import Module from 'manifold-3d';
import { parseColor } from './colors.js';

/** @typedef {import('./colors.js').ColorInput} ColorInput */
/** @typedef {import('./colors.js').RGBA} RGBA */
/** @typedef {[number, number]} Vec2 */
/** @typedef {[number, number, number]} Vec3 */
/**
 * Nested arrays of shapes, as produced by loops. Falsy entries are skipped, so `cond && shape` works.
 * @template T
 * @typedef {T | null | undefined | false | Items<T>[]} Items
 */

const wasm = await Module();
wasm.setup();
const { Manifold, CrossSection, Mesh } = wasm;

// ---------------------------------------------------------------------------
// Resolution of curved primitives — the same rules as OpenSCAD's $fn/$fa/$fs.

const resolution = { fn: 0, fa: 12, fs: 2 };

/**
 * Sets the default number of segments for circles, cylinders and spheres, like OpenSCAD's `$fn`, `$fa` and `$fs`.
 * @param {{ fn?: number, fa?: number, fs?: number }} options
 */
export function setResolution(options) {
  Object.assign(resolution, options);
}

function segmentsFor(r, fn) {
  const f = fn ?? resolution.fn;
  if (r < 1e-9) return 3;
  if (f > 0) return Math.max(Math.round(f), 3);
  return Math.ceil(Math.max(Math.min(360 / resolution.fa, (r * 2 * Math.PI) / resolution.fs), 5));
}

// ---------------------------------------------------------------------------
// Colors travel with the geometry: color() stamps a fresh mesh ID on the solid,
// and manifold keeps per-triangle IDs through booleans, so a union of colored
// parts still knows which faces came from where.

/** @type {Map<number, RGBA>} */
const colorById = new Map();

/** @internal Looks up the color assigned to a manifold original ID. */
export function colorOfId(id) {
  return colorById.get(id);
}

// ---------------------------------------------------------------------------

/** @internal */
export const POINT_IS_NOT_A_SHAPE =
  'A point has no geometry, so it cannot be combined with shapes or exported. Use it as a pivot (`rotate(a, { around: p })`) or read its coordinates with `.toArray()`.';

/** @template T @param {Items<T>[]} items @returns {T[]} */
function flatten(items) {
  const out = [];
  const walk = (item) => {
    if (Array.isArray(item)) item.forEach(walk);
    else if (item instanceof Point) throw new Error(POINT_IS_NOT_A_SHAPE);
    else if (item) out.push(item);
  };
  items.forEach(walk);
  return out;
}

/** Flattens items that must all be solids, for an operation that has no 2D form. */
function solidsFor(op, items) {
  const flat = flatten(items);
  if (flat.some((s) => !(s instanceof Solid))) throw new Error(`${op}() works on solids only; for 2D shapes use offset()`);
  return flat;
}

/** @param {number[]} v @returns {Vec3} */
function toVec3(v) {
  return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
}

/** Rotation by `degrees` around an arbitrary `axis`, as a column-major 4x4 matrix. */
function axisRotation(degrees, axis) {
  const [ax, ay, az] = toVec3(axis);
  const len = Math.hypot(ax, ay, az);
  const [x, y, z] = [ax / len, ay / len, az / len];
  const a = (degrees * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const t = 1 - c;
  return [
    t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
    t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0,
    0, 0, 0, 1,
  ];
}

/** Rotation by `[x, y, z]` degrees, around X, then Y, then Z, as a column-major 4x4 matrix. */
function eulerRotation(angles) {
  const [ax, ay, az] = toVec3(angles);
  return multiply(axisRotation(az, [0, 0, 1]), multiply(axisRotation(ay, [0, 1, 0]), axisRotation(ax, [1, 0, 0])));
}

/** The product `a * b` of two column-major 4x4 matrices: `b` applies first. */
function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
    }
  }
  return out;
}

/**
 * The pivot a rotation turns around: a point's position, the center of a shape's
 * bounding box, or plain coordinates.
 * @param {Point | Solid | Shape2 | number[]} target
 * @returns {Vec3}
 */
function pivotOf(target) {
  if (target instanceof Point) return [target.x, target.y, target.z];
  if (target instanceof Solid || target instanceof Shape2) {
    const { min, max } = target.bounds();
    return toVec3(min.map((lo, i) => (lo + max[i]) / 2));
  }
  if (Array.isArray(target)) return toVec3(target);
  throw new Error('rotate(): `around` must be a point, a shape or [x, y, z]');
}

