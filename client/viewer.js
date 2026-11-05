import { bindDisplayButtons, createScene, saveBlob } from './scene.js';

const canvas = document.getElementById('view');
const stage = document.getElementById('stage');
const statusEl = document.getElementById('status');
const fileEl = document.getElementById('file');
const emptyEl = document.getElementById('empty');
const errorEl = document.getElementById('error');
const errorText = document.getElementById('error-text');
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
  onCamera: cameraMoved,
});

// --- Camera persistence ------------------------------------------------------
// The camera survives model reloads untouched; it is also stored per file so a
// browser refresh or a restarted server comes back to the same view.

let fileKey = null;
let camera = null; // the latest from the view: { position, target, zoom }

const storage = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage unavailable (private window): the view just isn't remembered.
    }
  },
};

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
window.addEventListener('keydown', (event) => {
  if (event.target.closest?.('#part-menu')) return;
  if (event.key === 'f' || event.key === 'F') fitView();
});

// --- Model -------------------------------------------------------------------

/** Decodes a binary model frame: u32 header length, JSON header, then f32 positions and u32 indices per group. */
function decodeModel(buffer) {
  const headerLength = new DataView(buffer).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength)));
  let offset = 4 + headerLength;
  const groups = header.groups.map((g) => {
    const positions = new Float32Array(buffer, offset, g.vertices * 3);
    offset += positions.byteLength;
    const indices = new Uint32Array(buffer, offset, g.indices);
    offset += indices.byteLength;
    return { ...g, positions, indices };
  });
  return { header, groups };
}

let shown = null; // header of the model on screen

async function showModel({ header, groups }) {
  shown = header;
  const mesh = await view.showModel(groups);
  if (shown !== header) return; // a newer frame arrived meanwhile
  delete stage.dataset.empty;
  showReadout(mesh, header.ms);
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

/** Fills the readout: the model's overall size, large, then its mesh and how long the program took. */
function showReadout({ triangles, size }, ms) {
  readout.size.replaceChildren(size ? size.map(formatMm).join(' × ') : 'Empty');
  if (size) readout.size.append(Object.assign(document.createElement('small'), { textContent: 'mm' }));
  readout.mesh.textContent = `${triangles.toLocaleString()} triangles`;
  readout.time.textContent = `${ms.toLocaleString()} ms`;
}

// --- Parts -------------------------------------------------------------------
// A pill naming the part on screen; it opens a menu of the program's parts. A
// program with one part has no pill.

const partOpen = document.getElementById('part-open');
const partMenu = document.getElementById('part-menu');
let currentPart = '';

function showParts(names, current) {
  currentPart = current;
  document.getElementById('part-title').textContent = current;
  partMenu.replaceChildren(
    ...names.map((name) => {
      const item = Object.assign(document.createElement('button'), { type: 'button', textContent: name });
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(name === current));
      item.addEventListener('click', () => choosePart(name));
      return item;
    }),
  );
  partOpen.hidden = names.length < 2;
}

function choosePart(name) {
  partMenu.hidePopover();
  if (name === currentPart) return;
  currentPart = name;
  storage.set(`cadcode:part:${fileKey}`, name);
  requestPart(name);
}

partMenu.addEventListener('toggle', (event) => {
  partOpen.setAttribute('aria-expanded', String(event.newState === 'open'));
  if (event.newState !== 'open') return;
  const box = partOpen.getBoundingClientRect();
  partMenu.style.left = `${box.left}px`;
  partMenu.style.top = `${box.bottom + 8}px`;
  const items = [...partMenu.children];
  (items.find((item) => item.getAttribute('aria-checked') === 'true') ?? items[0])?.focus();
});

// Arrows move through the menu; Escape closes it (the popover's own).
partMenu.addEventListener('keydown', (event) => {
  const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
  if (!step) return;
  event.preventDefault();
  const items = [...partMenu.children];
  items[(items.indexOf(document.activeElement) + step + items.length) % items.length]?.focus();
});

// --- Download ----------------------------------------------------------------
// Fetched rather than navigated to, so a failing program shows its error here
// instead of replacing the viewer.

const downloadButton = document.getElementById('download');

downloadButton.addEventListener('click', async () => {
  downloadButton.disabled = true;
  try {
    const response = await fetch(`/stl?part=${encodeURIComponent(currentPart)}`);
    if (!response.ok) throw new Error(await response.text());
    saveBlob(await response.blob(), response.headers.get('Content-Disposition').match(/filename="(.+)"/)[1]);
  } catch (error) {
    showError(`STL download failed: ${error.message}`);
  } finally {
    downloadButton.disabled = false;
  }
});

// The picture is the view on screen, so it needs no server round trip.
// Named like the STL: the program's name, plus the part when there are several.
document.getElementById('png').addEventListener('click', async () => {
  if (!shown) return;
  const base = shown.file.slice(shown.file.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
  const name = shown.partNames.length > 1 ? `${base}-${shown.part}.png` : `${base}.png`;
  try {
    saveBlob(await view.snapshotPNG(), name);
  } catch (error) {
    showError(`PNG export failed: ${error.message}`);
  }
});

// --- Connection --------------------------------------------------------------

let socket = null;
let firstModel = true;

function requestPart(name) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'part', name }));
}

function connect() {
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

    const frame = decodeModel(event.data);
    const { header } = frame;
    if (fileKey !== header.file) {
      fileKey = header.file;
      const slash = header.file.lastIndexOf('/') + 1;
      fileEl.querySelector('.dir').textContent = header.file.slice(0, slash);
      fileEl.querySelector('.name').textContent = header.file.slice(slash);
      fileEl.title = header.file;
      fileEl.hidden = false;
      document.title = `${header.file} · cadcode`;
    }
    showParts(header.partNames, header.part);
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
    setStatus('disconnected');
    setTimeout(connect, 1000);
  });
}

connect();
