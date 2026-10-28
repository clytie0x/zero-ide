import { WASI, File, OpenFile, ConsoleStdout } from '@bjorn3/browser_wasi_shim';

// รันโปรแกรมที่คอมไพล์แล้ว คืน { code } เมื่อจบปกติ หรือ { trap } เมื่อพังกลางทาง
export async function run(wasm, { stdin, onStdout, onStderr }) {
  const fds = [
    new OpenFile(new File(stdin)),
    new ConsoleStdout(onStdout),
    new ConsoleStdout(onStderr),
  ];
  // ต้องปิด debug เอง ถ้าไม่ส่งค่า ไลบรารีจะเปิดไว้และพิมพ์ทุก syscall ลง console
  const wasi = new WASI(['main'], [], fds, { debug: false });
  const module = await WebAssembly.compile(wasm);
  const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.wasiImport });
  try {
    return { code: wasi.start(instance) };
  } catch (e) {
    if (e instanceof WebAssembly.RuntimeError) return { trap: e.message };
    if (e instanceof RangeError) return { trap: 'stack overflow', detail: e.message };
    throw e;
  }
}
