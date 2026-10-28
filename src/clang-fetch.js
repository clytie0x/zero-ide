// โหลดไฟล์ของ clang ฉบับบีบอัด (.gz) แล้วคลายในเบราว์เซอร์
// ฉบับที่คลายแล้วเก็บไว้ใน Cache Storage เปิดครั้งต่อไปจึงไม่ต้องโหลดใหม่

const CACHE_PREFIX = 'zero-ide-clang-';

async function openCache(name) {
  try {
    const keys = await caches.keys();
    // ลบของรุ่นเก่าทิ้ง ไม่ให้เปลืองที่ในเครื่องผู้เรียน
    await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== name).map((k) => caches.delete(k)));
    return await caches.open(name);
  } catch {
    return null; // บางเบราว์เซอร์ปิด Cache Storage ในโหมดไม่ระบุตัวตน ก็โหลดใหม่ทุกครั้งไป
  }
}

export function installClangFetch(base, manifest) {
  const original = self.fetch.bind(self);
  const cacheReady = openCache(CACHE_PREFIX + manifest.id);

  self.fetch = async (input, init) => {
    const href = new URL(input instanceof Request ? input.url : String(input), self.location.href).href;
    const entry = href.startsWith(base) ? manifest.files[href.slice(base.length)] : undefined;
    if (!entry) return original(input, init);

    const cache = await cacheReady;
    if (cache) {
      const hit = await cache.match(href);
      if (hit) return hit;
    }
    const res = await original(href + '.gz');
    if (!res.ok || !res.body) throw new Error(`โหลด ${href} ไม่สำเร็จ (HTTP ${res.status})`);
    const out = new Response(res.body.pipeThrough(new DecompressionStream('gzip')), {
      headers: { 'content-type': entry.type, 'content-length': String(entry.size) },
    });
    if (cache) cache.put(href, out.clone()).catch(() => {});
    return out;
  };
}
