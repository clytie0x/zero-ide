// api.d.ts ของ @yowasp/clang ไม่ได้ประกาศ runClang ทั้งที่ bundle ส่งออกมาให้ใช้
// ส่ง null แทนคำสั่งได้ เพื่อโหลดไฟล์ของ clang อย่างเดียว
import type { RunOptions, Tree } from '@yowasp/clang';

declare module '@yowasp/clang' {
  export function runClang(args: string[] | null, files?: Tree, options?: RunOptions): Promise<Tree> | Tree | undefined;
}
