/* QR Order — shared business logic.
 * Runs in the browser (demo mode, localStorage store) AND in Google Apps Script
 * (concatenated into apps-script/ALL-IN-ONE.gs by tools/build-gas.js).
 * Keep it plain ES5-ish JS with no DOM / no GAS APIs. */
var QRCore = (function () {
  var TZ = 7 * 3600000; // Asia/Bangkok
  var STATUSES = ['new', 'cooking', 'served', 'paid', 'cancelled'];
  var DOW_TH = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  var DEFAULT_SETTINGS = {
    shopName: 'ร้านของฉัน',
    tables: 10,
    promptpay: '',
    accepting: true,
    notice: '',
    categories: 'เมนูแนะนำ,อาหาร,เครื่องดื่ม,ของหวาน',
    admins: ''
  };

  function bk(d) { return new Date(new Date(d).getTime() + TZ); }
  function dayKey(d) { return bk(d).toISOString().slice(0, 10); }
  function hourOf(d) { return bk(d).getUTCHours(); }
  function dowOf(d) { return bk(d).getUTCDay(); }
  function addDays(key, n) {
    var d = new Date(key + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5); }
  function uid(p) { return (p || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function num(v) { v = Number(v); return isFinite(v) ? v : 0; }
  function str(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 200); }
  function bool(v) { return v === true || v === 'true' || v === 1 || v === '1' || v === 'TRUE'; }
  function fail(msg, code) { var e = new Error(msg); e.code = code || 'BAD_REQUEST'; return e; }
  function round2(n) { return Math.round(n * 100) / 100; }

  function settings(store) {
    var s = store.getSettings() || {}, out = {};
    for (var k in DEFAULT_SETTINGS) out[k] = (s[k] === undefined || s[k] === '') ? DEFAULT_SETTINGS[k] : s[k];
    out.tables = Math.max(1, Math.min(200, parseInt(out.tables, 10) || 10));
    out.accepting = bool(out.accepting);
    return out;
  }
  function publicSettings(s) {
    return { shopName: s.shopName, tables: s.tables, promptpay: s.promptpay, accepting: s.accepting, notice: s.notice, categories: s.categories };
  }
  function normMenu(m) {
    return {
      id: str(m.id, 40), name: str(m.name, 80), price: round2(num(m.price)), category: str(m.category, 40) || 'อาหาร',
      image: str(m.image, 500), available: m.available === undefined ? true : bool(m.available),
      desc: str(m.desc, 200), sort: num(m.sort), updated: str(m.updated, 40)
    };
  }
  function sortMenu(list) {
    return list.sort(function (a, b) { return (a.sort - b.sort) || a.name.localeCompare(b.name, 'th'); });
  }
  function publicOrder(o) {
    return { id: o.id, no: o.no, created: o.created, table: o.table, items: o.items, total: o.total, note: o.note, name: o.name, status: o.status, servedAt: o.servedAt || '' };
  }

  /* ---------------- public (customer) ---------------- */
  function getMenu(store) {
    var s = settings(store);
    var menu = sortMenu(store.getMenu().map(normMenu)).map(function (m) {
      return { id: m.id, name: m.name, price: m.price, category: m.category, image: m.image, available: m.available, desc: m.desc };
    });
    return { settings: publicSettings(s), menu: menu };
  }

  function validTable(s, t) {
    t = str(t, 10);
    var n = parseInt(t, 10);
    if (!n || n < 1 || n > s.tables || String(n) !== t) throw fail('เลขโต๊ะไม่ถูกต้อง');
    return String(n);
  }

  function placeOrder(store, p, now) {
    now = now || new Date();
    var s = settings(store);
    if (!s.accepting) throw fail('ขณะนี้ร้านปิดรับออเดอร์ชั่วคราว', 'CLOSED');
    var table = validTable(s, p.table);
    var byId = {};
    store.getMenu().map(normMenu).forEach(function (m) { byId[m.id] = m; });
    var lines = (p.items || []).slice(0, 60);
    var items = [];
    lines.forEach(function (l) {
      var m = byId[l.id];
      if (!m) throw fail('ไม่พบเมนูนี้แล้ว กรุณารีเฟรชหน้า');
      if (!m.available) throw fail('ขออภัย "' + m.name + '" หมดแล้ว', 'SOLD_OUT');
      var qty = Math.max(1, Math.min(50, parseInt(l.qty, 10) || 1));
      items.push({ id: m.id, name: m.name, price: m.price, qty: qty, note: str(l.note, 100), cat: m.category });
    });
    if (!items.length) throw fail('ยังไม่ได้เลือกเมนู');
    var total = round2(items.reduce(function (a, i) { return a + i.price * i.qty; }, 0));
    var iso = now.toISOString();
    var order = {
      id: uid('o'), no: store.nextOrderNo(dayKey(now)), created: iso, table: table, items: items, total: total,
      note: str(p.note, 200), name: str(p.name, 40), status: 'new', updated: iso, servedAt: ''
    };
    store.addOrder(order);
    return publicOrder(order);
  }

  function tableOrders(store, p, now) {
    now = now || new Date();
    var s = settings(store);
    var table = validTable(s, p.table);
    var since = now.getTime() - 8 * 3600000;
    var list = store.getRecentOrders(since).filter(function (o) { return o.table === table && o.status !== 'cancelled'; });
    var unpaid = list.filter(function (o) { return o.status !== 'paid'; });
    var calls = store.getCalls().filter(function (c) { return c.table === table && !bool(c.done) && new Date(c.created).getTime() > since; });
    return {
      orders: list.map(publicOrder).reverse(),
      unpaidTotal: round2(unpaid.reduce(function (a, o) { return a + num(o.total); }, 0)),
      openCalls: calls.map(function (c) { return c.type; }),
      promptpay: s.promptpay, shopName: s.shopName
    };
  }

  function callStaff(store, p, now) {
    now = now || new Date();
    var s = settings(store);
    var table = validTable(s, p.table);
    var type = ({ staff: 1, bill: 1, water: 1 })[p.type] ? p.type : 'staff';
    var open = store.getCalls().filter(function (c) { return c.table === table && c.type === type && !bool(c.done); });
    if (open.length) return { id: open[0].id, already: true };
    var c = { id: uid('c'), created: now.toISOString(), table: table, type: type, done: false, doneAt: '' };
    store.addCall(c);
    return { id: c.id };
  }

  /* ---------------- admin ---------------- */
  function live(store, now) {
    now = now || new Date();
    var since = now.getTime() - 24 * 3600000;
    var orders = store.getRecentOrders(since).filter(function (o) {
      return o.status === 'new' || o.status === 'cooking' || o.status === 'served';
    });
    var calls = store.getCalls().filter(function (c) { return !bool(c.done) && new Date(c.created).getTime() > since; });
    var today = dayKey(now), todaySales = 0, todayOrders = 0;
    store.getRecentOrders(now.getTime() - 26 * 3600000).forEach(function (o) {
      if (o.status !== 'cancelled' && dayKey(o.created) === today) { todaySales += num(o.total); todayOrders++; }
    });
    return {
      orders: orders.map(publicOrder), calls: calls, serverTime: now.toISOString(),
      today: { sales: round2(todaySales), orders: todayOrders }
    };
  }

  function setStatus(store, p, now) {
    now = now || new Date();
    if (STATUSES.indexOf(p.status) < 0) throw fail('สถานะไม่ถูกต้อง');
    var patch = { status: p.status, updated: now.toISOString() };
    if (p.status === 'served') patch.servedAt = now.toISOString();
    var o = store.updateOrder(str(p.id, 40), patch);
    if (!o) throw fail('ไม่พบออเดอร์');
    return publicOrder(o);
  }

  function payTable(store, p, now) {
    now = now || new Date();
    var table = str(p.table, 10), n = 0;
    store.getRecentOrders(now.getTime() - 24 * 3600000).forEach(function (o) {
      if (o.table === table && (o.status === 'new' || o.status === 'cooking' || o.status === 'served')) {
        var patch = { status: 'paid', updated: now.toISOString() };
        if (!o.servedAt) patch.servedAt = now.toISOString();
        store.updateOrder(o.id, patch); n++;
      }
    });
    store.getCalls().forEach(function (c) {
      if (c.table === table && !bool(c.done)) store.updateCall(c.id, { done: true, doneAt: now.toISOString() });
    });
    return { paid: n };
  }

  function resolveCall(store, p, now) {
    store.updateCall(str(p.id, 40), { done: true, doneAt: (now || new Date()).toISOString() });
    return { ok: true };
  }

  function menuAll(store) { return sortMenu(store.getMenu().map(normMenu)); }

  function saveMenuItem(store, p, now) {
    now = now || new Date();
    var it = normMenu(p.item || {});
    if (!it.name) throw fail('กรุณาใส่ชื่อเมนู');
    if (it.price < 0 || it.price > 100000) throw fail('ราคาไม่ถูกต้อง');
    var list = store.getMenu().map(normMenu);
    it.updated = now.toISOString();
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].id === it.id) idx = i;
    if (idx >= 0) list[idx] = it;
    else {
      it.id = uid('m');
      if (!it.sort) it.sort = list.reduce(function (a, m) { return Math.max(a, m.sort); }, 0) + 10;
      list.push(it);
    }
    store.saveMenu(list);
    return it;
  }

  function deleteMenuItem(store, p) {
    var list = store.getMenu().map(normMenu).filter(function (m) { return m.id !== p.id; });
    store.saveMenu(list);
    return { ok: true };
  }

  function setAvailable(store, p, now) {
    var list = store.getMenu().map(normMenu), hit = null;
    list.forEach(function (m) { if (m.id === p.id) { m.available = bool(p.available); m.updated = (now || new Date()).toISOString(); hit = m; } });
    if (!hit) throw fail('ไม่พบเมนู');
    store.saveMenu(list);
    return hit;
  }

  function saveSettings(store, p) {
    var cur = settings(store), inc = p.settings || {};
    var out = {
      shopName: str(inc.shopName, 60) || cur.shopName,
      tables: Math.max(1, Math.min(200, parseInt(inc.tables, 10) || cur.tables)),
      promptpay: str(inc.promptpay, 20).replace(/[^0-9]/g, ''),
      accepting: inc.accepting === undefined ? cur.accepting : bool(inc.accepting),
      notice: str(inc.notice, 200),
      categories: str(inc.categories, 300) || cur.categories,
      admins: str(inc.admins, 1000).toLowerCase().replace(/\s+/g, '')
    };
    store.saveSettings(out);
    return out;
  }

  /* ---------------- analytics ---------------- */
  function dashboard(store, p, now) {
    now = now || new Date();
    var to = /^\d{4}-\d{2}-\d{2}$/.test(p.to || '') ? p.to : dayKey(now);
    var from = /^\d{4}-\d{2}-\d{2}$/.test(p.from || '') ? p.from : to;
    if (from > to) { var t = from; from = to; to = t; }
    var span = daysBetween(from, to) + 1;
    if (span > 400) throw fail('ช่วงวันที่ยาวเกินไป (สูงสุด 400 วัน)');
    var pFrom = addDays(from, -span), pTo = addDays(from, -1);
    var all = store.getOrdersBetween(pFrom, to);
    var cur = [], prev = [], cancelled = 0;
    all.forEach(function (o) {
      var k = dayKey(o.created);
      if (o.status === 'cancelled') { if (k >= from && k <= to) cancelled++; return; }
      if (k >= from && k <= to) cur.push(o); else if (k >= pFrom && k <= pTo) prev.push(o);
    });
    function sum(list) { return round2(list.reduce(function (a, o) { return a + num(o.total); }, 0)); }

    var hourly = [], heat = [], daily = {}, items = {}, cats = {}, tables = {}, i;
    for (i = 0; i < 24; i++) hourly.push({ hour: i, orders: 0, sales: 0 });
    for (i = 0; i < 7; i++) { heat.push([]); for (var h = 0; h < 24; h++) heat[i].push(0); }
    for (i = 0; i < span; i++) daily[addDays(from, i)] = { date: addDays(from, i), orders: 0, sales: 0 };
    var serveMins = [], itemsSold = 0, dowSales = [0, 0, 0, 0, 0, 0, 0], dowDays = [0, 0, 0, 0, 0, 0, 0];
    Object.keys(daily).forEach(function (k) { dowDays[new Date(k + 'T00:00:00Z').getUTCDay()]++; });

    cur.forEach(function (o) {
      var hr = hourOf(o.created), dw = dowOf(o.created), k = dayKey(o.created), tot = num(o.total);
      hourly[hr].orders++; hourly[hr].sales += tot; heat[dw][hr]++; dowSales[dw] += tot;
      if (daily[k]) { daily[k].orders++; daily[k].sales += tot; }
      var tb = tables[o.table] || (tables[o.table] = { table: o.table, orders: 0, sales: 0 });
      tb.orders++; tb.sales += tot;
      (o.items || []).forEach(function (it) {
        var key = it.id || it.name;
        var r = items[key] || (items[key] = { id: it.id, name: it.name, qty: 0, sales: 0, cat: it.cat || '' });
        r.qty += num(it.qty); r.sales += num(it.qty) * num(it.price); r.name = it.name;
        itemsSold += num(it.qty);
        var c = it.cat || 'อื่นๆ';
        cats[c] = (cats[c] || 0) + num(it.qty) * num(it.price);
      });
      if (o.servedAt) {
        var m = (new Date(o.servedAt) - new Date(o.created)) / 60000;
        if (m >= 0 && m < 240) serveMins.push(m);
      }
    });
    hourly.forEach(function (x) { x.sales = round2(x.sales); });
    var itemList = Object.keys(items).map(function (k) { items[k].sales = round2(items[k].sales); return items[k]; });
    var topQty = itemList.slice().sort(function (a, b) { return b.qty - a.qty || b.sales - a.sales; }).slice(0, 10);
    var topSales = itemList.slice().sort(function (a, b) { return b.sales - a.sales; }).slice(0, 10);
    var catList = Object.keys(cats).map(function (k) { return { category: k, sales: round2(cats[k]) }; })
      .sort(function (a, b) { return b.sales - a.sales; });
    var tableList = Object.keys(tables).map(function (k) { tables[k].sales = round2(tables[k].sales); return tables[k]; })
      .sort(function (a, b) { return b.sales - a.sales; });
    var sold = {};
    itemList.forEach(function (x) { sold[x.id] = 1; });
    var unsold = store.getMenu().map(normMenu).filter(function (m) { return m.available && !sold[m.id]; }).map(function (m) { return m.name; });

    var sales = sum(cur), prevSales = sum(prev);
    var avgServe = serveMins.length ? Math.round(serveMins.reduce(function (a, b) { return a + b; }, 0) / serveMins.length) : null;
    var peak = hourly.slice().sort(function (a, b) { return b.orders - a.orders; })[0];
    var dowAvg = dowSales.map(function (v, d) { return dowDays[d] ? v / dowDays[d] : 0; });
    var bestDow = -1, bestDowVal = 0;
    dowAvg.forEach(function (v, d) { if (v > bestDowVal) { bestDowVal = v; bestDow = d; } });

    var insights = [];
    if (cur.length) {
      if (peak.orders) insights.push({ icon: 'clock', text: 'ช่วงเวลาที่ลูกค้าสั่งเยอะที่สุดคือ ' + pad(peak.hour) + ':00–' + pad(peak.hour + 1) + ':00 น. (' + peak.orders + ' ออเดอร์) ควรเตรียมวัตถุดิบและคนให้พร้อมก่อนช่วงนี้' });
      if (topQty[0]) insights.push({ icon: 'crown', text: 'เมนูขายดีอันดับ 1 คือ "' + topQty[0].name + '" ขายได้ ' + topQty[0].qty + ' ที่ รวม ' + fmt(topQty[0].sales) + ' บาท' });
      if (prev.length) {
        var ch = prevSales ? (sales - prevSales) / prevSales * 100 : 0;
        insights.push({ icon: ch >= 0 ? 'up' : 'down', text: 'ยอดขาย' + (ch >= 0 ? 'เพิ่มขึ้น ' : 'ลดลง ') + Math.abs(ch).toFixed(1) + '% เมื่อเทียบกับ ' + span + ' วันก่อนหน้า' });
      }
      if (span >= 7 && bestDow >= 0) insights.push({ icon: 'calendar', text: 'วัน' + DOW_TH[bestDow] + 'ขายดีที่สุด เฉลี่ย ' + fmt(bestDowVal) + ' บาท/วัน' });
      if (avgServe !== null) insights.push({ icon: 'timer', text: 'เวลาตั้งแต่สั่งจนเสิร์ฟเฉลี่ย ' + avgServe + ' นาที' + (avgServe > 20 ? ' — ช้ากว่าที่ลูกค้าส่วนใหญ่ยอมรอ (15–20 นาที)' : '') });
      if (unsold.length) insights.push({ icon: 'alert', text: 'เมนูที่ยังไม่มีคนสั่งในช่วงนี้: ' + unsold.slice(0, 5).join(', ') + (unsold.length > 5 ? ' และอีก ' + (unsold.length - 5) + ' รายการ' : '') + ' — ลองย้ายขึ้นเมนูแนะนำหรือปรับราคา' });
    }

    return {
      from: from, to: to, span: span,
      kpi: {
        sales: sales, orders: cur.length, avg: cur.length ? round2(sales / cur.length) : 0, itemsSold: itemsSold,
        prevSales: prevSales, prevOrders: prev.length, cancelled: cancelled, avgServeMin: avgServe,
        perDay: round2(sales / span)
      },
      hourly: hourly, daily: Object.keys(daily).sort().map(function (k) { daily[k].sales = round2(daily[k].sales); return daily[k]; }),
      heat: heat, topQty: topQty, topSales: topSales, categories: catList, tables: tableList, unsold: unsold,
      peakHour: peak.orders ? peak.hour : null, bestDow: bestDow, insights: insights
    };
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmt(n) { return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }); }

  /* ---------------- router ---------------- */
  var PUBLIC = { menu: 1, placeOrder: 1, tableOrders: 1, callStaff: 1 };
  function handle(store, action, p, ctx) {
    p = p || {}; ctx = ctx || {};
    var now = ctx.now || new Date();
    if (!PUBLIC[action] && !ctx.admin) throw fail('กรุณาเข้าสู่ระบบ', 'AUTH');
    switch (action) {
      case 'menu': return getMenu(store);
      case 'placeOrder': return placeOrder(store, p, now);
      case 'tableOrders': return tableOrders(store, p, now);
      case 'callStaff': return callStaff(store, p, now);
      case 'me': return { email: ctx.email || '', settings: settings(store) };
      case 'live': return live(store, now);
      case 'recentOrders': return store.getRecentOrders(now.getTime() - 864e5).slice(-60).reverse().map(publicOrder);
      case 'setStatus': return setStatus(store, p, now);
      case 'payTable': return payTable(store, p, now);
      case 'resolveCall': return resolveCall(store, p, now);
      case 'dashboard': return dashboard(store, p, now);
      case 'menuAll': return menuAll(store);
      case 'saveMenuItem': return saveMenuItem(store, p, now);
      case 'deleteMenuItem': return deleteMenuItem(store, p);
      case 'setAvailable': return setAvailable(store, p, now);
      case 'getSettings': return settings(store);
      case 'saveSettings': return saveSettings(store, p);
    }
    throw fail('ไม่รู้จักคำสั่ง ' + action);
  }

  /* ---------------- demo data ---------------- */
  function demoMenu() {
    var rows = [
      ['ก๋วยเตี๋ยวหมูน้ำใส', 60, 'เมนูแนะนำ', 'เส้นเล็ก/เส้นใหญ่/บะหมี่ หมูสับ หมูชิ้น ลูกชิ้น'],
      ['ผัดกะเพราหมูสับ + ไข่ดาว', 70, 'เมนูแนะนำ', 'เผ็ดได้ตามสั่ง'],
      ['ข้าวมันไก่', 55, 'อาหาร', 'ไก่ต้มนุ่ม น้ำจิ้มเต้าเจี้ยว'],
      ['ข้าวผัดหมู', 60, 'อาหาร', ''],
      ['ต้มยำกุ้งน้ำข้น', 120, 'อาหาร', 'กุ้งแม่น้ำ 3 ตัว'],
      ['เกาเหลาหมู', 60, 'อาหาร', ''],
      ['ผัดซีอิ๊วหมู', 65, 'อาหาร', ''],
      ['ชาเย็น', 40, 'เครื่องดื่ม', ''],
      ['กาแฟเย็น', 45, 'เครื่องดื่ม', ''],
      ['น้ำมะนาวโซดา', 35, 'เครื่องดื่ม', ''],
      ['น้ำเปล่า', 10, 'เครื่องดื่ม', ''],
      ['บัวลอยไข่หวาน', 35, 'ของหวาน', ''],
      ['ข้าวเหนียวมะม่วง', 80, 'ของหวาน', 'ตามฤดูกาล']
    ];
    return rows.map(function (r, i) {
      return { id: 'm' + (i + 1), name: r[0], price: r[1], category: r[2], image: '', available: true, desc: r[3], sort: (i + 1) * 10, updated: '' };
    });
  }

  // 30 days of plausible orders with lunch/dinner peaks
  function demoOrders(now, days) {
    days = days || 30;
    var menu = demoMenu(), out = [], seed = 42;
    function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    var weights = [9, 8, 5, 4, 2, 3, 3, 10, 6, 4, 3, 3, 0.4];
    var wsum = weights.reduce(function (a, b) { return a + b; }, 0);
    function pick() { var r = rnd() * wsum; for (var i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return menu[i]; } return menu[0]; }
    var hourW = { 10: 2, 11: 7, 12: 10, 13: 6, 14: 2, 15: 2, 16: 3, 17: 6, 18: 9, 19: 7, 20: 3 };
    var hours = Object.keys(hourW), hsum = 0; hours.forEach(function (h) { hsum += hourW[h]; });
    var today = dayKey(now);
    for (var d = days - 1; d >= 0; d--) {
      var key = addDays(today, -d), dow = new Date(key + 'T00:00:00Z').getUTCDay();
      var count = Math.round((dow === 0 || dow === 6 ? 52 : 38) * (0.8 + rnd() * 0.4));
      var no = 0;
      for (var c = 0; c < count; c++) {
        var r = rnd() * hsum, hr = 12;
        for (var j = 0; j < hours.length; j++) { r -= hourW[hours[j]]; if (r <= 0) { hr = +hours[j]; break; } }
        var t = new Date(key + 'T' + pad(hr) + ':' + pad(Math.floor(rnd() * 60)) + ':00+07:00');
        if (t > now) continue;
        var n = 1 + Math.floor(rnd() * 4), items = [], byId = {};
        for (var k = 0; k < n; k++) {
          var m = pick();
          if (byId[m.id]) { byId[m.id].qty++; continue; }
          byId[m.id] = { id: m.id, name: m.name, price: m.price, qty: 1, note: '', cat: m.category };
          items.push(byId[m.id]);
        }
        var total = items.reduce(function (a, i) { return a + i.price * i.qty; }, 0);
        var age = (now - t) / 60000;
        var status = age > 90 ? 'paid' : age > 25 ? 'served' : age > 8 ? 'cooking' : 'new';
        if (rnd() < 0.02) status = 'cancelled';
        var served = (status === 'paid' || status === 'served') ? new Date(t.getTime() + (8 + rnd() * 14) * 60000).toISOString() : '';
        out.push({
          id: 'o' + key.replace(/-/g, '') + pad(c), no: ++no, created: t.toISOString(), table: String(1 + Math.floor(rnd() * 10)),
          items: items, total: total, note: '', name: '', status: status, updated: t.toISOString(), servedAt: served
        });
      }
    }
    out.sort(function (a, b) { return a.created < b.created ? -1 : 1; });
    return out;
  }

  return {
    handle: handle, settings: settings, dashboard: dashboard, demoMenu: demoMenu, demoOrders: demoOrders,
    dayKey: dayKey, addDays: addDays, DEFAULT_SETTINGS: DEFAULT_SETTINGS, STATUSES: STATUSES
  };
})();
if (typeof module !== 'undefined') module.exports = QRCore;
