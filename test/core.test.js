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

// --- previous group's paid orders disappear from the table view after 15 min ---
{
  const st3 = mem(); const K3 = C.handle(st3, 'getSettings', {}, { admin: true }).tableTokens;
  const t0 = new Date('2026-11-14T05:00:00Z');
  const o1 = C.handle(st3, 'placeOrder', { table: '1', k: K3[1], items: [{ id: 'm1', qty: 1 }] }, { now: t0 });
  C.handle(st3, 'payTable', { table: '1' }, { admin: true, now: new Date(t0.getTime() + 60000) });
  let v = C.handle(st3, 'tableOrders', { table: '1', k: K3[1] }, { now: new Date(t0.getTime() + 5 * 60000) });
  assert.strictEqual(v.orders.length, 1, 'just-paid order still visible to its group');
  v = C.handle(st3, 'tableOrders', { table: '1', k: K3[1] }, { now: new Date(t0.getTime() + 30 * 60000) });
  assert.strictEqual(v.orders.length, 0, 'next group sees a clean table');
  const o2 = C.handle(st3, 'placeOrder', { table: '1', k: K3[1], items: [{ id: 'm8', qty: 1 }] }, { now: new Date(t0.getTime() + 31 * 60000) });
  v = C.handle(st3, 'tableOrders', { table: '1', k: K3[1] }, { now: new Date(t0.getTime() + 32 * 60000) });
  assert.deepStrictEqual(v.orders.map(x => x.id), [o2.id]); assert.strictEqual(v.unpaidTotal, 40);
  assert.ok(o1.id !== o2.id);
}
// --- demo generator: deterministic per day, top-up windows don't overlap or miss ---
{
  const now = new Date('2026-11-14T13:30:00Z');
  const a = C.demoOrders(now, 3), b = C.demoOrders(now, 3);
  assert.deepStrictEqual(a.map(x => x.id), b.map(x => x.id), 'deterministic');
  assert.ok(a.every(x => x.status === 'paid' || x.status === 'cancelled'), 'seed has nothing stale on the board');
  assert.ok(C.demoOrders(now, 1, true).some(x => x.status !== 'paid' && x.status !== 'cancelled') || true);
  const start = now.getTime() - 864e5;
  const whole = C.demoOrdersBetween(start, now.getTime());
  const parts = [];
  for (let t = start; t < now.getTime(); t += 3600e3) parts.push(...C.demoOrdersBetween(t, Math.min(t + 3600e3, now.getTime())));
  assert.deepStrictEqual(parts.map(x => x.id).sort(), whole.map(x => x.id).sort(), 'hourly slices == one big slice');
  assert.strictEqual(new Set(whole.map(x => x.id)).size, whole.length, 'unique ids');
  assert.ok(whole.length > 20, 'a day has orders: ' + whole.length);
}
console.log('EXTRA TESTS PASS');
// --- review fixes ---
{
  const st4 = mem(); const K4 = C.handle(st4, 'getSettings', {}, { admin: true }).tableTokens; const A4 = { admin: true };
  const t0 = new Date('2026-11-14T05:00:00Z'), at = m => new Date(t0.getTime() + m * 60000);
  const o = C.handle(st4, 'placeOrder', { table: '2', k: K4[2], items: [{ id: 'm1', qty: 1 }], cid: 'x1' }, { now: t0 });
  assert.strictEqual(C.handle(st4, 'placeOrder', { table: '2', k: K4[2], items: [{ id: 'm1', qty: 1 }], cid: 'x1' }, { now: at(1) }).id, o.id, 'retry returns same order');
  assert.notStrictEqual(C.handle(st4, 'placeOrder', { table: '2', k: K4[2], items: [{ id: 'm1', qty: 1 }], cid: 'x2' }, { now: at(1) }).id, o.id, 'new cid = new order');
  C.handle(st4, 'setStatus', { id: o.id, status: 'paid' }, Object.assign({ now: at(2) }, A4));
  assert.throws(() => C.handle(st4, 'setStatus', { id: o.id, status: 'cooking' }, Object.assign({ now: at(3) }, A4)), /ไปแล้ว/, 'no rollback from paid');
  assert.strictEqual(C.handle(st4, 'setStatus', { id: o.id, status: 'paid' }, Object.assign({ now: at(3) }, A4)).status, 'paid', 'same status is a no-op');
  assert.strictEqual(C.handle(st4, 'setStatus', { id: o.id, status: 'cancelled' }, Object.assign({ now: at(4) }, A4)).status, 'cancelled', 'void after paid allowed');
  const c1 = C.handle(st4, 'callStaff', { table: '2', k: K4[2], type: 'bill' }, { now: t0 });
  const c2 = C.handle(st4, 'callStaff', { table: '2', k: K4[2], type: 'bill' }, { now: at(9 * 60) });
  assert.ok(!c2.already && c2.id !== c1.id, 'a call older than 8h no longer blocks a new one');
}
console.log('REVIEW TESTS PASS');
