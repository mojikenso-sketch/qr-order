/* QR Order — Google Apps Script backend.
 * Paste apps-script/ALL-IN-ONE.gs (core.js + this file) into one Code.gs.
 * Setup:
 *   1) Run setup() once (creates the Google Sheet + makes you the owner).
 *      Optional: run seedDemoData() to fill 30 days of sample orders.
 *   2) Set GOOGLE_CLIENT_ID below (OAuth Web client ID used by the admin login).
 *   3) Deploy > New deployment > Web app: Execute as "Me", Who has access "Anyone".
 */
var GOOGLE_CLIENT_ID = 'PASTE_GOOGLE_CLIENT_ID_HERE';

var SHEETS = {
  Menu: ['id', 'name', 'price', 'category', 'image', 'available', 'desc', 'sort', 'updated'],
  Orders: ['id', 'no', 'created', 'table', 'items', 'total', 'note', 'name', 'status', 'updated', 'servedAt'],
  Calls: ['id', 'created', 'table', 'type', 'done', 'doneAt'],
  Settings: ['key', 'value']
};
var ADMIN_ACTIONS_WRITE = { me: 1, getSettings: 1, rotateTableTokens: 1, setStatus: 1, payTable: 1, resolveCall: 1, saveMenuItem: 1, deleteMenuItem: 1, setAvailable: 1, saveSettings: 1, uploadImage: 1 };

