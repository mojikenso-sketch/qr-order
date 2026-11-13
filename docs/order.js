/* QR Order — customer page: browse menu, cart, place order, track status, call staff, PromptPay bill */
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = QR.esc, baht = QR.baht, icon = QR.icon, api = QR.api;
  var qs = new URLSearchParams(location.search);
  var table = (qs.get('t') || '').trim(), tkey = (qs.get('k') || '').trim();
  var S = { settings: null, menu: [], cart: {}, orders: null, timer: null };
  var CART_KEY = 'qro_cart_' + table;
  var QUICK = ['ไม่เผ็ด', 'เผ็ดน้อย', 'เผ็ดมาก', 'ไม่ใส่ผัก', 'พิเศษ', 'ใส่กล่องกลับบ้าน'];

  function fillIcons(root) { $$('[data-ic]', root).forEach(function (el) { el.outerHTML = icon(el.getAttribute('data-ic'), 20); }); }
  function saveCart() { try { localStorage.setItem(CART_KEY, JSON.stringify(S.cart)); } catch (e) {} }
  function loadCart() { try { S.cart = JSON.parse(localStorage.getItem(CART_KEY) || '{}') || {}; } catch (e) { S.cart = {}; } }
  function byId(id) { return S.menu.filter(function (m) { return m.id === id; })[0]; }

  function modal(title, body, foot) {
    var ov = document.createElement('div');
    ov.className = 'overlay sheet';
    ov.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="modal-head"><h3>' + esc(title) + '</h3><button class="btn icon-btn ghost" data-close aria-label="ปิด">' + icon('x', 20) + '</button></div>' +
      '<div class="modal-body">' + body + '</div>' + (foot ? '<div class="modal-foot">' + foot + '</div>' : '') + '</div>';
    function close() { ov.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    ov.addEventListener('click', function (e) { if (e.target === ov || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    return { el: ov, close: close };
  }

  /* ---------- menu ---------- */
  function load() {
    return api('menu').then(function (d) {
      S.settings = d.settings; S.menu = d.menu;
      $('#shop').textContent = d.settings.shopName; document.title = 'สั่งอาหาร — ' + d.settings.shopName;
      var n = parseInt(table, 10);
      if (!n || n < 1 || n > d.settings.tables || String(n) !== table || !tkey) return pickTable();
      $('#tbadge').textContent = 'โต๊ะ ' + table;
      if (d.settings.notice) { $('#notice').textContent = d.settings.notice; $('#notice').classList.remove('hidden'); }
      if (!d.settings.accepting) { $('#notice').textContent = 'ขณะนี้ร้านปิดรับออเดอร์ผ่าน QR ชั่วคราว กรุณาติดต่อพนักงาน'; $('#notice').classList.remove('hidden'); }
      // drop cart lines that vanished / sold out
      Object.keys(S.cart).forEach(function (id) { var m = byId(id); if (!m || !m.available) delete S.cart[id]; });
      renderMenu(); renderCartBar(); refreshOrders();
    }).catch(function (e) { $('#menuList').innerHTML = '<div class="empty">' + esc(e.message) + '<br><button class="btn" style="margin-top:12px" onclick="location.reload()">ลองใหม่</button></div>'; });
  }
  function pickTable() {
    $('#tbadge').textContent = '';
    // No valid table QR: ask to scan again (a manual table picker would bypass the per-table secret).
    $('#menuList').innerHTML = '<div class="card center" style="padding:24px 16px"><div class="done-ic" style="background:var(--primary-50);color:var(--primary)">' + icon('qr', 36) + '</div>' +
      '<h2 class="vh">กรุณาสแกน QR Code ที่โต๊ะ</h2><p class="muted">ลิงก์นี้ไม่ถูกต้องหรือ QR ถูกเปลี่ยนแล้ว — สแกน QR ที่ตั้งอยู่บนโต๊ะอีกครั้ง หรือแจ้งพนักงาน</p></div>';
    $('#cats').innerHTML = ''; $('#cartbar').classList.add('hidden'); $('#tbadge').classList.add('hidden');
    $('.bottom-nav').classList.add('hidden');
    S.badTable = true;
  }
  function groups() {
    var order = String(S.settings.categories || '').split(',').map(function (c) { return c.trim(); }).filter(Boolean), g = {};
    S.menu.forEach(function (m) { (g[m.category] = g[m.category] || []).push(m); if (order.indexOf(m.category) < 0) order.push(m.category); });
    return order.filter(function (c) { return g[c]; }).map(function (c) { return { cat: c, items: g[c] }; });
  }
  function renderMenu() {
    var gs = groups();
    $('#cats').innerHTML = gs.map(function (g, i) { return '<button class="cat' + (i ? '' : ' active') + '" data-go="c' + i + '">' + esc(g.cat) + '</button>'; }).join('');
    $('#menuList').innerHTML = gs.map(function (g, i) {
      return '<h2 class="cat-title" id="c' + i + '">' + esc(g.cat) + '</h2>' + g.items.map(itemHtml).join('');
    }).join('') || '<div class="empty">ร้านยังไม่มีเมนู</div>';
    spy();
  }
  function itemHtml(m) {
    var q = S.cart[m.id] ? S.cart[m.id].qty : 0;
    var ctl = !m.available ? '<span class="soldtag">หมด</span>'
      : q ? '<span class="stepper"><button data-dec="' + m.id + '" aria-label="ลด ' + esc(m.name) + '">' + icon('minus', 18) + '</button><span class="q">' + q + '</span><button data-inc="' + m.id + '" aria-label="เพิ่ม ' + esc(m.name) + '">' + icon('plus', 18) + '</button></span>'
      : '<button class="addbtn" data-inc="' + m.id + '" aria-label="เพิ่ม ' + esc(m.name) + ' ลงตะกร้า">' + icon('plus', 20) + '</button>';
    return '<div class="item' + (m.available ? '' : ' off') + '" data-item="' + m.id + '" id="it-' + m.id + '">' +
      '<div class="thumb">' + esc(m.name.charAt(0)) + (m.image ? '<img src="' + esc(m.image) + '" alt="" loading="lazy" onerror="this.remove()">' : '') + '</div>' +
      '<div class="ibody"><div class="iname">' + esc(m.name) + '</div>' + (m.desc ? '<div class="idesc">' + esc(m.desc) + '</div>' : '') +
      '<div class="irow"><span class="iprice">' + baht(m.price) + ' ฿</span>' + ctl + '</div></div></div>';
  }
  function refreshItem(id) { var el = $('#it-' + id), m = byId(id); if (el && m) el.outerHTML = itemHtml(m); }
  // Highlights the category chip for the section being read.
  // Scroll-position based (not IntersectionObserver) so short last sections like "ของหวาน" still get picked:
  // at the bottom of the page the last section wins, and a tapped chip stays active while the page scrolls to it.
  var spyLockUntil = 0, spyBound = false;
  function setActiveCat(id) {
    $$('.cat').forEach(function (b) {
      var on = b.dataset.go === id;
      if (on && !b.classList.contains('active')) {
        var bar = $('#cats'); bar.scrollTo({ left: b.offsetLeft - (bar.clientWidth - b.offsetWidth) / 2, behavior: 'smooth' });
      }
      b.classList.toggle('active', on);
    });
  }
  function currentCat() {
    var titles = $$('.cat-title'); if (!titles.length) return null;
    var doc = document.documentElement;
    if (window.innerHeight + window.scrollY >= doc.scrollHeight - 4) return titles[titles.length - 1].id;
    var line = $('.ohead').getBoundingClientRect().bottom + 56, id = titles[0].id; // > scroll-margin-top gap (150px - header)
    titles.forEach(function (h) { if (h.getBoundingClientRect().top <= line) id = h.id; });
    return id;
  }
  function spy() {
    if (spyBound) return; spyBound = true;
    var tick = false;
    window.addEventListener('scroll', function () {
      if (tick) return; tick = true;
      requestAnimationFrame(function () { tick = false; if (Date.now() < spyLockUntil) return; var id = currentCat(); if (id) setActiveCat(id); });
    }, { passive: true });
  }
  function goCat(id) {
    var t = document.getElementById(id); if (!t) return;
    setActiveCat(id); spyLockUntil = Date.now() + 900;
    t.scrollIntoView({ behavior: 'smooth' });
  }

  /* ---------- cart ---------- */
  function setQty(id, d) {
    var m = byId(id); if (!m || !m.available || (S.settings && !S.settings.accepting)) { if (S.settings && !S.settings.accepting) QR.toast('ร้านปิดรับออเดอร์ชั่วคราว', 'err'); return; }
    var c = S.cart[id] || { qty: 0, note: '' };
    c.qty = Math.max(0, Math.min(50, c.qty + d));
    if (c.qty) S.cart[id] = c; else delete S.cart[id];
    saveCart(); refreshItem(id); renderCartBar();
  }
  function cartLines() { return Object.keys(S.cart).map(function (id) { return { m: byId(id), c: S.cart[id] }; }).filter(function (x) { return x.m; }); }
  function cartTotal() { return cartLines().reduce(function (a, x) { return a + x.m.price * x.c.qty; }, 0); }
  function renderCartBar() {
    var lines = cartLines(), n = lines.reduce(function (a, x) { return a + x.c.qty; }, 0);
    $('#cartbar').classList.toggle('hidden', !n || !$('#view-orders').classList.contains('hidden'));
    $('#cartCount').textContent = n; $('#cartTotal').textContent = baht(cartTotal()) + ' ฿';
  }
  function openCart() {
    var lines = cartLines();
    if (!lines.length) return;
    var md = modal('ตะกร้าของคุณ · โต๊ะ ' + table,
      '<div id="cl"></div>' +
      '<div class="field" style="margin-top:14px"><label for="oNote">หมายเหตุถึงร้าน (ถ้ามี)</label><input id="oNote" class="input" maxlength="200" placeholder="เช่น แยกจาน, มีเด็กเล็ก"></div>' +
      '<div class="ctotal"><span>รวม</span><span id="ct"></span></div>',
      '<button class="btn" data-close>สั่งเพิ่ม</button><button class="btn primary" id="oSend" style="flex:1">' + icon('check', 18) + ' ยืนยันสั่งอาหาร</button>');
    var el = md.el;
    function draw() {
      var ls = cartLines();
      if (!ls.length) { md.close(); return; }
      $('#cl', el).innerHTML = ls.map(function (x) {
        return '<div class="cline"><div><div class="n">' + esc(x.m.name) + '</div><div class="p">' + baht(x.m.price) + ' ฿ × ' + x.c.qty + ' = ' + baht(x.m.price * x.c.qty) + ' ฿</div></div>' +
          '<span class="stepper"><button data-cdec="' + x.m.id + '" aria-label="ลด">' + icon('minus', 18) + '</button><span class="q">' + x.c.qty + '</span><button data-cinc="' + x.m.id + '" aria-label="เพิ่ม">' + icon('plus', 18) + '</button></span>' +
          '<div style="grid-column:span 2"><div class="quick">' + QUICK.map(function (q) { return '<button data-qn="' + x.m.id + '" data-q="' + esc(q) + '" class="' + (x.c.note.indexOf(q) >= 0 ? 'on' : '') + '">' + esc(q) + '</button>'; }).join('') + '</div>' +
          '<input class="input" data-note="' + x.m.id + '" maxlength="100" placeholder="หมายเหตุเมนูนี้ เช่น เส้นเล็ก" value="' + esc(x.c.note) + '" aria-label="หมายเหตุ ' + esc(x.m.name) + '"></div></div>';
      }).join('');
      $('#ct', el).textContent = baht(cartTotal()) + ' ฿';
    }
    draw();
    el.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.cinc) { setQty(b.dataset.cinc, 1); draw(); }
      if (b.dataset.cdec) { setQty(b.dataset.cdec, -1); draw(); }
      if (b.dataset.qn) {
        var c = S.cart[b.dataset.qn], q = b.dataset.q, parts = c.note ? c.note.split(', ') : [];
        var i = parts.indexOf(q); if (i >= 0) parts.splice(i, 1); else parts.push(q);
        c.note = parts.join(', ').slice(0, 100); saveCart(); draw();
      }
    });
    el.addEventListener('input', function (e) { var id = e.target.dataset && e.target.dataset.note; if (id && S.cart[id]) { S.cart[id].note = e.target.value; saveCart(); } });
    $('#oSend', el).addEventListener('click', function () {
      var btn = this; btn.disabled = true; btn.innerHTML = 'กำลังส่ง…';
      var items = cartLines().map(function (x) { return { id: x.m.id, qty: x.c.qty, note: x.c.note }; });
      api('placeOrder', { table: table, k: tkey, items: items, note: $('#oNote', el).value }).then(function (o) {
        S.cart = {}; saveCart(); md.close(); renderMenu(); renderCartBar();
        var ok = modal('ส่งออเดอร์แล้ว',
          '<div class="center"><div class="done-ic">' + icon('check', 40) + '</div><h3>ออเดอร์ #' + o.no + ' เข้าครัวแล้ว</h3><p class="muted">โต๊ะ ' + esc(o.table) + ' · ' + o.items.length + ' รายการ · ' + baht(o.total) + ' บาท</p><p class="small muted">ติดตามสถานะได้ที่ "ออเดอร์ของฉัน"</p></div>',
          '<button class="btn" data-close>สั่งเพิ่ม</button><button class="btn primary" id="goOrd">ดูสถานะออเดอร์</button>');
        $('#goOrd', ok.el).addEventListener('click', function () { ok.close(); show('orders'); });
        refreshOrders();
      }).catch(function (e) {
        btn.disabled = false; btn.innerHTML = icon('check', 18) + ' ยืนยันสั่งอาหาร'; QR.toast(e.message, 'err');
        if (e.code === 'SOLD_OUT') load();
        if (e.code === 'BAD_TABLE') { md.close(); tkey = ''; pickTable(); }
      });
    });
  }

  /* ---------- my orders ---------- */
  function refreshOrders() {
    if (!table || !S.settings) return;
    if (S.badTable) return;
    return api('tableOrders', { table: table, k: tkey }).then(function (d) { S.orders = d; renderOrders(); })
      .catch(function (e) { if (e.code === 'BAD_TABLE') pickTable(); });
  }
  function renderOrders() {
    var d = S.orders; if (!d) return;
    var active = d.orders.filter(function (o) { return o.status !== 'paid'; }).length;
    $('#ordBadge').textContent = active; $('#ordBadge').classList.toggle('hidden', !active);
    var STEP = { new: 1, cooking: 2, served: 3, paid: 4 };
    $('#ordersBox').innerHTML = (d.unpaidTotal ? '<div class="sumbox"><span>ยอดที่ต้องชำระ</span><span class="big">' + baht(d.unpaidTotal) + ' ฿</span></div>' : '') +
      (d.openCalls.length ? '<p class="badge warn" style="margin:0 0 10px">' + icon('bell', 14) + ' แจ้งพนักงานแล้ว กรุณารอสักครู่</p>' : '') +
      (d.orders.length ? d.orders.map(function (o) {
        var st = STEP[o.status] || 1;
        return '<div class="ord"><div class="ord-top"><b>ออเดอร์ #' + o.no + ' · ' + QR.timeTH(o.created) + ' น.</b><span class="badge ' + (o.status === 'paid' ? 'gray' : o.status === 'served' ? 'ok' : o.status === 'cooking' ? 'warn' : '') + '">' + QR.STATUS_TH[o.status] + '</span></div>' +
          '<ul>' + o.items.map(function (i) { return '<li><span>' + i.qty + '× ' + esc(i.name) + (i.note ? '<span class="nt">' + esc(i.note) + '</span>' : '') + '</span><span>' + baht(i.qty * i.price) + '</span></li>'; }).join('') + '</ul>' +
          '<div class="steps">' + [1, 2, 3].map(function (n) { return '<i class="' + (st >= n ? 'on' : '') + '"></i>'; }).join('') + '</div>' +
          '<div class="steps-l"><span>รับออเดอร์</span><span>กำลังทำ</span><span>เสิร์ฟแล้ว</span></div></div>';
      }).join('') : '<div class="empty">ยังไม่มีออเดอร์จากโต๊ะนี้<br><button class="btn primary" style="margin-top:12px" data-view="menu">ดูเมนู</button></div>');
  }
  function call(type) {
    api('callStaff', { table: table, k: tkey, type: type }).then(function (r) {
      QR.toast(r.already ? 'แจ้งพนักงานไปแล้ว กรุณารอสักครู่' : (type === 'bill' ? 'แจ้งเช็คบิลแล้ว' : type === 'water' ? 'แจ้งขอน้ำแล้ว' : 'เรียกพนักงานแล้ว'), 'ok');
      refreshOrders();
    }).catch(function (e) { QR.toast(e.message, 'err'); });
  }
  function bill() {
    var d = S.orders;
    if (!d || !d.unpaidTotal) return QR.toast('ยังไม่มียอดที่ต้องชำระ', 'err');
    call('bill');
    var pp = d.promptpay;
    modal('เช็คบิล · โต๊ะ ' + table,
      '<div class="center"><p class="muted" style="margin-top:0">ยอดรวมทั้งหมด</p><div style="font-family:var(--font-head);font-size:36px;font-weight:700;color:var(--primary)">' + baht(d.unpaidTotal) + ' ฿</div>' +
      (pp ? '<p class="small muted">สแกนจ่ายด้วยแอปธนาคาร แล้วแสดงสลิปให้พนักงาน</p><div class="ppqr"><div class="pphead">PromptPay พร้อมเพย์</div>' + QR.qrSvg(QR.promptpayPayload(pp, d.unpaidTotal), 5) + '<div class="small">' + esc(d.shopName) + '</div></div>'
        : '<p>พนักงานกำลังมาเก็บเงินที่โต๊ะ</p>') +
      '<p class="small muted">แจ้งพนักงานให้แล้ว · ชำระเงินสดได้ที่พนักงาน</p></div>');
  }

  /* ---------- views & events ---------- */
  function show(v) {
    $('#view-menu').classList.toggle('hidden', v !== 'menu');
    $('#view-orders').classList.toggle('hidden', v !== 'orders');
    $('#cats').classList.toggle('hidden', v !== 'menu');
    $$('.bn[data-view]').forEach(function (b) { b.classList.toggle('active', b.dataset.view === v); });
    renderCartBar(); window.scrollTo(0, 0);
    if (v === 'orders') refreshOrders();
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('button, .item');
    if (!b) return;
    if (b.dataset.inc) { e.stopPropagation(); return setQty(b.dataset.inc, 1); }
    if (b.dataset.dec) { e.stopPropagation(); return setQty(b.dataset.dec, -1); }
    if (b.dataset.view) return show(b.dataset.view);
    if (b.dataset.callt) return call(b.dataset.callt);
    if (b.dataset.go) return goCat(b.dataset.go);
    if (b.id === 'openCart') return openCart();
    if (b.id === 'btnBill') return bill();
    if (b.classList.contains('item') && !e.target.closest('.stepper') && b.dataset.item) {
      var m = byId(b.dataset.item); if (m && m.available && !S.cart[m.id]) setQty(m.id, 1);
    }
  });

  fillIcons(document);
  if (QR.DEMO) $('#demoBar').classList.remove('hidden');
  loadCart();
  load();
  S.timer = setInterval(function () { if (!document.hidden && !$('#view-orders').classList.contains('hidden') || (S.orders && S.orders.orders.some(function (o) { return o.status !== 'paid'; }))) { if (!document.hidden) refreshOrders(); } }, 15000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshOrders(); });
})();
