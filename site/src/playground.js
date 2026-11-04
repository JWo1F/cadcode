import * as monaco from 'monaco-editor';
import { createScene, saveBlob } from '../../client/scene.js';
import examples from 'virtual:examples';
import typings from 'virtual:typings';
import workers from 'virtual:workers'; // file names, which carry their content's hash
import './playground.css';

const DEFAULT_EXAMPLE = 'knob';
const EVALUATE_DELAY = 350;

const canvas = document.getElementById('view');
const exampleSelect = document.getElementById('example');
const partSelect = document.getElementById('part');
const statusEl = document.getElementById('status');
const errorEl = document.getElementById('error');
const errorText = document.getElementById('error-text');
const logsEl = document.getElementById('logs');

const view = createScene(canvas);

// --- Editor ------------------------------------------------------------------

self.MonacoEnvironment = {
  getWorker(_id, label) {
    const file = label === 'typescript' || label === 'javascript' ? workers['ts.worker'] : workers['editor.worker'];
    return new Worker(new URL(file, import.meta.url), { type: 'module', name: label });
  },
};

// The library's typings, generated from its JSDoc, give completion and hovers for `'cadcode'`.
const js = monaco.typescript.javascriptDefaults;
js.setCompilerOptions({
  target: monaco.typescript.ScriptTarget.ESNext,
  module: monaco.typescript.ModuleKind.ESNext,
  moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
  allowJs: true,
  allowNonTsExtensions: true,
});
for (const [file, content] of Object.entries(typings)) js.addExtraLib(content, `file:///node_modules/cadcode/${file}`);

const model = monaco.editor.createModel('', 'javascript', monaco.Uri.parse('file:///program.js'));
const editor = monaco.editor.create(document.getElementById('editor'), {
  model,
  automaticLayout: true,
  fontSize: 13,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  tabSize: 2,
});

// --- Saving and sharing ------------------------------------------------------
// Every edit is saved to localStorage, so a reload comes back to it. A share link
// carries the code deflated in its hash.

const DRAFT_KEY = 'cadcode:playground';

function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ code: model.getValue(), example: exampleSelect.value, part: partSelect.value }));
  } catch {
    // Storage unavailable (private window): the code just isn't kept across reloads.
  }
}

function loadDraft() {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY));
  } catch {
    return null;
  }
}

const toBase64Url = (bytes) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join('')).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const fromBase64Url = (text) => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));

async function pack(code) {
  const stream = new Blob([code]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return toBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()));
}

