// Solids built ring by ring from a 2D profile: sweep along a path, loft between sections,
// and the helix that springs and threads follow.
import { Manifold, Mesh, Solid, segmentsFor, triangulate } from './shapes.js';

/** @typedef {import('./shapes.js').Vec2} Vec2 */
/** @typedef {import('./shapes.js').Vec3} Vec3 */

const EPS = 1e-9;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a) => Math.hypot(a[0], a[1], a[2]);
const normalize = (a) => mul(a, 1 / length(a));

/** `v` turned by `angle` radians around the unit `axis` (Rodrigues). */
function turn(v, axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(add(mul(v, c), mul(cross(axis, v), s)), mul(axis, dot(axis, v) * (1 - c)));
}

/** `v` turned by the smallest rotation that takes unit `from` onto unit `to`. */
function turnBetween(v, from, to) {
  const axis = cross(from, to);
  const sin = length(axis);
  const cos = dot(from, to);
  if (sin < EPS) return cos > 0 ? v : turn(v, perpendicular(from), Math.PI);
  return turn(v, mul(axis, 1 / sin), Math.atan2(sin, cos));
}

/** Any unit vector at a right angle to unit `v`. */
function perpendicular(v) {
  const other = Math.abs(v[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return normalize(cross(v, other));
}

/**
 * A closed solid from rings of the same profile. `polygons` are the profile's loops
 * (counterclockwise outlines, clockwise holes); `place(ring, x, y)` puts profile point
 * (x, y) of ring `ring` in space. Consecutive rings are joined by quads; a closed tube
 * also joins the last ring to the first, an open one gets the profile as caps.
 * The winding is checked on the result, so `place` may run the rings either way.
 * @param {Vec2[][]} polygons
 * @param {number} rings
 * @param {(ring: number, x: number, y: number) => Vec3} place
 * @param {boolean} closed
 * @param {string} what names the operation in errors
 * @returns {Solid}
 */
export function tube(polygons, rings, place, closed, what) {
  const starts = [];
  let perRing = 0;
  for (const poly of polygons) {
    starts.push(perRing);
    perRing += poly.length;
  }
  const positions = new Float32Array(rings * perRing * 3);
  for (let r = 0; r < rings; r++) {
    let k = (r * perRing) * 3;
    for (const poly of polygons) {
      for (const [x, y] of poly) {
        const p = place(r, x, y);
        positions[k++] = p[0];
        positions[k++] = p[1];
        positions[k++] = p[2];
      }
    }
  }
  const triangles = [];
  const spans = closed ? rings : rings - 1;
  for (let r = 0; r < spans; r++) {
    const a = r * perRing;
    const b = ((r + 1) % rings) * perRing;
    polygons.forEach((poly, p) => {
      const n = poly.length;
      for (let j = 0; j < n; j++) {
        const i0 = starts[p] + j;
        const i1 = starts[p] + ((j + 1) % n);
        triangles.push(a + i0, a + i1, b + i1, a + i0, b + i1, b + i0);
      }
    });
  }
  if (!closed) {
    const last = (rings - 1) * perRing;
    for (const [i, j, k] of triangulate(polygons)) triangles.push(i, k, j, last + i, last + j, last + k);
  }
  let manifold = manifoldOf(positions, triangles, what);
  if (manifold.volume() < 0) {
    for (let t = 0; t < triangles.length; t += 3) [triangles[t + 1], triangles[t + 2]] = [triangles[t + 2], triangles[t + 1]];
    manifold = manifoldOf(positions, triangles, what);
  }
  return new Solid(manifold);
}

function manifoldOf(positions, triangles, what) {
  const mesh = new Mesh({ numProp: 3, vertProperties: positions, triVerts: new Uint32Array(triangles) });
  mesh.merge();
  const manifold = new Manifold(mesh);
  if (manifold.status() !== 'NoError') throw new Error(`${what}: the result is not a closed solid (${manifold.status()})`);
  return manifold;
}

/**
 * The path's points as 3D vectors, without repeats; a closed path also drops a last point equal to its first.
 * @param {number[][]} path
 * @param {boolean} closed
 * @returns {Vec3[]}
 */
function pathPoints(path, closed) {
  if (!Array.isArray(path)) throw new Error('sweep(): the path is an array of [x, y, z] points');
  /** @type {Vec3[]} */
  const points = [];
  for (const p of path) {
    const v = /** @type {Vec3} */ ([p[0] ?? 0, p[1] ?? 0, p[2] ?? 0]);
    if (points.length === 0 || length(sub(v, points[points.length - 1])) > EPS) points.push(v);
  }
  if (closed && points.length > 1 && length(sub(points[0], points[points.length - 1])) < EPS) points.pop();
  const needed = closed ? 3 : 2;
  if (points.length < needed) throw new Error(`sweep(): a${closed ? ' closed' : 'n open'} path needs at least ${needed} distinct points`);
  return points;
}

/**
 * Where the profile goes at each path point: the point, the tangent, the profile's X and Y
 * axes, and how much a corner stretches the profile (`bend` direction, `stretch` factor).
 * @param {Vec3[]} points
 * @param {boolean} closed
 * @param {number[] | undefined} up
 */
function frames(points, closed, up) {
  const n = points.length;
  const segments = closed ? n : n - 1;
  const dirs = [];
  for (let i = 0; i < segments; i++) dirs.push(normalize(sub(points[(i + 1) % n], points[i])));

  const out = [];
  for (let i = 0; i < n; i++) {
    const before = closed ? dirs[(i - 1 + n) % n] : dirs[i - 1];
    const after = closed ? dirs[i] : dirs[i];
    const incoming = before ?? after;
    const outgoing = after ?? before;
    const sum = add(incoming, outgoing);
    if (length(sum) < 1e-6) throw new Error(`sweep(): the path turns straight back on itself at point ${i}`);
    const tangent = normalize(sum);
    const turnDir = sub(outgoing, incoming);
    const bendLength = length(turnDir);
    // At a corner the profile sits in the plane that halves the angle; stretching it across the
    // bend by 1 / cos(half the angle) keeps the tube its full width on both sides.
    const bend = bendLength > 1e-9 ? mul(turnDir, 1 / bendLength) : null;
    const stretch = 1 / dot(incoming, tangent);
    out.push({ point: points[i], tangent, bend, stretch, x: [0, 0, 0], y: [0, 0, 0] });
  }

  if (up) {
    const u = normalize([up[0] ?? 0, up[1] ?? 0, up[2] ?? 0]);
    out.forEach((f, i) => {
      const along = sub(u, mul(f.tangent, dot(u, f.tangent)));
      if (length(along) < 1e-6) throw new Error(`sweep(): \`up\` is parallel to the path at point ${i}`);
      f.y = normalize(along);
      f.x = cross(f.y, f.tangent);
    });
    return out;
  }

  // Rotation-minimizing frames: the profile starts as it lies in XY, turned so +Z meets the
  // first tangent, then is carried along with the least turning, so it does not twist.
  let x = turnBetween([1, 0, 0], [0, 0, 1], out[0].tangent);
  for (let i = 0; i < n; i++) {
    if (i > 0) x = normalize(turnBetween(x, out[i - 1].tangent, out[i].tangent));
    out[i].x = x;
    out[i].y = cross(out[i].tangent, x);
  }
  if (closed) {
    // Around a loop the carried frame comes back turned; spread that turn evenly so the ends meet.
    const back = turnBetween(out[n - 1].x, out[n - 1].tangent, out[0].tangent);
    const angle = Math.atan2(dot(cross(out[0].x, back), out[0].tangent), dot(out[0].x, back));
    out.forEach((f, i) => {
      f.x = turn(f.x, f.tangent, (-angle * i) / n);
      f.y = cross(f.tangent, f.x);
    });
  }
  return out;
}

/**
 * @typedef {object} SweepOptions
 * @property {boolean} [closed] The path is a loop: its last point joins its first, and the solid has no ends.
 * @property {number} [twist] Degrees the profile turns, counterclockwise, from the start of the path to its end.
 * @property {number | number[]} [scale] Size of the profile at the end relative to the start, a number or `[x, y]`.
 * @property {number[]} [up] Keep the profile's +Y toward this direction instead of carrying it along with the least turning.
 */

/**
 * @internal The work behind Shape2.sweep.
 * @param {Vec2[][]} polygons
 * @param {number[][]} path
 * @param {SweepOptions} options
 * @returns {Solid}
 */
export function sweepPolygons(polygons, path, options = {}) {
  const { closed = false, twist = 0, scale = 1, up } = options;
  if (polygons.length === 0) return new Solid(new Manifold());
  const [sx, sy] = typeof scale === 'number' ? [scale, scale] : [scale[0] ?? 1, scale[1] ?? 1];
  if (closed && (sx !== 1 || sy !== 1)) throw new Error('sweep(): a closed path cannot scale the profile, its ends would not meet');
  if (closed && Math.abs(twist % 360) > 1e-9) throw new Error('sweep(): on a closed path `twist` must be a whole number of turns (a multiple of 360), or the ends would not meet');
  const points = pathPoints(path, closed);
  const placed = frames(points, closed, up);

  const along = [0];
  for (let i = 1; i < points.length; i++) along.push(along[i - 1] + length(sub(points[i], points[i - 1])));
  const total = closed ? along[along.length - 1] + length(sub(points[0], points[points.length - 1])) : along[along.length - 1];

  const shape = placed.map((f, i) => {
    const t = along[i] / total;
    const a = (twist * t * Math.PI) / 180;
    return { f, cos: Math.cos(a), sin: Math.sin(a), kx: 1 + (sx - 1) * t, ky: 1 + (sy - 1) * t };
  });
  const place = (ring, px, py) => {
    const { f, cos, sin, kx, ky } = shape[ring];
    const x = px * kx;
    const y = py * ky;
    let offset = add(mul(f.x, x * cos - y * sin), mul(f.y, x * sin + y * cos));
    if (f.bend) offset = add(offset, mul(f.bend, dot(offset, f.bend) * (f.stretch - 1)));
    return add(f.point, offset);
  };
  return tube(polygons, points.length, place, closed, 'sweep()');
}

/**
 * Points along a helix around the Z axis, starting at `[r, 0, 0]` and rising along +Z:
 * a path for `.sweep()`, for springs and coils.
 * @param {{ r?: number, d?: number, pitch: number, turns?: number, height?: number, leftHand?: boolean, fn?: number }} options
 *   `pitch` is the rise per turn; give `turns` or `height`. A right-hand helix turns counterclockwise seen from above.
 *   `fn` is the number of points per turn; without it the `setResolution` defaults apply.
 * @returns {Vec3[]}
 */
export function helix(options) {
  const { pitch, leftHand = false, fn } = options ?? {};
  const r = options?.r ?? (options?.d !== undefined ? options.d / 2 : undefined);
  if (!(r > 0)) throw new Error('helix(): give a radius `r` or a diameter `d`');
  if (!(pitch > 0)) throw new Error('helix(): `pitch`, the rise per turn, must be positive');
  const turns = options.turns ?? (options.height !== undefined ? options.height / pitch : undefined);
  if (!(turns > 0)) throw new Error('helix(): give `turns` or `height`');
  const perTurn = segmentsFor(r, fn);
  const steps = Math.max(1, Math.ceil(turns * perTurn));
  const sign = leftHand ? -1 : 1;
  /** @type {Vec3[]} */
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = (turns * i) / steps;
    const a = 2 * Math.PI * t;
    points.push([r * Math.cos(a), sign * r * Math.sin(a), pitch * t]);
  }
  return points;
}
