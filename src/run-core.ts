import { WASI, File, OpenFile, ConsoleStdout } from '@bjorn3/browser_wasi_shim';

export type RunResult = { code: number } | { trap: string };

export interface RunInput {
  stdin: Uint8Array;
  onStdout: (bytes: Uint8Array) => void;
  onStderr: (bytes: Uint8Array) => void;
}

interface WasiCommand {
  exports: { memory: WebAssembly.Memory; _start: () => unknown };
}

function isCommand(instance: WebAssembly.Instance): instance is WebAssembly.Instance & WasiCommand {
  const { memory, _start } = instance.exports;
  return memory instanceof WebAssembly.Memory && typeof _start === 'function';
}

// รันโปรแกรมที่คอมไพล์แล้ว คืน { code } เมื่อจบปกติ หรือ { trap } เมื่อพังกลางทาง
export async function run(wasm: Uint8Array<ArrayBuffer>, { stdin, onStdout, onStderr }: RunInput): Promise<RunResult> {
  const fds = [new OpenFile(new File(stdin)), new ConsoleStdout(onStdout), new ConsoleStdout(onStderr)];
  // ต้องปิด debug เอง ถ้าไม่ส่งค่า ไลบรารีจะเปิดไว้และพิมพ์ทุก syscall ลง console
  const wasi = new WASI(['main'], [], fds, { debug: false });
  const module = await WebAssembly.compile(wasm);
  const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.wasiImport });
  if (!isCommand(instance)) throw new Error('ไฟล์ที่คอมไพล์ได้ไม่มี _start');
  try {
    return { code: wasi.start(instance) };
  } catch (e) {
    if (e instanceof WebAssembly.RuntimeError) return { trap: e.message };
    if (e instanceof RangeError) return { trap: 'stack overflow' };
    throw e;
  }
}
