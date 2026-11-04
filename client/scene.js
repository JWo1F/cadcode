// The three.js view shared by the dev viewer and the site's playground:
// renderer, camera and controls, the grid, and turning mesh groups into meshes.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DEFAULT_COLOR = '#f2c14e';
const EDGE_ANGLE = 25;

THREE.Object3D.DEFAULT_UP.set(0, 0, 1); // CAD convention: Z is up

/**
 * The colours default to the dev viewer's; the playground passes its own.
 * @param {HTMLCanvasElement} canvas
 * @param {{ background?: number, gridMajor?: number, gridMinor?: number, edges?: number }} [colors]
 */
export function createScene(canvas, { background = 0xeef0f3, gridMajor = 0xb9bec7, gridMinor = 0xd6d9df, edges = 0x2a2f36 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(background);

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

  // The canvas is sized by CSS, which the page may change at any time (the playground's split).
  function resize() {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

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
   * Replaces the model with mesh groups ({ color, positions, indices }) and
   * returns their triangle count. The camera is left where it is.
   */
  function showModel(groups) {
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

    const sphere = modelSphere();
    if (!sphere.isEmpty()) {
      camera.near = Math.max(sphere.radius / 1000, 0.01);
      camera.far = sphere.radius * 200 + camera.position.distanceTo(sphere.center);
      camera.updateProjectionMatrix();
      buildGrid(sphere);
    }

    return groups.reduce((n, g) => n + g.indices.length / 3, 0);
  }

  /**
   * The current view as a PNG, without the grid and axes. The frame is rendered
   * and read in the same task, so the drawing buffer is still intact.
   * @returns {Promise<Blob>}
   */
  function snapshotPNG() {
    grid.visible = axes.visible = false;
    renderer.render(scene, camera);
    const blob = new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The canvas could not be encoded'))), 'image/png'),
    );
    grid.visible = axes.visible = true;
    return blob;
  }

  /** The model's bounding box size in model units (mm): [x, y, z], or null when empty. */
  function modelSize() {
    const box = new THREE.Box3().setFromObject(model);
    if (box.isEmpty()) return null;
    return box.getSize(new THREE.Vector3()).toArray();
  }

  return { camera, controls, fitView, modelSize, showModel, snapshotPNG };
}

/** Starts a download of a blob under the given file name. */
export function saveBlob(blob, name) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href)); // after the browser has started the download
}
