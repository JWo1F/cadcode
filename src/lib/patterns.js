// Patterns: copies of a shape in a grid or around a circle, unioned. A grid can fill a region by
// itself, so vents and pegboards need no count-and-center arithmetic.

import { Solid, Shape2, union } from './shapes.js';

/** @typedef {Solid | Shape2} Patterned */

/**
 * @typedef {object} GridOptions
 * @property {number | [number, number]} pitch distance between neighbours' centers, the same both ways or `[x, y]`
 * @property {import('./shapes.js').Shape2} [within] a region to fill: as many copies as fit wholly inside
 *   it, the grid centered on its bounding box
 * @property {number | [number, number]} [count] copies along X and Y when there is no region, centered on the origin
 * @property {boolean} [stagger] every other row shifted half a pitch along X, for a honeycomb
 */

const pair = (v) => (typeof v === 'number' ? [v, v] : [v[0], v[1]]);

/** The footprint of a shape on XY, to test whether a copy fits a region. @param {Patterned} shape */
const footprint = (shape) => (shape instanceof Solid ? shape.project() : shape);

/**
 * Copies of a shape on a grid in XY, unioned. With `within`, the copies fill a region: as many as fit
 * wholly inside it, the grid centered on it, so a vent is `grid(circle({ d: 1.6 }), { pitch: 3.2, within: panel })`.
 * Without it, `count` copies centered on the origin. The shape is copied as drawn around the origin.
 * @template {Patterned} T
 * @param {T} shape
 * @param {GridOptions} options
 * @returns {T}
 */
export function grid(shape, options) {
  if (!(shape instanceof Solid || shape instanceof Shape2)) throw new Error('grid(): the shape must be a solid or a 2D shape');
  const { within, count, stagger = false } = options ?? {};
  if (options?.pitch === undefined) throw new Error('grid(): give a pitch');
  const pitch = pair(options.pitch);
  if (!pitch.every((p) => typeof p === 'number' && p > 0)) throw new Error(`grid(): pitch must be more than 0, got ${JSON.stringify(options.pitch)}`);
  if ((within === undefined) === (count === undefined)) throw new Error('grid(): give either within (a region to fill) or count');

  const foot = footprint(shape);
  /** @type {number[][]} */
  let centers;
  if (within) {
    if (!(within instanceof Shape2)) throw new Error('grid(): within must be a 2D shape');
    // The grid fits the region's box with room for the shape's own size, then keeps the copies inside the region.
    const region = within.bounds();
    const own = foot.bounds();
    const size = [0, 1].map((k) => own.max[k] - own.min[k]);
    const n = [0, 1].map((k) => Math.max(0, Math.floor((region.max[k] - region.min[k] - size[k]) / pitch[k] + 1e-9) + 1));
    const middle = [0, 1].map((k) => (region.min[k] + region.max[k]) / 2 - (own.min[k] + own.max[k]) / 2);
    centers = lattice(n, pitch, stagger).map(([x, y]) => [x + middle[0], y + middle[1]]);
    const area = foot.area();
    centers = centers.filter((c) => {
      const copy = foot.translate(c);
      return copy.intersect(within).area() > area - Math.max(1e-6, area * 1e-6);
    });
  } else {
    const n = pair(count);
    if (!n.every((v) => Number.isInteger(v) && v > 0)) throw new Error(`grid(): count must be whole numbers more than 0, got ${JSON.stringify(count)}`);
    centers = lattice(n, pitch, stagger);
  }
  return /** @type {T} */ (union(centers.map((c) => shape.translate(c))));
}

/** `n[0]` by `n[1]` points `pitch` apart, centered on the origin; odd rows shifted half a pitch if staggered. */
function lattice(n, pitch, stagger) {
  const out = [];
  for (let j = 0; j < n[1]; j++) {
    const shift = stagger && j % 2 ? pitch[0] / 2 : 0;
    // A shifted row keeps one copy fewer, so it stays inside the unshifted rows' width.
    const across = stagger && j % 2 ? n[0] - 1 : n[0];
    for (let i = 0; i < across; i++) {
      out.push([(i - (n[0] - 1) / 2) * pitch[0] + shift, (j - (n[1] - 1) / 2) * pitch[1]]);
    }
  }
  return out;
}

/**
 * @typedef {object} PolarOptions
 * @property {number} count how many copies
 * @property {number} [r] how far out from the origin each copy is moved before turning, along +X
 * @property {number} [start] degrees the first copy is turned, counter-clockwise from +X
 * @property {number} [angle] the arc the copies span: 360 spreads them evenly round, anything less puts
 *   the first at `start` and the last at `start + angle`
 */

/**
 * Copies of a shape around the Z axis (the origin, for a 2D shape), unioned: knurls, spokes, bolt
 * circles. Each copy is moved out `r` along +X, then turned.
 * @template {Patterned} T
 * @param {T} shape
 * @param {PolarOptions} options
 * @returns {T}
 */
export function polar(shape, options) {
  if (!(shape instanceof Solid || shape instanceof Shape2)) throw new Error('polar(): the shape must be a solid or a 2D shape');
  const { count, r = 0, start = 0, angle = 360 } = options ?? {};
  if (!(Number.isInteger(count) && count > 0)) throw new Error(`polar(): count must be a whole number more than 0, got ${count}`);
  const full = Math.abs(Math.abs(angle) - 360) < 1e-9;
  const step = full ? angle / count : count > 1 ? angle / (count - 1) : 0;
  const out = shape.translate([r, 0]);
  return /** @type {T} */ (union(Array.from({ length: count }, (_, i) => out.rotate(start + i * step))));
}
