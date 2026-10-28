// สร้างเว็บลง dist/ พร้อมขึ้น GitHub Pages
// ทุกไฟล์มี hash ในชื่อ เบราว์เซอร์จึงเก็บไว้ได้ตลอดจนกว่าเนื้อหาจะเปลี่ยน
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { buildPch } from './pch.mjs';
import { LANGS } from '../src/toolchain.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const CLANG_PKG = path.join(ROOT, 'node_modules/@yowasp/clang');
const DOMAIN = 'ide.teerapat.codes';

const hex = (buf, n) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, n);
const sri = (buf) => 'sha384-' + crypto.createHash('sha384').update(buf).digest('base64');
const rel = (abs) => path.relative(DIST, abs).split(path.sep).join('/');
const step = (label) => console.log(`- ${label}`);

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

/* ---------- ไฟล์ของ clang ---------- */

step('สร้าง PCH ของ bits/stdc++.h');
const header = fs.readFileSync(path.join(SRC, 'stdc++.h'), 'utf8');
const payload = { 'stdc++.h.pch': Buffer.from(await buildPch(header)) };
const genDir = path.join(CLANG_PKG, 'gen');
for (const name of fs.readdirSync(genDir)) {
  if (name.endsWith('.wasm') || name.endsWith('.tar')) payload[name] = fs.readFileSync(path.join(genDir, name));
}
const bundle = fs.readFileSync(path.join(genDir, 'bundle.js'));

const names = Object.keys(payload).sort();
const id = hex(Buffer.concat([bundle, ...names.map((n) => Buffer.from(hex(payload[n], 64)))]), 12);
const clangDir = path.join(DIST, 'clang', id);
fs.mkdirSync(clangDir, { recursive: true });
fs.writeFileSync(path.join(clangDir, 'bundle.js'), bundle);

step(`บีบอัดไฟล์ clang ${names.length} ไฟล์`);
const files = {};
let rawTotal = 0;
let gzTotal = 0;
let download = 0; // ที่ต้องโหลดก่อนรันได้ ไม่นับ PCH ซึ่งโหลดเมื่อเลือก C++
for (const name of names) {
  const gz = zlib.gzipSync(payload[name], { level: 9 });
  fs.writeFileSync(path.join(clangDir, name + '.gz'), gz);
  files[name] = { size: payload[name].length, type: name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' };
  rawTotal += payload[name].length;
  gzTotal += gz.length;
  if (!name.endsWith('.pch')) download += gz.length;
}
const manifest = { id, base: `clang/${id}/`, download, files };
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
};

// ชื่อไฟล์ผลลัพธ์ของแต่ละ entry จาก metafile
function outputsOf(result) {
  const map = {};
  for (const [out, info] of Object.entries(result.metafile.outputs)) {
    if (info.entryPoint) map[path.basename(info.entryPoint).replace(/\.[^.]+$/, '')] = path.join(ROOT, out);
  }
  return map;
}

step('bundle worker');
const workers = outputsOf(await esbuild.build({
  ...common,
  format: 'esm',
  entryPoints: [path.join(SRC, 'compile-worker.js'), path.join(SRC, 'run-worker.js')],
  define: { __CLANG__: JSON.stringify(manifest) },
}));

step('bundle หน้าเว็บ');
const app = outputsOf(await esbuild.build({
  ...common,
  format: 'esm',
  entryPoints: [path.join(SRC, 'app.js')],
  define: { __WORKERS__: JSON.stringify({ compile: rel(workers['compile-worker']), run: rel(workers['run-worker']) }) },
}));
const page = outputsOf(await esbuild.build({
  ...common,
  entryPoints: [path.join(SRC, 'theme.js'), path.join(SRC, 'style.css')],
}));

const faviconSrc = fs.readFileSync(path.join(SRC, 'favicon.svg'));
const favicon = path.join(DIST, 'assets', `favicon-${hex(faviconSrc, 8)}.svg`);
fs.writeFileSync(favicon, faviconSrc);

/* ---------- หน้า HTML ---------- */

const read = (p) => fs.readFileSync(p);
const clangVersion = JSON.parse(fs.readFileSync(path.join(CLANG_PKG, 'package.json'), 'utf8')).version.split('-')[0];
const vars = {
  theme: rel(page.theme),
  css: rel(page.style),
  css_sri: sri(read(page.style)),
  app: rel(app.app),
  app_sri: sri(read(app.app)),
  favicon: rel(favicon),
  clang: clangVersion,
  flags_c: LANGS.c.flags.join(' '),
  flags_cpp: LANGS.cpp.flags.join(' '),
};
const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8').replace(/\{\{(\w+)\}\}/g, (m, k) => {
  if (!(k in vars)) throw new Error(`index.html ใช้ {{${k}}} ที่ build ไม่รู้จัก`);
  return vars[k];
});
fs.writeFileSync(path.join(DIST, 'index.html'), html);

/* ---------- service worker ---------- */

const assets = fs.readdirSync(path.join(DIST, 'assets'), { recursive: true })
  .map((p) => path.join(DIST, 'assets', p))
  .filter((p) => fs.statSync(p).isFile())
  .map(rel)
  .sort();
const shell = ['./', ...assets];
const version = hex(Buffer.from(html + shell.join('\n')), 12);
await esbuild.build({
  entryPoints: [path.join(SRC, 'sw.js')],
  outfile: path.join(DIST, 'sw.js'),
  minify: true,
  legalComments: 'none',
  target: common.target,
  define: { __VERSION__: JSON.stringify(version), __SHELL__: JSON.stringify(shell) },
  logLevel: 'warning',
});

fs.writeFileSync(path.join(DIST, 'CNAME'), DOMAIN + '\n');
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');

console.log(`เสร็จ clang ${id} หน้าเว็บ ${version} ไฟล์ใน assets ${assets.length} ไฟล์`);