/** @typedef {{ around?: Point | Solid | Shape2 | number[] }} RotateOptions */

/** A 3D solid. Every method returns a new solid; solids are never modified in place. */
export class Solid {
  /** @internal */
  constructor(manifold) {
    this.manifold = manifold;
  }

  /** @param {number[]} v */
  translate(v) {
    return new Solid(this.manifold.translate(toVec3(v)));
  }

  /**
   * Rotates in degrees. `rotate([x, y, z])` turns around X, then Y, then Z, like OpenSCAD.
   * `rotate(a)` turns around Z; `rotate(a, axis)` turns around an arbitrary axis.
   * A last `{ around }` argument moves the pivot from the origin to a point, the center of a shape, or [x, y, z].
   * @param {number[] | number} angles
   * @param {number[] | RotateOptions} [axis]
   * @param {RotateOptions} [options]
   * @returns {Solid}
   */
  rotate(angles, axis, options) {
    if (axis && !Array.isArray(axis)) return this.rotate(angles, undefined, axis);
    if (options?.around) {
      const c = pivotOf(options.around);
      return this.translate(c.map((v) => -v)).rotate(angles, axis).translate(c);
    }
    if (axis) return new Solid(this.manifold.transform(axisRotation(angles, axis)));
    return new Solid(this.manifold.rotate(typeof angles === 'number' ? [0, 0, angles] : toVec3(angles)));
  }

  /** @param {number[] | number} v */
  scale(v) {
    return new Solid(this.manifold.scale(typeof v === 'number' ? v : [v[0] ?? 1, v[1] ?? 1, v[2] ?? 1]));
  }

  /** Mirrors across the plane through the origin with the given normal. @param {number[]} normal */
  mirror(normal) {
    return new Solid(this.manifold.mirror(toVec3(normal)));
  }

  /** Applies a column-major 4x4 matrix. @param {number[]} matrix */
  transform(matrix) {
    return new Solid(this.manifold.transform(matrix));
  }

  /**
   * Colors the whole solid. Accepts CSS names, hex strings or [r, g, b, a] in 0..1.
   * @param {ColorInput} color
   * @param {number} [alpha]
   */
  color(color, alpha) {
    const m = this.manifold.asOriginal();
    colorById.set(m.originalID(), parseColor(color, alpha));
    return new Solid(m);
  }

  /** @param {...Items<Solid>} others */
  union(...others) {
    return new Solid(Manifold.union([this.manifold, ...flatten(others).map((s) => s.manifold)]));
  }

  /** @param {...Items<Solid>} others */
  subtract(...others) {
    const cutters = flatten(others);
    if (cutters.length === 0) return this;
    return new Solid(this.manifold.subtract(Manifold.union(cutters.map((s) => s.manifold))));
  }

  /** @param {...Items<Solid>} others */
  intersect(...others) {
    return new Solid(Manifold.intersection([this.manifold, ...flatten(others).map((s) => s.manifold)]));
  }

  /** Convex hull of this solid together with any others. @param {...Items<Solid>} others */
  hull(...others) {
    return new Solid(Manifold.hull([this.manifold, ...flatten(others).map((s) => s.manifold)]));
  }

  /**
   * Minkowski sum of this solid with the others, like OpenSCAD's minkowski(): `part.minkowski(sphere(1))`
   * rounds every edge with radius 1 and makes the part 2 larger in each direction. The result is uncolored.
   * Fast when the shapes are convex; a part with holes or pockets can take seconds.
   * @param {...Items<Solid>} others
   */
  minkowski(...others) {
    return new Solid(solidsFor('minkowski', others).reduce((sum, s) => sum.minkowskiSum(s.manifold), this.manifold));
  }

  /** The cross-section at height `z`. */
  slice(z = 0) {
    return new Shape2(this.manifold.slice(z));
  }

  /** The outline of the solid projected onto the XY plane. */
  project() {
    return new Shape2(this.manifold.project());
  }

  volume() {
    return this.manifold.volume();
  }

  surfaceArea() {
    return this.manifold.surfaceArea();
  }

  /** @returns {{ min: Vec3, max: Vec3 }} */
  bounds() {
    const { min, max } = this.manifold.boundingBox();
    return { min: [...min], max: [...max] };
  }

