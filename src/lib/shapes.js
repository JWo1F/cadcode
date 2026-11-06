import Module from 'manifold-3d';
import { parseColor } from './colors.js';
import { range } from './util.js';

/** @typedef {import('./colors.js').ColorInput} ColorInput */
/** @typedef {import('./colors.js').RGBA} RGBA */
/** @typedef {[number, number]} Vec2 */
/** @typedef {[number, number, number]} Vec3 */
// Nested arrays of shapes, as produced by loops. Falsy entries are skipped, so `cond && shape` works.
// One typedef per element type: tsc drops the type parameter of a generic JSDoc
// typedef from the .d.ts it emits, which breaks the published typings.
/** @typedef {Solid | null | undefined | false | SolidItems[]} SolidItems Solids in nested arrays; falsy entries are skipped. */
/** @typedef {Shape2 | null | undefined | false | Shape2Items[]} Shape2Items 2D shapes in nested arrays; falsy entries are skipped. */
/** @typedef {Solid | Shape2 | null | undefined | false | ShapeItems[]} ShapeItems Solids or 2D shapes in nested arrays; falsy entries are skipped. */

const wasm = await Module();
wasm.setup();
const { Manifold, CrossSection, Mesh } = wasm;
/** @internal The WASM instance's CrossSection, for text(): shapes must all come from one instance. */
export { CrossSection };

// ---------------------------------------------------------------------------
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

/** @param {ShapeItems[]} items @returns {any[]} */
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

  /** @param {...SolidItems} others */
  union(...others) {
    return new Solid(Manifold.union([this.manifold, ...flatten(others).map((s) => s.manifold)]));
  }

  /** @param {...SolidItems} others */
  subtract(...others) {
    const cutters = flatten(others);
    if (cutters.length === 0) return this;
    return new Solid(this.manifold.subtract(Manifold.union(cutters.map((s) => s.manifold))));
  }

  /** @param {...SolidItems} others */
  intersect(...others) {
    return new Solid(Manifold.intersection([this.manifold, ...flatten(others).map((s) => s.manifold)]));
  }

  /** Convex hull of this solid together with any others. @param {...SolidItems} others */
  hull(...others) {
    return new Solid(Manifold.hull([this.manifold, ...flatten(others).map((s) => s.manifold)]));
  }

  /**
   * Minkowski sum of this solid with the others, like OpenSCAD's minkowski(): `part.minkowski(sphere(1))`
   * rounds every edge with radius 1 and makes the part 2 larger in each direction. The result is uncolored.
   * Fast when the shapes are convex; a part with holes or pockets can take seconds.
   * @param {...SolidItems} others
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

  /** @returns {number} */
  volume() {
    return this.manifold.volume();
  }

  /** @returns {number} */
  surfaceArea() {
    return this.manifold.surfaceArea();
  }

  /** @returns {{ min: Vec3, max: Vec3 }} */
  bounds() {
    const { min, max } = this.manifold.boundingBox();
    return { min: [...min], max: [...max] };
  }

  /** @returns {boolean} */
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

  /** @param {...Shape2Items} others */
  union(...others) {
    return new Shape2(CrossSection.union([this.section, ...flatten(others).map((s) => s.section)]));
  }

  /** @param {...Shape2Items} others */
  subtract(...others) {
    const cutters = flatten(others);
    if (cutters.length === 0) return this;
    return new Shape2(this.section.subtract(CrossSection.union(cutters.map((s) => s.section))));
  }

  /** @param {...Shape2Items} others */
  intersect(...others) {
    return new Shape2(CrossSection.intersection([this.section, ...flatten(others).map((s) => s.section)]));
  }

  /** @param {...Shape2Items} others */
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

  /** @returns {number} */
  area() {
    return this.section.area();
  }

  /** @returns {{ min: Vec2, max: Vec2 }} */
  bounds() {
    const { min, max } = this.section.bounds();
    return { min: [...min], max: [...max] };
  }

  /** @returns {boolean} */
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
 * The points of a convex polygon, counter-clockwise, with corner `i` rounded or chamfered as
 * `specs[i]` says. A rounded corner is an arc tangent to both sides; a chamfered one is cut
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
    const from = Math.atan2(a[1] - center[1], a[0] - center[0]);
    let sweep = Math.atan2(b[1] - center[1], b[0] - center[0]) - from;
    if (sweep > Math.PI) sweep -= 2 * Math.PI;
    if (sweep < -Math.PI) sweep += 2 * Math.PI;
    const steps = Math.max(1, Math.ceil((segmentsFor(r, fn) * Math.abs(sweep)) / (2 * Math.PI)));
    for (let k = 0; k <= steps; k++) {
      const t = from + (sweep * k) / steps;
      out.push([center[0] + r * Math.cos(t), center[1] + r * Math.sin(t)]);
    }
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
 */

