// ข้อความที่หน้าเว็บกับ worker ส่งหากัน
import type { Lang } from './toolchain.ts';

export type CompilerRequest =
  | { type: 'load' }
  | { type: 'prefetch-pch' }
  | { type: 'compile'; id: number; lang: Lang; source: string };

export type CompilerReply =
  | { type: 'progress'; done: number; total: number; download: number }
  | { type: 'ready' }
  | { type: 'load-error'; message: string }
  | ({ type: 'compiled'; id: number } & Compiled);

export type Compiled = { ok: true; wasm: Uint8Array<ArrayBuffer>; log: string } | { ok: false; crashed?: true; log: string };

export interface RunRequest {
  wasm: Uint8Array<ArrayBuffer>;
  stdin: Uint8Array<ArrayBuffer>;
}

export type RunReply =
  | { type: 'output'; out: string; err: string }
  | { type: 'done'; truncated: boolean; result: RunOutcome };

export type RunOutcome = { code: number } | { trap: string } | { limited: true } | { error: string };

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
