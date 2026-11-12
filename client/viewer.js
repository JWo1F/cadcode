import { createParamsPanel } from './params.js';
import { bindDisplayButtons, createScene, saveBlob } from './scene.js';
import { createAxisGizmo } from './gizmo.js';
import { bindViewTools } from './view-tools.js';
import { bindDownloadMenu } from './download-menu.js';
import { decodeFrame } from './frame-codec.js';
import { storage } from './storage.js';
import { showError as showErrorIn, showLogs as showLogsIn, showReadout, createPartPill } from './page-ui.js';
import { bindPanelLayout } from './panel-layout.js';

const canvas = document.getElementById('view');
const stage = document.getElementById('stage');
const statusEl = document.getElementById('status');
const fileEl = document.getElementById('file');
const emptyEl = document.getElementById('empty');
const errorBox = { error: document.getElementById('error'), text: document.getElementById('error-text') };
const logsEl = document.getElementById('logs');
const readout = {
  size: document.getElementById('readout-size'),
  mesh: document.getElementById('readout-mesh'),
  time: document.getElementById('readout-time'),
};

// The dev server bundles the render worker, three.js included, at /render-worker.js.
// The canvas is transparent: the stage's backdrop in viewer.css paints behind it,
// in the playground's colours.
const view = createScene(canvas, {
  workerUrl: '/render-worker.js',
  colors: { background: null, gridMajor: 0xc9ced5, gridMinor: 0xdfe2e6, edges: 0x1f2833 },
  onCamera: (moved) => {
    cameraMoved(moved);
    updateGizmo(moved);
  },
});
const updateGizmo = createAxisGizmo(document.getElementById('gizmo'), view);

// --- Camera persistence ------------------------------------------------------
// The camera survives model reloads untouched; it is also stored per file so a
// browser refresh or a restarted server comes back to the same view.

let fileKey = null;
let camera = null; // the latest from the view: { position, target, zoom }

function saveCamera() {
  if (!fileKey || !camera) return;
  storage.set(`cadcode:camera:${fileKey}`, camera);
}

function restoreCamera() {
  const saved = storage.get(`cadcode:camera:${fileKey}`);
  if (!saved) return false;
  view.setCamera(saved);
  return true;
}

let saveTimer = 0;
function cameraMoved(moved) {
  camera = moved;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCamera, 200);
}
window.addEventListener('beforeunload', saveCamera);

// The fitted camera arrives as a move and is saved from there.
function fitView() {
  view.fitView();
}

document.getElementById('fit').addEventListener('click', fitView);
bindDisplayButtons(view, [...document.querySelectorAll('[data-display]')]);
const isTyping = (event) => !!event.target.closest?.('#part-menu, #download-menu, .choice-menu, input, textarea');
// The section is remembered per file, like the camera.
bindViewTools(view, { stage, storageKey: () => fileKey && `cadcode:section:${fileKey}`, ignoreKey: isTyping });
window.addEventListener('keydown', (event) => {
  if (isTyping(event)) return;
  if (event.key === 'f' || event.key === 'F') fitView();
});

// --- Model -------------------------------------------------------------------

let shown = null; // header of the model on screen

async function showModel({ header, groups }) {
  shown = header;
  let mesh;
  try {
    mesh = await view.showModel(groups);
  } catch (error) {
    if (shown !== header) return;
    setStatus('error');
    showError(error.message);
    return;
  }
  if (shown !== header) return; // a newer frame arrived meanwhile
  delete stage.dataset.empty;
  showReadout(readout, mesh, header.ms);
  setStatus('ready');
}

// --- UI state ----------------------------------------------------------------

const STATUS_TEXT = {
  connecting: 'Connecting',
  building: 'Building',
  evaluating: 'Running',
  ready: 'Ready',
  error: 'Error',
  disconnected: 'Server stopped, reconnecting',
};

/** Shows the state by the status dot; while the program rebuilds the stage shows it too (see "Busy" in viewer.css). */
function setStatus(state) {
  statusEl.dataset.state = state;
  statusEl.textContent = STATUS_TEXT[state] ?? state;
  toggleFlag('busy', state === 'building' || state === 'evaluating' || state === 'connecting');
  toggleFlag('offline', state === 'disconnected');
  if (stage.dataset.empty !== undefined) emptyEl.textContent = state === 'disconnected' ? 'Waiting for the dev server…' : 'Building the model…';
}

function toggleFlag(name, on) {
  if (on) stage.dataset[name] = '';
  else delete stage.dataset[name];
}

const showError = (message) => showErrorIn(errorBox, message);
const showLogs = (logs) => showLogsIn(logsEl, logs);

// --- Parts -------------------------------------------------------------------
// The part chosen is remembered per file, and asked for again on the next visit.

const parts = createPartPill({
  open: document.getElementById('part-open'),
  menu: document.getElementById('part-menu'),
  title: document.getElementById('part-title'),
  onChoose(name) {
    storage.set(`cadcode:part:${fileKey}`, name);
    requestPart(name);
  },
});

// --- Download ----------------------------------------------------------------
// Fetched rather than navigated to, so a failing program shows its error here
// instead of replacing the viewer.

