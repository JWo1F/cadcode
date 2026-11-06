// The page's side of the section plane and the measurement, shared by the dev viewer
// and the site's playground. The view does the cutting and picking (client/inspect.js,
// in the render worker); this binds the buttons, the section card, the keys and the
// measurement's label to it. The markup lives in each page: see client/index.html.

const AXES = ['x', 'y', 'z'];

const formatMm = (n) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * @param {ReturnType<typeof import('./scene.js').createScene>} view
 * @param {{ stage: HTMLElement, storageKey?: () => string | null, ignoreKey?: (event: KeyboardEvent) => boolean }} options
 *   storageKey names where the section is remembered, read again whenever a model is
 *   shown (the dev viewer keys it by file); null leaves it unremembered. ignoreKey
 *   tells which key presses are not the view's, such as typing in an editor.
 */
export function bindViewTools(view, { stage, storageKey = () => null, ignoreKey = () => false }) {
  const sectionButton = document.getElementById('section-toggle');
  const measureButton = document.getElementById('measure-toggle');
  const card = document.getElementById('inspect');
  const sectionRow = card.querySelector('.inspect-section');
  const measureRow = card.querySelector('.inspect-measure');
  const axisButtons = [...card.querySelectorAll('[data-axis]')];
  const slider = document.getElementById('section-offset');
  const value = document.getElementById('section-value');
  const ruler = card.querySelector('.ruler');
  const track = card.querySelector('.ruler-track');
  const ends = { min: card.querySelector('[data-end="min"]'), max: card.querySelector('[data-end="max"]') };
  const flipButton = document.getElementById('section-flip');

  const label = Object.assign(document.createElement('div'), { className: 'measure-label', hidden: true });
  label.setAttribute('aria-live', 'polite');
  stage.append(label);

  // --- Section ----------------------------------------------------------------------
  // The offset is a coordinate along the axis; it stays within the model's bounds,
  // and starts at their middle.

  let section = { on: false, axis: 'z', offset: null, flip: false };
  let bounds = null; // the model's { min, max }, null while there is none
  let loadedKey; // the storage key the section was last read from

  const extent = () => {
    const i = AXES.indexOf(section.axis);
    return [bounds.min[i], bounds.max[i]];
  };

  function save() {
    const key = storageKey();
    if (!key || key !== loadedKey) return; // not before the saved one is read
    try {
      localStorage.setItem(key, JSON.stringify(section));
    } catch {
      // Storage unavailable (private window): the section just isn't remembered.
    }
  }

  function load(key) {
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      if (saved && AXES.includes(saved.axis)) section = { on: !!saved.on, axis: saved.axis, offset: Number.isFinite(saved.offset) ? saved.offset : null, flip: !!saved.flip };
    } catch {}
  }

  function applySection() {
    if (bounds) {
      const [lo, hi] = extent();
      // Outside the model (another part, or a smaller one) the plane starts again at its middle.
      if (section.offset === null || section.offset < lo || section.offset > hi) section.offset = (lo + hi) / 2;
      Object.assign(slider, { min: lo, max: hi, step: 'any' });
      ends.min.textContent = formatMm(lo);
      ends.max.textContent = formatMm(hi);
      showOffset(section.offset);
    }
    card.dataset.axis = section.axis;
    ruler.dataset.keep = section.flip ? 'above' : 'below';
    view.setSection({ ...section, on: section.on && bounds !== null, offset: section.offset ?? 0 });
    sectionButton.setAttribute('aria-pressed', String(section.on));
    flipButton.setAttribute('aria-pressed', String(section.flip));
    for (const button of axisButtons) button.setAttribute('aria-checked', String(button.dataset.axis === section.axis));
    sectionRow.hidden = !section.on;
    showCard();
    save();
  }

  function setAxis(axis) {
    if (axis === section.axis) return;
    section = { ...section, axis, offset: null };
    applySection();
  }

  sectionButton.addEventListener('click', () => {
    section.on = !section.on;
    applySection();
  });
  for (const button of axisButtons) button.addEventListener('click', () => setAxis(button.dataset.axis));
  flipButton.addEventListener('click', () => {
    section.flip = !section.flip;
    applySection();
  });
  slider.addEventListener('input', () => {
    section.offset = Number(slider.value);
    applySection();
  });

  /** The slider, and the value riding over its thumb; the stylesheet places both from --t. */
  function showOffset(offset) {
    slider.value = offset;
    value.textContent = formatMm(offset);
    const [lo, hi] = extent();
    track.style.setProperty('--t', String(hi > lo ? (offset - lo) / (hi - lo) : 0.5));
  }

  // A drag of the plane's frame in the view.
  view.on('section', (offset) => {
    section.offset = offset;
    showOffset(offset);
    save();
  });

  view.on('model', (result) => {
    const key = storageKey();
    if (key && key !== loadedKey) {
      loadedKey = key;
      load(key);
    }
    bounds = result.bounds;
    applySection();
  });

  // --- Measurement -----------------------------------------------------------------

  let measuring = false;
  let points = 0;

  const MEASURE_HINT = ['Click a point on the model', 'Click the second point', 'Click to start over, Esc to clear'];

  function setMeasuring(on) {
    measuring = on;
    view.setMeasuring(on);
    measureButton.setAttribute('aria-pressed', String(on));
    if (!on) showMeasure({ points: 0 });
    showCard();
  }

  function showMeasure(measure) {
    points = measure.points;
    measureRow.textContent = MEASURE_HINT[points];
    if (points < 2) {
      label.hidden = true;
      return;
    }
    const distance = Object.assign(document.createElement('strong'), { textContent: formatMm(measure.distance) });
    distance.append(Object.assign(document.createElement('small'), { textContent: 'mm' }));
    // Each axis's share in its colour, as in the gizmo.
    const deltas = document.createElement('span');
    deltas.className = 'deltas';
    measure.delta.forEach((d, i) => {
      const part = Object.assign(document.createElement('span'), { className: `delta-${AXES[i]}` });
      part.append(Object.assign(document.createElement('b'), { textContent: `Δ${AXES[i].toUpperCase()}` }), ` ${formatMm(d)}`);
      deltas.append(part);
    });
    label.replaceChildren(distance, deltas);
  }

  measureButton.addEventListener('click', () => setMeasuring(!measuring));
  view.on('measure', showMeasure);
  view.on('measure-label', (place) => {
    label.hidden = !place || points < 2;
    if (place) label.style.translate = `${place.x}px ${place.y}px`;
  });

  // --- Card and keys -------------------------------------------------------------------

  function showCard() {
    measureRow.hidden = !measuring;
    card.hidden = !section.on && !measuring;
  }

  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || ignoreKey(event)) return;
    const key = event.key.toLowerCase();
    if (key === 's') {
      section.on = !section.on;
      applySection();
    } else if (key === 'm') setMeasuring(!measuring);
    else if (section.on && AXES.includes(key)) setAxis(key);
    else if (event.key === 'Escape' && measuring) {
      if (points > 0) view.clearMeasure();
      else setMeasuring(false);
    } else return;
    event.preventDefault();
  });

  applySection();
}
