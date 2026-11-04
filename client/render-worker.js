// The three.js view, run in a worker on an OffscreenCanvas so that building a large
// mesh never stalls the page: renderer, camera and controls, the grid, and turning
// mesh groups into meshes. client/scene.js is the page's side: it hands over the
// canvas, forwards input and size, and sends commands; see it for the messages.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DEFAULT_COLOR = '#f2c14e';
const EDGE_ANGLE = 25;

THREE.Object3D.DEFAULT_UP.set(0, 0, 1); // CAD convention: Z is up

/**
 * Stands in for the canvas element, which OrbitControls listens to and measures.
 * The page forwards its events here; pointermove and pointerup go to the
 * "document", where OrbitControls listens for them during a drag.
 */
class ElementProxy extends EventTarget {
  ownerDocument = new EventTarget();
  clientWidth = 1;
  clientHeight = 1;
  left = 0;
  top = 0;
  // OrbitControls sets the cursor while dragging; the page applies it to the real canvas.
  style = new Proxy(
    {},
    {
      set(target, key, value) {
        if (key === 'cursor' && target.cursor !== value) self.postMessage({ type: 'cursor', value });
        target[key] = value;
        return true;
      },
    },
  );

  getBoundingClientRect() {
    const { left, top, clientWidth: width, clientHeight: height } = this;
    return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height };
  }

  getRootNode() {
    return this.ownerDocument;
  }

  setPointerCapture() {} // the page captures the pointer on the real canvas
  releasePointerCapture() {}
  focus() {}
}

/** Re-creates a forwarded event; the page has already called preventDefault where it matters. */
function dispatch(target, data) {
  const event = new Event(data.type, { cancelable: true });
  for (const [key, value] of Object.entries(data)) if (key !== 'type') Object.defineProperty(event, key, { value });
  target.dispatchEvent(event);
}

let view = null;
const queue = []; // messages that arrived before init

self.onmessage = ({ data }) => {
  if (data.type === 'init') {
    view = createView(data);
    for (const message of queue.splice(0)) handle(message);
    return;
  }
  if (view) handle(data);
  else queue.push(data);
};

async function handle(message) {
  switch (message.type) {
    case 'resize':
      return view.resize(message);
    case 'event':
      return dispatch(message.target === 'document' ? view.element.ownerDocument : view.element, message.event);
    case 'fit':
      return view.fitView();
    case 'inset':
      return view.setInset(message.inset);
    case 'set-camera':
      return view.setCamera(message.camera);
  }
  // The rest answer the page.
  try {
    const value = message.type === 'show' ? view.showModel(message.groups) : await view.snapshotPNG();
    self.postMessage({ type: 'reply', id: message.id, value });
  } catch (error) {
    self.postMessage({ type: 'reply', id: message.id, error: error.message });
  }
}

