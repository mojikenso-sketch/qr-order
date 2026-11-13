// QR Order — site config (public values only, no secrets here)
window.QR_CONFIG = {
  // Main Apps Script Web App /exec URL ("QR Order API"). Empty = demo mode (data in this browser only).
  API_URL: 'https://script.google.com/macros/s/AKfycbw8SAB02lKGdRVKNUIA4IrX1aJUrxYPGpWd6h6AbXBwhryGiOCPbdw6jzrqF7KNj8ZmCQ/exec',
  // Login Apps Script Web App /exec URL ("QR Order Login", runs as the visitor, asks only for their email).
  LOGIN_URL: '',
  // Base URL printed in table QR codes. Empty = the folder this site is served from.
  PUBLIC_URL: ''
};
