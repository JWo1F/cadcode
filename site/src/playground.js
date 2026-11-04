import * as monaco from 'monaco-editor';
import { createScene, saveBlob } from '../../client/scene.js';
import examples from 'virtual:examples';
import catalog from 'virtual:catalog'; // { name: { title, description } }
import typings from 'virtual:typings';
import workers from 'virtual:workers'; // file names, which carry their content's hash
import './playground.css';

const DEFAULT_EXAMPLE = 'knob';
const EVALUATE_DELAY = 350;

const canvas = document.getElementById('view');
const partSelect = document.getElementById('part');
const statusEl = document.getElementById('status');
const errorEl = document.getElementById('error');
const errorText = document.getElementById('error-text');
const logsEl = document.getElementById('logs');
const stage = document.getElementById('stage');
const readout = { size: document.getElementById('readout-size'), mesh: document.getElementById('readout-mesh') };

// The drafting-sheet colours of playground.css.
const view = createScene(canvas, {
  workerUrl: new URL(workers['render-worker'], import.meta.url),
  colors: { background: null, gridMajor: 0xc9ced5, gridMinor: 0xdfe2e6, edges: 0x1f2833 }, // the stage's CSS paints behind
});

let currentExample = ''; // the example the code came from, or '' for code from elsewhere

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

// Slate ink on the white panel; strings and numbers in warm filament tones.
monaco.editor.defineTheme('studio', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: '', foreground: '1f2833' },
    { token: 'comment', foreground: '98a1ac', fontStyle: 'italic' },
    { token: 'keyword', foreground: '1f2833', fontStyle: 'bold' },
    { token: 'string', foreground: '9a6a00' },
    { token: 'number', foreground: 'b25a12' },
    { token: 'identifier', foreground: '1f2833' },
    { token: 'delimiter', foreground: '77818d' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#1f2833',
    'editorLineNumber.foreground': '#c3c9d0',
    'editorLineNumber.activeForeground': '#77818d',
    'editor.lineHighlightBackground': '#f5f6f8',
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': '#f2c14e55',
    'editor.inactiveSelectionBackground': '#f2c14e2a',
    'editorCursor.foreground': '#1f2833',
    'editorIndentGuide.background1': '#1f283310',
    'editorIndentGuide.activeBackground1': '#1f283330',
    'editorGutter.background': '#ffffff',
    'scrollbarSlider.background': '#1f283318',
    'scrollbarSlider.hoverBackground': '#1f283328',
  },
});

const model = monaco.editor.createModel('', 'javascript', monaco.Uri.parse('file:///program.js'));
const editor = monaco.editor.create(document.getElementById('editor'), {
  model,
  theme: 'studio',
  automaticLayout: true,
  fontFamily: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
  fontSize: 13,
  lineHeight: 21,
  padding: { top: 8, bottom: 16 },
  lineNumbersMinChars: 3,
  renderLineHighlight: 'line',
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  tabSize: 2,
});
// Monaco measures its font once; the web font may arrive later.
document.fonts.ready.then(() => monaco.editor.remeasureFonts());

// --- Saving and sharing ------------------------------------------------------
// Every edit is saved to localStorage, so a reload comes back to it. A share link
// carries the code deflated in its hash.

const DRAFT_KEY = 'cadcode:playground';

function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ code: model.getValue(), example: currentExample, part: partSelect.value }));
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