async function downloadPart(format) {
  try {
    const response = await fetch(`/${format}?part=${encodeURIComponent(parts.current)}`);
    if (!response.ok) throw new Error(await response.text());
    saveBlob(await response.blob(), response.headers.get('Content-Disposition').match(/filename="(.+)"/)[1]);
  } catch (error) {
    showError(`${format.toUpperCase()} download failed: ${error.message}`);
  }
}

// The picture is the view on screen, so it needs no server round trip.
// Named like the STL: the program's name, plus the part when there are several.
async function savePNG() {
  if (!shown) return;
  const base = shown.file.slice(shown.file.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
  const name = shown.partNames.length > 1 ? `${base}-${shown.part}.png` : `${base}.png`;
  try {
    saveBlob(await view.snapshotPNG(), name);
  } catch (error) {
    showError(`PNG export failed: ${error.message}`);
  }
}

bindDownloadMenu({ stl: () => downloadPart('stl'), '3mf': () => downloadPart('3mf'), png: savePNG });

// --- Connection --------------------------------------------------------------

let socket = null;
let firstModel = true;

function requestPart(name) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'part', name }));
}

function connect() {
  restoreSent = false;
  // A restarted server may watch another file, or have forgotten the part: the first
  // model of every connection gets the camera and part saved for its file.
  firstModel = true;
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/`);
  socket.binaryType = 'arraybuffer';

  socket.addEventListener('message', (event) => {
    if (typeof event.data === 'string') {
      const message = JSON.parse(event.data);
      if (message.type === 'status') setStatus(message.status);
      if (message.type === 'error') {
        setStatus('error');
        showError(message.stack && message.stack.includes(message.message) ? message.stack : message.message);
        showLogs(message.logs);
      }
      return;
    }

    const frame = decodeFrame(event.data);
    const { header } = frame;
    if (fileKey !== header.file) {
      // The camera of the file before is saved under its name, not the new one's.
      clearTimeout(saveTimer);
      saveCamera();
      camera = null;
      fileKey = header.file;
      const slash = header.file.lastIndexOf('/') + 1;
      fileEl.querySelector('.dir').textContent = header.file.slice(0, slash);
      fileEl.querySelector('.name').textContent = header.file.slice(slash);
      fileEl.title = header.file;
      fileEl.hidden = false;
      document.title = `${header.file} · cadcode`;
    }
    parts.show(header.partNames, header.part);
    showParams(header);
    showError('');
    showLogs(header.logs);
    showModel(frame);

    if (firstModel) {
      firstModel = false;
      if (!restoreCamera()) fitView();
      const preferred = storage.get(`cadcode:part:${fileKey}`);
      if (preferred && preferred !== header.part && header.partNames.includes(preferred)) requestPart(preferred);
    }
  });

  socket.addEventListener('close', () => {
    // A change sent just before may never have been run; the next server's frame is the truth.
    paramsPanel.forgetSent();
    setStatus('disconnected');
    setTimeout(connect, 1000);
  });
}

// --- Parameters ----------------------------------------------------------------
// The panel edits the program's params; the server keeps the values across edits
// and drops the ones the program no longer declares. They are also stored per
// file, and handed back to a server that has just started (see "restore" in
// src/dev/server.js), so they outlive a restart too.

const paramsPanel = createParamsPanel({
  form: document.getElementById('params'),
  resetAll: document.getElementById('params-reset'),
  onChange(overrides) {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type: 'params', overrides }));
    return true;
  },
  // The sections folded away, per file.
  collapsed: {
    get: () => storage.get(`cadcode:params-collapsed:${fileKey}`) ?? [],
    set: (names) => storage.set(`cadcode:params-collapsed:${fileKey}`, names),
  },
});

let restoreSent = false; // per connection: the server takes the first browser's values only once

function showParams(header) {
  if (!restoreSent) {
    restoreSent = true;
    socket.send(JSON.stringify({ type: 'restore', overrides: storage.get(`cadcode:params:${fileKey}`) ?? {} }));
  }
  // Before the server has taken the stored values its own are not worth keeping.
  if (header.restored) storage.set(`cadcode:params:${fileKey}`, header.overrides);
  const hasParams = Object.keys(header.params).length > 0;
  paramsButton.hidden = !hasParams;
  panel.hidden = !hasParams;
  paramsPanel.show(header.params, header.overrides, header.sections);
  panelLayout.measure();
}

// --- Panel layout ---------------------------------------------------------------
// The panel's width is in pixels, at least 260 and at most 60% of the window.

const panel = document.getElementById('panel');
const paramsButton = document.getElementById('toggle-params');
const panelLayout = bindPanelLayout({
  stage,
  panel,
  grip: document.getElementById('grip'),
  button: paramsButton,
  view,
  storageKey: 'cadcode:params-panel',
  defaults: { width: 340, height: 0.42, open: true },
  attribute: 'panel',
  cssWidth: (width) => `${width}px`,
  widthAt: (clientX) => Math.round(Math.min(Math.max(innerWidth - clientX - 20, 260), Math.max(260, innerWidth * 0.6))),
});

connect();
