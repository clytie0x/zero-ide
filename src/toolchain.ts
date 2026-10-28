// ตั้งค่าคอมไพเลอร์ ใช้ร่วมกันทั้งในเบราว์เซอร์ ตอน build และในเทส
import type { RunOptions, Tree } from '@yowasp/clang';

export type Lang = 'c' | 'cpp';

export interface LangInfo {
  label: string;
  file: string;
  driver: 'clang' | 'clang++';
  flags: readonly string[];
}

export const LANGS: Readonly<Record<Lang, LangInfo>> = {
  c: { label: 'C', file: 'main.c', driver: 'clang', flags: ['-std=gnu17', '-O2', '-Wall'] },
  cpp: { label: 'C++', file: 'main.cpp', driver: 'clang++', flags: ['-std=gnu++20', '-O2', '-Wall', '-fno-exceptions'] },
};

export function isLang(value: unknown): value is Lang {
  return value === 'c' || value === 'cpp';
}

// runClang ของ @yowasp/clang รับ null เพื่อโหลดไฟล์อย่างเดียวได้ด้วย
export type RunClang = (args: string[] | null, files?: Tree, options?: RunOptions) => Promise<Tree> | Tree | undefined;

// stack 64 MB ให้ recursion ลึกแบบโจทย์แข่งได้ หน่วยความจำรวมไม่เกิน 1 GB
const LINK = ['-Wl,-z,stack-size=67108864', '-Wl,--max-memory=1073741824'];

export const HEADER_DIR = 'sys';
const HEADER = `${HEADER_DIR}/bits/stdc++.h`;
const PCH = `${HEADER}.pch`;

// PCH ต้องสร้างด้วย flag ชุดเดียวกับตอนคอมไพล์ C++ ไม่อย่างนั้น clang จะไม่ยอมใช้
export const PCH_ARGS = ['clang++', '-x', 'c++-header', ...LANGS.cpp.flags, HEADER, '-o', PCH];

const BITS_RE = /^[ \t]*#[ \t]*include[ \t]*<bits\/stdc\+\+\.h>/m;

export function usesBits(source: string): boolean {
  return BITS_RE.test(source);
}

export function compileArgs(lang: Lang, source: string, havePch: boolean): string[] {
  const { driver, flags, file } = LANGS[lang];
  const args: string[] = [driver, ...flags];
  if (lang === 'cpp') {
    args.push('-isystem', HEADER_DIR);
    if (havePch && usesBits(source)) args.push('-include-pch', PCH);
  }
  return [...args, file, ...LINK, '-o', 'main.wasm'];
}

export function headerTree(header: string, pch: Uint8Array | null): Tree {
  const bits: Tree = { 'stdc++.h': header };
  if (pch) bits['stdc++.h.pch'] = pch;
  return { [HEADER_DIR]: { bits } };
}

// หยิบไฟล์ที่ได้จาก runClang ตามเส้นทาง เช่น ['sys', 'bits', 'stdc++.h.pch']
export function fileAt(tree: Tree | undefined, path: readonly string[]): Uint8Array {
  let node: Tree | string | Uint8Array | undefined = tree;
  for (const part of path) {
    if (!node || typeof node === 'string' || node instanceof Uint8Array) break;
    node = node[part];
  }
  if (!(node instanceof Uint8Array)) throw new Error(`clang ไม่ได้สร้างไฟล์ ${path.join('/')}`);
  return node;
}

// clang จบด้วย exit code ไม่เป็นศูนย์จะโยน Exit ที่มี code เป็นตัวเลข
function exitCode(e: unknown): number | null {
  if (typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'number') return e.code;
  return null;
}

export type CompileResult = { ok: true; wasm: Uint8Array; log: string } | { ok: false; log: string };

export interface CompileInput {
  lang: Lang;
  source: string;
  header: string;
  pch: Uint8Array | null;
}

// log คือข้อความจาก compiler ทั้งหมด
export async function compile(runClang: RunClang, { lang, source, header, pch }: CompileInput): Promise<CompileResult> {
  const attempt = async (withPch: Uint8Array | null): Promise<CompileResult> => {
    let log = '';
    const dec = new TextDecoder();
    const sink = (b: Uint8Array | null) => {
      if (b) log += dec.decode(b, { stream: true });
    };
    const tree: Tree = { [LANGS[lang].file]: source, ...headerTree(header, withPch) };
    try {
      const out = await runClang(compileArgs(lang, source, withPch !== null), tree, { stdout: sink, stderr: sink });
      return { ok: true, wasm: fileAt(out, ['main.wasm']), log };
    } catch (e) {
      if (exitCode(e) === null) throw e;
      return { ok: false, log };
    }
  };
  const first = await attempt(pch);
  // PCH ใช้ไม่ได้ก็ยังคอมไพล์ได้ แค่ช้ากว่า
  if (!first.ok && pch && /precompiled header|PCH file/i.test(first.log)) return attempt(null);
  return first;
}