/** While the code runs the stage shows it; see "Loading" in playground.css. */
function setBusy(busy) {
  if (busy) stage.dataset.busy = '';
  else delete stage.dataset.busy;
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

const formatMm = (n) => (Math.round(n * 10) / 10).toLocaleString();

/** Fills the readout: the model's overall size, large, and its mesh. */
function showReadout({ triangles, size }) {
  readout.size.replaceChildren(size ? size.map(formatMm).join(' × ') : 'Empty');
  if (size) readout.size.append(Object.assign(document.createElement('small'), { textContent: 'mm' }));
  readout.mesh.textContent = `${triangles.toLocaleString()} triangles`;
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
  setStatus('evaluating', 'building');
  setBusy(true);
  let worker;
  const result = await run({ code: model.getValue(), part: partSelect.value || undefined }, (w) => (preview = worker = w));
  if (preview !== worker) return; // a newer run took over
  preview = null;

  showLogs(result.logs);
  if (!result.ok) {
    setBusy(false);
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
  const mesh = await view.showModel(result.groups); // the view's worker builds the meshes
  if (shown !== result || preview) return; // a newer run was shown meanwhile, or is under way
  setBusy(false);
  delete stage.dataset.empty;
  showReadout(mesh);
  setStatus('ready', `${result.ms} ms`);
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

// A popover of the gallery's renders, filtered as you type. The button that opens it
// shows the current example's render and title.

const picker = document.getElementById('picker');
const pickerOpen = document.getElementById('picker-open');
const pickerFilter = document.getElementById('picker-filter');
const pickerList = document.getElementById('picker-list');
const pickerEmpty = document.getElementById('picker-empty');
const thumbnail = (name) => `gallery/${name}.png`;

const pickerItems = Object.keys(examples).map((name) => {
  const { title, description } = catalog[name];
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.name = name;
  button.dataset.search = `${name} ${title} ${description}`.toLowerCase();
  const img = Object.assign(document.createElement('img'), { src: thumbnail(name), alt: '', loading: 'lazy', width: 160, height: 120 });
  const strong = Object.assign(document.createElement('strong'), { textContent: title });
  const span = Object.assign(document.createElement('span'), { textContent: description });
  button.append(img, strong, span);
  button.addEventListener('click', () => chooseExample(name));
  return button;
});
pickerList.replaceChildren(...pickerItems);

function setCurrentExample(name) {
  currentExample = name in examples ? name : '';
  shown = null; // until the new code has run
  for (const item of pickerItems) item.setAttribute('aria-current', String(item.dataset.name === currentExample));
  document.getElementById('picker-title').textContent = catalog[currentExample]?.title ?? 'Examples';
  const thumb = document.getElementById('picker-thumb');
  if (currentExample) thumb.src = thumbnail(currentExample);
  else thumb.removeAttribute('src');
}

function loadExample(name) {
  setCurrentExample(name);
  partSelect.replaceChildren();
  fitNext = true;
  model.setValue(examples[name]);
}

function chooseExample(name) {
  picker.hidePopover();
  if (name === currentExample && model.getValue() === examples[name]) return;
  const edited = !Object.values(examples).includes(model.getValue());
  if (edited && !confirm('Replace your code with this example?')) return;
  loadExample(name);
}

pickerFilter.addEventListener('input', () => {
  const words = pickerFilter.value.toLowerCase().split(/\s+/).filter(Boolean);
  let matches = 0;
  for (const item of pickerItems) {
    item.hidden = !words.every((word) => item.dataset.search.includes(word));
    if (!item.hidden) matches++;
  }
  pickerEmpty.hidden = matches > 0;
});

// Enter picks the first match.
pickerFilter.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const first = pickerItems.find((item) => !item.hidden);
  if (first) chooseExample(first.dataset.name);
});

picker.addEventListener('toggle', (event) => {
  pickerOpen.setAttribute('aria-expanded', String(event.newState === 'open'));
  if (event.newState !== 'open') return;
  pickerFilter.value = '';
  pickerFilter.dispatchEvent(new Event('input'));
  pickerFilter.focus();
  pickerItems.find((item) => item.dataset.name === currentExample)?.scrollIntoView({ block: 'nearest' });
});

partSelect.addEventListener('change', evaluate);

// --- Code panel ----------------------------------------------------------------
// The code floats on the stage: on the right, or across the bottom on phones. Its
// edge resizes it and the Code button hides it; both are remembered. The view is
// told how much of the canvas the panel covers, and centres the model on the rest.

const LAYOUT_KEY = 'cadcode:playground:panel';
const panel = document.getElementById('panel');
const grip = document.getElementById('grip');
const codeButton = document.getElementById('toggle-code');
const stacked = matchMedia('(max-width: 720px)'); // phones lay the code across the bottom

const DEFAULT_LAYOUT = { width: 0.44, height: 0.48, code: true }; // shares of the window
let layout = { ...DEFAULT_LAYOUT };
try {
  layout = { ...layout, ...JSON.parse(localStorage.getItem(LAYOUT_KEY)) };
} catch {
  // No saved layout: the defaults.
}

/** Tells the stylesheet and the view how much of the stage the panel covers. */
function measurePanel() {
  const box = panel.getBoundingClientRect();
  const right = layout.code && !stacked.matches ? Math.round(innerWidth - box.left) : 0;
  const bottom = layout.code && stacked.matches ? Math.round(innerHeight - box.top) : 0;
  stage.style.setProperty('--panel-cover', `${right}px`);
  stage.style.setProperty('--panel-cover-bottom', `${bottom}px`);
  // On phones the readout and tools stand above the panel, across the whole width.
  const footer = stacked.matches ? document.querySelector('.bottom-left').offsetHeight + 12 : 0;
  view.setInset({ right, bottom: bottom + footer });
}

function applyLayout() {
  stage.style.setProperty('--panel-width', `${layout.width * 100}vw`);
  stage.style.setProperty('--panel-height', `${layout.height * 100}dvh`);
  stage.dataset.code = layout.code ? 'shown' : 'hidden';
  codeButton.setAttribute('aria-pressed', String(layout.code));
  measurePanel();
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Storage unavailable: the layout just isn't remembered.
  }
}

