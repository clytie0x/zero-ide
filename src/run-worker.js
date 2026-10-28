import { run } from './run-core.js';

// เก็บผลลัพธ์ไม่เกินช่องละ 1 MB กันแท็บค้างตอนพิมพ์ในลูปไม่รู้จบ เกินแล้วหยุดโปรแกรมเลย
const LIMIT = 1 << 20;
const FLUSH_MS = 50;
const OUTPUT_LIMIT = new Error('output limit');

self.onmessage = async ({ data }) => {
  const streams = {
    out: { dec: new TextDecoder(), text: '', size: 0 },
    err: { dec: new TextDecoder(), text: '', size: 0 },
  };
  let truncated = false;
  let last = performance.now();

  const flush = () => {
    if (streams.out.text || streams.err.text) {
      self.postMessage({ type: 'output', out: streams.out.text, err: streams.err.text });
      streams.out.text = '';
      streams.err.text = '';
    }
    last = performance.now();
  };

  const sink = (s) => (bytes) => {
    const take = bytes.subarray(0, LIMIT - s.size);
    s.size += take.length;
    s.text += s.dec.decode(take, { stream: true });
    if (take.length < bytes.length) {
      truncated = true;
      throw OUTPUT_LIMIT;
    }
    if (performance.now() - last > FLUSH_MS) flush();
  };

  const t0 = performance.now();
  let result;
  try {
    result = await run(data.wasm, { stdin: data.stdin, onStdout: sink(streams.out), onStderr: sink(streams.err) });
  } catch (e) {
    result = e === OUTPUT_LIMIT ? { limited: true } : { error: String(e?.message || e) };
  }
  streams.out.text += streams.out.dec.decode();
  streams.err.text += streams.err.dec.decode();
  flush();
  self.postMessage({ type: 'done', ...result, truncated, ms: performance.now() - t0 });
};
