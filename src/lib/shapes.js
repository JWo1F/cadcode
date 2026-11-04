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

/** @template T @param {Items<T>[]} items @returns {T[]} */
function flatten(items) {
  const out = [];
  const walk = (item) => {
    if (Array.isArray(item)) item.forEach(walk);
    else if (item) out.push(item);
  };
  items.forEach(walk);
  return out;
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
   * @param {number[] | number} angles
   * @param {number[]} [axis]
   */
  rotate(angles, axis) {
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

  /** @param {number} degrees */
  rotate(degrees) {
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

// ---------------------------------------------------------------------------
// 3D primitives

/**
 * A box with one corner at the origin, or centered with `{ center: true }`.
 * @param {number | number[]} [size]
 * @param {{ center?: boolean }} [options]
 */
export function cube(size = 1, options = {}) {
  const s = typeof size === 'number' ? [size, size, size] : toVec3(size);
  return new Solid(Manifold.cube(s, options.center ?? false));
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
 * @property {number} [fn]
 */

/**
 * A cylinder or cone standing on the XY plane along +Z, like OpenSCAD's cylinder().
 * @param {CylinderOptions} options
 */
export function cylinder(options) {
  const { h, r, d, r1, r2, d1, d2, center = false, fn } = options;
  const base = r ?? (d !== undefined ? d / 2 : 1);
  const bottom = r1 ?? (d1 !== undefined ? d1 / 2 : base);
  const top = r2 ?? (d2 !== undefined ? d2 / 2 : base);
  return new Solid(Manifold.cylinder(h, bottom, top, segmentsFor(Math.max(bottom, top), fn), center));
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

/** @param {number[]} v @param {...Items<Solid | Shape2>} items */
export function translate(v, ...items) {
  return union(...items).translate(v);
}

/** Same arguments as {@link Solid#rotate}; 2D shapes take a single angle. @param {number[] | number} angles @param {...Items<Solid | Shape2>} items */
export function rotate(angles, ...items) {
  return union(...items).rotate(angles);
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
