// Primitives: cube, cylinder, sphere and polyhedron; square, slot, circle, ellipse and polygon,
// with rounded and chamfered edges and corners.
import { CrossSection, Manifold, Mesh, Shape2, Solid, segmentsFor, shortArc, toVec3 } from './shapes.js';
import { range } from './util.js';

/** @typedef {import('./shapes.js').Vec2} Vec2 */
/** @typedef {import('./shapes.js').Vec3} Vec3 */

// 3D primitives

// Rounded and chamfered edges. `round` and `chamfer` take a size for every edge or an object
// of sizes by group of edges; edgeSpecs() turns them into one { kind, size } per group.

/** @typedef {{ kind: 'round' | 'chamfer', size: number }} EdgeSpec */

/**
 * @param {string} op
 * @param {string[]} groups the groups of edges the shape has
 * @param {unknown} round
 * @param {unknown} chamfer
 * @returns {Record<string, EdgeSpec>}
 */
function edgeSpecs(op, groups, round, chamfer) {
  /** @type {Record<string, EdgeSpec>} */
  const specs = {};
  for (const [kind, value] of /** @type {const} */ ([['round', round], ['chamfer', chamfer]])) {
    if (value === undefined) continue;
    const sizes = typeof value === 'number' ? Object.fromEntries(groups.map((g) => [g, value])) : value;
    if (!sizes || typeof sizes !== 'object') throw new Error(`${op}(): ${kind} must be a number or an object like { ${groups[0]}: 1 }`);
    for (const [group, size] of Object.entries(sizes)) {
      if (!groups.includes(group)) throw new Error(`${op}(): ${kind} has no edges "${group}"; the groups are ${groups.join(', ')}`);
      if (!(typeof size === 'number' && size >= 0)) throw new Error(`${op}(): ${kind} must be 0 or more, got ${JSON.stringify(size)} for ${group}`);
      if (size === 0) continue;
      if (specs[group]) throw new Error(`${op}(): give the ${group} edges round or chamfer, not both`);
      specs[group] = { kind, size };
    }
  }
  return specs;
}

/**
 * The points of a polygon with corner `i` rounded or chamfered as `specs[i]` says. An inside
 * corner gets an arc on its outside, a fillet. A rounded corner is an arc tangent to both sides; a chamfered one is cut
 * `size` back along both sides.
 * @param {string} op
 * @param {Vec2[]} points
 * @param {(EdgeSpec | undefined)[]} specs
 * @param {number | undefined} fn
 * @returns {Vec2[]}
 */
function cornered(op, points, specs, fn) {
  const n = points.length;
  const corners = points.map((p, i) => {
    const spec = specs[i];
    if (!spec) return { cut: 0 };
    const along = (q) => {
      const [dx, dy] = [q[0] - p[0], q[1] - p[1]];
      const len = Math.hypot(dx, dy);
      return [dx / len, dy / len];
    };
    const u = along(points[(i + n - 1) % n]);
    const v = along(points[(i + 1) % n]);
    const half = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]))) / 2;
    return { spec, u, v, half, cut: spec.kind === 'round' ? spec.size / Math.tan(half) : spec.size };
  });
  // Each side must have room for the cuts at both its ends.
  points.forEach((p, i) => {
    const q = points[(i + 1) % n];
    const room = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const [a, b] = [corners[i], corners[(i + 1) % n]];
    if (a.cut + b.cut > room + 1e-9) {
      const { kind, size } = (a.spec ?? b.spec);
      throw new Error(`${op}(): ${kind} ${size} does not fit`);
    }
  });
  /** @type {Vec2[]} */
  const out = [];
  points.forEach((p, i) => {
    const c = corners[i];
    if (!c.spec) return void out.push(p);
    const a = [p[0] + c.u[0] * c.cut, p[1] + c.u[1] * c.cut];
    const b = [p[0] + c.v[0] * c.cut, p[1] + c.v[1] * c.cut];
    if (c.spec.kind === 'chamfer') return void out.push(a, b);
    const r = c.spec.size;
    const [bx, by] = [c.u[0] + c.v[0], c.u[1] + c.v[1]];
    const bl = Math.hypot(bx, by);
    const center = [p[0] + (bx / bl) * (r / Math.sin(c.half)), p[1] + (by / bl) * (r / Math.sin(c.half))];
    out.push(...shortArc(center, r, a, b, fn));
  });
  // Cuts that meet in the middle of a side leave the same point twice.
  return out.filter((p, i) => {
    const q = out[(i + 1) % out.length];
    return Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-9;
  });
}

