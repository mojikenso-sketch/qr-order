/* QR Order Login — a tiny separate Apps Script whose only permission is "see your email address".
 * Deploy > Web app: Execute as "User accessing the web app", Who has access "Anyone with a Google account".
 * It returns the visitor to the shop's back office with a Google-signed ID token (ScriptApp.getIdentityToken),
 * which the main QR Order API verifies with Google before opening a session.
 * Edit ALLOWED_RETURN when the site moves to another address. */
var ALLOWED_RETURN = [
  'https://mojikenso-sketch.github.io/qr-order/',
  'http://localhost/qr-order/'
];

function doGet(e) {
  var ret = String((e && e.parameter && e.parameter['return']) || '');
  var ok = ALLOWED_RETURN.some(function (a) { return ret.indexOf(a) === 0; }) && ret.indexOf('#') < 0;
  var state = String((e && e.parameter && e.parameter.state) || '');
  if (!/^[A-Za-z0-9]{16,64}$/.test(state)) ok = false;
  var email = Session.getActiveUser().getEmail();
  var body;
  if (!ok) {
    body = '<h1>ลิงก์ไม่ถูกต้อง</h1><p>กรุณาเข้าสู่ระบบจากหน้าหลังร้าน</p>';
  } else if (!email) {
    body = '<h1>เข้าสู่ระบบไม่สำเร็จ</h1><p>กรุณาเข้าสู่ระบบบัญชี Google ก่อน แล้วลองใหม่</p>';
  } else {
    var url = ret + '#idt=' + encodeURIComponent(ScriptApp.getIdentityToken()) + '&state=' + state;
    body = '<div class="ic">✓</div><h1>เข้าสู่ระบบเป็น</h1><p class="em">' + esc_(email) + '</p>' +
      '<a class="btn" href="' + esc_(url) + '" target="_top">ไปหน้าหลังร้าน</a>' +
      '<p class="small">ไม่ใช่บัญชีนี้? สลับบัญชีที่มุมขวาบนของ Google แล้วเปิดลิงก์ใหม่</p>';
  }
  var html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' +
    'body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#FFF7F3;color:#3B0D0D}' +
    '.c{background:#fff;border:1px solid #F3E3DC;border-radius:18px;padding:32px 24px;max-width:360px;width:calc(100% - 32px);text-align:center;box-shadow:0 4px 16px rgba(60,20,10,.08)}' +
    '.ic{width:56px;height:56px;border-radius:50%;background:#F0FDF4;color:#15803D;display:grid;place-items:center;font-size:28px;margin:0 auto 8px}' +
    'h1{font-size:20px;margin:8px 0}.em{font-weight:700;word-break:break-all}.small{font-size:13px;color:#78716C}' +
    '.btn{display:block;margin:20px 0 12px;padding:14px;border-radius:12px;background:#DC2626;color:#fff;text-decoration:none;font-weight:700;font-size:17px}' +
    '</style></head><body><div class="c">' + body + '</div></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('QR Order — เข้าสู่ระบบ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function esc_(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}
