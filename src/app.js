import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { EditorState, EditorSelection } from '@codemirror/state';
import { defaultKeymap, history as undoHistory, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, indentUnit, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { cpp } from '@codemirror/lang-cpp';
import { tags as t } from '@lezer/highlight';
import { LANGS } from './toolchain.js';
import { encodeShare, decodeShare } from './share.js';

// __WORKERS__ ใส่ให้ตอน build คือที่อยู่ของ worker ที่มี hash ในชื่อไฟล์
const WORKERS = __WORKERS__;
const TIME_LIMIT_MS = 10000;

const TEMPLATES = {
  c: '#include <stdio.h>\n\nint main() {\n    printf("Hello, POSN!\\n");\n    return 0;\n}\n',
  cpp: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    cout << "Hello, POSN!\\n";\n    return 0;\n}\n',
};

const $ = (id) => document.getElementById(id);
const store = {
  get(key) {
    try { return localStorage.getItem('zide-' + key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem('zide-' + key, value); } catch { /* ไม่มีที่เก็บก็ไม่จำ */ }
  },
};

/* ---------- โหมดมืด ---------- */

const root = document.documentElement;
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const effectiveTheme = () => {
  const v = root.getAttribute('data-theme');
  return v === 'light' || v === 'dark' ? v : darkQuery.matches ? 'dark' : 'light';
};
function syncThemeButton() {
  const label = effectiveTheme() === 'dark' ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด';
  const btn = document.querySelector('.theme-btn');
  btn.setAttribute('aria-label', label);
  btn.title = label;
}
document.querySelector('.theme-btn').addEventListener('click', () => {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  try { localStorage.setItem('zi-theme', next); } catch { /* สลับได้แม้ไม่มีที่เก็บ */ }
  syncThemeButton();
});
darkQuery.addEventListener('change', syncThemeButton);
syncThemeButton();

/* ---------- ตัวแก้โค้ด ---------- */

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.modifier, t.definitionKeyword], color: 'var(--syn-kw)', fontWeight: '600' },
  { tag: [t.typeName, t.standard(t.typeName), t.namespace], color: 'var(--syn-type)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--syn-fn)' },
  { tag: [t.string, t.character], color: 'var(--syn-str)' },
  { tag: t.escape, color: 'var(--syn-esc)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--syn-num)' },
  { tag: [t.processingInstruction, t.meta], color: 'var(--syn-pre)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-com)', fontStyle: 'italic' },
]);

const editorTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--code-bg)', color: 'var(--code-ink)', fontSize: '14.5px' },
  '.cm-scroller': { fontFamily: 'var(--font-code)', lineHeight: '1.7' },
  '.cm-content': { padding: '10px 0', caretColor: 'var(--ink)' },
  '.cm-gutters': { backgroundColor: 'var(--code-bg)', color: 'var(--code-gutter)', border: 'none', paddingLeft: '6px' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--brand) 6%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ink-2)' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--ink)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--brand) 24%, transparent)',
  },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'color-mix(in srgb, var(--brand) 16%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--brand) 45%, transparent)',
  },
});

let lang = 'c';
let saveTimer = 0;

const view = new EditorView({
  parent: $('editor'),
  state: EditorState.create({
    doc: '',
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      drawSelection(),
      undoHistory(),
      indentOnInput(),
      bracketMatching(),
      indentUnit.of('    '),
      EditorState.tabSize.of(4),
      cpp(),
      syntaxHighlighting(highlight),
      editorTheme,
      keymap.of([
        { key: 'Mod-Enter', run: () => { runCode(); return true; } },
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      EditorView.contentAttributes.of({ 'aria-label': 'โค้ด', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
      EditorView.updateListener.of((u) => {
        if (!u.docChanged) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveDraft, 400);
      }),
    ],
  }),
});

function saveDraft() {
  clearTimeout(saveTimer);
  store.set('draft-' + lang, view.state.doc.toString());
  store.set('stdin', $('stdin').value);
}

function setDoc(text) {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: EditorSelection.cursor(0) });
}