/**
 * @typedef {object} CubeOptions
 * @property {boolean} [center]
 * @property {number | { z?: number, top?: number, bottom?: number }} [round] radius the edges are
 *   rounded with: a number for every edge, or by group: `z` the four vertical edges, `top` and
 *   `bottom` the four around that face. The size stays the same.
 * @property {number | { z?: number, top?: number, bottom?: number }} [chamfer] how far back the edges
 *   are cut at 45°, for every edge or by group, as for `round`. A group takes round or chamfer, not both.
 * @property {number} [fn] segments of a full circle, for `round`
 */

const CUBE_EDGES = ['z', 'top', 'bottom'];

/**
 * A box with one corner at the origin, or centered with `{ center: true }`.
 * `{ round }` rounds edges and `{ chamfer }` cuts them, inside the same size: `{ round: 2 }` does
 * every edge, `{ round: { z: 3 }, chamfer: { top: 1 } }` the vertical edges and the top's.
 * @param {number | number[]} [size]
 * @param {CubeOptions} [options]
 */
export function cube(size = 1, options = {}) {
  const s = typeof size === 'number' ? [size, size, size] : toVec3(size);
  const { center = false, round, chamfer, fn } = options;
  const specs = edgeSpecs('cube', CUBE_EDGES, round, chamfer);
  if (Object.keys(specs).length === 0) return new Solid(Manifold.cube(s, center));
  const manifold = edgedCube(s, specs, fn);
  return new Solid(center ? manifold.translate(s.map((v) => -v / 2)) : manifold);
}

/**
 * The hull of horizontal slices of the box: the plan with its vertical edges rounded or cut, and
 * near the top and bottom smaller copies of it that trace the edges around those faces. Following
 * the plan's corners, a top edge's rounding or chamfer turns around a rounded vertical edge too.
 * @param {Vec3} s
 * @param {Record<string, EdgeSpec>} specs
 * @param {number | undefined} fn
 */
function edgedCube(s, specs, fn) {
  const [w, d, h] = s;
  const { z: vertical, top, bottom } = specs;
  for (const [name, ring] of [['top', top], ['bottom', bottom]]) {
    if (ring && ring.size > Math.min(w, d) / 2) throw new Error(`cube(): ${ring.kind} ${ring.size} does not fit around the ${name}`);
  }
  if ((top?.size ?? 0) + (bottom?.size ?? 0) > h) throw new Error('cube(): the top and bottom edges do not fit in the height');

  // The plan inset by `inset` on every side. Its corners shrink by as much, so a rounded corner
  // meets a rounded top in a ball, and a chamfered one a chamfered top in a three-sided facet.
  const plan = (inset) => {
    const corner = vertical && vertical.size > inset ? { kind: vertical.kind, size: vertical.size - inset } : undefined;
    const [x0, y0, x1, y1] = [inset, inset, w - inset, d - inset];
    if (x1 - x0 < 1e-9 || y1 - y0 < 1e-9) return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    return cornered('cube', [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], Array(4).fill(corner), fn);
  };

  // Slices as [height, inset], from the face inwards to where the edge's side begins.
  const ring = (spec, face, inwards) => {
    if (!spec) return [[face, 0]];
    if (spec.kind === 'chamfer') return [[face, spec.size], [face + inwards * spec.size, 0]];
    const r = spec.size;
    const steps = Math.max(1, Math.ceil(segmentsFor(r, fn) / 4));
    return range(0, steps).map((k) => {
      const t = ((Math.PI / 2) * k) / steps;
      return [face + inwards * (r - r * Math.cos(t)), r - r * Math.sin(t)];
    });
  };
  const slices = [...ring(bottom, 0, 1), ...ring(top, h, -1)];
  return Manifold.hull(slices.flatMap(([z, inset]) => plan(inset).map(([x, y]) => [x, y, z])));
}

