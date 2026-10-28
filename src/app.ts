import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { EditorState, EditorSelection } from '@codemirror/state';
import { defaultKeymap, history as undoHistory, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, indentUnit, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { cpp } from '@codemirror/lang-cpp';
import { tags as t } from '@lezer/highlight';
import { LANGS, isLang, type Lang } from './toolchain.ts';
import { encodeShare, decodeShare } from './share.ts';
import type { Compiled, CompilerReply, CompilerRequest, RunOutcome, RunReply, RunRequest } from './messages.ts';

// __WORKERS__ ใส่ให้ตอน build คือที่อยู่ของ worker ที่มี hash ในชื่อไฟล์
const WORKERS = __WORKERS__;
const TIME_LIMIT_MS = 10000;

const TEMPLATES: Record<Lang, string> = {
  c: '#include <stdio.h>\n\nint main() {\n    printf("Hello, POSN!\\n");\n    return 0;\n}\n',
  cpp: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    cout << "Hello, POSN!\\n";\n    return 0;\n}\n',
};

// หา element ตาม id และตรวจชนิด ถ้า HTML ไม่ตรงกับโค้ดจะพังทันทีแทนที่จะพังเงียบทีหลัง
function el<T extends HTMLElement>(id: string, type: new () => T): T {
  const node = document.getElementById(id);
  if (!(node instanceof type)) throw new Error(`ไม่พบ #${id} ที่เป็น ${type.name}`);
  return node;
}

function query<T extends Element>(selector: string, type: new () => T): T {
  const node = document.querySelector(selector);
  if (!(node instanceof type)) throw new Error(`ไม่พบ ${selector} ที่เป็น ${type.name}`);
  return node;
}

const ui = {
  editor: el('editor', HTMLDivElement),
  fileName: query('.file-name', HTMLSpanElement),
  themeBtn: query('.theme-btn', HTMLButtonElement),
  loadBar: query('.load-bar', HTMLDivElement),
  loadFill: query('.load-bar span', HTMLSpanElement),
  shareBtn: el('share-btn', HTMLButtonElement),
  resetBtn: el('reset-btn', HTMLButtonElement),
  runBtn: el('run-btn', HTMLButtonElement),
  stopBtn: el('stop-btn', HTMLButtonElement),
  status: el('status', HTMLParagraphElement),
  stdin: el('stdin', HTMLTextAreaElement),
  log: el('compiler-log', HTMLDivElement),
  logText: el('compiler-text', HTMLPreElement),
  logNote: el('log-note', HTMLParagraphElement),
  termTitle: el('term-title', HTMLSpanElement),
  out: el('output', HTMLPreElement),
  langButtons: [...document.querySelectorAll<HTMLButtonElement>('.lang-switch button')],
};

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem('zide-' + key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem('zide-' + key, value);
    } catch {
      // ไม่มีที่เก็บก็ไม่จำ
    }
  },
};

/* ---------- โหมดมืด ---------- */

const root = document.documentElement;
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

function effectiveTheme(): 'light' | 'dark' {
  const v = root.getAttribute('data-theme');
  if (v === 'light' || v === 'dark') return v;
  return darkQuery.matches ? 'dark' : 'light';
}

function syncThemeButton(): void {
  const label = effectiveTheme() === 'dark' ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด';
  ui.themeBtn.setAttribute('aria-label', label);
  ui.themeBtn.title = label;
}

ui.themeBtn.addEventListener('click', () => {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  try {
    localStorage.setItem('zi-theme', next);
  } catch {
    // สลับได้แม้ไม่มีที่เก็บ
  }
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

let lang: Lang = 'c';
let saveTimer = 0;

function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveDraft, 400);
}

const view = new EditorView({
  parent: ui.editor,
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
        {
          key: 'Mod-Enter',
          run: () => {
            void runCode();
            return true;
          },
        },
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      EditorView.contentAttributes.of({ 'aria-label': 'โค้ด', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) scheduleSave();
      }),
    ],
  }),
});

