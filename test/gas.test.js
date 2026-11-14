// Runs apps-script/ALL-IN-ONE.gs against an in-memory fake of SpreadsheetApp / PropertiesService / DriveApp etc.
// Usage: node test/gas.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');

function makeSheet(name) {
  const rows = []; let maxRows = 1000; const formats = [];
  const sh = {
    name, rows,
    getLastRow: () => { for (let i = rows.length - 1; i >= 0; i--) if (rows[i] && rows[i].some(v => v !== '' && v != null)) return i + 1; return 0; },
    getMaxRows: () => maxRows,
    insertRowsAfter: (_, n) => { maxRows += n; },
    appendRow: r => { rows[sh.getLastRow()] = r.slice(); if (rows.length > maxRows) maxRows = rows.length; },
    setFrozenRows: () => {},
    getRange: (r, c, nr = 1, nc = 1) => {
      if (r + nr - 1 > maxRows) throw new Error('Range out of bounds ' + name);
      const rg = {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const row = rows[r - 1 + i]; return row && row[c - 1 + j] != null ? row[c - 1 + j] : ''; })),
        setValues: v => { v.forEach((row, i) => { const R = rows[r - 1 + i] || (rows[r - 1 + i] = []); row.forEach((x, j) => { R[c - 1 + j] = x; }); }); return rg; },
        clearContent: () => { for (let i = 0; i < nr; i++) if (rows[r - 1 + i]) for (let j = 0; j < nc; j++) rows[r - 1 + i][c - 1 + j] = ''; return rg; },
        setNumberFormat: f => { formats.push(f); return rg; },
        createTextFinder: txt => ({ matchEntireCell: () => ({ findNext: () => {
          for (let i = 0; i < nr; i++) { const row = rows[r - 1 + i]; if (row && String(row[c - 1]) === String(txt)) return { getRow: () => r + i }; }
          return null; } }) })
      };
      return rg;
    }
  };
  return sh;
}
const book = { sheets: {}, getSheetByName: n => book.sheets[n] || null, insertSheet: n => (book.sheets[n] = makeSheet(n)),
  getSheets: () => Object.values(book.sheets), deleteSheet: () => {}, getId: () => 'BOOK', getUrl: () => 'url' };
const props = {}; const trashed = []; const triggers = [];
const ctx = {
  console, Date, Math, JSON, String, Number, Object, Array, Error, RegExp, isFinite, parseInt,
  SpreadsheetApp: { openById: () => book, create: () => book },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: k => { delete props[k]; }, getKeys: () => Object.keys(props) }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  CacheService: { getScriptCache: () => { const c = {}; return { get: k => c[k] || null, put: (k, v) => { c[k] = v; }, remove: k => { delete c[k]; } }; } },
  Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
  Utilities: { getUuid: () => Math.random().toString(16).slice(2).padEnd(32, '0'), base64Decode: s => Buffer.from(s, 'base64'),
    newBlob: () => ({}), computeDigest: () => [], base64EncodeWebSafe: () => '', DigestAlgorithm: {} },
  ContentService: { createTextOutput: t => ({ setMimeType: () => JSON.parse(t), t }), MimeType: { JSON: 'json' } },
  DriveApp: {
    getRootFolder: () => ({}),
    getFolderById: id => ({ getId: () => id }),
    createFolder: () => ({ getId: () => 'FOLDER', createFile: () => ({ getId: () => 'NEWFILE', setSharing() {} }) }),
    getFileById: id => ({ getParents: () => { let done = false; return { hasNext: () => !done, next: () => { done = true; return { getId: () => (id.startsWith('ours') ? 'FOLDER' : 'OTHER') }; } }; },
      setTrashed: () => trashed.push(id) }),
    Access: {}, Permission: {}
  },
  UrlFetchApp: { fetch: () => ({ getResponseCode: () => 500, getContentText: () => '{}' }) },
  ScriptApp: { getProjectTriggers: () => triggers.slice(), deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1),
    newTrigger: fn => ({ timeBased: () => ({ everyHours: () => ({ create: () => triggers.push({ getHandlerFunction: () => fn }) }) }) }) },
  Logger: { log: () => {} }
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script/ALL-IN-ONE.gs'), 'utf8'), ctx);
const post = (action, payload) => ctx.doPost({ postData: { contents: JSON.stringify({ action, payload }) } });

ctx.setup();
props.IMG_FOLDER_ID = 'FOLDER';
ctx.seedDemoData();
const orders = book.sheets.Orders;
const seeded = orders.getLastRow() - 1;
assert.ok(seeded > 800, 'seeded ' + seeded);

