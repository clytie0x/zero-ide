// โหลดก่อนวาดหน้า เพื่อไม่ให้จอกระพริบเป็นโหมดสว่างแวบหนึ่ง
try {
  var t = localStorage.getItem('zi-theme');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch (e) { /* ไม่มีที่เก็บก็ใช้ตามเครื่อง */ }
