import { runClang } from '@yowasp/clang';
import { PCH_ARGS, fileAt, headerTree } from '../src/toolchain.ts';

// สร้าง PCH ของ <bits/stdc++.h> ด้วย clang ตัวเดียวกับที่ส่งให้เบราว์เซอร์
export async function buildPch(header: string): Promise<Uint8Array> {
  const out = await runClang(PCH_ARGS, headerTree(header, null));
  return fileAt(out, ['sys', 'bits', 'stdc++.h.pch']);
}
