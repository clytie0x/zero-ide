import { run } from './run-core.ts';
import { errorMessage, type RunOutcome, type RunReply, type RunRequest } from './messages.ts';

// เก็บผลลัพธ์ไม่เกินช่องละ 1 MB กันแท็บค้างตอนพิมพ์ในลูปไม่รู้จบ เกินแล้วหยุดโปรแกรมเลย
const LIMIT = 1 << 20;
const FLUSH_MS = 50;
const OUTPUT_LIMIT = new Error('output limit');

interface Stream {
  dec: TextDecoder;
  text: string;
  size: number;
}

function post(msg: RunReply): void {
  self.postMessage(msg);
}

self.onmessage = async ({ data }: MessageEvent<RunRequest>) => {
  const out: Stream = { dec: new TextDecoder(), text: '', size: 0 };
  const err: Stream = { dec: new TextDecoder(), text: '', size: 0 };
  let truncated = false;
  let last = performance.now();

  const flush = () => {
    if (out.text || err.text) {
      post({ type: 'output', out: out.text, err: err.text });
      out.text = '';
      err.text = '';
    }
    last = performance.now();
  };

  const sink = (s: Stream) => (bytes: Uint8Array) => {
    const take = bytes.subarray(0, LIMIT - s.size);
    s.size += take.length;
    s.text += s.dec.decode(take, { stream: true });
    if (take.length < bytes.length) {
      truncated = true;
      throw OUTPUT_LIMIT;
    }
    if (performance.now() - last > FLUSH_MS) flush();
  };

  let result: RunOutcome;
  try {
    result = await run(data.wasm, { stdin: data.stdin, onStdout: sink(out), onStderr: sink(err) });
  } catch (e) {
    result = e === OUTPUT_LIMIT ? { limited: true } : { error: errorMessage(e) };
  }
  out.text += out.dec.decode();
  err.text += err.dec.decode();
  flush();
  post({ type: 'done', truncated, result });
};