async function unpack(packed) {
  const stream = new Blob([fromBase64Url(packed)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

async function shareLink() {
  const params = new URLSearchParams({ code: await pack(model.getValue()) });
  if (partSelect.value) params.set('part', partSelect.value);
  return `${location.origin}${location.pathname}#${params}`;
}

// --- UI state ----------------------------------------------------------------

function setStatus(state, text = state) {
  statusEl.dataset.state = state;
  statusEl.textContent = text;
}

function showError(message) {
  errorText.textContent = message;
  errorEl.hidden = !message;
}

function showLogs(logs = []) {
  logsEl.replaceChildren(
    ...logs.map(({ level, text }) => {
      const line = document.createElement('div');
      line.className = `log-${level}`;
      line.textContent = text;
      return line;
    }),
  );
  logsEl.hidden = logs.length === 0;
}

function showParts(names, current) {
  partSelect.replaceChildren(...names.map((name) => new Option(name, name, false, name === current)));
  partSelect.parentElement.hidden = names.length < 2;
}

/** Underlines the line a runtime error points at, when its stack names one. */
function markError(stack) {
  const at = stack?.match(/program\.js:(\d+):(\d+)/);
  const markers = at
    ? [
        {
          severity: monaco.MarkerSeverity.Error,
          message: stack.split('\n')[0],
          startLineNumber: Number(at[1]),
          startColumn: Number(at[2]),
          endLineNumber: Number(at[1]),
          endColumn: model.getLineMaxColumn(Number(at[1])),
        },
      ]
    : [];
  monaco.editor.setModelMarkers(model, 'cadcode', markers);
}

// --- Evaluation --------------------------------------------------------------

/** Runs the code in a fresh worker; `onWorker` gets it so a newer run can cancel it. */
function run(message, onWorker) {
  return new Promise((resolve) => {
    const worker = new Worker(new URL(workers['eval-worker'], import.meta.url), { type: 'module' });
    onWorker?.(worker);
    worker.onmessage = ({ data }) => {
      if (data.ready) return worker.postMessage(message);
      worker.terminate();
      resolve(data);
    };
    worker.onerror = (event) => {
      worker.terminate();
      resolve({ ok: false, message: event.message || 'The worker failed to start' });
    };
  });
}

let preview = null; // the worker of the run whose result the view is waiting for
let shown = null; // the result on screen
let fitNext = true; // a new example is framed; edits keep the camera
let notice = ''; // shown in place of the error after the next good run, e.g. a link to a missing example

async function evaluate() {
  preview?.terminate();
  setStatus('evaluating');
  let worker;
  const result = await run({ code: model.getValue(), part: partSelect.value || undefined }, (w) => (preview = worker = w));
  if (preview !== worker) return; // a newer run took over
  preview = null;

  showLogs(result.logs);
  if (!result.ok) {
    setStatus('error');
    showError(result.stack?.includes(result.message) ? result.stack : result.message);
    markError(result.stack);
    return;
  }
  shown = result;
  showError(notice);
  notice = '';
  markError(null);
  showParts(result.partNames, result.part);
  const triangles = view.showModel(result.groups);
  setStatus('ready', `${triangles.toLocaleString()} tris · ${result.ms} ms`);
  if (fitNext) {
    fitNext = false;
    view.fitView();
  }
  saveDraft(); // the part may have changed
}

let evaluateTimer = 0;
model.onDidChangeContent(() => {
  saveDraft();
  clearTimeout(evaluateTimer);
  evaluateTimer = setTimeout(evaluate, EVALUATE_DELAY);
});

// --- Examples ----------------------------------------------------------------

exampleSelect.replaceChildren(...Object.keys(examples).map((name) => new Option(name, name)));

function loadExample(name) {
  exampleSelect.value = name;
  partSelect.replaceChildren();
  fitNext = true;
  model.setValue(examples[name]);
}

exampleSelect.addEventListener('change', () => {
  const edited = !Object.values(examples).includes(model.getValue());
  if (edited && !confirm('Replace your code with this example?')) {
    exampleSelect.value = exampleSelect.dataset.current;
    return;
  }
  exampleSelect.dataset.current = exampleSelect.value;
  loadExample(exampleSelect.value);
});

partSelect.addEventListener('change', evaluate);

// --- Panes -------------------------------------------------------------------
// The divider resizes the halves; the Model and Code buttons hide one of them.
// At most one is hidden, so hiding one shows the other. Both are remembered.

const LAYOUT_KEY = 'cadcode:playground:layout';
const split = document.querySelector('.split');
const divider = document.getElementById('divider');
const paneButtons = { view: document.getElementById('show-view'), code: document.getElementById('show-code') };
const stacked = matchMedia('(max-width: 720px)'); // phones put the model above the code

let layout = { split: 50, hide: null };
try {
  layout = { ...layout, ...JSON.parse(localStorage.getItem(LAYOUT_KEY)) };
} catch {
  // No saved layout: the default halves.
}

function applyLayout() {
  split.style.setProperty('--split', `${layout.split}%`);
  if (layout.hide) split.dataset.hide = layout.hide;
  else delete split.dataset.hide;
  for (const [pane, button] of Object.entries(paneButtons)) button.setAttribute('aria-pressed', String(layout.hide !== pane));
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Storage unavailable: the layout just isn't remembered.
  }
}

for (const [pane, button] of Object.entries(paneButtons)) {
  button.addEventListener('click', () => {
    layout.hide = layout.hide === pane ? null : pane;
    applyLayout();
  });
}

divider.addEventListener('pointerdown', (event) => {
  divider.setPointerCapture(event.pointerId);
  split.classList.add('dragging');
});
divider.addEventListener('pointermove', (event) => {
  if (!divider.hasPointerCapture(event.pointerId)) return;
  const box = split.getBoundingClientRect();
  const share = stacked.matches ? (event.clientY - box.top) / box.height : (event.clientX - box.left) / box.width;
  layout.split = Math.round(Math.min(Math.max(share, 0.15), 0.85) * 1000) / 10;
  split.style.setProperty('--split', `${layout.split}%`);
});
divider.addEventListener('lostpointercapture', () => {
  split.classList.remove('dragging');
  applyLayout();
});
divider.addEventListener('dblclick', () => {
  layout.split = 50;
  applyLayout();
});

applyLayout();

// --- Toolbar -----------------------------------------------------------------

/** The download name: the example the code came from, plus the part when there are several. */
function fileName(ext) {
  const base = exampleSelect.value || 'model';
  return shown && shown.partNames.length > 1 ? `${base}-${shown.part}.${ext}` : `${base}.${ext}`;
}

document.getElementById('fit').addEventListener('click', () => view.fitView());

document.getElementById('png').addEventListener('click', async () => {
  if (!shown) return;
  try {
    saveBlob(await view.snapshotPNG(), fileName('png'));
  } catch (error) {
    showError(`PNG export failed: ${error.message}`);
  }
});

const stlButton = document.getElementById('stl');
stlButton.addEventListener('click', async () => {
  if (!shown) return;
  stlButton.disabled = true;
  const result = await run({ code: model.getValue(), part: shown.part, output: 'stl' });
  stlButton.disabled = false;
  if (!result.ok) return showError(`STL export failed: ${result.message}`);
  saveBlob(new Blob([result.stl], { type: 'model/stl' }), fileName('stl'));
});

const shareButton = document.getElementById('share');
shareButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(await shareLink());
  shareButton.textContent = 'Copied';
  setTimeout(() => (shareButton.textContent = 'Share'), 1500);
});