function setLang(next, { loadDraft = true } = {}) {
  if (loadDraft) saveDraft();
  lang = next;
  store.set('lang', lang);
  for (const b of document.querySelectorAll('.lang-switch button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  document.querySelector('.file-name').textContent = LANGS[lang].file;
  if (loadDraft) setDoc(store.get('draft-' + lang) ?? TEMPLATES[lang]);
  if (lang === 'cpp') compiler.postMessage({ type: 'prefetch-pch' });
}

for (const b of document.querySelectorAll('.lang-switch button')) {
  b.addEventListener('click', () => {
    if (b.dataset.lang !== lang && !busy) setLang(b.dataset.lang);
  });
}

$('reset-btn').addEventListener('click', () => {
  if (view.state.doc.toString() !== TEMPLATES[lang] && !confirm('ล้างโค้ดที่เขียนไว้ แล้วเริ่มจากโค้ดตั้งต้นใหม่ไหม')) return;
  setDoc(TEMPLATES[lang]);
  saveDraft();
  view.focus();
});

$('stdin').addEventListener('input', () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 400);
});
$('stdin').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    runCode();
  }
});

/* ---------- สถานะ ---------- */

// สถานะแสดงบนหัวหน้าต่างผลลัพธ์ และส่งให้โปรแกรมอ่านหน้าจอทางช่องที่ซ่อนไว้
function setStatus(text) {
  $('term-title').textContent = text;
  $('status').textContent = text;
}

const mb = (n) => (n / 1048576).toFixed(0);

/* ---------- ตัวคอมไพล์ ---------- */

const compiler = new Worker(new URL(WORKERS.compile, document.baseURI), { type: 'module' });
let compilerReady = false;
let compileSeq = 0;
const pending = new Map();
const loadBar = document.querySelector('.load-bar');

compiler.onmessage = ({ data }) => {
  if (data.type === 'progress') {
    if (compilerReady || !data.total) return;
    // done กับ total นับขนาดหลังคลาย จึงบอกเป็นเปอร์เซ็นต์คู่กับขนาดที่โหลดจริง
    const pct = Math.min(100, (100 * data.done) / data.total);
    loadBar.hidden = false;
    loadBar.firstElementChild.style.width = `${pct}%`;
    if (!busy) setStatus(`กำลังโหลดตัวคอมไพล์ ${Math.floor(pct)}% จากราว ${mb(data.download)} MB โหลดแค่ครั้งแรก`);
  } else if (data.type === 'ready') {
    compilerReady = true;
    loadBar.hidden = true;
    if (!busy) setStatus('ผลลัพธ์');
    navigator.storage?.persist?.().catch(() => {});
  } else if (data.type === 'load-error') {
    loadBar.hidden = true;
    setStatus('โหลดตัวคอมไพล์ไม่สำเร็จ');
    appendOut('[โหลดตัวคอมไพล์ไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วรีเฟรชหน้าใหม่]\n', 'sys');
    for (const [, reject] of pending.values()) reject(new Error(data.message));
    pending.clear();
  } else if (data.type === 'compiled') {
    const p = pending.get(data.id);
    pending.delete(data.id);
    p?.[0](data);
  }
};

function compileSource(source) {
  const id = ++compileSeq;
  return new Promise((resolve, reject) => {
    pending.set(id, [resolve, reject]);
    compiler.postMessage({ type: 'compile', id, lang, source });
  });
}

/* ---------- ข้อความจาก compiler ---------- */

const LOC_RE = /^(main\.(?:c|cpp)):(\d+):(\d+): (fatal error|error|warning|note): /;

