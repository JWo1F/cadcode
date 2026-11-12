// The arithmetic of the section plane and the measurement, apart from three.js and
// the DOM so it can be tested on its own. Points are [x, y, z] arrays; a box is
// { min, max } of them.

const INDEX = { x: 0, y: 1, z: 2 };
// The two axes the section frame spans, for each axis it is cut across.
const SPANS = { x: ['y', 'z'], y: ['x', 'z'], z: ['x', 'y'] };

/** The distance in pixels from (px, py) to the screen segment from a to b. */
export function distanceToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * The corners of the section frame, in order around it: the box's extent across the
 * axis, grown by a margin, at `offset` along it.
 * @param {{ min: number[], max: number[] }} box
 * @param {'x' | 'y' | 'z'} axis
 * @param {number} offset
 * @returns {number[][]}
 */
export function frameCorners(box, axis, offset) {
  const [u, v] = SPANS[axis].map((name) => INDEX[name]);
  const size = box.max.map((hi, i) => hi - box.min[i]);
  const margin = Math.max(...size) * 0.08 + 0.5;
  const lo = box.min.map((value) => value - margin);
  const hi = box.max.map((value) => value + margin);
  const corner = (cu, cv) => {
    const point = [0, 0, 0];
    point[INDEX[axis]] = offset;
    point[u] = cu;
    point[v] = cv;
    return point;
  };
  return [corner(lo[u], lo[v]), corner(hi[u], lo[v]), corner(hi[u], hi[v]), corner(lo[u], hi[v])];
}

/**
 * Where the section plane goes on a model spanning lo to hi along its axis: where it
 * was, or the middle when it was nowhere yet or is outside the model (another part,
 * or a smaller one).
 * @param {number | null} offset
 */
export function sectionOffset(offset, lo, hi) {
  return offset === null || offset < lo || offset > hi ? (lo + hi) / 2 : offset;
}