  isEmpty() {
    return this.manifold.isEmpty();
  }
}

/**
 * @typedef {object} ExtrudeOptions
 * @property {boolean} [center]
 * @property {number} [twist] degrees the top is rotated relative to the bottom
 * @property {number | Vec2} [scale] scale of the top relative to the bottom
 * @property {number} [divisions] intermediate slices; useful with twist
 */

/** @typedef {{ r: number, fn?: number } | { delta: number, chamfer?: boolean }} OffsetOptions */

/** A 2D shape in the XY plane. Extrude or revolve it to get a solid. */
export class Shape2 {
  /** @internal */
  constructor(section) {
    this.section = section;
  }

  /** @param {number[]} v */
  translate(v) {
    return new Shape2(this.section.translate([v[0] ?? 0, v[1] ?? 0]));
  }

  /**
   * Rotates counter-clockwise, around the origin or around `{ around }`: a point, the center of a shape, or [x, y].
   * @param {number} degrees
   * @param {RotateOptions} [options]
   * @returns {Shape2}
   */
  rotate(degrees, options) {
    if (options?.around) {
      const [x, y] = pivotOf(options.around);
      return this.translate([-x, -y]).rotate(degrees).translate([x, y]);
    }
    return new Shape2(this.section.rotate(degrees));
  }

  /** @param {number[] | number} v */
  scale(v) {
    return new Shape2(this.section.scale(typeof v === 'number' ? v : [v[0] ?? 1, v[1] ?? 1]));
  }

  /** @param {number[]} axis */
  mirror(axis) {
    return new Shape2(this.section.mirror([axis[0] ?? 0, axis[1] ?? 0]));
  }

  /**
   * Grows (positive) or shrinks (negative) the outline, like OpenSCAD's offset().
   * A number means `{ r }`: rounded corners. `{ delta }` keeps corners sharp, `{ delta, chamfer: true }` cuts them.
   * @param {number | OffsetOptions} options
   */
  offset(options) {
    const o = typeof options === 'number' ? { r: options } : options;
    if ('r' in o) return new Shape2(this.section.offset(o.r, 'Round', 2, segmentsFor(Math.abs(o.r), o.fn)));
    return new Shape2(this.section.offset(o.delta, o.chamfer ? 'Square' : 'Miter', 1e6));
  }

  /** @param {...Items<Shape2>} others */
  union(...others) {
    return new Shape2(CrossSection.union([this.section, ...flatten(others).map((s) => s.section)]));
  }

  /** @param {...Items<Shape2>} others */
  subtract(...others) {
    const cutters = flatten(others);
    if (cutters.length === 0) return this;
    return new Shape2(this.section.subtract(CrossSection.union(cutters.map((s) => s.section))));
  }

  /** @param {...Items<Shape2>} others */
  intersect(...others) {
    return new Shape2(CrossSection.intersection([this.section, ...flatten(others).map((s) => s.section)]));
  }

  /** @param {...Items<Shape2>} others */
  hull(...others) {
    return new Shape2(CrossSection.hull([this.section, ...flatten(others).map((s) => s.section)]));
  }

  /**
   * Extrudes along +Z, like OpenSCAD's linear_extrude().
   * @param {number} height
   * @param {ExtrudeOptions} [options]
   */
  extrude(height, options = {}) {
    const { center = false, twist = 0, scale = 1, divisions = 0 } = options;
    // manifold-3d misreads a scalar scaleTop, so always pass a vector.
    const scaleTop = typeof scale === 'number' ? [scale, scale] : scale;
    return new Solid(this.section.extrude(height, divisions, twist, scaleTop, center));
  }

  /**
   * Revolves around the Y axis into a solid around Z, like OpenSCAD's rotate_extrude().
   * @param {{ angle?: number, fn?: number }} [options]
   */
  revolve(options = {}) {
    const { min, max } = this.section.bounds();
    const radius = Math.max(Math.abs(min[0]), Math.abs(max[0]));
    return new Solid(this.section.revolve(segmentsFor(radius, options.fn), options.angle ?? 360));
  }

  area() {
    return this.section.area();
  }

  /** @returns {{ min: Vec2, max: Vec2 }} */
  bounds() {
    const { min, max } = this.section.bounds();
    return { min: [...min], max: [...max] };
  }

