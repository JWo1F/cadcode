// The side panel of the dev viewer (parameters) and the playground (code). It floats
// on the right, or across the bottom on phones. Its edge resizes it and a button hides
// it; both are remembered. The view is told how much of the canvas the panel covers,
// and centres the model on the rest.
import { storage } from './storage.js';

/**
 * @param {{
 *   stage: HTMLElement, panel: HTMLElement, grip: HTMLElement, button: HTMLElement,
 *   view: { setInset: (inset: { right: number, bottom: number }) => void },
 *   storageKey: string,
 *   defaults: { width: number, height: number, open: boolean },
 *   attribute: string,
 *   cssWidth: (width: number) => string,
 *   widthAt: (clientX: number) => number,
 *   onToggle?: (open: boolean) => void,
 * }} options
 *   The height is a share of the window; the width is in the page's own unit, which
 *   cssWidth writes and widthAt reads from the pointer while the edge is dragged.
 *   attribute names the stage's data attribute set to 'shown' or 'hidden'.
 * @returns {{ measure: () => void }} measure, for when the panel's content changes its size
 */
export function bindPanelLayout({ stage, panel, grip, button, view, storageKey, defaults, attribute, cssWidth, widthAt, onToggle }) {
  const stacked = matchMedia('(max-width: 720px)'); // phones lay the panel across the bottom
  const saved = storage.get(storageKey) ?? {};
  // The playground stored whether the panel is open as `code`; it is kept.
  let layout = { ...defaults, ...saved, open: saved.open ?? saved.code ?? defaults.open };
  delete layout.code;

  /** Tells the stylesheet and the view how much of the stage the panel covers. */
  function measure() {
    const shown = !panel.hidden && layout.open;
    const box = panel.getBoundingClientRect();
    const right = shown && !stacked.matches ? Math.round(innerWidth - box.left) : 0;
    const bottom = shown && stacked.matches ? Math.round(innerHeight - box.top) : 0;
    stage.style.setProperty('--panel-cover', `${right}px`);
    stage.style.setProperty('--panel-cover-bottom', `${bottom}px`);
    // On phones the readout and tools stand above the panel, across the whole width.
    const footer = stacked.matches ? /** @type {HTMLElement} */ (document.querySelector('.bottom-left')).offsetHeight + 12 : 0;
    view.setInset({ right, bottom: bottom + footer });
  }

  function size() {
    stage.style.setProperty('--panel-width', cssWidth(layout.width));
    stage.style.setProperty('--panel-height', `${layout.height * 100}dvh`);
  }

  function apply() {
    size();
    stage.dataset[attribute] = layout.open ? 'shown' : 'hidden';
    button.setAttribute('aria-pressed', String(layout.open));
    measure();
    storage.set(storageKey, layout);
  }

  button.addEventListener('click', () => {
    layout.open = !layout.open;
    apply();
    onToggle?.(layout.open);
  });

  grip.addEventListener('pointerdown', (event) => {
    grip.setPointerCapture(event.pointerId);
    stage.classList.add('dragging');
  });
  grip.addEventListener('pointermove', (event) => {
    if (!grip.hasPointerCapture(event.pointerId)) return;
    if (stacked.matches) layout.height = Math.min(Math.max((innerHeight - event.clientY) / innerHeight, 0.2), 0.8);
    else layout.width = widthAt(event.clientX);
    size();
    measure();
  });
  grip.addEventListener('lostpointercapture', () => {
    stage.classList.remove('dragging');
    apply();
  });
  grip.addEventListener('dblclick', () => {
    layout = { ...defaults, open: true };
    apply();
  });

  window.addEventListener('resize', measure);
  stacked.addEventListener('change', measure);
  apply();
  return { measure };
}