const me = post('me'); assert.ok(me.ok, JSON.stringify(me));
const K = me.data.settings.tableTokens;

// order numbers continue after today's sample orders
const todayKey = ctx.QRCore.dayKey(new Date());
const maxToday = Math.max(0, ...orders.rows.slice(1).filter(r => r && r[0] && ctx.QRCore.dayKey(r[2]) === todayKey).map(r => Number(r[1])));
delete props['NO_' + todayKey];            // simulate a lost counter
const o = post('placeOrder', { table: '4', k: K[4], items: [{ id: 'm1', qty: 2 }] });
assert.ok(o.ok, JSON.stringify(o)); assert.strictEqual(o.data.no, maxToday + 1, 'no reuse of today numbers');

// demoTick appends later sample orders AFTER a real order -> sheet not in time order; readers must still see everything
props.DEMO_LAST_TICK = String(Date.now() - 24 * 3600e3);
{ // simulate a day passing: drop sample rows from the last 24h (keep header + the real order), so demoTick has work to do
  const cut = Date.now() - 24 * 3600e3;
  const keep = orders.rows.filter((r, i) => i === 0 || (r && (r[0] === o.data.id || new Date(r[2]).getTime() <= cut)));
  orders.rows.length = 0; keep.forEach(r => orders.rows.push(r));
  // put the real order last but one, so appended demo rows land after it (out of time order)
}
const beforeTick = orders.getLastRow() - 1;
ctx.installDemoTrigger();
assert.strictEqual(triggers.length, 1, 'one hourly trigger');
const live = post('live'); assert.ok(live.ok && live.data.orders.some(x => x.id === o.data.id), 'real order still on board after demo rows appended');
const rec = post('recentOrders'); assert.ok(rec.data.some(x => x.id === o.data.id));
const d = post('dashboard', { from: todayKey, to: todayKey }); assert.ok(d.ok && d.data.kpi.orders > 0);
const ids = orders.rows.slice(1).filter(r => r && r[0]).map(r => r[0]);
assert.strictEqual(new Set(ids).size, ids.length, 'no duplicate order ids');
ctx.demoTick(); // immediately again: nothing new, no duplicates
const ids2 = orders.rows.slice(1).filter(r => r && r[0]).map(r => r[0]);
assert.strictEqual(ids2.length, ids.length, 'second tick adds nothing');
ctx.removeDemoTrigger(); assert.strictEqual(triggers.length, 0);

// table view: values that Sheets may hand back as numbers still match
orders.rows.forEach(r => { if (r && r[0] === o.data.id) r[3] = 4; });   // table stored as number
const tv = post('tableOrders', { table: '4', k: K[4] }); assert.ok(tv.ok && tv.data.orders.some(x => x.id === o.data.id));

// Drive photo cleanup: replacing/deleting trashes only our own uploads
const it = post('saveMenuItem', { item: { name: 'x', price: 1, image: 'https://lh3.googleusercontent.com/d/ours1=w600' } });
post('saveMenuItem', { item: Object.assign({}, it.data, { image: 'https://lh3.googleusercontent.com/d/ours2=w600' }) });
assert.deepStrictEqual(trashed, ['ours1']);
post('saveMenuItem', { item: Object.assign({}, it.data, { image: 'https://lh3.googleusercontent.com/d/ours2=w600', price: 2 }) });
assert.deepStrictEqual(trashed, ['ours1'], 'unchanged photo not trashed');
post('deleteMenuItem', { id: it.data.id });
assert.deepStrictEqual(trashed, ['ours1', 'ours2']);
const it2 = post('saveMenuItem', { item: { name: 'y', price: 1, image: 'https://lh3.googleusercontent.com/d/someoneelse=w600' } });
post('deleteMenuItem', { id: it2.data.id });
assert.deepStrictEqual(trashed, ['ours1', 'ours2'], 'never trash files outside our folder');
const it3 = post('saveMenuItem', { item: { name: 'z', price: 1, image: 'img/menu/m1.jpg' } });
post('deleteMenuItem', { id: it3.data.id });
assert.deepStrictEqual(trashed, ['ours1', 'ours2'], 'bundled photos untouched');

// formula guard
const f = post('placeOrder', { table: '4', k: K[4], items: [{ id: 'm1', qty: 1 }], note: '=1+1' });
const row = orders.rows.find(r => r && r[0] === f.data.id);
assert.strictEqual(row[6], "'=1+1");

console.log('GAS TESTS PASS (' + seeded + ' seeded, ' + (ids.length - beforeTick) + ' added by demoTick)');
assert.ok(ids.length - beforeTick > 20, 'demoTick added rows');
