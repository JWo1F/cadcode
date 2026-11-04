import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DEFAULT_COLOR = '#f2c14e';
const EDGE_ANGLE = 25;

const canvas = document.getElementById('view');
const partSelect = document.getElementById('part');
const statusEl = document.getElementById('status');
const fileEl = document.getElementById('file');
const errorEl = document.getElementById('error');
const errorText = document.getElementById('error-text');
const logsEl = document.getElementById('logs');

// --- Scene -------------------------------------------------------------------

THREE.Object3D.DEFAULT_UP.set(0, 0, 1); // CAD convention: Z is up

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0xeef0f3);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
camera.up.set(0, 0, 1);
camera.position.set(120, -160, 110);
scene.add(camera);

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
keyLight.position.set(-0.4, 0.8, 1); // relative to the camera, so shading follows the view
camera.add(keyLight);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.15;
controls.screenSpacePanning = true; // shift+drag and right-drag pan in the view plane

const grid = new THREE.Group();
scene.add(grid);
const axes = new THREE.AxesHelper(10);
scene.add(axes);

let model = new THREE.Group();
scene.add(model);

function resize() {
  const { clientWidth: w, clientHeight: h } = canvas;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

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

function modelSphere() {
  return new THREE.Box3().setFromObject(model).getBoundingSphere(new THREE.Sphere());
}

function fitView() {
  const sphere = modelSphere();
  if (sphere.isEmpty()) return;
  const distance = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.15;
  const direction = new THREE.Vector3(1, -1.3, 0.9).normalize();
  controls.target.copy(sphere.center);
  camera.position.copy(sphere.center).addScaledVector(direction, distance);
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  controls.update();
  saveCamera();
}

document.getElementById('fit').addEventListener('click', fitView);
window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLSelectElement) return;
  if (event.key === 'f' || event.key === 'F') fitView();
});

// --- Model -------------------------------------------------------------------

function disposeGroup(group) {
  group.traverse((object) => {
    object.geometry?.dispose();
    object.material?.dispose();
  });
}

function buildGrid(sphere) {
  disposeGroup(grid);
  grid.clear();
  const step = 10 ** Math.floor(Math.log10(Math.max(sphere.radius, 1)));
  const size = Math.ceil((sphere.radius * 3) / step) * step;
  const helper = new THREE.GridHelper(size, size / step, 0xb9bec7, 0xd6d9df);
  helper.rotation.x = Math.PI / 2;
  helper.position.set(Math.round(sphere.center.x / step) * step, Math.round(sphere.center.y / step) * step, 0);
  grid.add(helper);
  axes.scale.setScalar(step / 10);
}

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

function showModel({ header, groups }) {
  const next = new THREE.Group();
  for (const g of groups) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(g.indices, 1));
    geometry.computeVertexNormals();

    const [r, gr, b, a] = g.color ?? [...new THREE.Color(DEFAULT_COLOR).toArray(), 1];
    const transparent = a < 0.999;
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(r, gr, b),
      roughness: 0.65,
      metalness: 0.05,
      flatShading: true,
      transparent,
      opacity: a,
      depthWrite: !transparent,
      side: transparent ? THREE.DoubleSide : THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = transparent ? 1 : 0;
    next.add(mesh);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, EDGE_ANGLE),
      new THREE.LineBasicMaterial({ color: 0x2a2f36, transparent: true, opacity: transparent ? 0.25 : 0.55 }),
    );
    next.add(edges);
  }

  scene.remove(model);
  disposeGroup(model);
  model = next;
  scene.add(model);

  const sphere = modelSphere();
  if (!sphere.isEmpty()) {
    camera.near = Math.max(sphere.radius / 1000, 0.01);
    camera.far = sphere.radius * 200 + camera.position.distanceTo(sphere.center);
    camera.updateProjectionMatrix();
    buildGrid(sphere);
  }

  const triangles = groups.reduce((n, g) => n + g.indices.length / 3, 0);
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
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await response.blob());
    link.download = response.headers.get('Content-Disposition').match(/filename="(.+)"/)[1];
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href)); // after the browser has started the download
  } catch (error) {
    showError(`STL download failed: ${error.message}`);
  } finally {
    downloadButton.disabled = false;
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