function renderLog(log) {
  const pre = $('compiler-text');
  pre.replaceChildren();
  for (const line of log.replace(/\n+$/, '').split('\n')) {
    const m = LOC_RE.exec(line);
    if (m) {
      const loc = document.createElement('button');
      loc.type = 'button';
      loc.className = 'tk-loc';
      loc.textContent = `${m[1]}:${m[2]}:${m[3]}`;
      loc.title = 'ไปที่บรรทัดนี้';
      loc.addEventListener('click', () => jumpTo(Number(m[2]), Number(m[3])));
      const sev = document.createElement('span');
      sev.className = 'tk-sev-' + (m[4] === 'fatal error' ? 'error' : m[4]);
      sev.textContent = m[4];
      pre.append(loc, ': ', sev, ': ' + line.slice(m[0].length) + '\n');
    } else if (/^\s*\|?\s*\^[~^]*\s*$/.test(line.replace(/^\s*\d*\s*\|/, ''))) {
      const caret = document.createElement('span');
      caret.className = 'tk-caret';
      caret.textContent = line;
      pre.append(caret, '\n');
    } else {
      pre.append(line + '\n');
    }
  }
  $('compiler-log').hidden = false;
}

function jumpTo(line, col) {
  const doc = view.state.doc;
  const l = doc.line(Math.min(Math.max(line, 1), doc.lines));
  const pos = Math.min(l.from + Math.max(col - 1, 0), l.to);
  view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true });
  view.focus();
}

function explain(log) {
  if (/with exceptions disabled/.test(log)) {
    return 'ตัวรันบนเว็บยังใช้ try catch throw ไม่ได้ โค้ดนี้ให้ลองใน Code::Blocks แทน';
  }
  if (/'bits\/stdc\+\+\.h' file not found/.test(log)) {
    return 'ภาษา C ใช้ bits/stdc++.h ไม่ได้ ถ้าจะเขียน C++ ให้กดเลือก C++ ที่มุมขวาบน';
  }
  return '';
}

/* ---------- รันโปรแกรม ---------- */

const out = $('output');
let busy = false;
let runner = null;
let runTimer = 0;
let finishRun = null;

function appendOut(text, cls) {
  if (!text) return;
  const atBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 24;
  if (cls) {
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = text;
    out.append(span);
  } else {
    out.append(text);
  }
  if (atBottom) out.scrollTop = out.scrollHeight;
}

// ระหว่างโปรแกรมรัน ปุ่มหยุดขึ้นแทนที่ปุ่มรัน
function setBusy(on, running = false) {
  busy = on;
  const run = $('run-btn');
  run.setAttribute('aria-busy', String(on));
  run.disabled = on;
  run.hidden = running;
  $('stop-btn').hidden = !running;
}

const TRAPS = [
  [/unreachable/, 'โปรแกรมหยุดกลางทาง (เช่น เรียก abort หรือ assert ไม่ผ่าน หรือใช้ .at() เกินขอบ)'],
  [/out of bounds/, 'เข้าถึงหน่วยความจำนอกขอบเขต (เช่น ใช้ index เกินขนาดอาร์เรย์มาก ๆ หรือ recursion ลึกเกิน stack)'],
  [/divide by zero|remainder by zero/, 'หารด้วยศูนย์'],
  [/integer overflow/, 'ค่าล้นตอนหาร'],
  [/stack overflow|call stack/i, 'recursion ลึกเกินกว่าที่เบราว์เซอร์รับได้'],
];

function describeTrap(msg) {
  for (const [re, text] of TRAPS) if (re.test(msg)) return text;
  return msg;
}

