/**
 * Keyboard moves through a popover menu's items: the arrows to the next or previous
 * one, round the ends, Home and End to the first and last. Escape is the popover's own.
 * @param {HTMLElement} menu
 * @param {() => HTMLElement[]} items read at each key press, for menus that are rebuilt
 */
export function bindMenuKeys(menu, items) {
  menu.addEventListener('keydown', (event) => {
    const list = items();
    const at = list.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: list.length - 1 }[event.key];
    if (next === undefined || list.length === 0) return;
    event.preventDefault();
    list[(next + list.length) % list.length].focus();
  });
}
