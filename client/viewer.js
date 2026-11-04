import { createScene, saveBlob } from './scene.js';

const canvas = document.getElementById('view');
const partSelect = document.getElementById('part');
const statusEl = document.getElementById('status');
const fileEl = document.getElementById('file');
const errorEl = document.getElementById('error');
const errorText = document.getElementById('error-text');
const logsEl = document.getElementById('logs');

const view = createScene(canvas);
const { camera, controls } = view;

// --- Camera persistence ------------------------------------------------------
// The camera survives model reloads untouched; it is also stored per file so a
// browser refresh or a restarted server comes back to the same view.

let fileKey = null;

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
  if (!fileKey) return;
  storage.set(`cadcode:camera:${fileKey}`, {
    position: camera.position.toArray(),
    target: controls.target.toArray(),
    zoom: camera.zoom,
  });
}

function restoreCamera() {
  const saved = storage.get(`cadcode:camera:${fileKey}`);
  if (!saved) return false;
  camera.position.fromArray(saved.position);
  controls.target.fromArray(saved.target);
  camera.zoom = saved.zoom ?? 1;
  camera.updateProjectionMatrix();
  controls.update();
  return true;
}

let saveTimer = 0;
controls.addEventListener('change', () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCamera, 200);
});
window.addEventListener('beforeunload', saveCamera);

function fitView() {
  view.fitView();
  saveCamera();
}

document.getElementById('fit').addEventListener('click', fitView);
window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLSelectElement) return;
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

function showModel({ header, groups }) {
  shown = header;
  const triangles = view.showModel(groups);
  setStatus('ready', `${header.part} · ${triangles.toLocaleString()} tris · ${header.ms} ms`);
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
}

// --- Download ----------------------------------------------------------------
// Fetched rather than navigated to, so a failing program shows its error here
// instead of replacing the viewer.

const downloadButton = document.getElementById('download');

downloadButton.addEventListener('click', async () => {
  downloadButton.disabled = true;
  try {
    const response = await fetch(`/stl?part=${encodeURIComponent(partSelect.value)}`);
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

partSelect.addEventListener('change', () => {
  storage.set(`cadcode:part:${fileKey}`, partSelect.value);
  requestPart(partSelect.value);
});

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