function createView({ canvas, colors, ...size }) {
  // A null background leaves the canvas transparent, for the page to paint behind it.
  const { background = 0xeef0f3, gridMajor = 0xb9bec7, gridMinor = 0xd6d9df, edges = 0x2a2f36 } = colors ?? {};
  const element = new ElementProxy();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: background === null });
  if (background === null) renderer.setClearColor(0x000000, 0);
  else renderer.setClearColor(background);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
  camera.up.set(0, 0, 1);
  camera.position.set(120, -160, 110);
  scene.add(camera);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
  keyLight.position.set(-0.4, 0.8, 1); // relative to the camera, so shading follows the view
  camera.add(keyLight);

  const controls = new OrbitControls(camera, element);
  controls.enableDamping = true;
  controls.dampingFactor = 0.15;
  controls.screenSpacePanning = true; // shift+drag and right-drag pan in the view plane

  // The page keeps the camera across reloads; it hears of every move.
  controls.addEventListener('change', () => self.postMessage({ type: 'camera', camera: getCamera() }));

  const grid = new THREE.Group();
  scene.add(grid);
  const axes = new THREE.AxesHelper(10);
  scene.add(axes);

  let model = new THREE.Group();
  scene.add(model);

  // The page measures the canvas, which its CSS may resize at any time.
  function resize({ width, height, left, top, dpr }) {
    Object.assign(element, { clientWidth: width, clientHeight: height, left, top });
    if (width === 0 || height === 0) return;
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    applyProjection();
  }

  // The part of the canvas the page covers with a panel, on the right or the bottom.
  // The view centres on what is left, so the model is never framed under the panel.
  let inset = { right: 0, bottom: 0 };

  function setInset(next) {
    inset = { right: next.right ?? 0, bottom: next.bottom ?? 0 };
    applyProjection();
  }

  function applyProjection() {
    const { clientWidth: width, clientHeight: height } = element;
    camera.aspect = width / height;
    if (inset.right || inset.bottom) camera.setViewOffset(width, height, inset.right / 2, inset.bottom / 2, width, height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }

  resize(size);

  let paused = false; // while a snapshot is being encoded
  renderer.setAnimationLoop(() => {
    if (paused) return;
    controls.update();
    renderer.render(scene, camera);
  });

  function modelSphere() {
    return new THREE.Box3().setFromObject(model).getBoundingSphere(new THREE.Sphere());
  }

  function fitView() {
    const sphere = modelSphere();
    if (sphere.isEmpty()) return;
    // Fit the sphere in the uncovered part of the canvas, by its narrower side.
    const { clientWidth: width, clientHeight: height } = element;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const visible = Math.min(Math.max(height - inset.bottom, 1), Math.max(width - inset.right, 1)) / height;
    const distance = (sphere.radius / Math.sin(Math.atan(tanHalf * visible))) * 1.15;
    const direction = new THREE.Vector3(1, -1.3, 0.9).normalize();
    controls.target.copy(sphere.center);
    camera.position.copy(sphere.center).addScaledVector(direction, distance);
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    controls.update();
  }

  function getCamera() {
    return { position: camera.position.toArray(), target: controls.target.toArray(), zoom: camera.zoom };
  }

  function setCamera({ position, target, zoom }) {
    camera.position.fromArray(position);
    controls.target.fromArray(target);
    camera.zoom = zoom ?? 1;
    camera.updateProjectionMatrix();
    controls.update();
  }

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
    const helper = new THREE.GridHelper(size, size / step, gridMajor, gridMinor);
    helper.rotation.x = Math.PI / 2;
    helper.position.set(Math.round(sphere.center.x / step) * step, Math.round(sphere.center.y / step) * step, 0);
    grid.add(helper);
    axes.scale.setScalar(step / 10);
  }

  /**
   * Replaces the model with mesh groups ({ color, positions, indices }) and returns
   * its triangle count and bounding box size ([x, y, z], or null when empty).
   * The camera is left where it is.
   */
  function showModel(groups) {
    const next = new THREE.Group();
    for (const g of groups) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
      geometry.setIndex(new THREE.BufferAttribute(g.indices, 1));
      // No vertex normals: flat shading derives them per fragment.

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

      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, EDGE_ANGLE),
        new THREE.LineBasicMaterial({ color: edges, transparent: true, opacity: transparent ? 0.25 : 0.55 }),
      );
      next.add(outline);
    }

    scene.remove(model);
    disposeGroup(model);
    model = next;
    scene.add(model);

    const box = new THREE.Box3().setFromObject(model);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    if (!sphere.isEmpty()) {
      camera.near = Math.max(sphere.radius / 1000, 0.01);
      camera.far = sphere.radius * 200 + camera.position.distanceTo(sphere.center);
      camera.updateProjectionMatrix();
      buildGrid(sphere);
    }

    return {
      triangles: groups.reduce((n, g) => n + g.indices.length / 3, 0),
      size: box.isEmpty() ? null : box.getSize(new THREE.Vector3()).toArray(),
    };
  }

  /**
   * The current view as a PNG, without the grid and axes. The loop is paused while
   * the frame is encoded, so no frame with the grid replaces it in the meantime.
   */
  async function snapshotPNG() {
    paused = true;
    grid.visible = axes.visible = false;
    try {
      renderer.render(scene, camera);
      return await canvas.convertToBlob({ type: 'image/png' });
    } finally {
      grid.visible = axes.visible = true;
      paused = false;
    }
  }

  return { element, resize, setInset, fitView, setCamera, showModel, snapshotPNG };
}