/* ---------------- web entry ---------------- */
function doGet() { return json_({ ok: true, service: 'QR Order API' }); }

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (x) { return json_({ ok: false, error: 'bad json' }); }
  var action = String(body.action || ''), p = body.payload || {};
  var lock = null;
  try {
    var ctx = { now: new Date(), admin: false, email: '' };
    if (body.token) {
      var email = verifyIdToken_(body.token);
      if (email) {
        if (!isAdmin_(email)) return json_({ ok: false, code: 'NOT_ADMIN', error: 'บัญชี ' + email + ' ไม่มีสิทธิ์จัดการร้าน', email: email });
        ctx.admin = true; ctx.email = email;
      } else if (action !== 'menu' && action !== 'placeOrder' && action !== 'tableOrders' && action !== 'callStaff') {
        return json_({ ok: false, code: 'AUTH', error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
      }
    }
    if (action === 'placeOrder' || action === 'callStaff' || ADMIN_ACTIONS_WRITE[action]) {
      lock = LockService.getScriptLock(); lock.waitLock(20000);
    }
    var data;
    if (action === 'uploadImage') {
      if (!ctx.admin) return json_({ ok: false, code: 'AUTH', error: 'กรุณาเข้าสู่ระบบ' });
      data = uploadImage_(p);
    } else {
      data = QRCore.handle(SheetStore_(), action, p, ctx);
    }
    return json_({ ok: true, data: data });
  } catch (err) {
    return json_({ ok: false, code: err.code || 'ERROR', error: String(err.message || err) });
  } finally {
    if (lock) try { lock.releaseLock(); } catch (x) {}
  }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ---------------- auth ---------------- */
function verifyIdToken_(tok) {
  var cache = CacheService.getScriptCache();
  var key = 'tok_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, tok)).slice(0, 43);
  var hit = cache.get(key);
  if (hit) return hit;
  var r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(tok), { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return null;
  var j = JSON.parse(r.getContentText());
  if (j.aud !== GOOGLE_CLIENT_ID) return null;
  if (String(j.email_verified) !== 'true') return null;
  var ttl = Math.floor(Number(j.exp) - Date.now() / 1000);
  if (ttl < 30) return null;
  var email = String(j.email).toLowerCase();
  cache.put(key, email, Math.min(ttl, 3000));
  return email;
}

function isAdmin_(email) {
  var owner = PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL') || '';
  if (owner && email === owner.toLowerCase()) return true;
  var s = QRCore.settings(SheetStore_());
  return String(s.admins || '').toLowerCase().split(/[,\s]+/).indexOf(email) >= 0;
}

/* ---------------- sheet store ---------------- */
function ss_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('ยังไม่ได้รัน setup()');
  return SpreadsheetApp.openById(id);
}
function sh_(name) {
  var s = ss_().getSheetByName(name);
  if (!s) {
    s = ss_().insertSheet(name);
    s.getRange(1, 1, s.getMaxRows(), SHEETS[name].length).setNumberFormat('@'); // keep "0812..." / ISO dates as text
    s.appendRow(SHEETS[name]); s.setFrozenRows(1);
  }
  return s;
}
function readRows_(name) {
  var s = sh_(name), n = s.getLastRow();
  if (n < 2) return [];
  var cols = SHEETS[name];
  return s.getRange(2, 1, n - 1, cols.length).getValues().map(function (r) {
    var o = {}; cols.forEach(function (c, i) { o[c] = r[i]; }); return o;
  });
}
function toRow_(name, o) {
  return SHEETS[name].map(function (c) {
    var v = o[c];
    if (v === undefined || v === null) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    if (typeof v === 'string' && /^[-=+@]/.test(v) || typeof v === 'string' && (v.charCodeAt(0) === 9 || v.charCodeAt(0) === 13)) return "'" + v; // never let customer text become a formula
    return v;
  });
}
function parseOrder_(o) {
  o.id = String(o.id); o.table = String(o.table); o.no = Number(o.no);
  o.created = iso_(o.created); o.updated = iso_(o.updated); o.servedAt = o.servedAt ? iso_(o.servedAt) : '';
  try { o.items = JSON.parse(o.items || '[]'); } catch (x) { o.items = []; }
  o.total = Number(o.total) || 0; o.note = String(o.note || ''); o.name = String(o.name || '');
  return o;
}
function iso_(v) { return v instanceof Date ? v.toISOString() : String(v || ''); }
function findRow_(name, id) {
  var s = sh_(name), n = s.getLastRow();
  if (n < 2) return 0;
  var f = s.getRange(2, 1, n - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  return f ? f.getRow() : 0;
}

function SheetStore_() {
  return {
    getSettings: function () {
      var o = {}; readRows_('Settings').forEach(function (r) { o[r.key] = r.value; }); return o;
    },
    saveSettings: function (obj) {
      var s = sh_('Settings'), n = s.getLastRow();
      if (n > 1) s.getRange(2, 1, n - 1, 2).clearContent();
      var rows = Object.keys(obj).map(function (k) { return [k, obj[k]]; });
      if (rows.length) s.getRange(2, 1, rows.length, 2).setValues(rows);
    },
    getMenu: function () {
      return readRows_('Menu').filter(function (m) { return m.id; }).map(function (m) { m.updated = iso_(m.updated); return m; });
    },
    saveMenu: function (list) {
      var s = sh_('Menu'), n = s.getLastRow(), w = SHEETS.Menu.length;
      if (n > 1) s.getRange(2, 1, n - 1, w).clearContent();
      if (list.length) s.getRange(2, 1, list.length, w).setValues(list.map(function (m) { return toRow_('Menu', m); }));
    },
    nextOrderNo: function (day) {
      var p = PropertiesService.getScriptProperties();
      var k = 'NO_' + day, v = (Number(p.getProperty(k)) || 0) + 1;
      p.setProperty(k, String(v));
      if (v === 1) { // tidy old counters
        p.getKeys().forEach(function (x) { if (x.indexOf('NO_') === 0 && x < 'NO_' + QRCore.addDays(day, -3)) p.deleteProperty(x); });
      }
      return v;
    },
    addOrder: function (o) { sh_('Orders').appendRow(toRow_('Orders', o)); },
    updateOrder: function (id, patch) {
      var row = findRow_('Orders', id);
      if (!row) return null;
      var s = sh_('Orders'), w = SHEETS.Orders.length;
      var vals = s.getRange(row, 1, 1, w).getValues()[0], o = {};
      SHEETS.Orders.forEach(function (c, i) { o[c] = vals[i]; });
      o = parseOrder_(o);
      for (var k in patch) o[k] = patch[k];
      s.getRange(row, 1, 1, w).setValues([toRow_('Orders', o)]);
      return o;
    },
    // Orders are appended in time order, so read from the bottom up.
    getRecentOrders: function (sinceMs) {
      var s = sh_('Orders'), n = s.getLastRow(), out = [], w = SHEETS.Orders.length;
      var chunk = 400, end = n;
      while (end >= 2) {
        var start = Math.max(2, end - chunk + 1);
        var vals = s.getRange(start, 1, end - start + 1, w).getValues();
        var stop = false;
        for (var i = vals.length - 1; i >= 0; i--) {
          var o = {}; SHEETS.Orders.forEach(function (c, j) { o[c] = vals[i][j]; });
          if (!o.id) continue;
          o = parseOrder_(o);
          if (new Date(o.created).getTime() < sinceMs) { stop = true; break; }
          out.push(o);
        }
        if (stop) break;
        end = start - 1;
      }
      return out.reverse();
    },
    getOrdersBetween: function (fromKey, toKey) {
      var since = new Date(fromKey + 'T00:00:00+07:00').getTime();
      return this.getRecentOrders(since).filter(function (o) { return QRCore.dayKey(o.created) <= toKey; });
    },
    getCalls: function () {
      var since = Date.now() - 2 * 864e5;
      return readRows_('Calls').filter(function (c) { return c.id; }).map(function (c) {
        c.created = iso_(c.created); c.doneAt = iso_(c.doneAt); c.table = String(c.table); c.done = c.done === true || c.done === 'TRUE' || c.done === 'true';
        return c;
      }).filter(function (c) { return !c.done || new Date(c.created).getTime() > since; });
    },
    addCall: function (c) { sh_('Calls').appendRow(toRow_('Calls', c)); },
    updateCall: function (id, patch) {
      var row = findRow_('Calls', id);
      if (!row) return;
      var s = sh_('Calls'), w = SHEETS.Calls.length, vals = s.getRange(row, 1, 1, w).getValues()[0], o = {};
      SHEETS.Calls.forEach(function (c, i) { o[c] = vals[i]; });
      for (var k in patch) o[k] = patch[k];
      s.getRange(row, 1, 1, w).setValues([toRow_('Calls', o)]);
    }
  };
}

/* ---------------- images ---------------- */
function uploadImage_(p) {
  var m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(p.dataUrl || ''));
  if (!m) throw new Error('ไฟล์รูปไม่ถูกต้อง');
  var bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > 1.5 * 1024 * 1024) throw new Error('รูปใหญ่เกินไป');
  var props = PropertiesService.getScriptProperties(), fid = props.getProperty('IMG_FOLDER_ID'), folder;
  try { folder = fid && DriveApp.getFolderById(fid); } catch (x) { folder = null; }
  if (!folder) { folder = DriveApp.createFolder('QR Order - รูปเมนู'); props.setProperty('IMG_FOLDER_ID', folder.getId()); }
  var file = folder.createFile(Utilities.newBlob(bytes, m[1], 'menu-' + Date.now() + '.' + m[1].split('/')[1]));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { url: 'https://lh3.googleusercontent.com/d/' + file.getId() + '=w600' };
}

/* ---------------- setup (run by hand in the editor) ---------------- */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID'), book;
  try { book = id && SpreadsheetApp.openById(id); } catch (x) { book = null; }
  if (!book) { book = SpreadsheetApp.create('QR Order - ข้อมูลร้าน'); props.setProperty('SHEET_ID', book.getId()); }
  Object.keys(SHEETS).forEach(function (n) { sh_(n); });
  var first = book.getSheetByName('Sheet1') || book.getSheetByName('ชีต1');
  if (first && book.getSheets().length > 1) book.deleteSheet(first);
  props.setProperty('OWNER_EMAIL', Session.getEffectiveUser().getEmail());
  var store = SheetStore_();
  if (!store.getMenu().length) store.saveMenu(QRCore.demoMenu());
  if (!Object.keys(store.getSettings()).length) store.saveSettings(QRCore.DEFAULT_SETTINGS);
  DriveApp.getRootFolder(); // ask for Drive scope now (menu images)
  UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true }); // ask for UrlFetch scope now
  Logger.log('Sheet: ' + book.getUrl() + '\nOwner: ' + Session.getEffectiveUser().getEmail());
}

/* Fills 30 days of sample orders (replaces the Orders sheet). */
function seedDemoData() {
  var orders = QRCore.demoOrders(new Date(), 30);
  var s = sh_('Orders'), n = s.getLastRow(), w = SHEETS.Orders.length;
  if (n > 1) s.getRange(2, 1, n - 1, w).clearContent();
  var need = orders.length + 1 + 200 - s.getMaxRows();
  if (need > 0) s.insertRowsAfter(s.getMaxRows(), need);
  s.getRange(1, 1, s.getMaxRows(), w).setNumberFormat('@');
  s.getRange(2, 1, orders.length, w).setValues(orders.map(function (o) { return toRow_('Orders', o); }));
  SheetStore_().saveMenu(QRCore.demoMenu());
  Logger.log(orders.length + ' orders');
}

/* Clears all orders and calls (keeps menu + settings). */
function clearOrders() {
  ['Orders', 'Calls'].forEach(function (name) {
    var s = sh_(name), n = s.getLastRow();
    if (n > 1) s.deleteRows(2, n - 1);
  });
}
