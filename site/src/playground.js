import * as monaco from 'monaco-editor';
import { bindDisplayButtons, createScene, saveBlob } from '../../client/scene.js';
import { createAxisGizmo } from '../../client/gizmo.js';
import { bindViewTools } from '../../client/view-tools.js';
import { bindDownloadMenu } from '../../client/download-menu.js';
import { storage } from '../../client/storage.js';
import { showError as showErrorIn, showLogs as showLogsIn, showReadout, createPartPill } from '../../client/page-ui.js';
import { bindPanelLayout } from '../../client/panel-layout.js';
import { pack, unpack } from './share-link.js';
import examples from 'virtual:examples';
import catalog from 'virtual:catalog'; // { name: { title, description } }
import typings from 'virtual:typings';
import workers from 'virtual:workers'; // file names, which carry their content's hash
import '../../client/view-tools.css';
import '../../client/download-menu.css';
import './playground.css';

const DEFAULT_EXAMPLE = 'knob';
const EVALUATE_DELAY = 350;

const canvas = document.getElementById('view');
const statusEl = document.getElementById('status');
const errorBox = { error: document.getElementById('error'), text: document.getElementById('error-text') };
const logsEl = document.getElementById('logs');
const stage = document.getElementById('stage');
const readout = { size: document.getElementById('readout-size'), mesh: document.getElementById('readout-mesh') };

// The drafting-sheet colours of playground.css.
const view = createScene(canvas, {
  workerUrl: new URL(workers['render-worker'], import.meta.url),
  colors: { background: null, gridMajor: 0xc9ced5, gridMinor: 0xdfe2e6, edges: 0x1f2833 }, // the stage's CSS paints behind
  onCamera: (camera) => updateGizmo(camera),
});
const updateGizmo = createAxisGizmo(document.getElementById('gizmo'), view);

let currentExample = ''; // the example the code came from, or '' for code from elsewhere
let currentPart = ''; // the part asked for, or '' for the program's default

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
  padding: { top: 12, bottom: 16 },
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
  storage.set(DRAFT_KEY, { code: model.getValue(), example: currentExample, part: currentPart });
}

async function shareLink() {
  const params = new URLSearchParams({ code: await pack(model.getValue()) });
  if (currentPart) params.set('part', currentPart);
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

const showError = (message) => showErrorIn(errorBox, message);
const showLogs = (logs) => showLogsIn(logsEl, logs);

// --- Parts -------------------------------------------------------------------

const parts = createPartPill({
  open: document.getElementById('part-open'),
  menu: document.getElementById('part-menu'),
  title: document.getElementById('part-title'),
  onChoose(name) {
    currentPart = name;
    evaluate();
  },
});

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
let memoCache = []; // what memo() built in the last good run, handed to the next one

async function evaluate() {
  preview?.terminate();
  setStatus('evaluating', 'building');
  setBusy(true);
  let worker;
  const result = await run({ code: model.getValue(), part: currentPart || undefined, memo: memoCache }, (w) => (preview = worker = w));
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
  memoCache = result.memo;
  showError(notice);
  notice = '';
  markError(null);
  parts.show(result.partNames, result.part);
  currentPart = result.part;
  let mesh;
  try {
    mesh = await view.showModel(result.groups); // the view's worker builds the meshes
  } catch (error) {
    if (shown !== result || preview) return;
    setBusy(false);
    setStatus('error');
    showError(error.message);
    return;
  }
  if (shown !== result || preview) return; // a newer run was shown meanwhile, or is under way
  setBusy(false);
  delete stage.dataset.empty;
  showReadout(readout, mesh);
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
  currentPart = '';
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

// --- Code panel ----------------------------------------------------------------
// The code's width is a share of the window, from a quarter to three quarters.

bindPanelLayout({
  stage,
  panel: document.getElementById('panel'),
  grip: document.getElementById('grip'),
  button: document.getElementById('toggle-code'),
  view,
  storageKey: 'cadcode:playground:panel',
  defaults: { width: 0.44, height: 0.48, open: true },
  attribute: 'code',
  cssWidth: (width) => `${width * 100}vw`,
  widthAt: (clientX) => Math.min(Math.max((innerWidth - clientX) / innerWidth, 0.25), 0.75),
  onToggle: (open) => open && editor.focus(),
});

// --- Toolbar -----------------------------------------------------------------

/** The download name: the example the code came from, plus the part when there are several. */
function fileName(ext) {
  const base = currentExample || 'model';
  return shown && shown.partNames.length > 1 ? `${base}-${shown.part}.${ext}` : `${base}.${ext}`;
}

document.getElementById('fit').addEventListener('click', () => view.fitView());
bindDisplayButtons(view, [...document.querySelectorAll('[data-display]')]);
bindViewTools(view, {
  stage,
  storageKey: () => 'cadcode:playground:section',
  ignoreKey: (event) => editor.hasTextFocus() || event.target instanceof HTMLInputElement,
});

async function exportPart(format) {
  if (!shown) return;
  const result = await run({ code: model.getValue(), part: shown.part, output: format, memo: memoCache });
  if (!result.ok) return showError(`${format.toUpperCase()} export failed: ${result.message}`);
  saveBlob(new Blob([result.file], { type: `model/${format}` }), fileName(format));
}

async function savePNG() {
  if (!shown) return;
  try {
    saveBlob(await view.snapshotPNG(), fileName('png'));
  } catch (error) {
    showError(`PNG export failed: ${error.message}`);
  }
}

bindDownloadMenu({ stl: () => exportPart('stl'), '3mf': () => exportPart('3mf'), png: savePNG });

const shareButton = document.getElementById('share');
shareButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(await shareLink());
    shareButton.textContent = 'Link copied';
  } catch {
    // Clipboard refused (no permission, or the page is not focused).
    shareButton.textContent = 'Copy failed';
  }
  setTimeout(() => (shareButton.textContent = 'Copy link'), 1500);
});

window.addEventListener('keydown', (event) => {
  if (editor.hasTextFocus() || event.target instanceof HTMLInputElement) return;
  if (event.key === 'f' || event.key === 'F') view.fitView();
});

// --- Start -------------------------------------------------------------------
// A shared link's code wins; then ?example=name (the site's gallery links); then
// the saved draft; then the default. The link is dropped from the address once
// read, so a reload after editing restores the draft, not the link.

/** Shows code that came from outside an example, selecting its part before the first run. */
function loadCode(code, part) {
  setCurrentExample(Object.keys(examples).find((name) => examples[name] === code) ?? '');
  currentPart = part ?? '';
  model.setValue(code);
}

const hash = new URLSearchParams(location.hash.slice(1));
const requested = new URLSearchParams(location.search).get('example');
const draft = storage.get(DRAFT_KEY);
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
