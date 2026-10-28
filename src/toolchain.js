// ตั้งค่าคอมไพเลอร์ ใช้ร่วมกันทั้งในเบราว์เซอร์ ตอน build และในเทส

export const LANGS = {
  c: { label: 'C', file: 'main.c', driver: 'clang', flags: ['-std=gnu17', '-O2', '-Wall'] },
  cpp: { label: 'C++', file: 'main.cpp', driver: 'clang++', flags: ['-std=gnu++20', '-O2', '-Wall', '-fno-exceptions'] },
};

// stack 64 MB ให้ recursion ลึกแบบโจทย์แข่งได้ หน่วยความจำรวมไม่เกิน 1 GB
const LINK = ['-Wl,-z,stack-size=67108864', '-Wl,--max-memory=1073741824'];

export const HEADER_DIR = 'sys';
const HEADER = `${HEADER_DIR}/bits/stdc++.h`;
const PCH = `${HEADER}.pch`;

// PCH ต้องสร้างด้วย flag ชุดเดียวกับตอนคอมไพล์ C++ ไม่อย่างนั้น clang จะไม่ยอมใช้
export const PCH_ARGS = ['clang++', '-x', 'c++-header', ...LANGS.cpp.flags, HEADER, '-o', PCH];

const BITS_RE = /^[ \t]*#[ \t]*include[ \t]*<bits\/stdc\+\+\.h>/m;

export function usesBits(source) {
  return BITS_RE.test(source);
}

export function compileArgs(lang, source, havePch) {
  const { driver, flags, file } = LANGS[lang];
  const args = [driver, ...flags];
  if (lang === 'cpp') {
    args.push('-isystem', HEADER_DIR);
    if (havePch && usesBits(source)) args.push('-include-pch', PCH);
  }
  return [...args, file, ...LINK, '-o', 'main.wasm'];
}

export function headerTree(header, pch) {
  const bits = { 'stdc++.h': header };
  if (pch) bits['stdc++.h.pch'] = pch;
  return { [HEADER_DIR]: { bits } };
}

// คืน { ok, wasm, log } โดย log คือข้อความจาก compiler ทั้งหมด
export async function compile(runClang, { lang, source, header, pch }) {
  const attempt = async (withPch) => {
    let log = '';
    const dec = new TextDecoder();
    const sink = (b) => { if (b) log += dec.decode(b, { stream: true }); };
    const tree = { [LANGS[lang].file]: source, ...headerTree(header, withPch ? pch : null) };
    try {
      const out = await runClang(compileArgs(lang, source, !!withPch), tree, { stdout: sink, stderr: sink });
      return { ok: true, wasm: out['main.wasm'], log };
    } catch (e) {
      if (typeof e?.code !== 'number') throw e;
      return { ok: false, log };
    }
  };
  const first = await attempt(pch);
  // PCH ใช้ไม่ได้ก็ยังคอมไพล์ได้ แค่ช้ากว่า
  if (!first.ok && pch && /precompiled header|PCH file/i.test(first.log)) return attempt(null);
  return first;
}
