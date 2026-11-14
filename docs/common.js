/* QR Order — shared browser helpers: API client, demo store, icons, formatting, PromptPay. */
(function () {
  var CFG = window.QR_CONFIG || {};
  var DEMO = !CFG.API_URL || /[?&]demo=1(&|$)/.test(location.search); // ?demo=1 = try-it mode for prospects
  var LS = 'qro_demo_';

  /* ---------- demo store (localStorage) ---------- */
  function lsGet(k, d) { try { var v = localStorage.getItem(LS + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) { console.warn('storage full', e); } }
  function ensureDemo() {
    if (lsGet('ver', 0) === 3) return;
    var now = new Date();
    lsSet('menu', QRCore.demoMenu());
    lsSet('orders', QRCore.demoOrders(now, 30, true));
    lsSet('calls', []);
    var s = {}; for (var k in QRCore.DEFAULT_SETTINGS) s[k] = QRCore.DEFAULT_SETTINGS[k];
    s.shopName = 'ร้านก๋วยเตี๋ยวตัวอย่าง'; s.promptpay = '0812345678';
    lsSet('settings', s);
    lsSet('nos', {});
    lsSet('ver', 3);
  }
  var demoStore = {
    getSettings: function () { return lsGet('settings', {}); },
    saveSettings: function (s) { lsSet('settings', s); },
    getMenu: function () { return lsGet('menu', []); },
    saveMenu: function (l) { lsSet('menu', l); },
    nextOrderNo: function (day) { var n = lsGet('nos', {}); n[day] = (n[day] || 0) + 1; lsSet('nos', n); return n[day]; },
    addOrder: function (o) { var l = lsGet('orders', []); l.push(o); lsSet('orders', l); },
    updateOrder: function (id, patch) {
      var l = lsGet('orders', []), hit = null;
      l.forEach(function (o) { if (o.id === id) { for (var k in patch) o[k] = patch[k]; hit = o; } });
      lsSet('orders', l); return hit;
    },
    getRecentOrders: function (since) { return lsGet('orders', []).filter(function (o) { return new Date(o.created).getTime() >= since; }); },
    getOrdersBetween: function (a, b) { return lsGet('orders', []).filter(function (o) { var k = QRCore.dayKey(o.created); return k >= a && k <= b; }); },
    getCalls: function () { return lsGet('calls', []); },
    addCall: function (c) { var l = lsGet('calls', []); l.push(c); lsSet('calls', l); },
    updateCall: function (id, p) { var l = lsGet('calls', []); l.forEach(function (c) { if (c.id === id) for (var k in p) c[k] = p[k]; }); lsSet('calls', l); }
  };

  /* ---------- API ---------- */
  var token = null;
  function api(action, payload) {
    if (DEMO) {
      ensureDemo();
      return new Promise(function (res, rej) {
        setTimeout(function () {
          try {
            if (action === 'uploadImage') return res({ url: payload.dataUrl });
            res(JSON.parse(JSON.stringify(QRCore.handle(demoStore, action, payload, { admin: !!token, email: token ? 'demo@example.com' : '' }))));
          } catch (e) { rej(e); }
        }, 120);
      });
    }
    return fetch(CFG.API_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, payload: payload || {}, token: token })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) { var e = new Error(j.error || 'เกิดข้อผิดพลาด'); e.code = j.code; e.email = j.email; throw e; }
      return j.data;
    }, function () { throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง'); });
  }

  /* ---------- formatting ---------- */
  function baht(n) { return Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function timeTH(iso) { var d = new Date(iso); return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }); }
  function ago(iso) {
    var m = Math.floor((Date.now() - new Date(iso)) / 60000);
    if (m < 1) return 'เมื่อสักครู่'; if (m < 60) return m + ' นาทีที่แล้ว';
    var h = Math.floor(m / 60); return h + ' ชม. ' + (m % 60) + ' นาทีที่แล้ว';
  }
  var STATUS_TH = { new: 'รับออเดอร์แล้ว', cooking: 'กำลังทำ', served: 'เสิร์ฟแล้ว', paid: 'ชำระแล้ว', cancelled: 'ยกเลิก' };

  /* ---------- icons (Lucide paths, MIT) ---------- */
  var P = {
    chart: '<path d="M3 3v18h18"/><path d="M7 16v-5"/><path d="M12 16V8"/><path d="M17 16v-9"/>',
    menu: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
    gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    minus: '<path d="M5 12h14"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    crown: '<path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/>',
    up: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
    down: '<path d="m22 17-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    timer: '<path d="M10 2h4"/><path d="M12 14l3-3"/><circle cx="12" cy="14" r="8"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    sound: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
    mute: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m22 9-6 6M16 9l6 6"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    chef: '<path d="M17 21a1 1 0 0 0 1-1v-5.35c0-.46.31-.85.73-1.03a4 4 0 0 0-2.95-7.44 1 1 0 0 1-.75-.47 4 4 0 0 0-6.06 0 1 1 0 0 1-.75.47 4 4 0 0 0-2.95 7.44c.42.18.73.57.73 1.03V20a1 1 0 0 0 1 1Z"/><path d="M6 17h12"/>',
    store: '<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M2 7h20v3a2 2 0 0 1-4 0 2 2 0 0 1-4 0 2 2 0 0 1-4 0 2 2 0 0 1-4 0 2 2 0 0 1-4 0Z"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    water: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
    note: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>'
  };
  function icon(name, size, cls) {
    return '<svg class="ic ' + (cls || '') + '" width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || '') + '</svg>';
  }

  /* ---------- PromptPay (EMVCo) ---------- */
  function crc16(s) {
    var crc = 0xFFFF;
    for (var i = 0; i < s.length; i++) {
      crc ^= s.charCodeAt(i) << 8;
      for (var j = 0; j < 8; j++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
    return ('0000' + crc.toString(16).toUpperCase()).slice(-4);
  }
  function f(id, v) { return id + ('0' + v.length).slice(-2) + v; }
  function promptpayPayload(target, amount) {
    target = String(target || '').replace(/[^0-9]/g, '');
    var acc;
    if (target.length >= 15) acc = f('03', target);
    else if (target.length >= 13) acc = f('02', target);
    else acc = f('01', ('0000000000000' + target.replace(/^0/, '66')).slice(-13));
    var s = f('00', '01') + f('01', amount ? '12' : '11') + f('29', f('00', 'A000000677010111') + acc) + f('58', 'TH') + f('53', '764');
    if (amount) s += f('54', Number(amount).toFixed(2));
    s += '6304';
    return s + crc16(s);
  }
  function qrSvg(text, cell) {
    var q = qrcode(0, 'M'); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: cell || 4, margin: 2, scalable: true });
  }

  function toast(msg, kind) {
    var t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.setAttribute('role', 'status');
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 300); }, 2600);
  }

  window.QR = {
    CFG: CFG, DEMO: DEMO, api: api, setToken: function (t) { token = t; }, getToken: function () { return token; },
    baht: baht, esc: esc, timeTH: timeTH, ago: ago, icon: icon, STATUS_TH: STATUS_TH,
    promptpayPayload: promptpayPayload, qrSvg: qrSvg, toast: toast,
    resetDemo: function () { lsSet('ver', 0); ensureDemo(); }
  };
})();
