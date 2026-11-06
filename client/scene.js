// The page's side of the three.js view shared by the dev viewer and the site's
// playground. The scene itself runs in client/render-worker.js on an OffscreenCanvas,
// so building a large mesh never stalls the page. This side hands the canvas over,
// forwards input and size, and turns commands into messages:
//
//   to the worker:   init, resize, inset, event, show, fit, snapshot, set-camera, view-axis, display
//   from the worker: reply (to show and snapshot), camera (on every move), cursor

/** The event fields OrbitControls reads. */
const FIELDS = ['pointerId', 'pointerType', 'button', 'buttons', 'clientX', 'clientY', 'pageX', 'pageY', 'deltaX', 'deltaY', 'deltaMode', 'ctrlKey', 'metaKey', 'shiftKey', 'altKey', 'key', 'code'];

const copyEvent = (event) => {
  const data = { type: event.type };
  for (const field of FIELDS) if (event[field] !== undefined) data[field] = event[field];
  return data;
};

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ workerUrl: string | URL, colors?: { background?: number, gridMajor?: number, gridMinor?: number, edges?: number }, onCamera?: (camera: { position: number[], target: number[], zoom: number, ortho: boolean }) => void }} options
 *   The colours default to the dev viewer's, and a null background leaves the canvas
 *   transparent; onCamera hears of every camera move.
 */
export function createScene(canvas, { workerUrl, colors, onCamera }) {
  const worker = new Worker(workerUrl, { type: 'module', name: 'render' });
  const pending = new Map(); // id → { resolve, reject } of a show or snapshot
  let nextId = 1;

  const request = (message, transfer = []) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...message, id }, transfer);
    });

  worker.onmessage = ({ data }) => {
    if (data.type === 'camera') return onCamera?.(data.camera);
    if (data.type === 'cursor') return void (canvas.style.cursor = data.value);
    if (data.type !== 'reply') return;
    const { resolve, reject } = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) reject(new Error(data.error));
    else resolve(data.value);
  };

  // A worker that fails to load or throws would leave the page waiting for replies.
  worker.onerror = (event) => {
    const error = new Error(event.message || 'The view failed to start');
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
    console.error(error);
  };

  // --- Size --------------------------------------------------------------------

  const measure = () => {
    const box = canvas.getBoundingClientRect();
    return { width: canvas.clientWidth, height: canvas.clientHeight, left: box.left, top: box.top, dpr: window.devicePixelRatio };
  };

  const offscreen = canvas.transferControlToOffscreen();
  worker.postMessage({ type: 'init', canvas: offscreen, colors, ...measure() }, [offscreen]);
  new ResizeObserver(() => worker.postMessage({ type: 'resize', ...measure() })).observe(canvas);

  // --- Input -------------------------------------------------------------------
  // The page captures the pointer on the canvas, so a drag keeps reporting when it
  // leaves it; OrbitControls hears pointermove and pointerup on its "document".

  canvas.style.touchAction = 'none';
  const forward = (target, event) => worker.postMessage({ type: 'event', target, event: copyEvent(event) });

  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    forward('element', event);
  });
  canvas.addEventListener('pointercancel', (event) => forward('element', event));
  canvas.addEventListener('pointermove', (event) => forward('document', event));
  canvas.addEventListener('pointerup', (event) => forward('document', event));
  canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    forward('element', event);
  });
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      forward('element', event);
    },
    { passive: false },
  );
  // OrbitControls watches the modifier keys to change what a drag or wheel does.
  for (const type of ['keydown', 'keyup']) window.addEventListener(type, (event) => forward('document', event));

  // --- Commands ----------------------------------------------------------------

  return {
    /**
     * Replaces the model with mesh groups ({ color, positions, indices }); their
     * buffers are handed to the worker and are unusable here afterwards.
     * @returns {Promise<{ triangles: number, size: [number, number, number] | null }>}
     */
    showModel(groups) {
      const buffers = new Set(groups.flatMap((g) => [g.positions.buffer, g.indices.buffer, ...(g.lines ? [g.lines.buffer] : [])]));
      return request({ type: 'show', groups }, [...buffers]);
    },
    fitView() {
      worker.postMessage({ type: 'fit' });
    },
    /** How much of the canvas a panel covers, in CSS pixels; the view centres on the rest. */
    setInset(inset) {
      worker.postMessage({ type: 'inset', inset });
    },
    setCamera(camera) {
      worker.postMessage({ type: 'set-camera', camera });
    },
    /** Turns the camera to look at the target from [x, y, z], into an orthographic axis view. */
    viewAlong(direction) {
      worker.postMessage({ type: 'view-axis', direction });
    },
    /** How the model is drawn: 'solid', 'wire' (every triangle edge, no faces) or 'both'. */
    setDisplay(mode) {
      worker.postMessage({ type: 'display', mode });
    },
    /** The current view as a PNG, without the grid and axes. @returns {Promise<Blob>} */
    snapshotPNG() {
      return request({ type: 'snapshot' });
    },
  };
}

/**
 * Turns buttons with data-display="wire" or "both" into a pair of radio-like
 * toggles for the view's display mode: pressing one switches to it, pressing the
 * pressed one goes back to solid. The mode is remembered across reloads.
 * @param {{ setDisplay: (mode: string) => void }} view
 * @param {HTMLButtonElement[]} buttons
 */
export function bindDisplayButtons(view, buttons) {
  const KEY = 'cadcode:display';
  const apply = (mode) => {
    view.setDisplay(mode);
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.display === mode));
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      // Storage unavailable (private window): the mode just isn't remembered.
    }
  };
  let saved = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {}
  let mode = buttons.some((button) => button.dataset.display === saved) ? saved : 'solid';
  for (const button of buttons) {
    button.addEventListener('click', () => {
      mode = mode === button.dataset.display ? 'solid' : button.dataset.display;
      apply(mode);
    });
  }
  apply(mode);
}

/** Starts a download of a blob under the given file name. */
export function saveBlob(blob, name) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href)); // after the browser has started the download
}