function saveDraft(): void {
  clearTimeout(saveTimer);
  store.set('draft-' + lang, view.state.doc.toString());
  store.set('stdin', ui.stdin.value);
}

function setDoc(text: string): void {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: EditorSelection.cursor(0) });
}

function setLang(next: Lang, { loadDraft = true }: { loadDraft?: boolean } = {}): void {
  if (loadDraft) saveDraft();
  lang = next;
  store.set('lang', lang);
  for (const b of ui.langButtons) b.setAttribute('aria-pressed', String(b.dataset['lang'] === lang));
  ui.fileName.textContent = LANGS[lang].file;
  if (loadDraft) setDoc(store.get('draft-' + lang) ?? TEMPLATES[lang]);
  if (lang === 'cpp') postCompiler({ type: 'prefetch-pch' });
}

for (const b of ui.langButtons) {
  b.addEventListener('click', () => {
    const next = b.dataset['lang'];
    if (isLang(next) && next !== lang && !busy) setLang(next);
  });
}

ui.resetBtn.addEventListener('click', () => {
  if (view.state.doc.toString() !== TEMPLATES[lang] && !confirm('ล้างโค้ดที่เขียนไว้ แล้วเริ่มจากโค้ดตั้งต้นใหม่ไหม')) return;
  setDoc(TEMPLATES[lang]);
  saveDraft();
  view.focus();
});

ui.stdin.addEventListener('input', scheduleSave);
ui.stdin.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    void runCode();
  }
});

/* ---------- สถานะ ---------- */

// สถานะแสดงบนหัวหน้าต่างผลลัพธ์ และส่งให้โปรแกรมอ่านหน้าจอทางช่องที่ซ่อนไว้
function setStatus(text: string): void {
  ui.termTitle.textContent = text;
  ui.status.textContent = text;
}

const mb = (n: number) => (n / 1048576).toFixed(0);

/* ---------- ตัวคอมไพล์ ---------- */

const compiler = new Worker(new URL(WORKERS.compile, document.baseURI), { type: 'module' });
let compilerReady = false;
let compileSeq = 0;
const pending = new Map<number, { resolve: (c: Compiled) => void; reject: (e: Error) => void }>();

function postCompiler(msg: CompilerRequest): void {
  compiler.postMessage(msg);
}

compiler.onmessage = ({ data }: MessageEvent<CompilerReply>) => {
  switch (data.type) {
    case 'progress': {
      if (compilerReady || !data.total) return;
      // done กับ total นับขนาดหลังคลาย จึงบอกเป็นเปอร์เซ็นต์คู่กับขนาดที่โหลดจริง
      const pct = Math.min(100, (100 * data.done) / data.total);
      ui.loadBar.hidden = false;
      ui.loadFill.style.width = `${pct}%`;
      if (!busy) setStatus(`กำลังโหลดตัวคอมไพล์ ${Math.floor(pct)}% จากราว ${mb(data.download)} MB โหลดแค่ครั้งแรก`);
      return;
    }
    case 'ready':
      compilerReady = true;
      ui.loadBar.hidden = true;
      if (!busy) setStatus('ผลลัพธ์');
      navigator.storage.persist().catch(() => {});
      return;
    case 'load-error':
      ui.loadBar.hidden = true;
      setStatus('โหลดตัวคอมไพล์ไม่สำเร็จ');
      appendOut('[โหลดตัวคอมไพล์ไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วรีเฟรชหน้าใหม่]\n', 'sys');
      for (const p of pending.values()) p.reject(new Error(data.message));
      pending.clear();
      return;
    case 'compiled': {
      const p = pending.get(data.id);
      pending.delete(data.id);
      p?.resolve(data);
      return;
    }
  }
};

function compileSource(source: string): Promise<Compiled> {
  const id = ++compileSeq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    postCompiler({ type: 'compile', id, lang, source });
  });
}

/* ---------- ข้อความจาก compiler ---------- */

const LOC_RE = /^(main\.(?:c|cpp)):(\d+):(\d+): (fatal error|error|warning|note): /;

