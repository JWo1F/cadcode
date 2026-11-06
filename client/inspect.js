// The render worker's inspection tools: a section plane that cuts the model along
// X, Y or Z and caps the cut, and a measurement between two picked points.
// client/render-worker.js owns the scene and forwards input here first; the page's
// side is client/view-tools.js.
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
// The two axes the section frame spans, for each axis it is cut across.
const SPANS = { x: ['y', 'z'], y: ['x', 'z'], z: ['x', 'y'] };

const FRAME_COLOR = 0xdcaa2c; // the filament colour of the page
const MEASURE_COLOR = 0x1f2833; // the page's ink
const GRAB_PX = { mouse: 8, pen: 10, touch: 20 }; // how near the frame a press grabs it
const SNAP_PX = 10; // a pick this near a vertex lands on it
const CLICK_PX = 4; // a press that moves further is a drag of the view, not a pick
const HOVER_MS = 40; // the hover pick runs at most this often; it walks every triangle

/** A square of unit size in the XY plane, from 0 to 1, as two triangles. */
function unitSquare() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

/** A round marker for picked points: a filled disc with a dark ring, drawn once. */
function dotTexture(fill) {
  const canvas = new OffscreenCanvas(64, 64);
  const context = canvas.getContext('2d');
  context.beginPath();
  context.arc(32, 32, 26, 0, Math.PI * 2);
  context.fillStyle = fill;
  context.fill();
  context.lineWidth = 8;
  context.strokeStyle = '#1f2833';
  context.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function dots(fill, size) {
  const points = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3)),
    new THREE.PointsMaterial({ map: dotTexture(fill), size, sizeAttenuation: false, transparent: true, alphaTest: 0.5, depthTest: false }),
  );
  points.renderOrder = 32;
  points.frustumCulled = false;
  return points;
}

const distanceToSegment = (px, py, [ax, ay], [bx, by]) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

/**
 * @param {{ scene: THREE.Scene, element: { clientWidth: number, clientHeight: number, left: number, top: number }, getCamera: () => THREE.Camera, post: (message: object) => void }} options
 *   post sends a message to the page: section (the offset after a drag), measure, measure-label and cursor.
 */
