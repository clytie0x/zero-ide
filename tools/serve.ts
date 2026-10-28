// เปิด dist/ ที่ http://localhost:8723 เพื่อลองในเครื่อง ส่งไฟล์แบบเดียวกับ GitHub Pages คือไม่บีบอัดไฟล์ .gz ซ้ำ
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
// --slow จำลองเน็ตบ้านราว 2 MB ต่อวินาที ไว้ดูหน้าตาตอนโหลดตัวคอมไพล์ครั้งแรก
const SLOW = process.argv.includes('--slow');
const PORT = Number(process.env.PORT || (SLOW ? 8725 : 8723));
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
  '.json': 'application/json',
};

http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end();
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
  const cache = SLOW && file.endsWith('.gz') ? 'no-store' : type.startsWith('text/html') ? 'no-cache' : 'max-age=600';
  res.writeHead(200, { 'content-type': type, 'content-length': fs.statSync(file).size, 'cache-control': cache });
  const stream = fs.createReadStream(file, { highWaterMark: 64 * 1024 });
  if (SLOW && file.endsWith('.gz')) {
    void (async () => {
      for await (const chunk of stream) {
        res.write(chunk);
        await new Promise((r) => setTimeout(r, 32));
      }
      res.end();
    })();
  } else {
    stream.pipe(res);
  }
  console.log(req.method, url.pathname);
}).listen(PORT, () => console.log(`http://localhost:${PORT}/`));