  isEmpty() {
    return this.section.isEmpty();
  }

  /** The outline as arrays of points. @returns {Vec2[][]} */
  toPolygons() {
    return this.section.toPolygons().map((poly) => poly.map((p) => [p[0], p[1]]));
  }
}

/**
 * A point in space. It has no geometry and never reaches an STL; it marks a place,
 * such as a pivot for `rotate(..., { around })`, and moves with the same transforms as solids.
 */
export class Point {
  /** @internal @param {Vec3} position */
  constructor(position) {
    [this.x, this.y, this.z] = position;
  }

  /** @returns {Vec3} */
  toArray() {
    return [this.x, this.y, this.z];
  }

  /** Applies a column-major 4x4 matrix. @param {number[]} m */
  transform(m) {
    const { x, y, z } = this;
    return new Point([
      m[0] * x + m[4] * y + m[8] * z + m[12],
      m[1] * x + m[5] * y + m[9] * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14],
    ]);
  }

  /** @param {number[]} v */
  translate(v) {
    const [dx, dy, dz] = toVec3(v);
    return new Point([this.x + dx, this.y + dy, this.z + dz]);
  }

  /**
   * The same arguments as {@link Solid#rotate}.
   * @param {number[] | number} angles
   * @param {number[] | RotateOptions} [axis]
   * @param {RotateOptions} [options]
   * @returns {Point}
   */
  rotate(angles, axis, options) {
    if (axis && !Array.isArray(axis)) return this.rotate(angles, undefined, axis);
    if (options?.around) {
      const c = pivotOf(options.around);
      return this.translate(c.map((v) => -v)).rotate(angles, axis).translate(c);
    }
    if (axis) return this.transform(axisRotation(angles, axis));
    return this.transform(eulerRotation(typeof angles === 'number' ? [0, 0, angles] : angles));
  }

  /** @param {number[] | number} v */
  scale(v) {
    const [sx, sy, sz] = typeof v === 'number' ? [v, v, v] : [v[0] ?? 1, v[1] ?? 1, v[2] ?? 1];
    return new Point([this.x * sx, this.y * sy, this.z * sz]);
  }

  /** Mirrors across the plane through the origin with the given normal. @param {number[]} normal */
  mirror(normal) {
    const n = toVec3(normal);
    const k = (2 * (this.x * n[0] + this.y * n[1] + this.z * n[2])) / (n[0] ** 2 + n[1] ** 2 + n[2] ** 2);
    return new Point([this.x - k * n[0], this.y - k * n[1], this.z - k * n[2]]);
  }
}

/**
 * A point at `[x, y, z]`. Missing components are 0.
 * @param {number[]} [position]
 */
export function point(position = [0, 0, 0]) {
  return new Point(toVec3(position));
}

// ---------------------------------------------------------------------------
// 3D primitives

/**
 * Checks a `round` or `chamfer` option against the largest value the shape has room for.
 * @param {string} op
 * @param {number} round
 * @param {number} chamfer
 * @param {number} limit
 */
function checkEdge(op, round, chamfer, limit) {
  if (round && chamfer) throw new Error(`${op}(): give round or chamfer, not both`);
  const [name, value] = round ? ['round', round] : ['chamfer', chamfer];
  if (!(value >= 0 && value <= limit)) throw new Error(`${op}(): ${name} must be between 0 and ${+limit.toFixed(4)}, got ${value}`);
}

/**
 * @typedef {object} CubeOptions
 * @property {boolean} [center]
 * @property {number} [round] radius every edge is rounded with; the size stays the same
 * @property {number} [chamfer] how far back every edge is cut at 45°; the size stays the same
 * @property {number} [fn] segments of a full circle, for `round`
 */

/**
 * A box with one corner at the origin, or centered with `{ center: true }`.
 * `{ round }` rounds every edge and `{ chamfer }` cuts every edge, inside the same size.
 * @param {number | number[]} [size]
 * @param {CubeOptions} [options]
 */
