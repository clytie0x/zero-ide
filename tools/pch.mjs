import { runClang } from '@yowasp/clang';
import { PCH_ARGS, headerTree } from '../src/toolchain.js';

// สร้าง PCH ของ <bits/stdc++.h> ด้วย clang ตัวเดียวกับที่ส่งให้เบราว์เซอร์
export async function buildPch(header) {
  const out = await runClang(PCH_ARGS, headerTree(header, null));
  return out.sys.bits['stdc++.h.pch'];
}
