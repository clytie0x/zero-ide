// เก็บหน้าเว็บไว้ในเครื่อง เปิดซ้ำได้แม้เน็ตหลุด
// ไฟล์ของ clang ไม่ผ่านที่นี่ compile worker เก็บเองใน cache ของมัน
const sw = self as unknown as ServiceWorkerGlobalScope;
const SHELL = __SHELL__.map((p) => new URL(p, sw.location.href).href);
const HOME = new URL('./', sw.location.href).href;
const CACHE = 'zero-ide-shell-' + __VERSION__;

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => sw.skipWaiting()),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('zero-ide-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== sw.location.origin) return;
  url.hash = '';
  url.search = '';

  if (req.mode === 'navigate') {
    // หน้าเว็บเอาของใหม่ก่อน ถ้าเน็ตหลุดค่อยใช้ของที่เก็บไว้
    // no-cache ให้ถามเซิร์ฟเวอร์ทุกครั้ง เพราะ GitHub Pages ให้เบราว์เซอร์เก็บ HTML ไว้ 10 นาที
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res.ok && url.href === HOME) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(HOME, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(HOME)) ?? Response.error()),
    );
    return;
  }
  if (SHELL.includes(url.href)) {
    // ไฟล์ที่มี hash ในชื่อไม่มีวันเปลี่ยน ใช้ของในเครื่องได้เลย
    event.respondWith(caches.match(url.href).then((hit) => hit ?? fetch(req)));
  }
});
