import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runClang } from '@yowasp/clang';
import { compile } from '../src/toolchain.js';
import { run } from '../src/run-core.js';
import { buildPch } from '../tools/pch.mjs';

const header = fs.readFileSync(new URL('../src/stdc++.h', import.meta.url), 'utf8');
let pch;

before(async () => {
  pch = await buildPch(header);
});

async function compileAndRun(lang, source, input = '', usePch = true) {
  const c = await compile(runClang, { lang, source, header, pch: usePch ? pch : null });
  if (!c.ok) return { compile: c };
  let stdout = '';
  let stderr = '';
  const dec = new TextDecoder();
  const r = await run(c.wasm, {
    stdin: new TextEncoder().encode(input),
    onStdout: (b) => { stdout += dec.decode(b); },
    onStderr: (b) => { stderr += dec.decode(b); },
  });
  return { compile: c, ...r, stdout, stderr };
}

test('C อ่าน scanf แล้วพิมพ์ผล', async () => {
  const r = await compileAndRun('c', '#include <stdio.h>\nint main(){int a,b;scanf("%d %d",&a,&b);printf("%d\\n",a+b);return 0;}\n', '3 4\n');
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '7\n');
});

const bitsProgram = `#include <bits/stdc++.h>
using namespace std;
int main() {
    int n; cin >> n;
    vector<int> v(n);
    for (auto &x : v) cin >> x;
    sort(v.begin(), v.end());
    map<int, int> m;
    for (int x : v) m[x]++;
    for (auto [k, c] : m) cout << k << ":" << c << " ";
    cout << "\\n";
}
`;

test('C++ ใช้ bits/stdc++.h ได้ทั้งแบบมีและไม่มี PCH', async () => {
  for (const usePch of [true, false]) {
    const r = await compileAndRun('cpp', bitsProgram, '5\n3 1 3 2 1\n', usePch);
    assert.equal(r.code, 0, r.compile.log);
    assert.equal(r.stdout, '1:2 2:1 3:2 \n');
  }
});

test('PCH เสียก็ยังคอมไพล์ได้', async () => {
  const c = await compile(runClang, { lang: 'cpp', source: bitsProgram, header, pch: new Uint8Array([1, 2, 3]) });
  assert.equal(c.ok, true, c.log);
});

test('โค้ดผิดได้ข้อความ error พร้อมเลขบรรทัด', async () => {
  const r = await compileAndRun('c', '#include <stdio.h>\nint main() {\n    int x = 5\n    printf("%d", x);\n}\n');
  assert.equal(r.compile.ok, false);
  assert.match(r.compile.log, /main\.c:3:14: error/);
});

test('try/catch แจ้งว่าไม่รองรับ exception', async () => {
  const r = await compileAndRun('cpp', '#include <stdexcept>\nint main(){try{throw std::runtime_error("x");}catch(...){}}\n');
  assert.equal(r.compile.ok, false);
  assert.match(r.compile.log, /exceptions disabled/);
});

test('return ค่าอื่นได้รหัสออกตามนั้น', async () => {
  const r = await compileAndRun('c', 'int main(){return 3;}\n');
  assert.equal(r.code, 3);
});

test('abort กลางทางเป็น trap', async () => {
  const r = await compileAndRun('cpp', '#include <vector>\nint main(){std::vector<int> v(3); v.at(10) = 1;}\n');
  assert.ok(r.trap, JSON.stringify(r));
});

test('recursion ลึกหนึ่งล้านชั้นไม่พัง', async () => {
  const src = '#include <stdio.h>\nint d(int n){ return n == 0 ? 0 : 1 + d(n - 1); }\nint main(){int n; scanf("%d",&n); printf("%d\\n", d(n));}\n';
  const r = await compileAndRun('c', src, '1000000\n');
  assert.equal(r.stdout, '1000000\n', JSON.stringify(r));
});
