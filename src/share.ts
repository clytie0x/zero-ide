// ลิงก์แชร์โค้ด เก็บโค้ดไว้หลังเครื่องหมาย # จึงไม่ถูกส่งไปที่เซิร์ฟเวอร์
// รูปแบบ #lang=cpp&code=<deflate-raw แล้ว base64url>&in=<แบบเดียวกัน>
// zero-index สร้างลิงก์ "ลองรัน" ด้วยรูปแบบนี้ ถ้าเปลี่ยนต้องแก้ทั้งสองที่
import { isLang, type Lang } from './toolchain.ts';

const MAX_TEXT = 256 * 1024;

export interface Shared {
  lang: Lang;
  code: string;
  input: string | null;
}

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pump(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_TEXT) {
      await reader.cancel();
      throw new Error('too large');
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function pack(text: string): Promise<string> {
  const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return toBase64Url(await pump(stream));
}

async function unpack(param: string): Promise<string> {
  const stream = new Blob([fromBase64Url(param)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new TextDecoder('utf-8', { fatal: true }).decode(await pump(stream));
}

export async function encodeShare({ lang, code, input }: { lang: Lang; code: string; input: string }): Promise<string> {
  const params = new URLSearchParams({ lang, code: await pack(code) });
  if (input) params.set('in', await pack(input));
  return '#' + params.toString();
}

// คืน null ถ้าลิงก์ไม่ใช่รูปแบบนี้หรือข้อมูลเสีย
export async function decodeShare(hash: string): Promise<Shared | null> {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const lang = params.get('lang');
  const code = params.get('code');
  const input = params.get('in');
  if (!code || !isLang(lang)) return null;
  try {
    return { lang, code: await unpack(code), input: input === null ? null : await unpack(input) };
  } catch {
    return null;
  }
}
