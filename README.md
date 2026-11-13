# QR Order — ระบบสั่งอาหารผ่าน QR Code

- `docs/` = เว็บ (GitHub Pages): `index.html` หลังร้าน (ภาพรวม / เมนู), `order.html?t=<โต๊ะ>` หน้าลูกค้า
- `apps-script/` = Google Apps Script backend (Google Sheets เก็บข้อมูล, Drive เก็บรูปเมนู)
- `docs/core.js` = logic กลาง ใช้ทั้งในเบราว์เซอร์ (โหมดทดลอง) และใน Apps Script

## เปิดดูในเครื่อง (XAMPP)
http://localhost/qr-order/docs/ — ถ้า `API_URL` ใน `docs/config.js` ว่าง จะเป็นโหมดทดลอง (ข้อมูลอยู่ในเบราว์เซอร์)

## ติดตั้งจริง
1. `node tools/build-gas.js` → วาง `apps-script/ALL-IN-ONE.gs` ลง Code.gs ของโปรเจกต์ Apps Script ใหม่ + ตั้ง `appsscript.json`
2. โปรเจกต์ Apps Script ที่ 2 "QR Order Login": วาง `apps-script/login/Login.gs` + `appsscript.json` (แก้ ALLOWED_RETURN ให้ตรงเว็บ) → Deploy Web app: Execute as **User accessing**, access **Anyone with Google account** → ใส่ /exec ใน `LOGIN_URL` ของ `docs/config.js`
3. เจ้าของร้าน (คนที่รัน setup) ต้อง login หลังร้านเป็นคนแรก — ระบบจะผูกกับ Login script นั้น
4. รัน `setup()` (สร้างชีต + ตั้งคนรันเป็นเจ้าของร้าน) — ถ้าอยากมีข้อมูลตัวอย่าง รัน `seedDemoData()`
5. Deploy → Web app: Execute as **Me**, Who has access **Anyone** → ใส่ /exec URL ใน `docs/config.js` → push
6. หลังร้าน → ปุ่ม "QR โต๊ะ" → พิมพ์ QR ตั้งที่โต๊ะ

## ทดสอบ
`node test/core.test.js`
