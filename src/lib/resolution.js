/** @typedef {[number, number]} Vec2 */

// Resolution of curved primitives — the same rules as OpenSCAD's $fn/$fa/$fs.

/** @internal Read by text() for its curves. */
export const resolution = { fn: 0, fa: 12, fs: 2 };

/**
 * Sets the default number of segments for circles, cylinders and spheres, like OpenSCAD's `$fn`, `$fa` and `$fs`.
 * @param {{ fn?: number, fa?: number, fs?: number }} options
 */
export function setResolution(options) {
  Object.assign(resolution, options);
}

/** @internal Segments for a full circle of radius `r`, by the `fn`/`fa`/`fs` rules; the importers use it for arcs. */
export function segmentsFor(r, fn) {
  const f = fn ?? resolution.fn;
  if (r < 1e-9) return 3;
  if (f > 0) return Math.max(Math.round(f), 3);
  return Math.ceil(Math.max(Math.min(360 / resolution.fa, (r * 2 * Math.PI) / resolution.fs), 5));
}

/**
 * @internal Points on the circle of radius `r` around `center`, from the angle `from` turning `turn`
 * radians (counter-clockwise when positive), both ends included, with as many segments as that
 * share of a full circle gets.
 * @param {number[]} center @param {number} r @param {number} from @param {number} turn @param {number | undefined} fn
 * @returns {Vec2[]}
 */
export function arcPoints(center, r, from, turn, fn) {
  const steps = Math.max(1, Math.ceil((segmentsFor(r, fn) * Math.abs(turn)) / (2 * Math.PI)));
  return Array.from({ length: steps + 1 }, (_, k) => {
    const t = from + (turn * k) / steps;
    return /** @type {Vec2} */ ([center[0] + r * Math.cos(t), center[1] + r * Math.sin(t)]);
  });
}

/**
 * @internal The short way round the circle around `center` from `a` to `b`, as `arcPoints`: the
 * round of a corner, between the points where it touches the two sides.
 * @param {number[]} center @param {number} r @param {number[]} a @param {number[]} b @param {number | undefined} fn
 */
export function shortArc(center, r, a, b, fn) {
  const from = Math.atan2(a[1] - center[1], a[0] - center[0]);
  let turn = Math.atan2(b[1] - center[1], b[0] - center[0]) - from;
  if (turn > Math.PI) turn -= 2 * Math.PI;
  if (turn < -Math.PI) turn += 2 * Math.PI;
  return arcPoints(center, r, from, turn, fn);
}
