/* QR Order — admin (หลังร้าน): login, ภาพรวม (live orders + analytics), เมนู, QR, settings */
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = QR.esc, baht = QR.baht, icon = QR.icon, api = QR.api;
  var S = { settings: null, menu: [], range: 'today', from: null, to: null, topBy: 'qty', dash: null,
    seen: {}, firstLive: true, sound: true, liveTimer: null, charts: {}, cat: '' };
  var TOKEN_KEY = 'qro_idtoken';

  function fillIcons(root) { $$('[data-ic]', root).forEach(function (el) { el.outerHTML = icon(el.getAttribute('data-ic'), 18); }); }
  function err(e) { QR.toast(e.message || String(e), 'err'); if (e.code === 'AUTH') logout(true); }

  /* ================= login ================= */
  function showLogin(msg) {
    $('#app').classList.add('hidden'); $('#login').classList.remove('hidden');
    var le = $('#loginErr');
    if (msg) { le.textContent = msg; le.classList.remove('hidden'); } else le.classList.add('hidden');
    if (QR.DEMO) { $('#demoLogin').classList.remove('hidden'); return; }
    if (!QR.CFG.LOGIN_URL) { le.textContent = 'ยังไม่ได้ตั้งค่า LOGIN_URL ใน config.js'; le.classList.remove('hidden'); return; }
    var back = location.href.replace(/#.*$/, '');
    var st = Array.from(crypto.getRandomValues(new Uint8Array(16)), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    try { sessionStorage.setItem('qro_login_state', st); } catch (e) {}
    $('#gsiBtn').innerHTML = '<a class="btn primary block gbtn" href="' + esc(QR.CFG.LOGIN_URL + '?return=' + encodeURIComponent(back) + '&state=' + st) + '">' +
      '<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>' +
      'เข้าสู่ระบบด้วย Google</a>';
  }
  // Back from the Login Apps Script with #idt=<Google ID token>: trade it for a session.
  function finishGoogleLogin(idt, state) {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    var want = null; try { want = sessionStorage.getItem('qro_login_state'); sessionStorage.removeItem('qro_login_state'); } catch (e) {}
    if (!want || want !== state) return showLogin('ลิงก์เข้าสู่ระบบไม่ถูกต้อง กรุณากดปุ่มเข้าสู่ระบบจากหน้านี้');
    $('#loginErr').classList.add('hidden');
    $('#gsiBtn').innerHTML = '<div class="spinner"></div>';
    api('login', { idToken: idt }).then(function (r) { tryLogin(r.session); })
      .catch(function (e) { showLogin(e.message); });
  }
  // No-login mode: the owner page opens straight away.
  function openApp() {
    $('#btnLogout').classList.add('hidden');
    api('me').then(function (me) { S.settings = me.settings; S.email = ''; startApp(); })
      .catch(function (e) { showLogin(e.message); });
  }
  function tryLogin(tok) {
    QR.setToken(tok);
    api('me').then(function (me) {
      try { sessionStorage.setItem(TOKEN_KEY, tok); } catch (e) {}
      S.settings = me.settings; S.email = me.email;
      startApp();
    }).catch(function (e) {
      QR.setToken(null);
      try { sessionStorage.removeItem(TOKEN_KEY); } catch (x) {}
      showLogin(e.code === 'NOT_ADMIN' ? e.message + ' — ให้เจ้าของร้านเพิ่มอีเมลนี้ในหน้าตั้งค่า' : e.message);
    });
  }
  function logout(expired) {
    clearInterval(S.liveTimer);
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
    if (!expired && QR.getToken() && !QR.DEMO) api('logout').catch(function () {});
    QR.setToken(null);
    showLogin(expired ? 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง' : '');
  }

  /* ================= app shell ================= */
  function startApp() {
    $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
    $('#shopName').textContent = S.settings.shopName;
    document.title = S.settings.shopName + ' — หลังร้าน';
    renderAccept();
    setRange('today');
    loadLive();
    clearInterval(S.liveTimer);
    S.liveTimer = setInterval(function () { if (!document.hidden) loadLive(); }, 10000);
    loadMenu();
  }
  function switchTab(t) {
    $$('.tab').forEach(function (b) { var on = b.dataset.tab === t; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
    $('#tab-overview').classList.toggle('hidden', t !== 'overview');
    $('#tab-menu').classList.toggle('hidden', t !== 'menu');
    try { history.replaceState(null, '', '#' + t); } catch (e) {}
  }
  function renderAccept() {
    var b = $('#acceptBadge');
    b.className = 'badge ' + (S.settings.accepting ? 'ok' : '');
    b.textContent = S.settings.accepting ? 'เปิดรับออเดอร์' : 'ปิดรับออเดอร์';
  }
  function renderSound() {
    var b = $('#btnSound');
    b.innerHTML = icon(S.sound ? 'sound' : 'mute', 18) + '<span class="hide-sm">' + (S.sound ? 'เสียงเตือนเปิด' : 'เสียงเตือนปิด') + '</span>';
    b.setAttribute('aria-pressed', S.sound);
  }

  /* ================= live orders ================= */
  var audioCtx;
  function beep() {
    if (!S.sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.18, 0.36].forEach(function (t, i) {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = [880, 1175, 1568][i]; o.type = 'sine';
        g.gain.setValueAtTime(0.0001, audioCtx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + t + 0.16);
        o.connect(g); g.connect(audioCtx.destination); o.start(audioCtx.currentTime + t); o.stop(audioCtx.currentTime + t + 0.2);
      });
    } catch (e) {}
  }
  function loadLive() {
    return api('live').then(renderLive).catch(function (e) { $('#liveMeta').textContent = 'โหลดออเดอร์ไม่สำเร็จ: ' + e.message; if (e.code === 'AUTH') logout(true); });
  }
  function renderLive(d) {
    var fresh = false, ids = {};
    d.orders.forEach(function (o) { ids[o.id] = 1; if (!S.seen[o.id] && !S.firstLive && o.status === 'new') fresh = true; });
    d.calls.forEach(function (c) { ids[c.id] = 1; if (!S.seen[c.id] && !S.firstLive) fresh = true; });
    if (fresh) { beep(); document.title = '🔔 ออเดอร์ใหม่ — ' + S.settings.shopName; setTimeout(function () { document.title = S.settings.shopName + ' — หลังร้าน'; }, 8000); }
    var newIds = S.firstLive ? {} : ids;
    var prevSeen = S.seen; S.seen = ids; S.firstLive = false;

    $('#liveMeta').textContent = 'อัปเดต ' + QR.timeTH(d.serverTime) + ' น. · วันนี้ ' + d.today.orders + ' ออเดอร์ · ' + baht(d.today.sales) + ' บาท';
    var CALL = { staff: ['bell', 'เรียกพนักงาน'], bill: ['receipt', 'ขอเช็คบิล'], water: ['water', 'ขอน้ำ/น้ำแข็ง'] };
    $('#calls').innerHTML = d.calls.map(function (c) {
      var k = CALL[c.type] || CALL.staff;
      return '<div class="call">' + icon(k[0], 20) + '<span class="grow">โต๊ะ ' + esc(c.table) + ' — ' + k[1] + ' <span class="small" style="font-weight:400">(' + QR.ago(c.created) + ')</span></span>' +
        (c.type === 'bill' ? '<button class="btn sm" data-pay="' + esc(c.table) + '">' + icon('check', 16) + ' รับชำระทั้งโต๊ะ</button>' : '') +
        '<button class="btn sm" data-call="' + esc(c.id) + '">รับทราบ</button></div>';
    }).join('');

    var cols = { new: [], cooking: [], served: [] };
    d.orders.forEach(function (o) { if (cols[o.status]) cols[o.status].push(o); });
    function card(o) {
      var isFresh = newIds[o.id] && !prevSeen[o.id];
      var next = { new: ['cooking', 'เริ่มทำ', 'primary'], cooking: ['served', 'เสิร์ฟแล้ว', 'primary'], served: ['paid', 'รับชำระแล้ว', 'accent'] }[o.status];
      return '<article class="ocard' + (isFresh ? ' fresh' : '') + '">' +
        '<div class="ocard-top"><span class="tbl">โต๊ะ ' + esc(o.table) + '</span><span class="no">#' + esc(o.no) + '</span><span class="t" title="' + QR.timeTH(o.created) + '">' + QR.ago(o.created) + '</span></div>' +
        (o.name ? '<div class="small muted">ชื่อ: ' + esc(o.name) + '</div>' : '') +
        '<ul>' + o.items.map(function (i) {
          return '<li><span class="q">' + i.qty + '×</span><span class="n">' + esc(i.name) + (i.note ? '<span class="itemnote">↳ ' + esc(i.note) + '</span>' : '') + '</span></li>';
        }).join('') + '</ul>' +
        (o.note ? '<div class="onote">หมายเหตุ: ' + esc(o.note) + '</div>' : '') +
        '<div class="ocard-foot"><span class="sum">' + baht(o.total) + ' ฿</span>' +
        (o.status === 'new' ? '<button class="btn sm ghost danger" data-cancel="' + o.id + '">ยกเลิก</button>' : '') +
        '<button class="btn sm ' + next[2] + '" data-st="' + next[0] + '" data-id="' + o.id + '">' + next[1] + '</button></div></article>';
    }
    [['new', '#colNew', '#cNew'], ['cooking', '#colCooking', '#cCooking'], ['served', '#colServed', '#cServed']].forEach(function (x) {
      var list = cols[x[0]].sort(function (a, b) { return a.created < b.created ? -1 : 1; });
      $(x[1]).innerHTML = list.length ? list.map(card).join('') : '<div class="empty small">ไม่มีออเดอร์</div>';
      $(x[2]).textContent = list.length;
    });
  }
  function setStatus(id, st, btn) {
    if (btn) btn.disabled = true;
    api('setStatus', { id: id, status: st }).then(function () {
      QR.toast(st === 'cancelled' ? 'ยกเลิกออเดอร์แล้ว' : 'อัปเดตเป็น "' + QR.STATUS_TH[st] + '"', 'ok');
      loadLive(); if (st === 'paid' || st === 'cancelled') loadDash();
    }).catch(function (e) { if (btn) btn.disabled = false; err(e); });
  }

  /* ================= analytics ================= */
  function today() { return QRCore.dayKey(new Date()); }
  function setRange(r) {
    var t = today(), from = t, to = t;
    if (r === 'yesterday') { from = to = QRCore.addDays(t, -1); }
    else if (r === '7') from = QRCore.addDays(t, -6);
    else if (r === '30') from = QRCore.addDays(t, -29);
    else if (r === 'month') from = t.slice(0, 8) + '01';
    S.range = r; S.from = from; S.to = to;
    $$('[data-range]').forEach(function (b) { b.classList.toggle('active', b.dataset.range === r); });
    $('#dFrom').value = from; $('#dTo').value = to;
    loadDash();
  }
  function loadDash() {
    $('#kpis').innerHTML = '<div class="spinner" style="grid-column:1/-1"></div>';
    return api('dashboard', { from: S.from, to: S.to }).then(function (d) { S.dash = d; renderDash(d); }).catch(err);
  }
  function thDate(k) { return new Date(k + 'T00:00:00+07:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Asia/Bangkok' }); }
  function delta(cur, prev) {
    if (!prev) return '';
    var p = (cur - prev) / prev * 100;
    return '<span class="delta ' + (p >= 0 ? 'up' : 'down') + '">' + (p >= 0 ? '▲ ' : '▼ ') + Math.abs(p).toFixed(1) + '%</span> ';
  }
  function renderDash(d) {
    var k = d.kpi;
    $('#rangeLabel').textContent = d.from === d.to ? thDate(d.from) : thDate(d.from) + ' – ' + thDate(d.to) + ' (' + d.span + ' วัน)';
    $('#kpis').innerHTML =
      '<div class="card kpi hero"><div class="lbl">' + icon('receipt', 16) + 'ยอดขาย</div><div class="val">' + baht(k.sales) + '<small>บาท</small></div><div class="sub">' + delta(k.sales, k.prevSales) + 'เทียบช่วงก่อนหน้า ' + baht(k.prevSales) + ' บาท</div></div>' +
      '<div class="card kpi"><div class="lbl">' + icon('cart', 16) + 'จำนวนออเดอร์</div><div class="val">' + k.orders.toLocaleString() + '<small>ออเดอร์</small></div><div class="sub">' + delta(k.orders, k.prevOrders) + (k.cancelled ? 'ยกเลิก ' + k.cancelled : 'ไม่มียกเลิก') + '</div></div>' +
      '<div class="card kpi"><div class="lbl">' + icon('chart', 16) + 'ยอดเฉลี่ยต่อบิล</div><div class="val">' + baht(k.avg) + '<small>บาท</small></div><div class="sub">ขายได้ ' + k.itemsSold.toLocaleString() + ' รายการ' + (d.span > 1 ? ' · เฉลี่ย ' + baht(k.perDay) + ' บ./วัน' : '') + '</div></div>' +
      '<div class="card kpi"><div class="lbl">' + icon('clock', 16) + 'ช่วงพีค</div><div class="val">' + (d.peakHour === null ? '–' : pad(d.peakHour) + ':00') + '</div><div class="sub">' + (k.avgServeMin === null ? 'ยังไม่มีข้อมูลเวลาเสิร์ฟ' : 'สั่ง→เสิร์ฟ เฉลี่ย ' + k.avgServeMin + ' นาที') + '</div></div>';
    $('#insights').innerHTML = d.insights.length ? d.insights.map(function (i) { return '<div class="insight">' + icon(i.icon, 18) + '<span>' + esc(i.text) + '</span></div>'; }).join('')
      : '<div class="insight">' + icon('alert', 18) + '<span>ยังไม่มีออเดอร์ในช่วงนี้</span></div>';
    renderTop(); renderCharts(d); renderHeat(d.heat);
    var maxT = d.tables.reduce(function (a, t) { return Math.max(a, t.sales); }, 0);
    $('#tableList').innerHTML = d.tables.length ? d.tables.map(function (t) {
      return '<div class="tcell"><div class="tn">โต๊ะ ' + esc(t.table) + '</div><div class="ts">' + t.orders + ' บิล · ' + baht(t.sales) + ' ฿</div><div class="bar"><i style="width:' + (maxT ? t.sales / maxT * 100 : 0) + '%"></i></div></div>';
    }).join('') : '<div class="empty small">ไม่มีข้อมูล</div>';
    loadRecent();
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function renderTop() {
    var d = S.dash; if (!d) return;
    var list = S.topBy === 'qty' ? d.topQty : d.topSales;
    var max = list.reduce(function (a, x) { return Math.max(a, S.topBy === 'qty' ? x.qty : x.sales); }, 0);
    $('#topList').innerHTML = list.length ? list.map(function (x, i) {
      var v = S.topBy === 'qty' ? x.qty : x.sales;
      return '<li><span class="rank ' + (i < 3 ? 'r' + (i + 1) : '') + '">' + (i + 1) + '</span><div style="min-width:0"><div class="bar-n">' + esc(x.name) + '</div><div class="bar"><i style="width:' + (max ? v / max * 100 : 0) + '%"></i></div></div>' +
        '<div class="v"><b>' + (S.topBy === 'qty' ? x.qty.toLocaleString() + ' ที่' : baht(x.sales) + ' ฿') + '</b><span class="muted">' + (S.topBy === 'qty' ? baht(x.sales) + ' ฿' : x.qty + ' ที่') + '</span></div></li>';
    }).join('') : '<li class="empty small" style="display:block">ไม่มีข้อมูล</li>';
  }
  var PALETTE = ['#DC2626', '#F59E0B', '#EA580C', '#15803D', '#2563EB', '#9333EA', '#DB2777', '#0D9488'];
  function chart(id, cfg) {
    if (!window.Chart) return;
    if (S.charts[id]) S.charts[id].destroy();
    S.charts[id] = new Chart(document.getElementById(id), cfg);
  }
  function renderCharts(d) {
    if (!window.Chart) return;
    Chart.defaults.font.family = "'IBM Plex Sans Thai', sans-serif";
    Chart.defaults.color = '#78716C';
    var hrs = d.hourly.filter(function (h) { return h.hour >= 6; });
    var maxO = hrs.reduce(function (a, h) { return Math.max(a, h.orders); }, 0);
    chart('chHour', {
      type: 'bar',
      data: { labels: hrs.map(function (h) { return pad(h.hour) + ':00'; }), datasets: [{ label: 'ออเดอร์', data: hrs.map(function (h) { return h.orders; }),
        backgroundColor: hrs.map(function (h) { return h.orders === maxO && maxO ? '#DC2626' : '#FDBA74'; }), borderRadius: 6 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: function (c) { return 'ยอดขาย ' + baht(hrs[c.dataIndex].sales) + ' บาท'; } } } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#F5EDE9' } }, x: { grid: { display: false } } } }
    });
    var multi = d.daily.length > 1;
    chart('chDay', {
      type: multi ? 'line' : 'bar',
      data: { labels: d.daily.map(function (x) { return new Date(x.date + 'T00:00:00+07:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' }); }),
        datasets: [{ label: 'ยอดขาย (บาท)', data: d.daily.map(function (x) { return x.sales; }), borderColor: '#DC2626', backgroundColor: multi ? 'rgba(220,38,38,.12)' : '#DC2626', fill: true, tension: .35, pointRadius: d.daily.length > 40 ? 0 : 3, borderRadius: 6 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return baht(c.raw) + ' บาท · ' + d.daily[c.dataIndex].orders + ' ออเดอร์'; } } } },
        scales: { y: { beginAtZero: true, grid: { color: '#F5EDE9' } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } } } }
    });
    chart('chCat', {
      type: 'doughnut',
      data: { labels: d.categories.map(function (c) { return c.category; }), datasets: [{ data: d.categories.map(function (c) { return c.sales; }), backgroundColor: PALETTE, borderColor: '#fff', borderWidth: 2 }] },
      options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: function (c) {
        var tot = d.categories.reduce(function (a, x) { return a + x.sales; }, 0);
        return c.label + ': ' + baht(c.raw) + ' ฿ (' + (tot ? (c.raw / tot * 100).toFixed(1) : 0) + '%)'; } } } } }
    });
  }
  function renderHeat(heat) {
    var DOW = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'], order = [1, 2, 3, 4, 5, 6, 0];
    var max = 0; heat.forEach(function (r) { r.forEach(function (v) { if (v > max) max = v; }); });
    var h = '<div></div>';
    for (var i = 0; i < 24; i++) h += '<div class="h">' + (i % 2 ? '' : i) + '</div>';
    order.forEach(function (d) {
      h += '<div class="d">' + DOW[d] + '</div>';
      for (var j = 0; j < 24; j++) {
        var v = heat[d][j], a = max ? v / max : 0;
        h += '<div class="c" title="' + DOW[d] + ' ' + pad(j) + ':00 — ' + v + ' ออเดอร์" style="' + (v ? 'background:rgba(220,38,38,' + (0.12 + a * 0.88).toFixed(2) + ')' : '') + '"></div>';
      }
    });
    $('#heat').innerHTML = h;
  }
  function loadRecent() {
    api('recentOrders').then(renderRecent).catch(function () { $('#recent').innerHTML = '<div class="empty small">–</div>'; });
  }
  function renderRecent(list) {
    var BADGE = { new: '', cooking: 'warn', served: 'info', paid: 'ok', cancelled: 'gray' };
    $('#recent').innerHTML = list.length ? list.map(function (o) {
      return '<div class="rrow"><span>' + QR.timeTH(o.created) + '</span><b>โต๊ะ ' + esc(o.table) + '</b><span class="it">' + esc(o.items.map(function (i) { return i.name + ' ×' + i.qty; }).join(', ')) + '</span>' +
        '<span class="badge ' + BADGE[o.status] + '">' + QR.STATUS_TH[o.status] + '</span><b>' + baht(o.total) + '</b></div>';
    }).join('') : '<div class="empty small">ยังไม่มีออเดอร์</div>';
  }

  /* ================= menu ================= */
  function loadMenu() {
    return api('menuAll').then(function (m) { S.menu = m; renderMenu(); }).catch(err);
  }
  function cats() {
    var set = {}, out = [];
    String(S.settings.categories || '').split(',').concat(S.menu.map(function (m) { return m.category; })).forEach(function (c) {
      c = c.trim(); if (c && !set[c]) { set[c] = 1; out.push(c); }
    });
    return out;
  }
  function renderMenu() {
    var q = ($('#menuSearch').value || '').trim().toLowerCase();
    var cl = cats();
    $('#catFilter').innerHTML = ['<button class="chip ' + (!S.cat ? 'active' : '') + '" data-cat="">ทั้งหมด (' + S.menu.length + ')</button>']
      .concat(cl.map(function (c) {
        var n = S.menu.filter(function (m) { return m.category === c; }).length;
        return '<button class="chip ' + (S.cat === c ? 'active' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + ' (' + n + ')</button>';
      })).join('');
    var list = S.menu.filter(function (m) { return (!S.cat || m.category === S.cat) && (!q || m.name.toLowerCase().indexOf(q) >= 0); });
    var off = S.menu.filter(function (m) { return !m.available; }).length;
    $('#menuMeta').textContent = S.menu.length + ' เมนู' + (off ? ' · หมด ' + off + ' รายการ' : '');
    $('#menuGrid').innerHTML = list.length ? list.map(function (m) {
      return '<article class="card mcard' + (m.available ? '' : ' off') + '">' +
        '<div class="mimg">' + esc(m.name.charAt(0)) + (m.image ? '<img src="' + esc(m.image) + '" alt="" loading="lazy" onerror="this.remove()">' : '') + (m.available ? '' : '<span class="soldout">หมด</span>') + '</div>' +
        '<div class="mbody"><div class="mrow"><span class="mname">' + esc(m.name) + '</span><span class="mprice">' + baht(m.price) + ' ฿</span></div>' +
        '<span class="badge gray" style="justify-self:start">' + esc(m.category) + '</span>' + (m.desc ? '<div class="mdesc">' + esc(m.desc) + '</div>' : '') + '</div>' +
        '<div class="mfoot"><label class="switch"><input type="checkbox" data-avail="' + m.id + '"' + (m.available ? ' checked' : '') + '><span class="track"></span><span>' + (m.available ? 'มีขาย' : 'หมด') + '</span></label>' +
        '<button class="btn sm icon-btn ghost" data-edit="' + m.id + '" aria-label="แก้ไข ' + esc(m.name) + '">' + icon('edit', 18) + '</button>' +
        '<button class="btn sm icon-btn ghost danger" data-del="' + m.id + '" aria-label="ลบ ' + esc(m.name) + '">' + icon('trash', 18) + '</button></div></article>';
    }).join('') : '<div class="empty">ไม่พบเมนู</div>';
  }

  function modal(title, body, foot, cls) {
    var ov = document.createElement('div');
    ov.className = 'overlay sheet';
    ov.innerHTML = '<div class="modal ' + (cls || '') + '" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="modal-head"><h3>' + esc(title) + '</h3><button class="btn icon-btn ghost" data-close aria-label="ปิด">' + icon('x', 20) + '</button></div>' +
      '<div class="modal-body">' + body + '</div>' + (foot ? '<div class="modal-foot">' + foot + '</div>' : '') + '</div>';
    function close() { ov.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    ov.addEventListener('click', function (e) { if (e.target === ov || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    var f = ov.querySelector('input, textarea, select'); if (f) setTimeout(function () { f.focus(); }, 50);
    return { el: ov, close: close };
  }

  function editMenu(id) {
    var m = S.menu.filter(function (x) { return x.id === id; })[0] || { name: '', price: '', category: cats()[0] || 'อาหาร', desc: '', image: '', available: true, sort: '' };
    var md = modal(id ? 'แก้ไขเมนู' : 'เพิ่มเมนู',
      '<div class="field"><label for="fName">ชื่อเมนู *</label><input id="fName" class="input" maxlength="80" value="' + esc(m.name) + '" required></div>' +
      '<div class="row-gap" style="align-items:flex-start">' +
      '<div class="field" style="flex:1"><label for="fPrice">ราคา (บาท) *</label><input id="fPrice" class="input" type="number" inputmode="decimal" min="0" step="any" value="' + esc(m.price) + '"></div>' +
      '<div class="field" style="flex:1"><label for="fCat">หมวดหมู่</label><input id="fCat" class="input" list="catList" value="' + esc(m.category) + '"><datalist id="catList">' + cats().map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist></div></div>' +
      '<div class="field"><label for="fDesc">รายละเอียด</label><input id="fDesc" class="input" maxlength="200" value="' + esc(m.desc) + '" placeholder="เช่น เส้นเล็ก/เส้นใหญ่, เผ็ดได้ตามสั่ง"></div>' +
      '<div class="field"><label>รูปภาพ</label><div class="img-pick"><div class="img-prev" id="fPrev" style="' + (m.image ? 'background-image:url(\'' + esc(m.image) + '\')' : '') + '">' + (m.image ? '' : icon('image', 24)) + '</div>' +
      '<div style="display:grid;gap:6px;flex:1"><label class="btn sm" style="justify-self:start">' + icon('image', 16) + ' เลือกรูป<input type="file" id="fFile" accept="image/*" class="sr-only"></label>' +
      '<input id="fImg" class="input" placeholder="หรือวางลิงก์รูป https://…" value="' + esc(m.image) + '"></div></div></div>' +
      '<div class="row-gap"><div class="field" style="width:120px"><label for="fSort">ลำดับ</label><input id="fSort" class="input" type="number" value="' + esc(m.sort) + '"></div>' +
      '<label class="switch" style="margin-top:12px"><input type="checkbox" id="fAvail"' + (m.available ? ' checked' : '') + '><span class="track"></span><span>มีขาย</span></label></div>',
      '<button class="btn" data-close>ยกเลิก</button><button class="btn primary" id="fSave">' + icon('check', 18) + ' บันทึก</button>');
    var el = md.el;
    $('#fImg', el).addEventListener('input', function () { var v = this.value.trim(); $('#fPrev', el).style.backgroundImage = v ? 'url("' + v.replace(/"/g, '') + '")' : ''; });
    $('#fFile', el).addEventListener('change', function () {
      var file = this.files[0]; if (!file) return;
      resizeImage(file, 640).then(function (dataUrl) {
        $('#fPrev', el).style.backgroundImage = 'url("' + dataUrl + '")'; $('#fPrev', el).innerHTML = '<div class="spinner" style="margin:0;width:20px;height:20px"></div>';
        return api('uploadImage', { dataUrl: dataUrl });
      }).then(function (r) { $('#fImg', el).value = r.url; $('#fPrev', el).innerHTML = ''; QR.toast('อัปโหลดรูปแล้ว', 'ok'); })
        .catch(function (e) { $('#fPrev', el).innerHTML = ''; err(e); });
    });
    $('#fSave', el).addEventListener('click', function () {
      var item = { id: id || '', name: $('#fName', el).value.trim(), price: $('#fPrice', el).value, category: $('#fCat', el).value.trim(),
        desc: $('#fDesc', el).value.trim(), image: $('#fImg', el).value.trim(), available: $('#fAvail', el).checked, sort: $('#fSort', el).value };
      if (!item.name) { $('#fName', el).focus(); return QR.toast('กรุณาใส่ชื่อเมนู', 'err'); }
      if (item.price === '' || Number(item.price) < 0) { $('#fPrice', el).focus(); return QR.toast('กรุณาใส่ราคา', 'err'); }
      this.disabled = true; var btn = this;
      api('saveMenuItem', { item: item }).then(function () { md.close(); QR.toast('บันทึกเมนูแล้ว', 'ok'); loadMenu(); })
        .catch(function (e) { btn.disabled = false; err(e); });
    });
  }
  function resizeImage(file, max) {
    return new Promise(function (res, rej) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var s = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = function () { rej(new Error('อ่านไฟล์รูปไม่ได้')); };
      img.src = url;
    });
  }

  /* ================= QR codes ================= */
  function orderBase() {
    var b = QR.CFG.PUBLIC_URL || location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '');
    if (b.slice(-1) !== '/') b += '/';
    return b + 'order.html?' + (QR.DEMO && QR.CFG.API_URL ? 'demo=1&' : '') + 't=';
  }
  function showQr() {
    var n = S.settings.tables, base = orderBase(), cards = '';
    for (var i = 1; i <= n; i++) {
      var u = base + i + '&k=' + encodeURIComponent(S.settings.tableTokens[i] || '');
      cards += '<div class="qr-card"><div class="qs">' + esc(S.settings.shopName) + '</div><div class="qt">โต๊ะ ' + i + '</div>' + QR.qrSvg(u, 5) +
        '<div class="qh">สแกนเพื่อดูเมนูและสั่งอาหาร</div><a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(u) + '</a></div>';
    }
    var md = modal('QR Code สั่งอาหาร (' + n + ' โต๊ะ)',
      '<p class="small muted" style="margin-top:0">พิมพ์แล้วตั้งไว้ที่โต๊ะ ลูกค้าสแกนแล้วสั่งได้ทันที — เปลี่ยนจำนวนโต๊ะได้ที่ ตั้งค่าร้าน</p>' +
      (location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? '<p class="small" style="color:var(--warn)">ตอนนี้เปิดจาก localhost — QR จะสแกนจากมือถือไม่ได้จนกว่าจะขึ้นเว็บ GitHub Pages</p>' : '') +
      '<div class="qr-grid">' + cards + '</div>',
      '<button class="btn sm ghost danger" id="qrRotate" style="margin-right:auto">' + icon('refresh', 16) + ' สร้าง QR ชุดใหม่</button><a class="btn" href="' + esc(base + '1&k=' + encodeURIComponent(S.settings.tableTokens[1] || '')) + '" target="_blank" rel="noopener">' + icon('link', 18) + ' เปิดหน้าลูกค้า (โต๊ะ 1)</a><button class="btn primary" id="qrPrint">' + icon('print', 18) + ' พิมพ์</button>', 'wide');
    $('#qrRotate', md.el).addEventListener('click', function () {
      if (!confirm('สร้างรหัส QR ใหม่ทุกโต๊ะ? QR ที่พิมพ์ไว้เดิมจะใช้สั่งอาหารไม่ได้ ต้องพิมพ์ใหม่')) return;
      api('rotateTableTokens').then(function (ns) { S.settings = ns; md.close(); showQr(); QR.toast('สร้าง QR ชุดใหม่แล้ว — กรุณาพิมพ์ใหม่', 'ok'); }).catch(err);
    });
    $('#qrPrint', md.el).addEventListener('click', function () {
      var pa = $('#printArea') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'printArea' }));
      pa.innerHTML = '<div class="qr-grid">' + cards + '</div>';
      window.print();
    });
  }

  /* ================= settings ================= */
  function showSettings() {
    var s = S.settings;
    var md = modal('ตั้งค่าร้าน',
      '<div class="field"><label for="sName">ชื่อร้าน</label><input id="sName" class="input" maxlength="60" value="' + esc(s.shopName) + '"></div>' +
      '<div class="row-gap" style="align-items:flex-start"><div class="field" style="flex:1"><label for="sTables">จำนวนโต๊ะ</label><input id="sTables" class="input" type="number" min="1" max="200" value="' + esc(s.tables) + '"></div>' +
      '<div class="field" style="flex:2"><label for="sPP">พร้อมเพย์ (เบอร์โทร / เลขบัตร ปชช.)</label><input id="sPP" class="input" inputmode="numeric" maxlength="20" value="' + esc(s.promptpay) + '"><span class="hint">ลูกค้ากด "เช็คบิล" จะเห็น QR พร้อมเพย์พร้อมยอดเงิน</span></div></div>' +
      '<label class="switch"><input type="checkbox" id="sAcc"' + (s.accepting ? ' checked' : '') + '><span class="track"></span><span>เปิดรับออเดอร์ผ่าน QR</span></label>' +
      '<div class="field" style="margin-top:10px"><label for="sNotice">ประกาศหน้าเมนูลูกค้า</label><input id="sNotice" class="input" maxlength="200" value="' + esc(s.notice) + '" placeholder="เช่น วันนี้ข้าวเหนียวมะม่วงหมด / ปิด 21:00 น."></div>' +
      '<div class="field"><label for="sCats">หมวดหมู่เมนู (คั่นด้วย ,)</label><input id="sCats" class="input" value="' + esc(s.categories) + '"></div>' +
      (QR.CFG.OPEN_ADMIN ? '<input type="hidden" id="sAdmins" value="' + esc(s.admins) + '">' : '<div class="field"><label for="sAdmins">อีเมล Gmail ที่เข้าหลังร้านได้ (คั่นด้วย ,)</label><textarea id="sAdmins" class="input" placeholder="staff1@gmail.com, staff2@gmail.com">' + esc(s.admins) + '</textarea><span class="hint">เจ้าของ (บัญชีที่ติดตั้งระบบ) เข้าได้เสมอ' + (S.email ? ' · คุณเข้าสู่ระบบเป็น ' + esc(S.email) : '') + '</span></div>') +
      (QR.DEMO ? '<button class="btn sm danger" id="sReset">' + icon('refresh', 16) + ' รีเซ็ตข้อมูลตัวอย่าง</button>' : ''),
      '<button class="btn" data-close>ยกเลิก</button><button class="btn primary" id="sSave">' + icon('check', 18) + ' บันทึก</button>');
    var el = md.el;
    if ($('#sReset', el)) $('#sReset', el).addEventListener('click', function () {
      if (!confirm('ล้างข้อมูลทั้งหมดในเบราว์เซอร์นี้และสร้างข้อมูลตัวอย่างใหม่?')) return;
      QR.resetDemo(); location.reload();
    });
    $('#sSave', el).addEventListener('click', function () {
      var btn = this; btn.disabled = true;
      api('saveSettings', { settings: { shopName: $('#sName', el).value, tables: $('#sTables', el).value, promptpay: $('#sPP', el).value, accepting: $('#sAcc', el).checked,
        notice: $('#sNotice', el).value, categories: $('#sCats', el).value, admins: $('#sAdmins', el).value } })
        .then(function (ns) {
          S.settings = ns; md.close(); QR.toast('บันทึกการตั้งค่าแล้ว', 'ok');
          $('#shopName').textContent = ns.shopName; renderAccept(); renderMenu();
        }).catch(function (e) { btn.disabled = false; err(e); });
    });
  }

  /* ================= events ================= */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('button, [data-cat]'); if (!b) return;
    if (b.dataset.tab) return switchTab(b.dataset.tab);
    if (b.dataset.range) return setRange(b.dataset.range);
    if (b.dataset.top) { S.topBy = b.dataset.top; $$('[data-top]').forEach(function (x) { x.classList.toggle('active', x === b); }); return renderTop(); }
    if (b.dataset.st) return setStatus(b.dataset.id, b.dataset.st, b);
    if (b.dataset.cancel) { if (confirm('ยกเลิกออเดอร์นี้?')) setStatus(b.dataset.cancel, 'cancelled', b); return; }
    if (b.dataset.call) { b.disabled = true; return api('resolveCall', { id: b.dataset.call }).then(loadLive).catch(err); }
    if (b.dataset.pay) {
      if (!confirm('รับชำระเงินทุกออเดอร์ของโต๊ะ ' + b.dataset.pay + ' แล้ว?')) return;
      b.disabled = true;
      return api('payTable', { table: b.dataset.pay }).then(function (r) { QR.toast('โต๊ะ ' + b.dataset.pay + ' ชำระแล้ว ' + r.paid + ' ออเดอร์', 'ok'); loadLive(); loadDash(); }).catch(err);
    }
    if (b.dataset.cat !== undefined && b.classList.contains('chip')) { S.cat = b.dataset.cat; return renderMenu(); }
    if (b.dataset.edit) return editMenu(b.dataset.edit);
    if (b.dataset.del) {
      var m = S.menu.filter(function (x) { return x.id === b.dataset.del; })[0];
      if (!confirm('ลบเมนู "' + (m ? m.name : '') + '"? (ถ้าแค่ของหมด ให้ปิดสวิตช์ "มีขาย" แทน)')) return;
      return api('deleteMenuItem', { id: b.dataset.del }).then(function () { QR.toast('ลบเมนูแล้ว', 'ok'); loadMenu(); }).catch(err);
    }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.dataset && t.dataset.avail) {
      api('setAvailable', { id: t.dataset.avail, available: t.checked }).then(function (m) {
        S.menu.forEach(function (x) { if (x.id === m.id) x.available = m.available; }); renderMenu();
        QR.toast(m.name + (m.available ? ' — มีขาย' : ' — หมดแล้ว'), 'ok');
      }).catch(function (er) { t.checked = !t.checked; err(er); });
    }
    if (t.id === 'dFrom' || t.id === 'dTo') {
      S.from = $('#dFrom').value || S.from; S.to = $('#dTo').value || S.to; S.range = 'custom';
      $$('[data-range]').forEach(function (b) { b.classList.remove('active'); });
      loadDash();
    }
  });
  $('#menuSearch').addEventListener('input', renderMenu);
  $('#btnAddMenu').addEventListener('click', function () { editMenu(''); });
  $('#btnQr').addEventListener('click', showQr);
  $('#btnSettings').addEventListener('click', showSettings);
  $('#btnLogout').addEventListener('click', function () { logout(false); });
  $('#btnSound').addEventListener('click', function () { S.sound = !S.sound; try { localStorage.setItem('qro_sound', S.sound ? '1' : '0'); } catch (e) {} renderSound(); if (S.sound) beep(); });
  $('#demoLogin').addEventListener('click', function () { tryLogin('demo'); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && QR.getToken()) loadLive(); });

  /* ================= boot ================= */
  fillIcons(document);
  $('#loginIcon').innerHTML = icon('chef', 32); $('#brandIcon').innerHTML = icon('chef', 22);
  try { S.sound = localStorage.getItem('qro_sound') !== '0'; } catch (e) {}
  renderSound();
  if (QR.DEMO) $('#demoBar').classList.remove('hidden');
  if (location.hash === '#menu') switchTab('menu');
  var saved = null; try { saved = sessionStorage.getItem(TOKEN_KEY); } catch (e) {}
  var idt = (location.hash.match(/[#&]idt=([^&]+)/) || [])[1];
  var lst = (location.hash.match(/[#&]state=([^&]+)/) || [])[1];
  if (idt && !QR.DEMO) finishGoogleLogin(decodeURIComponent(idt), lst || '');
  else if (QR.CFG.OPEN_ADMIN && !QR.DEMO) openApp();
  else if (saved) tryLogin(saved); else showLogin('');
})();
