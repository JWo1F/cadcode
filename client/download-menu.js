// The download split button, shared by the dev viewer and the playground: the main
// half saves in the format chosen last, the arrow opens a menu of formats, and picking
// one saves in it and makes it the main half's. The choice is remembered across files.
//
// Markup it expects: #download (with a [data-format-label] inside), #download-open
// (popovertarget="download-menu") and #download-menu (a popover .menu).

const STORAGE_KEY = 'cadcode:download-format';

const FORMATS = [
  { id: 'stl', label: 'STL', title: 'Download the part as STL, its solids merged into one body' },
  { id: '3mf', label: '3MF', title: 'Download the part as 3MF, its solids and colors kept apart' },
  { id: 'png', label: 'PNG', title: 'Save the current view as PNG' },
];

/**
 * @param {Record<'stl' | '3mf' | 'png', () => Promise<void> | void>} savers
 *   Each does its download and shows its own errors.
 */
export function bindDownloadMenu(savers) {
  const formats = FORMATS.map((format) => ({ ...format, save: savers[format.id] }));
  const main = document.getElementById('download');
  const open = document.getElementById('download-open');
  const menu = document.getElementById('download-menu');
  const formatLabel = main.querySelector('[data-format-label]');

  let current = formats.find((f) => f.id === remembered()) ?? formats[0];

  const items = formats.map((format) => {
    const item = Object.assign(document.createElement('button'), { type: 'button', textContent: format.label, title: format.title });
    item.setAttribute('role', 'menuitemradio');
    item.addEventListener('click', () => {
      menu.hidePopover();
      choose(format);
      save();
    });
    return item;
  });
  menu.replaceChildren(...items);

  function choose(format) {
    current = format;
    formatLabel.textContent = format.label;
    main.title = format.title;
    items.forEach((item, i) => item.setAttribute('aria-checked', String(formats[i] === format)));
    try {
      localStorage.setItem(STORAGE_KEY, format.id);
    } catch {
      // Private windows may refuse storage; the choice then lasts until the page reloads.
    }
  }

  async function save() {
    main.disabled = open.disabled = true;
    try {
      await current.save();
    } finally {
      main.disabled = open.disabled = false;
    }
  }

  choose(current);
  main.addEventListener('click', save);

  // Under the button when there is room, above it otherwise (the playground's is at the
  // bottom); lined up with the side of the screen the button is on.
  menu.addEventListener('toggle', (event) => {
    open.setAttribute('aria-expanded', String(event.newState === 'open'));
    if (event.newState !== 'open') return;
    const group = main.parentElement.getBoundingClientRect();
    const height = menu.offsetHeight;
    const below = group.bottom + 8 + height <= window.innerHeight;
    menu.style.top = `${below ? group.bottom + 8 : group.top - 8 - height}px`;
    const onRight = group.left + group.width / 2 > window.innerWidth / 2;
    menu.style.left = `${onRight ? group.right - menu.offsetWidth : group.left}px`;
    items[formats.indexOf(current)].focus();
  });

  // Arrows move through the menu; Escape closes it (the popover's own).
  menu.addEventListener('keydown', (event) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    items[(items.indexOf(document.activeElement) + step + items.length) % items.length]?.focus();
  });
}

function remembered() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