export function createInspect({ scene, element, getCamera, post }) {
  // --- Section ------------------------------------------------------------------
  // The plane keeps the side below the offset (above it when flipped). Every solid
  // material of the model clips by it; the cut is capped per body with the stencil
  // trick: back faces behind the plane count up, front faces count down, and the cap
  // is drawn where the count is not zero — inside the solid. Manifold's meshes are
  // always closed, so the count is exact.

  const plane = new THREE.Plane();
  const clipPlanes = [plane];
  let section = { on: false, axis: 'z', offset: 0, flip: false };
  let display = 'solid';
  let box = new THREE.Box3(); // the model's, empty when there is none
  let shapes = []; // the model's solid meshes: { mesh, outline, wire, transparent }
  let clipped = []; // their materials, which clip while the section is on

  const square = unitSquare();
  const overlays = new THREE.Group(); // what a PNG leaves out: the frame and the measurement
  scene.add(overlays);

  // The plane is shown as a see-through sheet with a bold frame, which a drag moves.
  const sheet = new THREE.Mesh(
    square,
    new THREE.MeshBasicMaterial({ color: FRAME_COLOR, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }),
  );
  sheet.matrixAutoUpdate = false;
  sheet.renderOrder = 20;
  const frameMaterial = new LineMaterial({ color: FRAME_COLOR, linewidth: 2, depthTest: false, transparent: true });
  const frame = new LineSegments2(new LineSegmentsGeometry().setPositions([0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0]), frameMaterial);
  frame.matrixAutoUpdate = false;
  frame.renderOrder = 21;
  frame.frustumCulled = false;
  overlays.add(sheet, frame);

  const caps = new THREE.Group(); // per body: its two stencil meshes and its cap
  scene.add(caps);
  const stencilMaterial = (side, op) =>
    new THREE.MeshBasicMaterial({
      side,
      clippingPlanes: clipPlanes,
      depthWrite: false,
      depthTest: false,
      colorWrite: false,
      stencilWrite: true,
      stencilFunc: THREE.AlwaysStencilFunc,
      stencilFail: op,
      stencilZFail: op,
      stencilZPass: op,
    });
  const countBack = stencilMaterial(THREE.BackSide, THREE.IncrementWrapStencilOp);
  const countFront = stencilMaterial(THREE.FrontSide, THREE.DecrementWrapStencilOp);

  /** The frame's corners in world space, in order around it, or null without a model. */
  function frameCorners() {
    if (box.isEmpty()) return null;
    const [u, v] = SPANS[section.axis];
    const size = box.getSize(new THREE.Vector3());
    const margin = Math.max(size.x, size.y, size.z) * 0.08 + 0.5;
    const lo = box.min.clone().subScalar(margin);
    const hi = box.max.clone().addScalar(margin);
    const corner = (cu, cv) => new THREE.Vector3().setComponent('xyz'.indexOf(section.axis), section.offset).setComponent('xyz'.indexOf(u), cu).setComponent('xyz'.indexOf(v), cv);
    return [corner(lo[u], lo[v]), corner(hi[u], lo[v]), corner(hi[u], hi[v]), corner(lo[u], hi[v])];
  }

  function updateSection() {
    const normal = AXES[section.axis].clone().multiplyScalar(section.flip ? 1 : -1);
    plane.set(normal, section.flip ? -section.offset : section.offset);

    const corners = frameCorners();
    const shown = section.on && corners !== null;
    sheet.visible = frame.visible = shown;
    if (corners) {
      // The unit square stretched over the frame: X along its first side, Y along the second.
      const [a, b, , d] = corners;
      const matrix = new THREE.Matrix4().makeBasis(b.clone().sub(a), d.clone().sub(a), AXES[section.axis]).setPosition(a);
      for (const object of [sheet, frame]) object.matrix.copy(matrix);
      for (const cap of caps.children) if (cap.userData.cap) cap.matrix.copy(matrix);
    }
    const solid = display !== 'wire';
    caps.visible = section.on && solid;
  }

  /** Clips a model material while the section is on; the wire, built later, comes through here too. */
  function clip(material) {
    material.clippingPlanes = section.on ? clipPlanes : null;
    material.needsUpdate = true;
    if (!clipped.includes(material)) clipped.push(material);
  }

  function setSection(next) {
    const toggled = next.on !== section.on;
    section = { ...section, ...next };
    if (toggled) for (const material of clipped) clip(material);
    updateSection();
    if (!section.on) hoverFrame = false;
    updateCursor();
  }

  /**
   * Takes the model just shown: its solid meshes, which body each belongs to and
   * its colour, and its bounding box. The measurement is dropped: its points were
   * on surfaces that may be gone.
   * @param {{ mesh: THREE.Mesh, outline: THREE.LineSegments, transparent: boolean, body: number, color: THREE.Color }[]} next
   */
  function setModel(next, nextBox) {
    shapes = next;
    box = nextBox;
    clipped = [];
    for (const shape of shapes) {
      clip(shape.mesh.material);
      clip(shape.outline.material);
    }

    for (const cap of caps.children) if (cap.userData.cap) cap.material.dispose();
    caps.clear();
    // One cap per opaque body, with the colour most of its triangles have, darkened
    // so the cut reads as a cut. Each body counts and caps in turn, and the stencil is
    // cleared after its cap, so the bodies of an assembly don't mix.
    const bodies = new Map();
    for (const shape of shapes) {
      if (shape.transparent) continue;
      const body = bodies.get(shape.body) ?? { meshes: [], color: shape.color, triangles: 0 };
      const triangles = shape.mesh.geometry.index.count / 3;
      if (triangles > body.triangles) Object.assign(body, { color: shape.color, triangles });
      body.meshes.push(shape.mesh);
      bodies.set(shape.body, body);
    }
    let order = 10;
    for (const { meshes, color } of bodies.values()) {
      for (const mesh of meshes) {
        for (const material of [countBack, countFront]) {
          const counter = new THREE.Mesh(mesh.geometry, material);
          counter.renderOrder = order;
          caps.add(counter);
        }
      }
      const cap = new THREE.Mesh(
        square,
        new THREE.MeshStandardMaterial({
          color: color.clone().multiplyScalar(0.35), // linear: about two thirds as bright on screen
          roughness: 0.8,
          metalness: 0,
          flatShading: true,
          side: THREE.DoubleSide,
          stencilWrite: true,
          stencilRef: 0,
          stencilFunc: THREE.NotEqualStencilFunc,
          stencilFail: THREE.ReplaceStencilOp,
          stencilZFail: THREE.ReplaceStencilOp,
          stencilZPass: THREE.ReplaceStencilOp,
        }),
      );
      cap.matrixAutoUpdate = false;
      cap.userData.cap = true;
      cap.renderOrder = order + 0.5;
      cap.onAfterRender = (renderer) => renderer.clearStencil();
      caps.add(cap);
      order += 1;
    }

    updateSection();
    clearMeasure();
  }

  function setDisplay(mode) {
    display = mode;
    updateSection();
  }

  // --- Screen space ---------------------------------------------------------------

  /** A world point in canvas pixels, or null when it is behind the camera. */
  function toScreen(point) {
    const ndc = point.clone().project(getCamera());
    if (ndc.z > 1) return null;
    return [((ndc.x + 1) / 2) * element.clientWidth, ((1 - ndc.y) / 2) * element.clientHeight];
  }

  function nearFrame(x, y, pointerType) {
    const corners = section.on && frameCorners();
    if (!corners) return false;
    const screen = corners.map(toScreen);
    if (screen.some((p) => p === null)) return false;
    const reach = GRAB_PX[pointerType] ?? GRAB_PX.mouse;
    return screen.some((p, i) => distanceToSegment(x, y, p, screen[(i + 1) % 4]) <= reach);
  }

  // --- Measurement -----------------------------------------------------------------

  let measuring = false;
  let picked = []; // up to two world points
  const marks = dots('#f2c14e', 13);
  const hoverMark = dots('#ffffff', 11);
  hoverMark.visible = false;
  const lineMaterial = new LineMaterial({ color: MEASURE_COLOR, linewidth: 2, depthTest: false, transparent: true });
  const line = new LineSegments2(new LineSegmentsGeometry(), lineMaterial);
  line.renderOrder = 31;
  line.frustumCulled = false;
  line.visible = false;
  marks.geometry.setDrawRange(0, 0);
  overlays.add(line, marks, hoverMark);
  let label = null; // the last label position posted, as "x,y" or ''

  const raycaster = new THREE.Raycaster();

  /**
   * The model's surface under a canvas pixel: the nearest point not cut away, or on
   * the cap where the ray meets the section plane inside a solid. A point near a
   * vertex of the triangle hit lands on the vertex.
   */
  function pick(x, y) {
    const camera = getCamera();
    raycaster.setFromCamera(new THREE.Vector2((x / element.clientWidth) * 2 - 1, 1 - (y / element.clientHeight) * 2), camera);
    const meshes = shapes.map((shape) => shape.mesh);
    // Both sides, to tell inside from outside along the ray; the render is not touched in between.
    const sides = meshes.map((mesh) => mesh.material.side);
    let hits;
    try {
      for (const mesh of meshes) mesh.material.side = THREE.DoubleSide;
      hits = raycaster.intersectObjects(meshes, false);
    } finally {
      meshes.forEach((mesh, i) => (mesh.material.side = sides[i]));
    }
    if (section.on) hits = hits.filter((hit) => plane.distanceToPoint(hit.point) >= -1e-6);

    if (caps.visible) {
      const onPlane = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
      if (onPlane) {
        const t = raycaster.ray.origin.distanceTo(onPlane);
        // Inside a solid when the next surface the ray meets is one it leaves through.
        const next = hits.find((hit) => hit.distance > t);
        const inside = next && next.face.normal.dot(raycaster.ray.direction) > 0;
        if (inside && (!hits.length || t < hits[0].distance)) return onPlane;
      }
    }
    if (!hits.length) return null;

    const { point, face, object } = hits[0];
    const positions = object.geometry.attributes.position;
    let best = point;
    let bestDistance = SNAP_PX;
    for (const index of [face.a, face.b, face.c]) {
      const vertex = new THREE.Vector3().fromBufferAttribute(positions, index);
      if (section.on && plane.distanceToPoint(vertex) < -1e-6) continue;
      const screen = toScreen(vertex);
      const distance = screen ? Math.hypot(screen[0] - x, screen[1] - y) : Infinity;
      if (distance < bestDistance) [best, bestDistance] = [vertex, distance];
    }
    return best.clone();
  }

  function showPicked() {
    const positions = marks.geometry.attributes.position;
    picked.forEach((p, i) => positions.setXYZ(i, p.x, p.y, p.z));
    positions.needsUpdate = true;
    marks.geometry.setDrawRange(0, picked.length);
    line.visible = picked.length === 2;
    if (picked.length === 2) line.geometry.setPositions([...picked[0].toArray(), ...picked[1].toArray()]);

    if (picked.length < 2) {
      post({ type: 'measure', value: { points: picked.length } });
      return;
    }
    const delta = picked[1].clone().sub(picked[0]);
    post({ type: 'measure', value: { points: 2, distance: delta.length(), delta: delta.toArray().map(Math.abs) } });
    label = null; // posts the label's place on the next frame
  }

  function addPoint(point) {
    picked = picked.length === 2 ? [point] : [...picked, point];
    showPicked();
  }

  function clearMeasure() {
    picked = [];
    showPicked();
  }

  function setMeasuring(on) {
    measuring = on;
    hoverMark.visible = false;
    pendingHover = null;
    if (!on) clearMeasure();
    updateCursor();
  }

  // --- Input ----------------------------------------------------------------------
  // The page forwards pointer events here before OrbitControls sees them. A press on
  // the section frame drags the plane and is kept from the controls; in measure mode a
  // press that doesn't move is a pick, and a drag still turns the view.

  const pointers = new Set();
  let drag = null; // { id, x, y, offset, perPixel: [x, y] world units along the axis per pixel moved }
  let press = null; // { id, x, y }: a press that may become a pick
  let hoverFrame = false;
  let pendingHover = null; // [x, y]: the last place the pointer hovered, not yet picked
  let lastHover = 0;
  let cursor = '';

  function updateCursor() {
    const next = drag ? 'grabbing' : hoverFrame ? 'grab' : measuring ? 'crosshair' : '';
    if (next === cursor) return;
    cursor = next;
    post({ type: 'cursor', value: next });
  }

  /** How the plane moves for a pixel of drag: along the axis as it appears on screen. */
  function startDrag(id, x, y) {
    const center = box.getCenter(new THREE.Vector3()).setComponent('xyz'.indexOf(section.axis), section.offset);
    const step = box.getSize(new THREE.Vector3()).length() / 10 || 1;
    const from = toScreen(center);
    const to = toScreen(center.clone().addScaledVector(AXES[section.axis], step));
    if (!from || !to) return false;
    const sx = (to[0] - from[0]) / step; // pixels per world unit
    const sy = (to[1] - from[1]) / step;
    const pixels = sx * sx + sy * sy;
    if (pixels < 1e-4) return false; // looking straight along the axis: the slider moves it
    drag = { id, x, y, offset: section.offset, perPixel: [sx / pixels, sy / pixels] };
    return true;
  }

  function moveDrag(x, y) {
    const { min, max } = box;
    const i = 'xyz'.indexOf(section.axis);
    const moved = (x - drag.x) * drag.perPixel[0] + (y - drag.y) * drag.perPixel[1];
    const offset = Math.min(Math.max(drag.offset + moved, min.getComponent(i)), max.getComponent(i));
    section = { ...section, offset };
    updateSection();
    post({ type: 'section', value: offset });
  }

  /** @returns {boolean} whether the event was used here and must not reach the controls */
  function handleEvent(event) {
    const x = event.clientX - element.left;
    const y = event.clientY - element.top;
    switch (event.type) {
      case 'pointerdown': {
        pointers.add(event.pointerId);
        if (pointers.size > 1 || event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey) {
          press = null;
          return false;
        }
        if (nearFrame(x, y, event.pointerType) && startDrag(event.pointerId, x, y)) {
          updateCursor();
          return true;
        }
        if (measuring) press = { id: event.pointerId, x, y };
        return false;
      }
      case 'pointermove': {
        if (drag && event.pointerId === drag.id) {
          moveDrag(x, y);
          return true;
        }
        if (press && Math.hypot(x - press.x, y - press.y) > CLICK_PX) press = null;
        if (!event.buttons) {
          hoverFrame = nearFrame(x, y, event.pointerType);
          updateCursor();
          if (measuring && event.pointerType === 'mouse') pendingHover = [x, y];
        }
        return false;
      }
      case 'pointerup':
      case 'pointercancel': {
        pointers.delete(event.pointerId);
        if (drag && event.pointerId === drag.id) {
          drag = null;
          updateCursor();
          return true;
        }
        if (event.type === 'pointerup' && press?.id === event.pointerId) {
          const point = pick(x, y);
          if (point) addPoint(point);
        }
        press = null;
        return false;
      }
    }
    return false;
  }

  // --- Every frame -------------------------------------------------------------------

  function update() {
    if (pendingHover && performance.now() - lastHover > HOVER_MS) {
      lastHover = performance.now();
      const point = pick(...pendingHover);
      pendingHover = null;
      hoverMark.visible = point !== null;
      if (point) {
        hoverMark.geometry.attributes.position.setXYZ(0, point.x, point.y, point.z);
        hoverMark.geometry.attributes.position.needsUpdate = true;
        hoverMark.geometry.setDrawRange(0, 1);
      }
    }
    // The label sits on the page, at the middle of the line.
    if (picked.length === 2) {
      const screen = toScreen(picked[0].clone().lerp(picked[1], 0.5));
      const next = screen ? `${Math.round(screen[0])},${Math.round(screen[1])}` : '';
      if (next !== label) {
        label = next;
        post({ type: 'measure-label', value: screen ? { x: screen[0], y: screen[1] } : null });
      }
    }
  }

  function resize(width, height) {
    frameMaterial.resolution.set(width, height);
    lineMaterial.resolution.set(width, height);
  }

  /** Hides the frame and the measurement, for a PNG; the cut stays. */
  function showOverlays(visible) {
    overlays.visible = visible;
  }

  return { setModel, setDisplay, setSection, clip, setMeasuring, clearMeasure, handleEvent, update, resize, showOverlays };
}
