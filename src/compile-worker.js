import { compile } from './toolchain.js';
import { installClangFetch } from './clang-fetch.js';
import header from './stdc++.h';

// __CLANG__ ใส่ให้ตอน build คือที่อยู่ของไฟล์ clang กับขนาดของแต่ละไฟล์
// worker อยู่ใน assets/ ไฟล์ clang อยู่ใน clang/<id>/ ที่ราก
const CLANG = __CLANG__;
const base = new URL('../' + CLANG.base, self.location.href).href;
installClangFetch(base, CLANG);

let clangReady = null;
let pchReady = null;

function post(msg, transfer) {
  self.postMessage(msg, transfer || []);
}

function loadClang() {
  if (!clangReady) {
    clangReady = (async () => {
      const { runClang } = await import(base + 'bundle.js');
      // เรียกแบบไม่มีคำสั่ง clang จะแค่โหลดไฟล์ทั้งหมดให้พร้อมก่อนผู้เรียนกดรัน
      await runClang(null, {}, {
        fetchProgress: ({ doneLength, totalLength }) => post({ type: 'progress', done: doneLength, total: totalLength, download: CLANG.download }),
      });
      return runClang;
    })();
    clangReady.then(
      () => post({ type: 'ready' }),
      (e) => {
        clangReady = null;
        post({ type: 'load-error', message: String(e?.message || e) });
      },
    );
  }
  return clangReady;
}

function loadPch() {
  if (!pchReady) {
    pchReady = (async () => {
      try {
        const res = await fetch(base + 'stdc++.h.pch');
        return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
      } catch {
        return null;
      }
    })();
  }
  return pchReady;
}

self.onmessage = async ({ data }) => {
  if (data.type === 'load') {
    loadClang().catch(() => {});
  } else if (data.type === 'prefetch-pch') {
    loadClang().then(loadPch).catch(() => {});
  } else if (data.type === 'compile') {
    const t0 = performance.now();
    try {
      const runClang = await loadClang();
      const pch = data.lang === 'cpp' ? await loadPch() : null;
      const r = await compile(runClang, { lang: data.lang, source: data.source, header, pch });
      const ms = performance.now() - t0;
      if (r.ok) post({ type: 'compiled', id: data.id, ok: true, wasm: r.wasm, log: r.log, ms }, [r.wasm.buffer]);
      else post({ type: 'compiled', id: data.id, ok: false, log: r.log, ms });
    } catch (e) {
      post({ type: 'compiled', id: data.id, ok: false, crashed: true, log: String(e?.message || e) });
    }
  }
};