/**
 * @typedef {object} CylinderOptions
 * @property {number} h
 * @property {number} [r]
 * @property {number} [d]
 * @property {number} [r1] bottom radius, for cones
 * @property {number} [r2] top radius, for cones
 * @property {number} [d1]
 * @property {number} [d2]
 * @property {boolean} [center]
 * @property {number | { top?: number, bottom?: number }} [round] radius the top and bottom edges
 *   are rounded with, both or each on its own. The size stays the same.
 * @property {number | { top?: number, bottom?: number }} [chamfer] how far back the top and bottom
 *   edges are cut along both faces, both or each on its own. An edge takes round or chamfer, not both.
 * @property {number} [fn]
 * @property {'x' | 'y' | 'z'} [axis] the axis it runs along, from the origin (or centered on it): `'x'` lays
 *   it along +X, as `.rotate([0, 90, 0])` would
 */

/**
 * A cylinder or cone standing on the XY plane along +Z, like OpenSCAD's cylinder(), or along `axis`.
 * `{ round }` rounds the top and bottom edges and `{ chamfer }` cuts them, inside the same size;
 * `{ chamfer: { top: 1 } }` does the top edge only.
 * @param {CylinderOptions} options
 */
export function cylinder(options) {
  const { axis = 'z', ...rest } = options;
  const turn = { x: [0, 90, 0], y: [-90, 0, 0], z: null }[axis];
  if (turn === undefined) throw new Error(`cylinder(): axis must be 'x', 'y' or 'z', got ${JSON.stringify(axis)}`);
  const upright = standingCylinder(rest);
  return turn ? upright.rotate(turn) : upright;
}

/** @param {CylinderOptions} options */
function standingCylinder(options) {
  const { h, r, d, r1, r2, d1, d2, center = false, fn, round, chamfer } = options;
  const base = r ?? (d !== undefined ? d / 2 : 1);
  const bottom = r1 ?? (d1 !== undefined ? d1 / 2 : base);
  const top = r2 ?? (d2 !== undefined ? d2 / 2 : base);
  const segments = segmentsFor(Math.max(bottom, top), fn);
  const specs = edgeSpecs('cylinder', ['top', 'bottom'], round, chamfer);
  if (Object.keys(specs).length === 0) return new Solid(Manifold.cylinder(h, bottom, top, segments, center));
  // The right half of the section, X from the axis out and Y up, revolved.
  const section = cornered('cylinder', [[0, 0], [bottom, 0], [top, h], [0, h]], [undefined, specs.bottom, specs.top, undefined], fn);
  const manifold = new CrossSection([section]).revolve(segments, 360);
  return new Solid(center ? manifold.translate([0, 0, -h / 2]) : manifold);
}

/**
 * A sphere centered on the origin. `sphere(5)` is `sphere({ r: 5 })`.
 * @param {number | { r?: number, d?: number, fn?: number }} options
 */
export function sphere(options) {
  const o = typeof options === 'number' ? { r: options } : options;
  const r = o.r ?? (o.d !== undefined ? o.d / 2 : 1);
  return new Solid(Manifold.sphere(r, segmentsFor(r, o.fn)));
}

/**
 * A solid from explicit vertices and faces, like OpenSCAD's polyhedron():
 * each face lists point indices clockwise when seen from outside.
 * @param {number[][]} points
 * @param {number[][]} faces
 */
