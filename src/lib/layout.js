// Laying parts out for printing: spreading several over the bed, so a `print` part needs no
// hand-placed translates. Turning one onto the side it prints on is Solid.layFlat().

import { Solid } from './shapes.js';

/** @typedef {Solid | null | undefined | false | ArrangeItems[]} ArrangeItems A part: a solid, or solids in nested arrays that move together. */

/**
 * Solids in a part, flattened, with falsy entries dropped.
 * @param {ArrangeItems} item
 * @returns {Solid[]}
 */
function solidsOf(item) {
  if (Array.isArray(item)) return item.flatMap(solidsOf);
  if (!item) return [];
  if (!(item instanceof Solid)) throw new Error('arrange(): every part must be a solid or an array of solids');
  return [item];
}

/** Moves every solid in a part, keeping its nesting. @param {ArrangeItems} item @param {number[]} v @returns {ArrangeItems} */
function moved(item, v) {
  if (Array.isArray(item)) return item.map((i) => moved(i, v));
  return item ? item.translate(v) : item;
}

/**
 * Spreads parts over the bed for printing: in a row along +X, or in rows of `columns` stacked along +Y,
 * `gap` apart by their bounding boxes, each centered across its row, the whole layout centered on the
 * origin. Heights are kept, so lay the parts flat first. A part may be an array of solids, such as a
 * part in two colors; they move together.
 * @param {ArrangeItems[]} parts
 * @param {{ gap?: number, columns?: number }} [options]
 * @returns {ArrangeItems[]} the parts moved, in the same order and nesting
 */
export function arrange(parts, options = {}) {
  const { gap = 5, columns = Infinity } = options;
  if (!(typeof gap === 'number' && gap >= 0)) throw new Error(`arrange(): gap must be 0 or more, got ${gap}`);
  if (!(columns === Infinity || (Number.isInteger(columns) && columns > 0))) throw new Error(`arrange(): columns must be a whole number more than 0, got ${columns}`);
  const boxes = parts.map((part) => {
    const solids = solidsOf(part);
    if (solids.length === 0) return null;
    const all = solids.map((s) => s.bounds());
    return {
      min: [0, 1].map((k) => Math.min(...all.map((b) => b.min[k]))),
      max: [0, 1].map((k) => Math.max(...all.map((b) => b.max[k]))),
    };
  });
  // Rows of parts, left to right; each row as deep as its deepest part.
  /** @type {number[][]} */
  const rows = [];
  boxes.forEach((box, i) => {
    if (!box) return;
    if (rows.length === 0 || rows[rows.length - 1].length >= columns) rows.push([]);
    rows[rows.length - 1].push(i);
  });
  /** @type {number[][]} */
  const offsets = parts.map(() => [0, 0, 0]);
  let y = 0;
  let width = 0;
  for (const row of rows) {
    const depth = Math.max(...row.map((i) => boxes[i].max[1] - boxes[i].min[1]));
    let x = 0;
    for (const i of row) {
      const { min, max } = boxes[i];
      offsets[i] = [x - min[0], y + (depth - (max[1] - min[1])) / 2 - min[1], 0];
      x += max[0] - min[0] + gap;
    }
    width = Math.max(width, x - gap);
    y += depth + gap;
  }
  const depth = y - gap;
  return parts.map((part, i) => moved(part, [offsets[i][0] - width / 2, offsets[i][1] - depth / 2, 0]));
}