function renderLog(log: string): void {
  const pre = ui.logText;
  pre.replaceChildren();
  for (const line of log.replace(/\n+$/, '').split('\n')) {
    const m = LOC_RE.exec(line);
    if (m) {
      const [whole, file, row, col, severity] = m as unknown as [string, string, string, string, string];
      const loc = document.createElement('button');
      loc.type = 'button';
      loc.className = 'tk-loc';
      loc.textContent = `${file}:${row}:${col}`;
      loc.title = 'ไปที่บรรทัดนี้';
      loc.addEventListener('click', () => jumpTo(Number(row), Number(col)));
      const sev = document.createElement('span');
      sev.className = 'tk-sev-' + (severity === 'fatal error' ? 'error' : severity);
      sev.textContent = severity;
      pre.append(loc, ': ', sev, ': ' + line.slice(whole.length) + '\n');
    } else if (/^\s*\|?\s*\^[~^]*\s*$/.test(line.replace(/^\s*\d*\s*\|/, ''))) {
      const caret = document.createElement('span');
      caret.className = 'tk-caret';
      caret.textContent = line;
      pre.append(caret, '\n');
    } else {
      pre.append(line + '\n');
    }
  }
  ui.log.hidden = false;
}

function jumpTo(line: number, col: number): void {
  const doc = view.state.doc;
  const l = doc.line(Math.min(Math.max(line, 1), doc.lines));
  const pos = Math.min(l.from + Math.max(col - 1, 0), l.to);
  view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true });
  view.focus();
}

function explain(log: string): string {
  if (/with exceptions disabled/.test(log)) {
    return 'ตัวรันบนเว็บยังใช้ try catch throw ไม่ได้ โค้ดนี้ให้ลองใน Code::Blocks แทน';
  }
  if (/'bits\/stdc\+\+\.h' file not found/.test(log)) {
    return 'ภาษา C ใช้ bits/stdc++.h ไม่ได้ ถ้าจะเขียน C++ ให้กดเลือก C++ ที่มุมขวาบน';
  }
  return '';
}

/* ---------- รันโปรแกรม ---------- */

let busy = false;
let runner: Worker | null = null;
let runTimer = 0;
let finishRun: ((title: string, note?: string) => void) | null = null;

