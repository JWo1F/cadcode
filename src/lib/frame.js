// Frames: planes in space to draw 2D shapes on and extrude them from, so a cut in a side wall
// needs no rotate().translate() chain. A frame maps local [u, v, w] to the world: u and v lie
// in the plane, w runs along its normal.

/** @typedef {[number, number, number]} Vec3 */

const AXES = /** @type {const} */ (['X', 'Y', 'Z']);

/** How far `extrude(..., { through })` reaches past an end, so a cut leaves no skin. */
const THROUGH = 1;

/**
 * @typedef {object} FrameExtrudeOptions
 * @property {boolean | 'start'} [through] `true` reaches 1 past both ends, so a cut goes clean through the
 *   faces it starts and ends on; `'start'` reaches 1 back past the frame's plane only: a pocket cut into a
 *   face, or a boss that sinks into the part it stands on
 * @property {boolean} [center] centered on the frame's plane, `depth` thick in all; not with `through: 'start'`
 */

/**
 * A plane in space with its own 2D coordinates: `face()`, `plane.XZ` and `frameAt()` make one.
 * Every method returns something new; a frame never changes.
 */
export class Frame {
  /**
   * @internal
   * @param {number[]} matrix column-major 4x4, local [u, v, w] to world
   */
  constructor(matrix) {
    this.matrix = matrix;
  }

  /** Where local [0, 0, 0] lies. @returns {Vec3} */
  get origin() {
    const m = this.matrix;
    return [m[12], m[13], m[14]];
  }

  /** The direction positive depths go, a unit vector. @returns {Vec3} */
  get normal() {
    const m = this.matrix;
    return [m[8], m[9], m[10]];
  }

  /**
   * The same plane moved `distance` along its normal.
   * @param {number} distance
   * @returns {Frame}
   */
  offset(distance) {
    const m = [...this.matrix];
    for (let k = 0; k < 3; k++) m[12 + k] += m[8 + k] * distance;
    return new Frame(m);
  }

  /**
   * Extrudes a 2D shape drawn in the frame's coordinates. A positive `depth` goes along the normal
   * (out of a face), a negative one against it (into the part); `{ center: true }` puts the frame's
   * plane in the middle.
   * @param {import('./shapes.js').Shape2} shape
   * @param {number} depth
   * @param {FrameExtrudeOptions} [options]
   * @returns {import('./shapes.js').Solid}
   */
  extrude(shape, depth, options = {}) {
    if (!(typeof depth === 'number' && depth !== 0)) throw new Error(`Frame.extrude(): depth must be a number other than 0, got ${depth}`);
    const { through = false, center = false } = options;
    if (![true, false, 'start'].includes(through)) throw new Error(`Frame.extrude(): through must be true, false or 'start', got ${JSON.stringify(through)}`);
    if (center && through === 'start') throw new Error("Frame.extrude(): a centered extrusion has no start to reach past; use through: true");
    // [from, to] along the normal, before reaching past the ends; `start` is the end on the plane.
    let [from, to] = center ? [-Math.abs(depth) / 2, Math.abs(depth) / 2] : [Math.min(0, depth), Math.max(0, depth)];
    if (through === true) [from, to] = [from - THROUGH, to + THROUGH];
    if (through === 'start') [from, to] = depth < 0 ? [from, to + THROUGH] : [from - THROUGH, to];
    return shape.extrude(to - from).translate([0, 0, from]).transform(this.matrix);
  }

  /**
   * Moves a solid or point built around the origin onto the frame: its X and Y go to the frame's
   * u and v, its Z along the normal.
   * @template {import('./shapes.js').Solid | import('./shapes.js').Point} T
   * @param {T} item
   * @returns {T}
   */
  place(item) {
    return /** @type {T} */ (item.transform(this.matrix));
  }
}

/** A frame whose u and v are two world axes, at `at` along the third. */
function axisFrame(axis, sign, at) {
  const n = AXES.indexOf(axis);
  const [a, b] = [0, 1, 2].filter((k) => k !== n);
  const unit = (k, s = 1) => [0, 1, 2].map((i) => (i === k ? s : 0));
  const origin = unit(n, at);
  return new Frame([...unit(a), 0, ...unit(b), 0, ...unit(n, sign), 0, ...origin, 1]);
}

/**
 * @internal The frame on a face of a bounding box: `'+X'` is the side at the largest X, its normal
 * pointing out. Local u and v are the other two world axes in order (Y and Z on an X face, X and Z
 * on a Y face, X and Y on a Z face), so positions in it are world coordinates.
 * @param {string} name
 * @param {{ min: number[], max: number[] }} bounds
 * @returns {Frame}
 */
export function faceFrame(name, bounds) {
  const match = /^([+-])([XYZ])$/.exec(name);
  if (!match) throw new Error(`face(): name must be one of +X, -X, +Y, -Y, +Z, -Z, got ${JSON.stringify(name)}`);
  const [, sign, axis] = match;
  const k = AXES.indexOf(/** @type {'X' | 'Y' | 'Z'} */ (axis));
  return axisFrame(axis, sign === '+' ? 1 : -1, sign === '+' ? bounds.max[k] : bounds.min[k]);
}

/**
 * The three planes through the origin. Local u and v are world coordinates: `plane.XZ` has u = X,
 * v = Z and its normal along +Y. Move one with `.offset(d)`.
 */
export const plane = Object.freeze({
  /** u = X, v = Y, normal +Z. */
  XY: axisFrame('Z', 1, 0),
  /** u = X, v = Z, normal +Y. */
  XZ: axisFrame('Y', 1, 0),
  /** u = Y, v = Z, normal +X. */
  YZ: axisFrame('X', 1, 0),
});

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scaled = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => scaled(a, 1 / Math.hypot(...a));

/**
 * A frame at a point with the given normal, such as on a curved surface. Local v points as close to
 * world +Z as the plane allows (to +Y when the normal is vertical), and u = v × normal, so the frame
 * is seen the right way round from the side the normal points to.
 * @param {number[] | import('./shapes.js').Point} origin
 * @param {number[]} normal
 * @returns {Frame}
 */
export function frameAt(origin, normal) {
  const o = Array.isArray(origin) ? [origin[0] ?? 0, origin[1] ?? 0, origin[2] ?? 0] : origin.toArray();
  const raw = [normal[0] ?? 0, normal[1] ?? 0, normal[2] ?? 0];
  if (Math.hypot(...raw) < 1e-12) throw new Error('frameAt(): the normal must not be [0, 0, 0]');
  const n = unit(raw);
  const up = Math.abs(n[2]) > 0.999 ? [0, 1, 0] : [0, 0, 1];
  const v = unit(sub(up, scaled(n, dot(up, n))));
  const u = cross(v, n);
  return new Frame([...u, 0, ...v, 0, ...n, 0, ...o, 1]);
}