/**
 * A cylinder or cone standing on the XY plane along +Z, like OpenSCAD's cylinder().
 * `{ round }` rounds the top and bottom edges and `{ chamfer }` cuts them, inside the same size;
 * `{ chamfer: { top: 1 } }` does the top edge only.
 * @param {CylinderOptions} options
 */
export function cylinder(options) {
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

/** @param {...ShapeItems} items */
export function union(...items) {
  return combine(items, 'union', (ms) => Manifold.union(ms), (cs) => CrossSection.union(cs));
}

/**
 * Subtracts every following shape from the first one.
 * @param {Solid | Shape2} base
 * @param {...ShapeItems} cutters
 */
export function difference(base, ...cutters) {
  return base.subtract(...cutters);
}

/** @param {...ShapeItems} items */
export function intersection(...items) {
  return combine(items, 'intersection', (ms) => Manifold.intersection(ms), (cs) => CrossSection.intersection(cs));
}

/** Convex hull of all given shapes, like OpenSCAD's hull(). @param {...ShapeItems} items */
export function hull(...items) {
  return combine(items, 'hull', (ms) => Manifold.hull(ms), (cs) => CrossSection.hull(cs));
}

/**
 * Minkowski sum of all given solids, like OpenSCAD's minkowski(): `minkowski(part, sphere(1))`.
 * See {@link Solid#minkowski}.
 * @param {...SolidItems} items
 * @returns {Solid}
 */
export function minkowski(...items) {
  const [first, ...rest] = solidsFor('minkowski', items);
  return first ? first.minkowski(rest) : new Solid(Manifold.compose([]));
}

/** @param {number[]} v @param {...ShapeItems} items */
export function translate(v, ...items) {
  return union(...items).translate(v);
}

/**
 * `rotate(angles, ...shapes)` or `rotate(angles, { around }, ...shapes)`. 2D shapes take a single angle.
 * @param {number[] | number} angles
 * @param {...(RotateOptions | ShapeItems)} rest
 */
export function rotate(angles, ...rest) {
  const first = rest[0];
  const isOptions = first && typeof first === 'object' && !Array.isArray(first) && !(first instanceof Solid) && !(first instanceof Shape2);
  const options = isOptions ? rest.shift() : undefined;
  return union(...rest).rotate(angles, options);
}

/** @param {number[] | number} v @param {...ShapeItems} items */
export function scale(v, ...items) {
  return union(...items).scale(v);
}

/** @param {number[]} normal @param {...ShapeItems} items */
export function mirror(normal, ...items) {
  return union(...items).mirror(normal);
}

/**
 * `color('orange', lid)` or `color('orange', 0.35, lid)`.
 * @param {ColorInput} c
 * @param {...(number | SolidItems)} rest
 * @returns {Solid}
 */
export function color(c, ...rest) {
  const alpha = typeof rest[0] === 'number' ? rest.shift() : undefined;
  return union(...rest).color(c, alpha);
}

/** @param {number | OffsetOptions} options @param {...Shape2Items} items @returns {Shape2} */
export function offset(options, ...items) {
  return union(...items).offset(options);
}

/** @param {number} height @param {ExtrudeOptions} options @param {...Shape2Items} items @returns {Solid} */
export function linearExtrude(height, options, ...items) {
  return union(...items).extrude(height, options);
}