function appendOut(text: string, cls?: 'err' | 'sys'): void {
  if (!text) return;
  const out = ui.out;
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
function setBusy(on: boolean, running = false): void {
  busy = on;
  ui.runBtn.setAttribute('aria-busy', String(on));
  ui.runBtn.disabled = on;
  ui.runBtn.hidden = running;
  ui.stopBtn.hidden = !running;
}

const TRAPS: ReadonlyArray<readonly [RegExp, string]> = [
  [/unreachable/, 'โปรแกรมหยุดกลางทาง (เช่น เรียก abort หรือ assert ไม่ผ่าน หรือใช้ .at() เกินขอบ)'],
  [/out of bounds/, 'เข้าถึงหน่วยความจำนอกขอบเขต (เช่น ใช้ index เกินขนาดอาร์เรย์มาก ๆ หรือ recursion ลึกเกิน stack)'],
  [/divide by zero|remainder by zero/, 'หารด้วยศูนย์'],
  [/integer overflow/, 'ค่าล้นตอนหาร'],
  [/stack overflow|call stack/i, 'recursion ลึกเกินกว่าที่เบราว์เซอร์รับได้'],
];

function describeTrap(msg: string): string {
  for (const [re, text] of TRAPS) if (re.test(msg)) return text;
  return msg;
}

// ชื่อบนหัวหน้าต่างผลลัพธ์ กับบรรทัดอธิบายที่ใส่เฉพาะตอนจบไม่ปกติ
function describeOutcome(result: RunOutcome): [string, string?] {
  if ('limited' in result) return ['ผลลัพธ์ยาวเกิน', 'ผลลัพธ์ยาวเกิน 1 MB โปรแกรมถูกหยุด อาจมีลูปที่ไม่จบ'];
  if ('error' in result) return ['รันไม่สำเร็จ', result.error];
  if ('trap' in result) return ['โปรแกรมหยุดทำงานผิดปกติ', describeTrap(result.trap)];
  return [result.code === 0 ? 'จบโปรแกรม' : `จบโปรแกรม ค่าที่ return คือ ${result.code}`];
}

async function runCode(): Promise<void> {
  if (busy) return;
  saveDraft();
  setBusy(true);
  ui.out.replaceChildren();
  ui.log.hidden = true;
  ui.logNote.hidden = true;
  setStatus(compilerReady ? 'กำลังคอมไพล์' : 'รอโหลดตัวคอมไพล์ให้เสร็จ แล้วจะคอมไพล์ให้ทันที');

  let compiled: Compiled;
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
      ui.logNote.textContent = note;
      ui.logNote.hidden = false;
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
  const request: RunRequest = { wasm: compiled.wasm, stdin: new TextEncoder().encode(ui.stdin.value) };

  await new Promise<void>((resolve) => {
    const worker = new Worker(new URL(WORKERS.run, document.baseURI), { type: 'module' });
    runner = worker;
    finishRun = (title, note) => {
      clearTimeout(runTimer);
      worker.terminate();
      runner = null;
      finishRun = null;
      const text = ui.out.textContent ?? '';
      if (note) appendOut(`${text && !text.endsWith('\n') ? '\n' : ''}[${note}]\n`, 'sys');
      setStatus(title);
      resolve();
    };
    worker.onmessage = ({ data }: MessageEvent<RunReply>) => {
      if (data.type === 'output') {
        appendOut(data.out);
        appendOut(data.err, 'err');
        return;
      }
      finishRun?.(...describeOutcome(data.result));
    };
    worker.onerror = (e) => {
      e.preventDefault();
      finishRun?.('รันไม่สำเร็จ', 'ลองรีเฟรชหน้าแล้วรันใหม่');
    };
    runTimer = window.setTimeout(() => {
      finishRun?.('เกินเวลา', `เกิน ${TIME_LIMIT_MS / 1000} วินาที โปรแกรมถูกหยุด อาจมีลูปที่ไม่จบ หรือรอข้อมูลเข้าที่ยังไม่ได้ใส่`);
    }, TIME_LIMIT_MS);
    worker.postMessage(request, [request.wasm.buffer]);
  });
  setBusy(false);
}

ui.runBtn.addEventListener('click', () => void runCode());
ui.stopBtn.addEventListener('click', () => finishRun?.('หยุดแล้ว', 'หยุดโดยผู้ใช้'));

/* ---------- แชร์ ---------- */

let shareTimer = 0;
ui.shareBtn.addEventListener('click', async () => {
  const hash = await encodeShare({ lang, code: view.state.doc.toString(), input: ui.stdin.value });
  const url = location.origin + location.pathname + hash;
  try {
    await navigator.clipboard.writeText(url);
    ui.shareBtn.classList.add('done');
    ui.status.textContent = 'คัดลอกลิงก์แล้ว';
    clearTimeout(shareTimer);
    shareTimer = window.setTimeout(() => ui.shareBtn.classList.remove('done'), 1800);
  } catch {
    history.replaceState(null, '', hash);
    ui.status.textContent = 'คัดลอกไม่ได้ ลิงก์อยู่ในช่องที่อยู่ด้านบนแล้ว';
  }
});

/* ---------- เริ่มต้น ---------- */

async function init(): Promise<void> {
  const shared = location.hash.length > 1 ? await decodeShare(location.hash) : null;
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  if (shared) {
    setLang(shared.lang, { loadDraft: false });
    setDoc(shared.code);
    ui.stdin.value = shared.input ?? '';
    saveDraft();
  } else {
    const saved = store.get('lang');
    ui.stdin.value = store.get('stdin') ?? '';
    setLang(isLang(saved) ? saved : 'c', { loadDraft: false });
    setDoc(store.get('draft-' + lang) ?? TEMPLATES[lang]);
  }
  setStatus('กำลังเตรียมตัวคอมไพล์');
  postCompiler({ type: 'load' });
}

window.addEventListener('pagehide', saveDraft);
void init();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
