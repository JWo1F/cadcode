// The three.js view, run in a worker on an OffscreenCanvas so that building a large
// mesh never stalls the page: renderer, camera and controls, the grid, and turning
// mesh groups into meshes. client/scene.js is the page's side: it hands over the
// canvas, forwards input and size, and sends commands; see it for the messages.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { createInspect } from './inspect.js';

const DEFAULT_COLOR = '#f2c14e';
const EDGE_ANGLE = 25;
const SKETCH_LINE_WIDTH = 2.5; // CSS pixels; plain WebGL lines are always one pixel wide
const TURN_MS = 300; // how long the camera takes to turn to an axis view
// Looking straight along Z, the orbit has no azimuth to hold on to, so an axis view
// along Z leans this far towards -Y: X then points right, as in a drawing's plan.
const POLE_LEAN = 1e-4;

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
      // The section frame and measure picks see pointer events first, and may keep them from the controls.
      if (message.event.type.startsWith('pointer') && view.inspect.handleEvent(message.event)) return;
      return dispatch(message.target === 'document' ? view.element.ownerDocument : view.element, message.event);
    case 'fit':
      return view.fitView();
    case 'inset':
      return view.setInset(message.inset);
    case 'set-camera':
      return view.setCamera(message.camera);
    case 'display':
      return view.setDisplay(message.mode);
    case 'view-axis':
      return view.viewAlong(message.direction);
    case 'section':
      return view.inspect.setSection(message.section);
    case 'measuring':
      return view.inspect.setMeasuring(message.on);
    case 'measure-clear':
      return view.inspect.clearMeasure();
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

  // The stencil buffer caps the section's cut; see client/inspect.js.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: background === null, stencil: true });
  renderer.localClippingEnabled = true;
  if (background === null) renderer.setClearColor(0x000000, 0);
  else renderer.setClearColor(background);

  const scene = new THREE.Scene();
  // Perspective, except in an axis view, which is orthographic as in Blender: the
  // view drops back to perspective as soon as it is turned off the axis.
  const perspective = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
  perspective.position.set(120, -160, 110);
  const orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, -10000, 10000);
  scene.add(perspective, orthographic);
  let camera = perspective; // the one in use

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
  keyLight.position.set(-0.4, 0.8, 1); // relative to the camera, so shading follows the view
  camera.add(keyLight);

  const controls = new OrbitControls(camera, element);
  controls.enableDamping = true;
  controls.dampingFactor = 0.15;
  controls.screenSpacePanning = true; // shift+drag and right-drag pan in the view plane

  // The page keeps the camera across reloads and draws the axes gizmo from it; it
  // hears of every move.
  controls.addEventListener('change', () => {
    if (axisView && !turn && viewDirection().angleTo(axisView) > 1e-6) toPerspective();
    reportCamera();
  });
  const reportCamera = () => self.postMessage({ type: 'camera', camera: getCamera() });

  const grid = new THREE.Group();
  scene.add(grid);
  const axes = new THREE.AxesHelper(10);
  scene.add(axes);

  let model = new THREE.Group();
  scene.add(model);

  const inspect = createInspect({ scene, element, getCamera: () => camera, post: (message) => self.postMessage(message) });

  // What the model is drawn as: 'solid' (faces and feature edges), 'wire' (every
  // triangle edge, no faces) or 'both' (the solid with every triangle edge over it).
  let display = 'solid';
  let shapes = []; // per mesh group: { mesh, outline, wire, transparent }; wire is built on first need
  let sketchLines = []; // the outlines' materials, which need the canvas size in pixels

  // The page measures the canvas, which its CSS may resize at any time.
  function resize({ width, height, left, top, dpr }) {
    Object.assign(element, { clientWidth: width, clientHeight: height, left, top });
    if (width === 0 || height === 0) return;
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    for (const material of sketchLines) material.resolution.set(width, height);
    inspect.resize(width, height);
    applyProjection();
  }

  // The part of the canvas the page covers with a panel, on the right or the bottom.
  // The view centres on what is left, so the model is never framed under the panel.
  let inset = { right: 0, bottom: 0 };

  function setInset(next) {
    inset = { right: next.right ?? 0, bottom: next.bottom ?? 0 };
    applyProjection();
  }

  // Half the height the orthographic camera sees at zoom 1: what the perspective one
  // saw at the target when the view switched, so the model keeps its size.
  let orthoHalfHeight = 1;

  function applyProjection() {
    const { clientWidth: width, clientHeight: height } = element;
    const aspect = width / height;
    perspective.aspect = aspect;
    Object.assign(orthographic, { top: orthoHalfHeight, bottom: -orthoHalfHeight, left: -orthoHalfHeight * aspect, right: orthoHalfHeight * aspect });
    for (const each of [perspective, orthographic]) {
      if (inset.right || inset.bottom) each.setViewOffset(width, height, inset.right / 2, inset.bottom / 2, width, height);
      else each.clearViewOffset();
      each.updateProjectionMatrix();
    }
  }

  const tanHalfFov = () => Math.tan(THREE.MathUtils.degToRad(perspective.fov / 2));

  /** The unit direction from the target to the camera. */
  function viewDirection() {
    return camera.position.clone().sub(controls.target).normalize();
  }

  // --- Axis views ----------------------------------------------------------------
  // In an axis view the camera is orthographic, and axisView is the direction from
  // the target to it; null in perspective.

  let axisView = null;

  function useCamera(next) {
    if (next === camera) return;
    next.position.copy(camera.position);
    next.quaternion.copy(camera.quaternion);
    next.add(keyLight);
    camera = next;
    controls.object = next;
  }

  function toOrthographic() {
    if (camera === orthographic) return void (axisView = viewDirection());
    orthoHalfHeight = camera.position.distanceTo(controls.target) * tanHalfFov() / camera.zoom;
    orthographic.zoom = 1;
    useCamera(orthographic);
    applyProjection();
    axisView = viewDirection();
  }

  // Back at the distance where perspective shows the target as large as it was.
  function toPerspective() {
    axisView = null;
    if (camera === perspective) return;
    const distance = (orthoHalfHeight / orthographic.zoom) / tanHalfFov();
    const direction = viewDirection();
    useCamera(perspective);
    perspective.position.copy(controls.target).addScaledVector(direction, distance);
    perspective.zoom = 1;
    perspective.updateProjectionMatrix();
  }

  // The turn to an axis view under way: { offset, rotation, start }. The camera keeps
  // its distance and swings around the target; input waits until it is done.
  let turn = null;

  /**
   * Turns the camera to look at the target from [x, y, z], then makes the view
   * orthographic. From one axis view to another it stays orthographic, at its zoom.
   */
  function viewAlong(direction) {
    stopTurn();
    const to = new THREE.Vector3().fromArray(direction).normalize();
    if (Math.abs(to.z) > 0.999) to.set(0, -POLE_LEAN, Math.sign(to.z)).normalize();
    // Without damping, an update spends what is left of the last drag's momentum.
    controls.enableDamping = false;
    controls.update();
    const offset = camera.position.clone().sub(controls.target);
    const rotation = new THREE.Quaternion().setFromUnitVectors(offset.clone().normalize(), to);
    controls.enabled = false;
    turn = { offset, rotation, start: performance.now() };
  }

  function stepTurn() {
    const t = Math.min((performance.now() - turn.start) / TURN_MS, 1);
    const eased = 1 - (1 - t) ** 3;
    const rotation = new THREE.Quaternion().slerp(turn.rotation, eased);
    camera.position.copy(controls.target).add(turn.offset.clone().applyQuaternion(rotation));
    if (t < 1) return;
    stopTurn();
    // The new axis first: the update would otherwise see the view off the old one.
    toOrthographic();
    controls.update();
    reportCamera(); // the camera may not have moved, so the controls may not tell
  }

  function stopTurn() {
    turn = null;
    controls.enabled = true;
    controls.enableDamping = true;
  }

  resize(size);

  let paused = false; // while a snapshot is being encoded
  renderer.setAnimationLoop(() => {
    if (paused) return;
    if (turn) stepTurn();
    controls.update();
    inspect.update();
    renderer.render(scene, camera);
  });

  function modelSphere() {
    return new THREE.Box3().setFromObject(model).getBoundingSphere(new THREE.Sphere());
  }

  function fitView() {
    const sphere = modelSphere();
    if (sphere.isEmpty()) return;
    stopTurn();
    toPerspective();
    // Fit the sphere in the uncovered part of the canvas, by its narrower side.
    const { clientWidth: width, clientHeight: height } = element;
    const tanHalf = tanHalfFov();
    const visible = Math.min(Math.max(height - inset.bottom, 1), Math.max(width - inset.right, 1)) / height;
    const distance = (sphere.radius / Math.sin(Math.atan(tanHalf * visible))) * 1.15;
    const direction = new THREE.Vector3(1, -1.3, 0.9).normalize();
    controls.target.copy(sphere.center);
    camera.position.copy(sphere.center).addScaledVector(direction, distance);
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    controls.update();
  }

  /** ortho: whether the view is an orthographic axis view; zoom is then the orthographic camera's. */
  function getCamera() {
    return { position: camera.position.toArray(), target: controls.target.toArray(), zoom: camera.zoom, ortho: camera === orthographic };
  }

  function setCamera({ position, target, zoom = 1, ortho = false }) {
    stopTurn();
    toPerspective();
    camera.position.fromArray(position);
    controls.target.fromArray(target);
    camera.zoom = ortho ? 1 : zoom;
    camera.updateProjectionMatrix();
    controls.update();
    if (!ortho) return;
    toOrthographic();
    orthographic.zoom = zoom;
    orthographic.updateProjectionMatrix();
    reportCamera();
  }

  function setDisplay(mode) {
    display = mode;
    applyDisplay();
    inspect.setDisplay(mode);
  }

  function applyDisplay() {
    const solid = display !== 'wire';
    const wired = display !== 'solid';
    for (const shape of shapes) {
      shape.mesh.visible = shape.outline.visible = solid;
      if (wired && !shape.wire) {
        shape.wire = new THREE.LineSegments(
          new THREE.WireframeGeometry(shape.mesh.geometry),
          new THREE.LineBasicMaterial({ color: edges, transparent: true }),
        );
        inspect.clip(shape.wire.material);
        model.add(shape.wire);
      }
      if (!shape.wire) continue;
      shape.wire.visible = wired;
      // Over faces the lines only hint at the triangles; alone they are the picture.
      shape.wire.material.opacity = solid ? (shape.transparent ? 0.15 : 0.3) : 0.7;
    }
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
    const nextShapes = [];
    const nextSketchLines = [];
    for (const g of groups) {
      if (g.sketch) {
        nextSketchLines.push(addSketch(next, g));
        continue;
      }
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
      nextShapes.push({ mesh, outline, wire: null, transparent, body: g.body, color: material.color });
    }

    scene.remove(model);
    disposeGroup(model);
    model = next;
    shapes = nextShapes;
    sketchLines = nextSketchLines;
    scene.add(model);
    applyDisplay();

    const box = new THREE.Box3().setFromObject(model);
    inspect.setModel(shapes, box.clone());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    if (!sphere.isEmpty()) {
      perspective.near = Math.max(sphere.radius / 1000, 0.01);
      perspective.far = sphere.radius * 200 + camera.position.distanceTo(sphere.center);
      // The orthographic camera does not move when it zooms, so it sees as far behind as ahead.
      orthographic.near = -perspective.far;
      orthographic.far = perspective.far;
      perspective.updateProjectionMatrix();
      orthographic.updateProjectionMatrix();
      buildGrid(sphere);
    }

    return {
      triangles: groups.reduce((n, g) => n + g.indices.length / 3, 0),
      size: box.isEmpty() ? null : box.getSize(new THREE.Vector3()).toArray(),
      bounds: box.isEmpty() ? null : { min: box.min.toArray(), max: box.max.toArray() },
    };
  }

  /**
   * Draws a 2D shape like a CAD sketch: a see-through, unlit fill on Z=0 and a bold
   * outline over it. It looks the same in every display mode, having no triangles
   * worth showing. Returns the outline's material.
   */
  function addSketch(group, g) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(g.indices, 1));
    const [r, gr, b, a] = g.color;
    const fill = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(r, gr, b),
        transparent: true,
        opacity: a,
        depthWrite: false,
        side: THREE.DoubleSide,
        // In front of the grid, which lies on Z=0 too.
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    fill.renderOrder = 2;
    group.add(fill);

    const material = new LineMaterial({ color: new THREE.Color(r, gr, b), linewidth: SKETCH_LINE_WIDTH });
    material.resolution.set(element.clientWidth, element.clientHeight);
    const outline = new LineSegments2(new LineSegmentsGeometry().setPositions(g.lines), material);
    outline.renderOrder = 3;
    group.add(outline);
    return material;
  }

  /**
   * The current view as a PNG, without the grid, the axes, the section frame and the
   * measurement, cut to the part of the canvas no panel covers. The loop is paused while the frame is encoded, so no
   * frame with the grid replaces it in the meantime.
   */
  async function snapshotPNG() {
    paused = true;
    grid.visible = axes.visible = false;
    inspect.showOverlays(false);
    try {
      renderer.render(scene, camera);
      if (!inset.right && !inset.bottom) return await canvas.convertToBlob({ type: 'image/png' });
      // Copied in the same task as the render, before the drawing buffer is cleared.
      const dpr = renderer.getPixelRatio();
      const width = Math.max(1, canvas.width - Math.round(inset.right * dpr));
      const height = Math.max(1, canvas.height - Math.round(inset.bottom * dpr));
      const visible = new OffscreenCanvas(width, height);
      visible.getContext('2d').drawImage(canvas, 0, 0, width, height, 0, 0, width, height);
      return await visible.convertToBlob({ type: 'image/png' });
    } finally {
      grid.visible = axes.visible = true;
      inspect.showOverlays(true);
      paused = false;
    }
  }

  return { element, inspect, resize, setInset, fitView, setCamera, viewAlong, setDisplay, showModel, snapshotPNG };
}
