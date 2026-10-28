import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { encodeShare, decodeShare } from '../src/share.js';
import { LANGS } from '../src/toolchain.js';

const code = '#include <stdio.h>\n\nint main() {\n    printf("สวัสดี %d\\n", 42);\n}\n';

test('เข้ารหัสแล้วถอดกลับได้ตรงเดิม', async () => {
  const hash = await encodeShare({ lang: 'c', code, input: '3 4\n' });
  assert.match(hash, /^#lang=c&code=[A-Za-z0-9_-]+&in=[A-Za-z0-9_-]+$/);
  assert.deepEqual(await decodeShare(hash, LANGS), { lang: 'c', code, input: '3 4\n' });
});

test('ถอดลิงก์ที่ zero-index สร้างด้วย zlib ได้', async () => {
  const b64 = deflateRawSync(Buffer.from(code)).toString('base64url');
  assert.deepEqual(await decodeShare(`#lang=cpp&code=${b64}`, LANGS), { lang: 'cpp', code, input: null });
});

test('ลิงก์เสียหรือภาษาแปลกได้ null', async () => {
  assert.equal(await decodeShare('#lang=py&code=AAAA', LANGS), null);
  assert.equal(await decodeShare('#lang=c&code=!!!', LANGS), null);
  assert.equal(await decodeShare('#lang=c', LANGS), null);
  assert.equal(await decodeShare('#lang=__proto__&code=AAAA', LANGS), null);
});

test('ข้อมูลที่คลายแล้วใหญ่เกินไม่ยอมรับ', async () => {
  const bomb = deflateRawSync(Buffer.alloc(1024 * 1024, 32)).toString('base64url');
  assert.equal(await decodeShare(`#lang=c&code=${bomb}`, LANGS), null);
});
