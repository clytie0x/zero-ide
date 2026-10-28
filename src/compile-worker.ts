import type { RunClang } from './toolchain.ts';
import { compile } from './toolchain.ts';
import { installClangFetch } from './clang-fetch.ts';
import { errorMessage, type CompilerReply, type CompilerRequest } from './messages.ts';
import header from './stdc++.h';

// __CLANG__ ใส่ให้ตอน build คือที่อยู่ของไฟล์ clang กับขนาดของแต่ละไฟล์
// worker อยู่ใน assets/ ไฟล์ clang อยู่ใน clang/<id>/ ที่ราก
const CLANG = __CLANG__;
const base = new URL('../' + CLANG.base, self.location.href).href;
installClangFetch(base, CLANG);

let clangReady: Promise<RunClang> | null = null;
let pchReady: Promise<Uint8Array | null> | null = null;

function post(msg: CompilerReply, transfer: Transferable[] = []): void {
  self.postMessage(msg, transfer);
}

function loadClang(): Promise<RunClang> {
  if (!clangReady) {
    const ready = (async () => {
      const mod = (await import(base + 'bundle.js')) as { runClang: RunClang };
      // เรียกแบบไม่มีคำสั่ง clang จะแค่โหลดไฟล์ทั้งหมดให้พร้อมก่อนผู้เรียนกดรัน
      await mod.runClang(null, {}, {
        fetchProgress: ({ doneLength, totalLength }) =>
          post({ type: 'progress', done: doneLength, total: totalLength, download: CLANG.download }),
      });
      return mod.runClang;
    })();
    clangReady = ready;
    ready.then(
      () => post({ type: 'ready' }),
      (e: unknown) => {
        clangReady = null;
        post({ type: 'load-error', message: errorMessage(e) });
      },
    );
  }
  return clangReady;
}

function loadPch(): Promise<Uint8Array | null> {
  pchReady ??= (async () => {
    try {
      const res = await fetch(base + 'stdc++.h.pch');
      return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
    } catch {
      return null;
    }
  })();
  return pchReady;
}

self.onmessage = async ({ data }: MessageEvent<CompilerRequest>) => {
  if (data.type === 'load') {
    loadClang().catch(() => {});
  } else if (data.type === 'prefetch-pch') {
    loadClang().then(loadPch).catch(() => {});
  } else {
    try {
      const runClang = await loadClang();
      const pch = data.lang === 'cpp' ? await loadPch() : null;
      const r = await compile(runClang, { lang: data.lang, source: data.source, header, pch });
      if (r.ok) {
        // ก๊อปลง buffer ใหม่ของตัวเอง ส่งต่อแบบ transfer ได้โดยไม่ต้องคัดลอกซ้ำ
        const wasm = new Uint8Array(r.wasm);
        post({ type: 'compiled', id: data.id, ok: true, wasm, log: r.log }, [wasm.buffer]);
      } else {
        post({ type: 'compiled', id: data.id, ok: false, log: r.log });
      }
    } catch (e) {
      post({ type: 'compiled', id: data.id, ok: false, crashed: true, log: errorMessage(e) });
    }
  }
};