export function polyhedron(points, faces) {
  const triVerts = [];
  for (const face of faces) {
    for (let i = 1; i + 1 < face.length; i++) triVerts.push(face[0], face[i + 1], face[i]);
  }
  const mesh = new Mesh({
    numProp: 3,
    vertProperties: new Float32Array(points.flatMap(toVec3)),
    triVerts: new Uint32Array(triVerts),
  });
  mesh.merge();
  let manifold;
  try {
    manifold = new Manifold(mesh);
  } catch (error) {
    throw new Error(`polyhedron() is not a closed solid: ${/** @type {Error} */ (error).message}`);
  }
  if (manifold.status() !== 'NoError') throw new Error(`polyhedron() is not a closed solid: ${manifold.status()}`);
  if (manifold.volume() < 0) throw new Error('polyhedron(): the faces are wound inside out; list each one clockwise seen from outside');
  return new Solid(manifold);
}

// ---------------------------------------------------------------------------
// 2D primitives

/**
 * @typedef {object} SquareOptions
 * @property {boolean} [center]
 * @property {PolygonOptions['round']} [round] corners rounded inside the same size: a radius for every
 *   corner, or by index or function as for `polygon()`; corner 0 is at the smallest x and y, then
 *   counter-clockwise
 * @property {PolygonOptions['chamfer']} [chamfer] corners cut back along both sides, as for `round`
 * @property {number} [fn] segments of a full circle, for `round`
 */

/**
 * A rectangle with one corner at the origin, or centered with `{ center: true }`.
 * `{ round: 2 }` rounds its corners and `{ chamfer: 1 }` cuts them, inside the same size.
 * @param {number | number[]} [size]
 * @param {SquareOptions} [options]
 */
export function square(size = 1, options = {}) {
  const s = typeof size === 'number' ? [size, size] : [size[0], size[1]];
  const { center = false, round, chamfer, fn } = options;
  if (round === undefined && chamfer === undefined) return new Shape2(CrossSection.square(s, center));
  const [x0, y0] = center ? [-s[0] / 2, -s[1] / 2] : [0, 0];
  const [x1, y1] = [x0 + s[0], y0 + s[1]];
  return polygon([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], { round, chamfer, fn });
}

/**
 * A slot: a stadium of `width` whose round ends are centered on `from` and `to`, as a milled slot or
 * a hole for a sliding pin. Equal points give a circle.
 * @param {number[]} from
 * @param {number[]} to
 * @param {number} width
 * @param {{ fn?: number }} [options]
 */
export function slot(from, to, width, options = {}) {
  if (!(typeof width === 'number' && width > 0)) throw new Error(`slot(): width must be more than 0, got ${width}`);
  const end = (p) => circle({ r: width / 2, fn: options.fn }).translate([p[0] ?? 0, p[1] ?? 0]);
  return end(from).hull(end(to));
}

/**
 * A circle centered on the origin. `circle(5)` is `circle({ r: 5 })`.
 * @param {number | { r?: number, d?: number, fn?: number }} options
 */
export function circle(options) {
  const o = typeof options === 'number' ? { r: options } : options;
  const r = o.r ?? (o.d !== undefined ? o.d / 2 : 1);
  return new Shape2(CrossSection.circle(r, segmentsFor(r, o.fn)));
}

/**
 * @typedef {object} PolygonOptions
 * @property {number | Record<number, number> | ((index: number, point: Vec2) => number | undefined)} [round]
 *   radius corners are rounded with: a number for every corner, `{ 2: 3 }` by index into `points`, or a
 *   function of a corner's index and point giving its radius (0 or undefined leaves it sharp)
 * @property {number | Record<number, number> | ((index: number, point: Vec2) => number | undefined)} [chamfer]
 *   how far back corners are cut along both sides, given as for `round`. A corner named by index wins over a
 *   number or function for every corner; a corner given both a round and a chamfer of the same kind throws.
 * @property {number} [fn] segments of a full circle, for `round`
 */

/**
 * An ellipse centered on the origin, its radii along X and Y: `ellipse([20, 10])` is 40 wide and 20 tall.
 * It has as many segments as a circle of its larger radius.
 * @param {number[] | { r?: number[], d?: number[], fn?: number }} options `[rx, ry]`, or `{ r: [rx, ry] }`
 *   or `{ d: [width, height] }`
 */