async function runCode() {
  if (busy) return;
  saveDraft();
  setBusy(true);
  out.replaceChildren();
  $('compiler-log').hidden = true;
  $('log-note').hidden = true;
  setStatus(compilerReady ? 'กำลังคอมไพล์' : 'รอโหลดตัวคอมไพล์ให้เสร็จ แล้วจะคอมไพล์ให้ทันที');

  let compiled;
  try {
    compiled = await compileSource(view.state.doc.toString());
  } catch {
    setBusy(false);
    return;
  }
  if (compiled.log) {
    renderLog(compiled.log);
    const note = explain(compiled.log);
    if (note) {
      $('log-note').textContent = note;
      $('log-note').hidden = false;
    }
  }
  if (!compiled.ok) {
    setStatus(compiled.crashed ? 'ตัวคอมไพล์ทำงานผิดพลาด' : 'คอมไพล์ไม่ผ่าน');
    if (compiled.crashed) appendOut('[ตัวคอมไพล์ทำงานผิดพลาด ลองรีเฟรชหน้าแล้วรันใหม่]\n', 'sys');
    setBusy(false);
    return;
  }

  setBusy(true, true);
  setStatus('กำลังรัน');
  const stdin = new TextEncoder().encode($('stdin').value);

  // note คือบรรทัดอธิบายท้ายผลลัพธ์ ใส่เฉพาะตอนจบไม่ปกติ
  await new Promise((resolve) => {
    runner = new Worker(new URL(WORKERS.run, document.baseURI), { type: 'module' });
    finishRun = (title, note) => {
      clearTimeout(runTimer);
      runner?.terminate();
      runner = null;
      finishRun = null;
      if (note) appendOut(`${out.textContent && !out.textContent.endsWith('\n') ? '\n' : ''}[${note}]\n`, 'sys');
      setStatus(title);
      resolve();
    };
    runner.onmessage = ({ data }) => {
      if (data.type === 'output') {
        appendOut(data.out);
        appendOut(data.err, 'err');
        return;
      }
      if (data.limited) finishRun('ผลลัพธ์ยาวเกิน', 'ผลลัพธ์ยาวเกิน 1 MB โปรแกรมถูกหยุด อาจมีลูปที่ไม่จบ');
      else if (data.error) finishRun('รันไม่สำเร็จ', data.error);
      else if (data.trap) finishRun('โปรแกรมหยุดทำงานผิดปกติ', describeTrap(data.trap));
      else if (data.code === 0) finishRun('จบโปรแกรม');
      else finishRun(`จบโปรแกรม ค่าที่ return คือ ${data.code}`);
    };
    runner.onerror = (e) => {
      e.preventDefault();
      finishRun('รันไม่สำเร็จ', 'ลองรีเฟรชหน้าแล้วรันใหม่');
    };
    runTimer = setTimeout(() => {
      finishRun('เกินเวลา', `เกิน ${TIME_LIMIT_MS / 1000} วินาที โปรแกรมถูกหยุด อาจมีลูปที่ไม่จบ หรือรอข้อมูลเข้าที่ยังไม่ได้ใส่`);
    }, TIME_LIMIT_MS);
    runner.postMessage({ wasm: compiled.wasm, stdin }, [compiled.wasm.buffer]);
  });
  setBusy(false);
}

$('run-btn').addEventListener('click', runCode);
$('stop-btn').addEventListener('click', () => {
  if (finishRun) finishRun('หยุดแล้ว', 'หยุดโดยผู้ใช้');
});

/* ---------- แชร์ ---------- */

let shareTimer = 0;
$('share-btn').addEventListener('click', async () => {
  const btn = $('share-btn');
  const hash = await encodeShare({ lang, code: view.state.doc.toString(), input: $('stdin').value });
  const url = location.origin + location.pathname + hash;
  try {
    await navigator.clipboard.writeText(url);
    btn.classList.add('done');
    $('status').textContent = 'คัดลอกลิงก์แล้ว';
    clearTimeout(shareTimer);
    shareTimer = setTimeout(() => btn.classList.remove('done'), 1800);
  } catch {
    history.replaceState(null, '', hash);
    $('status').textContent = 'คัดลอกไม่ได้ ลิงก์อยู่ในช่องที่อยู่ด้านบนแล้ว';
  }
});

/* ---------- เริ่มต้น ---------- */

async function init() {
  const shared = location.hash.length > 1 ? await decodeShare(location.hash, LANGS) : null;
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  if (shared) {
    setLang(shared.lang, { loadDraft: false });
    setDoc(shared.code);
    $('stdin').value = shared.input ?? '';
    saveDraft();
  } else {
    const saved = store.get('lang');
    $('stdin').value = store.get('stdin') ?? '';
    setLang(Object.hasOwn(LANGS, saved) ? saved : 'c', { loadDraft: false });
    setDoc(store.get('draft-' + lang) ?? TEMPLATES[lang]);
  }
  setStatus('กำลังเตรียมตัวคอมไพล์');
  compiler.postMessage({ type: 'load' });
}

window.addEventListener('pagehide', saveDraft);
init();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
