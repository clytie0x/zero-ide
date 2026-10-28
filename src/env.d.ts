// ค่าที่ tools/build.ts ใส่ให้ตอน bundle ด้วย define ของ esbuild

interface ClangManifest {
  id: string;
  base: string;
  download: number;
  files: Record<string, { size: number; type: string }>;
}

declare const __CLANG__: ClangManifest;
declare const __WORKERS__: { compile: string; run: string };
declare const __VERSION__: string;
declare const __SHELL__: string[];

// esbuild โหลดไฟล์ .h เป็นข้อความ
declare module '*.h' {
  const text: string;
  export default text;
}