codeButton.addEventListener('click', () => {
  layout.code = !layout.code;
  applyLayout();
  if (layout.code) editor.focus();
});

grip.addEventListener('pointerdown', (event) => {
  grip.setPointerCapture(event.pointerId);
  stage.classList.add('dragging');
});
grip.addEventListener('pointermove', (event) => {
  if (!grip.hasPointerCapture(event.pointerId)) return;
  if (stacked.matches) layout.height = Math.min(Math.max((innerHeight - event.clientY) / innerHeight, 0.2), 0.8);
  else layout.width = Math.min(Math.max((innerWidth - event.clientX) / innerWidth, 0.25), 0.75);
  stage.style.setProperty('--panel-width', `${layout.width * 100}vw`);
  stage.style.setProperty('--panel-height', `${layout.height * 100}dvh`);
  measurePanel();
});
grip.addEventListener('lostpointercapture', () => {
  stage.classList.remove('dragging');
  applyLayout();
});
grip.addEventListener('dblclick', () => {
  layout = { ...DEFAULT_LAYOUT, code: true };
  applyLayout();
});

window.addEventListener('resize', measurePanel);
stacked.addEventListener('change', measurePanel);
applyLayout();

// --- Toolbar -----------------------------------------------------------------

/** The download name: the example the code came from, plus the part when there are several. */
function fileName(ext) {
  const base = currentExample || 'model';
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
  shareButton.textContent = 'Link copied';
  setTimeout(() => (shareButton.textContent = 'Copy link'), 1500);
});

window.addEventListener('keydown', (event) => {
  if (editor.hasTextFocus() || event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return;
  if (event.key === 'f' || event.key === 'F') view.fitView();
});

// --- Start -------------------------------------------------------------------
// A shared link's code wins; then ?example=name (the site's gallery links); then
// the saved draft; then the default. The link is dropped from the address once
// read, so a reload after editing restores the draft, not the link.

/** Shows code that came from outside an example, selecting its part before the first run. */
function loadCode(code, part) {
  setCurrentExample(Object.keys(examples).find((name) => examples[name] === code) ?? '');
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
  if (draft.example in examples) setCurrentExample(draft.example);
} else {
  loadExample(DEFAULT_EXAMPLE);
}
