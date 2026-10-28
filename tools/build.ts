// สร้างเว็บลง dist/ พร้อมขึ้น GitHub Pages
// ทุกไฟล์มี hash ในชื่อ เบราว์เซอร์จึงเก็บไว้ได้ตลอดจนกว่าเนื้อหาจะเปลี่ยน
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { buildPch } from './pch.ts';
import { LANGS } from '../src/toolchain.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const CLANG_PKG = path.join(ROOT, 'node_modules/@yowasp/clang');
const DOMAIN = 'ide.teerapat.codes';

const hex = (buf: crypto.BinaryLike, n: number) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, n);
const sri = (buf: crypto.BinaryLike) => 'sha384-' + crypto.createHash('sha384').update(buf).digest('base64');
const rel = (abs: string) => path.relative(DIST, abs).split(path.sep).join('/');
const step = (label: string) => console.log(`- ${label}`);

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

/* ---------- ไฟล์ของ clang ---------- */

step('สร้าง PCH ของ bits/stdc++.h');
const header = fs.readFileSync(path.join(SRC, 'stdc++.h'), 'utf8');
const payload = new Map<string, Buffer>([['stdc++.h.pch', Buffer.from(await buildPch(header))]]);
const genDir = path.join(CLANG_PKG, 'gen');
for (const name of fs.readdirSync(genDir)) {
  if (name.endsWith('.wasm') || name.endsWith('.tar')) payload.set(name, fs.readFileSync(path.join(genDir, name)));
}
const bundle = fs.readFileSync(path.join(genDir, 'bundle.js'));

const entries = [...payload].sort(([a], [b]) => a.localeCompare(b));
const id = hex(Buffer.concat([bundle, ...entries.map(([, buf]) => Buffer.from(hex(buf, 64)))]), 12);
const clangDir = path.join(DIST, 'clang', id);
fs.mkdirSync(clangDir, { recursive: true });
fs.writeFileSync(path.join(clangDir, 'bundle.js'), bundle);

step(`บีบอัดไฟล์ clang ${entries.length} ไฟล์`);
const files: ClangManifest['files'] = {};
let rawTotal = 0;
let gzTotal = 0;
let download = 0; // ที่ต้องโหลดก่อนรันได้ ไม่นับ PCH ซึ่งโหลดเมื่อเลือก C++
for (const [name, buf] of entries) {
  const gz = zlib.gzipSync(buf, { level: 9 });
  fs.writeFileSync(path.join(clangDir, name + '.gz'), gz);
  files[name] = { size: buf.length, type: name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' };
  rawTotal += buf.length;
  gzTotal += gz.length;
  if (!name.endsWith('.pch')) download += gz.length;
}
const manifest: ClangManifest = { id, base: `clang/${id}/`, download, files };
console.log(`  ${(rawTotal / 1e6).toFixed(1)} MB บีบเหลือ ${(gzTotal / 1e6).toFixed(1)} MB โหลดครั้งแรก ${(download / 1e6).toFixed(1)} MB`);

/* ---------- JavaScript กับ CSS ---------- */

const common = {
  bundle: true,
  minify: true,
  legalComments: 'none',
  target: ['chrome111', 'firefox114', 'safari16.4'],
  outdir: path.join(DIST, 'assets'),
  entryNames: '[name]-[hash]',
  assetNames: 'fonts/[name]-[hash]',
  loader: { '.h': 'text', '.woff2': 'file' },
  metafile: true,
  logLevel: 'warning',
} satisfies esbuild.BuildOptions;

// ไฟล์ผลลัพธ์ของ entry ชื่อ name จาก metafile
function outputOf(result: esbuild.BuildResult<typeof common>, name: string): string {
  for (const [out, info] of Object.entries(result.metafile.outputs)) {
    if (info.entryPoint && path.basename(info.entryPoint).replace(/\.[^.]+$/, '') === name) return path.join(ROOT, out);
  }
  throw new Error(`esbuild ไม่ได้สร้างไฟล์ของ ${name}`);
}

step('bundle worker');
const workers = await esbuild.build({
  ...common,
  format: 'esm',
  entryPoints: [path.join(SRC, 'compile-worker.ts'), path.join(SRC, 'run-worker.ts')],
  define: { __CLANG__: JSON.stringify(manifest) },
});
const workerPaths: typeof __WORKERS__ = {
  compile: rel(outputOf(workers, 'compile-worker')),
  run: rel(outputOf(workers, 'run-worker')),
};

step('bundle หน้าเว็บ');
const app = await esbuild.build({
  ...common,
  format: 'esm',
  entryPoints: [path.join(SRC, 'app.ts')],
  define: { __WORKERS__: JSON.stringify(workerPaths) },
});
const page = await esbuild.build({
  ...common,
  entryPoints: [path.join(SRC, 'theme.ts'), path.join(SRC, 'style.css')],
});
const appFile = outputOf(app, 'app');
const cssFile = outputOf(page, 'style');

const faviconSrc = fs.readFileSync(path.join(SRC, 'favicon.svg'));
const favicon = path.join(DIST, 'assets', `favicon-${hex(faviconSrc, 8)}.svg`);
fs.writeFileSync(favicon, faviconSrc);

/* ---------- หน้า HTML ---------- */

const clangPkg = JSON.parse(fs.readFileSync(path.join(CLANG_PKG, 'package.json'), 'utf8')) as { version: string };
const vars: Record<string, string> = {
  theme: rel(outputOf(page, 'theme')),
  css: rel(cssFile),
  css_sri: sri(fs.readFileSync(cssFile)),
  app: rel(appFile),
  app_sri: sri(fs.readFileSync(appFile)),
  favicon: rel(favicon),
  clang: clangPkg.version.split('-')[0] ?? clangPkg.version,
  flags_c: LANGS.c.flags.join(' '),
  flags_cpp: LANGS.cpp.flags.join(' '),
};
const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8').replace(/\{\{(\w+)\}\}/g, (_m, k: string) => {
  const value = vars[k];
  if (value === undefined) throw new Error(`index.html ใช้ {{${k}}} ที่ build ไม่รู้จัก`);
  return value;
});
fs.writeFileSync(path.join(DIST, 'index.html'), html);

/* ---------- service worker ---------- */

const assets = fs
  .readdirSync(path.join(DIST, 'assets'), { recursive: true, encoding: 'utf8' })
  .map((p) => path.join(DIST, 'assets', p))
  .filter((p) => fs.statSync(p).isFile())
  .map(rel)
  .sort();
const shell = ['./', ...assets];
const version = hex(Buffer.from(html + shell.join('\n')), 12);
await esbuild.build({
  entryPoints: [path.join(SRC, 'sw.ts')],
  outfile: path.join(DIST, 'sw.js'),
  bundle: true,
  minify: true,
  legalComments: 'none',
  target: common.target,
  define: { __VERSION__: JSON.stringify(version), __SHELL__: JSON.stringify(shell) },
  logLevel: 'warning',
});

fs.writeFileSync(path.join(DIST, 'CNAME'), DOMAIN + '\n');
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');

console.log(`เสร็จ clang ${id} หน้าเว็บ ${version} ไฟล์ใน assets ${assets.length} ไฟล์`);