export function ellipse(options) {
  const o = Array.isArray(options) ? { r: options } : options ?? {};
  const r = o.r ?? (o.d ? [o.d[0] / 2, o.d[1] / 2] : undefined);
  if (!Array.isArray(r) || !(r[0] > 0 && r[1] > 0)) throw new Error(`ellipse(): give the radii as [rx, ry] or { d: [width, height] }, both more than 0, got ${JSON.stringify(options)}`);
  return new Shape2(CrossSection.circle(1, segmentsFor(Math.max(r[0], r[1]), o.fn)).scale([r[0], r[1]]));
}

/**
 * A polygon from points. With `paths`, each path is a list of point indices;
 * paths inside others become holes (even-odd fill), like OpenSCAD's polygon().
 * `{ round }` and `{ chamfer }` soften corners, all of them or some by index:
 * `polygon(pts, { round: { 1: 2 }, chamfer: { 3: 1 } })`, or by a function of the corner's index and point:
 * `{ round: (i) => (i % 2 ? 2 : 3) }`. An inside corner rounds into a fillet.
 * @param {number[][]} points
 * @param {number[][] | PolygonOptions} [paths]
 * @param {PolygonOptions} [options]
 */
export function polygon(points, paths, options) {
  if (paths && !Array.isArray(paths)) return polygon(points, undefined, paths);
  const pts = /** @type {Vec2[]} */ (points.map((p) => [p[0], p[1]]));
  const specs = cornerSpecs(pts, options?.round, options?.chamfer);
  const loops = paths ?? [pts.map((_, i) => i)];
  const contours = loops.map((path) =>
    specs.some(Boolean) ? cornered('polygon', path.map((i) => pts[i]), path.map((i) => specs[i]), options?.fn) : path.map((i) => pts[i]),
  );
  return new Shape2(new CrossSection(contours, 'EvenOdd'));
}

/**
 * @internal One spec per point from polygon()'s `round` and `chamfer`; a path's close() sizes its joins with it.
 * @param {unknown[]} points the corners, one spec each
 * @param {unknown} round
 * @param {unknown} chamfer
 * @param {string} [op] the function to name in errors
 * @param {string} [what] what a point is called in errors
 * @returns {(EdgeSpec | undefined)[]}
 */
export function cornerSpecs(points, round, chamfer, op = 'polygon()', what = 'corner') {
  const count = points.length;
  /** @type {(EdgeSpec | undefined)[]} */
  const specs = Array(count).fill(undefined);
  const given = /** @type {const} */ ([['round', round], ['chamfer', chamfer]]);
  const everyCorner = (value) => typeof value === 'number' || typeof value === 'function';
  // First what covers every corner, then corners named by index, which win over it. Two sizes at
  // the same level for one corner — a round and a chamfer — throw.
  for (const level of [true, false]) {
    const set = new Set();
    for (const [kind, value] of given) {
      if (value === undefined || everyCorner(value) !== level) continue;
      if (!level && (!value || typeof value !== 'object')) throw new Error(`${op}: ${kind} must be a number, a function of the ${what}'s index, or an object like { 0: 1 } by index`);
      const sizes =
        typeof value === 'number' ? points.map(() => value)
        : typeof value === 'function' ? points.map((p, i) => value(i, p) ?? 0)
        : null;
      const entries = sizes ? sizes.map((size, i) => [String(i), size]) : Object.entries(value);
      for (const [key, size] of entries) {
        const i = Number(key);
        if (!(Number.isInteger(i) && i >= 0 && i < count)) throw new Error(`${op}: ${kind} names ${what} ${key}, but the ${what}s are 0 to ${count - 1}`);
        if (!(typeof size === 'number' && size >= 0)) throw new Error(`${op}: ${kind} must be 0 or more, got ${JSON.stringify(size)} for ${what} ${i}`);
        if (level && size === 0) continue;
        if (set.has(i)) throw new Error(`${op}: give ${what} ${i} round or chamfer, not both`);
        set.add(i);
        specs[i] = size === 0 ? undefined : { kind, size };
      }
    }
  }
  return specs;
}