export function cube(size = 1, options = {}) {
  const s = typeof size === 'number' ? [size, size, size] : toVec3(size);
  const { center = false, round = 0, chamfer = 0, fn } = options;
  if (!round && !chamfer) return new Solid(Manifold.cube(s, center));
  checkEdge('cube', round, chamfer, Math.min(...s) / 2);
  let manifold;
  if (round) {
    // The hull of a ball in each corner: flat faces, quarter-cylinder edges, eighth-sphere corners.
    const ball = Manifold.sphere(round, segmentsFor(round, fn));
    const corners = [];
    for (const x of [round, s[0] - round]) for (const y of [round, s[1] - round]) for (const z of [round, s[2] - round]) corners.push(ball.translate([x, y, z]));
    manifold = Manifold.hull(corners);
  } else {
    // The hull of three boxes, each as large as the cube along one axis and inset by the chamfer along the others.
    const c = chamfer;
    manifold = Manifold.hull([
      Manifold.cube([s[0], s[1] - 2 * c, s[2] - 2 * c]).translate([0, c, c]),
      Manifold.cube([s[0] - 2 * c, s[1], s[2] - 2 * c]).translate([c, 0, c]),
      Manifold.cube([s[0] - 2 * c, s[1] - 2 * c, s[2]]).translate([c, c, 0]),
    ]);
  }
  return new Solid(center ? manifold.translate(s.map((v) => -v / 2)) : manifold);
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
 * @property {number} [round] radius the top and bottom edges are rounded with; the size stays the same
 * @property {number} [chamfer] how far back the top and bottom edges are cut; the size stays the same
 * @property {number} [fn]
 */

/**
 * A cylinder or cone standing on the XY plane along +Z, like OpenSCAD's cylinder().
 * `{ round }` rounds the top and bottom edges and `{ chamfer }` cuts them, inside the same size.
 * @param {CylinderOptions} options
 */
export function cylinder(options) {
  const { h, r, d, r1, r2, d1, d2, center = false, fn, round = 0, chamfer = 0 } = options;
  const base = r ?? (d !== undefined ? d / 2 : 1);
  const bottom = r1 ?? (d1 !== undefined ? d1 / 2 : base);
  const top = r2 ?? (d2 !== undefined ? d2 / 2 : base);
  const segments = segmentsFor(Math.max(bottom, top), fn);
  if (!round && !chamfer) return new Solid(Manifold.cylinder(h, bottom, top, segments, center));
  checkEdge('cylinder', round, chamfer, Math.min(h / 2, bottom, top));
  const profile = round ? roundedProfile(h, bottom, top, round, segmentsFor(round, fn)) : chamferedProfile(h, bottom, top, chamfer);
  const manifold = profile.revolve(segments, 360);
  return new Solid(center ? manifold.translate([0, 0, -h / 2]) : manifold);
}

/**
 * The right half of a cylinder's section, X from the axis out and Y up, with its corners
 * rounded: the whole section is shrunk and grown back with round corners, then cut at the axis.
 */
function roundedProfile(h, bottom, top, round, segments) {
  const section = new CrossSection([[[-bottom, 0], [bottom, 0], [top, h], [-top, h]]]);
  const rounded = section.offset(-round, 'Miter', 1e6).offset(round, 'Round', 2, segments);
  return rounded.intersect(CrossSection.square([Math.max(bottom, top), h]));
}

/** The right half of a cylinder's section with its outer corners cut `chamfer` back along both sides. */
function chamferedProfile(h, bottom, top, chamfer) {
  // Along the side, which leans by k: chamfer / s up and k * chamfer / s out.
  const k = (top - bottom) / h;
  const s = Math.hypot(1, k);
  const [dz, dx] = [chamfer / s, (k * chamfer) / s];
  return new CrossSection([[[0, 0], [bottom - chamfer, 0], [bottom + dx, dz], [top - dx, h - dz], [top - chamfer, h], [0, h]]]);
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
  const manifold = new Manifold(mesh);
  if (manifold.status() !== 'NoError') throw new Error(`polyhedron() is not a closed solid: ${manifold.status()}`);
  return new Solid(manifold);
}

// ---------------------------------------------------------------------------
// 2D primitives

/**
 * @param {number | number[]} [size]
 * @param {{ center?: boolean }} [options]
 */
export function square(size = 1, options = {}) {
  const s = typeof size === 'number' ? [size, size] : [size[0], size[1]];
  return new Shape2(CrossSection.square(s, options.center ?? false));
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
 * A polygon from points. With `paths`, each path is a list of point indices;
 * paths inside others become holes (even-odd fill), like OpenSCAD's polygon().
 * @param {number[][]} points
 * @param {number[][]} [paths]
 */
export function polygon(points, paths) {
  const pts = points.map((p) => [p[0], p[1]]);
  const contours = paths ? paths.map((path) => path.map((i) => pts[i])) : [pts];
  return new Shape2(new CrossSection(contours, 'EvenOdd'));
}

// ---------------------------------------------------------------------------
// Functional forms. They take any mix of shapes and nested arrays (from loops),
// so OpenSCAD's `translate(v) for (...) child();` becomes `translate(v, xs.map(...))`.

function dimension(items, op) {
  if (items.length === 0) return 'empty';
  const solids = items.filter((s) => s instanceof Solid).length;
  if (solids === items.length) return 'solid';
  if (solids === 0) return 'shape2';
  throw new Error(`${op}() cannot mix 2D shapes and 3D solids`);
}

/** Applies a 3D or 2D operation to all items, depending on what they are. */
function combine(items, op, solidOp, shapeOp) {
  const flat = flatten(items);
  switch (dimension(flat, op)) {
    case 'empty':
      return new Solid(Manifold.compose([]));
    case 'solid':
      return new Solid(solidOp(flat.map((s) => s.manifold)));
    case 'shape2':
      return new Shape2(shapeOp(flat.map((s) => s.section)));
  }
}

/** @param {...Items<Solid | Shape2>} items */
export function union(...items) {
  return combine(items, 'union', (ms) => Manifold.union(ms), (cs) => CrossSection.union(cs));
}

/**
 * Subtracts every following shape from the first one.
 * @param {Solid | Shape2} base
 * @param {...Items<Solid | Shape2>} cutters
 */
export function difference(base, ...cutters) {
  return base.subtract(...cutters);
}

/** @param {...Items<Solid | Shape2>} items */
export function intersection(...items) {
  return combine(items, 'intersection', (ms) => Manifold.intersection(ms), (cs) => CrossSection.intersection(cs));
}

/** Convex hull of all given shapes, like OpenSCAD's hull(). @param {...Items<Solid | Shape2>} items */
export function hull(...items) {
  return combine(items, 'hull', (ms) => Manifold.hull(ms), (cs) => CrossSection.hull(cs));
}

/**
 * Minkowski sum of all given solids, like OpenSCAD's minkowski(): `minkowski(part, sphere(1))`.
 * See {@link Solid#minkowski}.
 * @param {...Items<Solid>} items
 * @returns {Solid}
 */
export function minkowski(...items) {
  const [first, ...rest] = solidsFor('minkowski', items);
  return first ? first.minkowski(rest) : new Solid(Manifold.compose([]));
}

/** @param {number[]} v @param {...Items<Solid | Shape2>} items */
export function translate(v, ...items) {
  return union(...items).translate(v);
}

/**
 * `rotate(angles, ...shapes)` or `rotate(angles, { around }, ...shapes)`. 2D shapes take a single angle.
 * @param {number[] | number} angles
 * @param {...(RotateOptions | Items<Solid | Shape2>)} rest
 */
export function rotate(angles, ...rest) {
  const first = rest[0];
  const isOptions = first && typeof first === 'object' && !Array.isArray(first) && !(first instanceof Solid) && !(first instanceof Shape2);
  const options = isOptions ? rest.shift() : undefined;
  return union(...rest).rotate(angles, options);
}

/** @param {number[] | number} v @param {...Items<Solid | Shape2>} items */
export function scale(v, ...items) {
  return union(...items).scale(v);
}

/** @param {number[]} normal @param {...Items<Solid | Shape2>} items */
export function mirror(normal, ...items) {
  return union(...items).mirror(normal);
}

/**
 * `color('orange', lid)` or `color('orange', 0.35, lid)`.
 * @param {ColorInput} c
 * @param {...(number | Items<Solid>)} rest
 */
export function color(c, ...rest) {
  const alpha = typeof rest[0] === 'number' ? rest.shift() : undefined;
  return union(...rest).color(c, alpha);
}

/** @param {number | OffsetOptions} options @param {...Items<Shape2>} items */
export function offset(options, ...items) {
  return union(...items).offset(options);
}

/** @param {number} height @param {ExtrudeOptions} options @param {...Items<Shape2>} items */
export function linearExtrude(height, options, ...items) {
  return union(...items).extrude(height, options);
}