window.addEventListener('keydown', (event) => {
  if (editor.hasTextFocus() || event.target instanceof HTMLSelectElement) return;
  if (event.key === 'f' || event.key === 'F') view.fitView();
});

// --- Start -------------------------------------------------------------------
// A shared link's code wins; then ?example=name (the site's gallery links); then
// the saved draft; then the default. The link is dropped from the address once
// read, so a reload after editing restores the draft, not the link.

/** Shows code that came from outside an example, selecting its part before the first run. */
function loadCode(code, part) {
  exampleSelect.value = Object.keys(examples).find((name) => examples[name] === code) ?? '';
  if (part) partSelect.replaceChildren(new Option(part, part, true, true));
  model.setValue(code);
}

const hash = new URLSearchParams(location.hash.slice(1));
const requested = new URLSearchParams(location.search).get('example');
const draft = loadDraft();
history.replaceState(null, '', location.pathname);

if (hash.has('code')) {
  try {
    loadCode(await unpack(hash.get('code')), hash.get('part'));
  } catch {
    showError('The code in this link could not be read');
    loadExample(DEFAULT_EXAMPLE);
  }
} else if (requested) {
  if (!(requested in examples)) notice = `There is no example "${requested}"; showing ${DEFAULT_EXAMPLE} instead`;
  loadExample(requested in examples ? requested : DEFAULT_EXAMPLE);
} else if (typeof draft?.code === 'string') {
  loadCode(draft.code, draft.part);
  if (draft.example in examples) exampleSelect.value = draft.example;
} else {
  loadExample(DEFAULT_EXAMPLE);
}
exampleSelect.dataset.current = exampleSelect.value;
