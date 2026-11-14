/* QR Order — Google Apps Script backend.
 * Paste apps-script/ALL-IN-ONE.gs (core.js + this file) into one Code.gs.
 * Setup:
 *   1) Run setup() once (creates the Google Sheet + makes you the owner).
 *      Optional: run seedDemoData() to fill 30 days of sample orders.
 *   2) Deploy > Web app: Execute as "Me", Who has access "Anyone".
 * Admin login comes from the separate "QR Order Login" Apps Script (apps-script/Login.gs):
 * it hands back a Google-signed ID token, which the "login" action below exchanges for a 6-hour session.
 */
var SESSION_SECONDS = 21600; // CacheService max (6 h)
// true = the owner page needs no login (owner's choice 2026-11-14). Anyone with the API URL can then use owner actions.
// Set to false to require the Google login again (also set OPEN_ADMIN: false in docs/config.js).
var OPEN_ADMIN = true;

var SHEETS = {
  Menu: ['id', 'name', 'price', 'category', 'image', 'available', 'desc', 'sort', 'updated'],
  Orders: ['id', 'no', 'created', 'table', 'items', 'total', 'note', 'name', 'status', 'updated', 'servedAt'],
  Calls: ['id', 'created', 'table', 'type', 'done', 'doneAt'],
  Settings: ['key', 'value']
};
var ADMIN_ACTIONS_WRITE = { me: 1, getSettings: 1, rotateTableTokens: 1, setStatus: 1, payTable: 1, resolveCall: 1, saveMenuItem: 1, deleteMenuItem: 1, setAvailable: 1, saveSettings: 1, uploadImage: 1 };
var PUBLIC_ACTIONS = { menu: 1, placeOrder: 1, tableOrders: 1, callStaff: 1 };

