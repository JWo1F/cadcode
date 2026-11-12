// The parts of the page that the dev viewer and the playground share: the error and
// log boxes, the readout, and the part pill. Each takes the elements it fills; the
// markup is in client/index.html and site/playground.html.
import { formatMm } from './format.js';
import { bindMenuKeys } from './menu-keys.js';

/** The error box (`error`, its text in `text`): a message shows it, '' hides it. */
export function showError({ error, text }, message) {
  text.textContent = message;
  error.hidden = !message;
}

/** The program's console output, a line per entry, each classed by its level. */
export function showLogs(element, logs = []) {
  element.replaceChildren(
    ...logs.map(({ level, text }) => {
      const line = document.createElement('div');
      line.className = `log-${level}`;
      line.textContent = text;
      return line;
    }),
  );
  element.hidden = logs.length === 0;
}

/**
 * Fills the readout: the model's overall size, large, then its mesh and, when there is
 * a `time` element, how long the program took.
 * @param {{ size: HTMLElement, mesh: HTMLElement, time?: HTMLElement }} readout
 * @param {{ triangles: number, size: number[] | null }} model
 * @param {number} [ms]
 */
export function showReadout(readout, { triangles, size }, ms) {
  readout.size.replaceChildren(size ? size.map(formatMm).join(' × ') : 'Empty');
  if (size) readout.size.append(Object.assign(document.createElement('small'), { textContent: 'mm' }));
  readout.mesh.textContent = `${triangles.toLocaleString()} triangles`;
  if (readout.time) readout.time.textContent = `${ms.toLocaleString()} ms`;
}

/**
 * A pill naming the part on screen; it opens a menu of the program's parts. A
 * program with one part has no pill. Choosing another part calls `onChoose`.
 * @param {{ open: HTMLElement, menu: HTMLElement, title: HTMLElement, onChoose: (name: string) => void }} elements
 */
export function createPartPill({ open, menu, title, onChoose }) {
  let current = '';

  function show(names, part) {
    current = part;
    title.textContent = part;
    menu.replaceChildren(
      ...names.map((name) => {
        const item = Object.assign(document.createElement('button'), { type: 'button', textContent: name });
        item.setAttribute('role', 'menuitemradio');
        item.setAttribute('aria-checked', String(name === part));
        item.addEventListener('click', () => choose(name));
        return item;
      }),
    );
    open.hidden = names.length < 2;
  }

  function choose(name) {
    menu.hidePopover();
    if (name === current) return;
    current = name;
    onChoose(name);
  }

  menu.addEventListener('toggle', (event) => {
    open.setAttribute('aria-expanded', String(event.newState === 'open'));
    if (event.newState !== 'open') return;
    const box = open.getBoundingClientRect();
    menu.style.left = `${box.left}px`;
    menu.style.top = `${box.bottom + 8}px`;
    const items = [...menu.children];
    (items.find((item) => item.getAttribute('aria-checked') === 'true') ?? items[0])?.focus();
  });
  bindMenuKeys(menu, () => /** @type {HTMLElement[]} */ ([...menu.children]));

  return {
    show,
    /** The part on screen, or the one chosen since. */
    get current() {
      return current;
    },
  };
}
