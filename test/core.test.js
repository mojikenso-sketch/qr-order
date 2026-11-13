const assert = require('assert');
const C = require('../docs/core.js');
function mem() {
  let menu = C.demoMenu(), orders = [], calls = [], settings = { ...C.DEFAULT_SETTINGS, tables: 5 }, nos = {};
  return {
    getSettings: () => settings, saveSettings: s => settings = s, getMenu: () => JSON.parse(JSON.stringify(menu)), saveMenu: l => menu = l,
    nextOrderNo: d => (nos[d] = (nos[d] || 0) + 1), addOrder: o => orders.push(o),
    updateOrder: (id, p) => { const o = orders.find(x => x.id === id); if (o) Object.assign(o, p); return o; },
    getRecentOrders: s => orders.filter(o => new Date(o.created) >= s),
    getOrdersBetween: (a, b) => orders.filter(o => { const k = C.dayKey(o.created); return k >= a && k <= b; }),
    getCalls: () => calls, addCall: c => calls.push(c), updateCall: (id, p) => Object.assign(calls.find(c => c.id === id) || {}, p)
  };
}
const st = mem(), A = { admin: true };
// public menu
const K = C.handle(st, 'getSettings', {}, { admin: true }).tableTokens;
const m = C.handle(st, 'menu');
assert.ok(!('tableTokens' in m.settings), 'tokens must not be public');
assert.throws(() => C.handle(st, 'placeOrder', { table: '3', items: [{ id: 'm1', qty: 1 }] }), /QR/);
assert.throws(() => C.handle(st, 'tableOrders', { table: '3', k: 'guess' }), /QR/);
assert.strictEqual(m.menu.length, 13);
// auth required
assert.throws(() => C.handle(st, 'live'), /เข้าสู่ระบบ/);
// order: server price wins, qty clamped
const o = C.handle(st, 'placeOrder', { table: '3', k: K[3], items: [{ id: 'm1', qty: 2, price: 1 }, { id: 'm8', qty: 999 }] });
assert.strictEqual(o.total, 60 * 2 + 40 * 50); assert.strictEqual(o.no, 1);
assert.throws(() => C.handle(st, 'placeOrder', { table: '9', items: [{ id: 'm1', qty: 1 }] }), /โต๊ะ/);
assert.throws(() => C.handle(st, 'placeOrder', { table: '3', k: K[3], items: [] }), /เลือก/);
C.handle(st, 'setAvailable', { id: 'm2', available: false }, A);
assert.throws(() => C.handle(st, 'placeOrder', { table: '1', k: K[1], items: [{ id: 'm2', qty: 1 }] }), /หมด/);
// live + status
let live = C.handle(st, 'live', {}, A);
assert.strictEqual(live.orders.length, 1);
C.handle(st, 'setStatus', { id: o.id, status: 'served' }, A);
// call + tableOrders + payTable
C.handle(st, 'callStaff', { table: '3', k: K[3], type: 'bill' });
assert.ok(C.handle(st, 'callStaff', { table: '3', k: K[3], type: 'bill' }).already);
let to = C.handle(st, 'tableOrders', { table: '3', k: K[3] });
assert.strictEqual(to.unpaidTotal, o.total); assert.deepStrictEqual(to.openCalls, ['bill']);
C.handle(st, 'payTable', { table: '3' }, A);
to = C.handle(st, 'tableOrders', { table: '3', k: K[3] });
assert.strictEqual(to.unpaidTotal, 0); assert.strictEqual(to.openCalls.length, 0);
// dashboard
const d = C.handle(st, 'dashboard', {}, A);
assert.strictEqual(d.kpi.orders, 1); assert.strictEqual(d.kpi.sales, o.total); assert.ok(d.insights.length);
// demo data dashboard over 30 days
const st2 = mem(); const now = new Date();
C.demoOrders(now, 30).forEach(x => st2.addOrder(x));
const d2 = C.handle(st2, 'dashboard', { from: C.addDays(C.dayKey(now), -29), to: C.dayKey(now) }, { admin: true, now });
assert.ok(d2.kpi.orders > 500, 'orders ' + d2.kpi.orders); assert.strictEqual(d2.daily.length, 30);
console.log('peak', d2.peakHour, 'top', d2.topQty[0].name, 'sales', d2.kpi.sales);
// menu CRUD + settings
const it = C.handle(st, 'saveMenuItem', { item: { name: 'ทดสอบ', price: 15, category: 'ของหวาน' } }, A);
assert.ok(it.id); C.handle(st, 'deleteMenuItem', { id: it.id }, A);
const s = C.handle(st, 'saveSettings', { settings: { shopName: 'X', tables: 8, promptpay: '081-234-5678', admins: 'A@Gmail.com, b@gmail.com' } }, A);
assert.strictEqual(s.promptpay, '0812345678'); assert.strictEqual(s.tableTokens[3], K[3], 'tokens kept on save');
const r = C.handle(st, 'rotateTableTokens', {}, A); assert.notStrictEqual(r.tableTokens[3], K[3]); assert.strictEqual(s.admins, 'a@gmail.com,b@gmail.com');
console.log('ALL TESTS PASS');