/* ---------------- web entry ---------------- */
function doGet() { return json_({ ok: true, service: 'QR Order API' }); }

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (x) { return json_({ ok: false, error: 'bad json' }); }
  var action = String(body.action || ''), p = body.payload || {};
  var lock = null;
  try {
    if (action === 'login') return json_(login_(String(p.idToken || '')));
    var ctx = { now: new Date(), admin: false, email: '' };
    if (OPEN_ADMIN) ctx.admin = true;
    else if (body.token) {
      var email = sessionEmail_(String(body.token));
      if (email && isAdmin_(email)) { ctx.admin = true; ctx.email = email; }
      else if (!PUBLIC_ACTIONS[action]) return json_({ ok: false, code: 'AUTH', error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
    }
    if (action === 'placeOrder' || action === 'callStaff' || ADMIN_ACTIONS_WRITE[action]) {
      lock = LockService.getScriptLock(); lock.waitLock(20000);
    }
    var data;
    if (action === 'logout') { if (body.token) CacheService.getScriptCache().remove('sess_' + body.token); data = { ok: true }; }
    else if (action === 'uploadImage') {
      if (!ctx.admin) return json_({ ok: false, code: 'AUTH', error: 'กรุณาเข้าสู่ระบบ' });
      data = uploadImage_(p);
    } else {
      var store = SheetStore_(), oldImg = '';
      if (ctx.admin && (action === 'saveMenuItem' || action === 'deleteMenuItem')) {
        var id = action === 'deleteMenuItem' ? p.id : (p.item && p.item.id);
        store.getMenu().forEach(function (m) { if (m.id === id) oldImg = String(m.image || ''); });
      }
      data = QRCore.handle(store, action, p, ctx);
      if (oldImg && (action === 'deleteMenuItem' || String((data && data.image) || '') !== oldImg)) trashMenuImage_(oldImg);
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
// Verifies a Google-signed ID token from the Login script, then issues a random session id.
function login_(idToken) {
  if (!idToken) return { ok: false, code: 'AUTH', error: 'ไม่พบข้อมูลการเข้าสู่ระบบ' };
  var r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return { ok: false, code: 'AUTH', error: 'การเข้าสู่ระบบหมดอายุ กรุณาลองใหม่' };
  var j = JSON.parse(r.getContentText());
  if (String(j.email_verified) !== 'true' || !j.email) return { ok: false, code: 'AUTH', error: 'บัญชี Google นี้ยังไม่ยืนยันอีเมล' };
  if (Number(j.exp) * 1000 < Date.now()) return { ok: false, code: 'AUTH', error: 'การเข้าสู่ระบบหมดอายุ กรุณาลองใหม่' };
  var email = String(j.email).toLowerCase();
  var props = PropertiesService.getScriptProperties();
  var aud = props.getProperty('LOGIN_AUD');
  var owner = String(props.getProperty('OWNER_EMAIL') || '').toLowerCase();
  if (!aud) {
    // Trust-on-first-use: the owner's first login pins which Login script may vouch for users.
    if (email !== owner) return { ok: false, code: 'AUTH', error: 'เจ้าของร้าน (' + owner + ') ต้องเข้าสู่ระบบเป็นคนแรก' };
    props.setProperty('LOGIN_AUD', String(j.aud)); aud = String(j.aud);
  }
  if (String(j.aud) !== aud) return { ok: false, code: 'AUTH', error: 'ลิงก์เข้าสู่ระบบไม่ถูกต้อง' };
  if (!isAdmin_(email)) return { ok: false, code: 'NOT_ADMIN', error: 'บัญชี ' + email + ' ไม่มีสิทธิ์จัดการร้าน', email: email };
  var sid = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('sess_' + sid, email, SESSION_SECONDS);
  return { ok: true, data: { session: sid, email: email } };
}

function sessionEmail_(sid) {
  if (!/^[a-f0-9]{64}$/.test(sid)) return null;
  return CacheService.getScriptCache().get('sess_' + sid);
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
      var k = 'NO_' + day, maxNo = 0;
      // Never reuse a number already on today's orders (sample data, manual sheet edits, a lost property).
      this.getRecentOrders(new Date(day + 'T00:00:00+07:00').getTime()).forEach(function (o) { if (o.no > maxNo) maxNo = o.no; });
      var v = Math.max(Number(p.getProperty(k)) || 0, maxNo) + 1;
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
      var chunk = 400, end = n, oldRun = 0;
      while (end >= 2) {
        var start = Math.max(2, end - chunk + 1);
        var vals = s.getRange(start, 1, end - start + 1, w).getValues();
        var stop = false;
        for (var i = vals.length - 1; i >= 0; i--) {
          var o = {}; SHEETS.Orders.forEach(function (c, j) { o[c] = vals[i][j]; });
          if (!o.id) continue;
          o = parseOrder_(o);
          // Rows are *mostly* in time order (the demo top-up appends a little late), so only stop
          // after a long run of older rows instead of at the first one.
          if (new Date(o.created).getTime() < sinceMs) { if (++oldRun >= 60) { stop = true; break; } continue; }
          oldRun = 0;
          out.push(o);
        }
        if (stop) break;
        end = start - 1;
      }
      return out.sort(function (a, b) { return a.created < b.created ? -1 : a.created > b.created ? 1 : 0; });
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

// Moves an uploaded menu photo to the Drive trash (recoverable for 30 days) - only files in our own image folder.
function trashMenuImage_(url) {
  var m = /lh3\.googleusercontent\.com\/d\/([\w-]+)/.exec(url);
  var fid = PropertiesService.getScriptProperties().getProperty('IMG_FOLDER_ID');
  if (!m || !fid) return;
  try {
    var f = DriveApp.getFileById(m[1]), parents = f.getParents();
    while (parents.hasNext()) if (parents.next().getId() === fid) { f.setTrashed(true); return; }
  } catch (x) {}
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
  UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo', { muteHttpExceptions: true }); // ask for UrlFetch scope now
  Logger.log('Sheet: ' + book.getUrl() + '\nOwner: ' + Session.getEffectiveUser().getEmail());
}

/* Fills 30 days of sample orders (replaces the Orders sheet). */
function seedDemoData() {
  var now = new Date();
  var orders = QRCore.demoOrders(now, 30);
  var s = sh_('Orders'), n = s.getLastRow(), w = SHEETS.Orders.length;
  if (n > 1) s.getRange(2, 1, n - 1, w).clearContent();
  var need = orders.length + 1 + 200 - s.getMaxRows();
  if (need > 0) s.insertRowsAfter(s.getMaxRows(), need);
  s.getRange(1, 1, s.getMaxRows(), w).setNumberFormat('@');
  s.getRange(2, 1, orders.length, w).setValues(orders.map(function (o) { return toRow_('Orders', o); }));
  // keep today's running order number above the sample orders so real orders don't reuse a number
  var today = QRCore.dayKey(new Date()), maxNo = 0;
  orders.forEach(function (o) { if (QRCore.dayKey(o.created) === today && o.no > maxNo) maxNo = o.no; });
  PropertiesService.getScriptProperties().setProperty('NO_' + today, String(maxNo));
  PropertiesService.getScriptProperties().setProperty('DEMO_LAST_TICK', String(now.getTime()));
  var store = SheetStore_();
  store.saveMenu(QRCore.demoMenu());
  var st = store.getSettings();
  if (!st.shopName || st.shopName === QRCore.DEFAULT_SETTINGS.shopName) { st.shopName = 'ร้านก๋วยเตี๋ยวตัวอย่าง'; store.saveSettings(st); }
  Logger.log(orders.length + ' orders');
}

/* Clears all orders and calls (keeps menu + settings). */
function clearOrders() {
  ['Orders', 'Calls'].forEach(function (name) {
    var s = sh_(name), n = s.getLastRow();
    if (n > 1) s.deleteRows(2, n - 1);
  });
}

/* ---------------- demo shop: keep sample sales flowing ----------------
 * installDemoTrigger()  - run once: every hour, demoTick() adds the sample orders that "happened" since the last run,
 *                         so today's figures and the charts stay alive for prospects.
 * removeDemoTrigger()   - run before using the system for a real shop (then clearOrders()).
 */
function demoTick() {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var props = PropertiesService.getScriptProperties(), now = Date.now();
    var last = Number(props.getProperty('DEMO_LAST_TICK')) || now - 3600000;
    if (now - last > 3 * 864e5) last = now - 3 * 864e5; // after a long pause, back-fill at most 3 days
    var store = SheetStore_(), have = {};
    store.getRecentOrders(last - 3600000).forEach(function (o) { have[o.id] = 1; }); // idempotent: never add a sample order twice
    var orders = QRCore.demoOrdersBetween(last, now).filter(function (o) { return !have[o.id]; });
    if (orders.length) {
      var s = sh_('Orders'), w = SHEETS.Orders.length;
      orders.forEach(function (o) { o.no = store.nextOrderNo(QRCore.dayKey(o.created)); });
      var start = s.getLastRow() + 1, need = start + orders.length + 50 - s.getMaxRows();
      if (need > 0) s.insertRowsAfter(s.getMaxRows(), need);
      s.getRange(start, 1, orders.length, w).setNumberFormat('@')
        .setValues(orders.map(function (o) { return toRow_('Orders', o); }));
    }
    props.setProperty('DEMO_LAST_TICK', String(now));
    Logger.log('demoTick added ' + orders.length);
  } finally { lock.releaseLock(); }
}
function installDemoTrigger() {
  removeDemoTrigger();
  ScriptApp.newTrigger('demoTick').timeBased().everyHours(1).create();
  demoTick();
}
function removeDemoTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'demoTick') ScriptApp.deleteTrigger(t); });
}
