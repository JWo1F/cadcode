import Module from 'manifold-3d';
import { parseColor } from './colors.js';
import { range } from './util.js';
import { sweepPolygons } from './sweep.js';
import { faceFrame, frameAt } from './frame.js';
import { edgesOf, softenEdges } from './edges.js';

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
/** @internal The WASM instance's classes, for text() and the importers: shapes must all come from one instance. */
export { CrossSection, Manifold, Mesh };
/** @internal Triangles covering polygons (counterclockwise outlines, clockwise holes), as indices into their points in order. */
export const triangulate = (polygons) => wasm.triangulate(polygons);

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

/** @internal Segments for a full circle of radius `r`, by the `fn`/`fa`/`fs` rules; the importers use it for arcs. */
export function segmentsFor(r, fn) {
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

/**
 * @internal Reserves one manifold original ID per color, for meshes built with their
 * colors in triangle runs (the 3MF importer). Returns the IDs, in the order of `colors`;
 * a null color gets an ID with no color, for the uncolored triangles.
 * @param {(RGBA | null)[]} colors
 * @returns {number[]}
 */
export function reserveColorIds(colors) {
  if (colors.length === 0) return [];
  const first = Manifold.reserveIDs(colors.length);
  return colors.map((color, i) => {
    if (color) colorById.set(first + i, color);
    return first + i;
  });
}

/** @internal Looks up the color assigned to a manifold original ID. */
export function colorOfId(id) {
  return colorById.get(id);
}

// ---------------------------------------------------------------------------

/** @internal */
export const POINT_IS_NOT_A_SHAPE =
  'A point has no geometry, so it cannot be combined with shapes or exported. Use it as a pivot (`rotate(a, { around: p })`) or read its coordinates with `.toArray()`.';

/** @internal */
export const SKETCH_IS_NOT_A_SHAPE =
  'A sketch and its lines and circles are guides, not shapes: return the sketch in a part to see it, and extrude an outline made from its points (`s.polygon()`, `s.extrude()`) to build with it.';

/** Why `item` cannot go where shapes are expected. @param {unknown} item */
function notAShape(item) {
  const name = /** @type {any} */ (item)?.constructor?.name;
  if (['Sketch', 'Line', 'Circle'].includes(name)) return SKETCH_IS_NOT_A_SHAPE;
  return `Expected a solid or a 2D shape, got ${name && name !== 'Object' ? `a ${name}` : JSON.stringify(item)}`;
}

/** @param {ShapeItems[]} items @returns {any[]} */
function flatten(items) {
  const out = [];
  const walk = (item) => {
    if (Array.isArray(item)) item.forEach(walk);
    else if (item instanceof Point) throw new Error(POINT_IS_NOT_A_SHAPE);
    else if (item instanceof Solid || item instanceof Shape2) out.push(item);
    else if (item) throw new Error(notAShape(item));
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

/**
 * @typedef {'min' | 'center' | 'max' | 'before' | 'after'} AlignTo How one axis lines up with the target:
 *   `min`, `center`, `max` match that side or the middle of the two boxes; `before` puts this one wholly
 *   on the target's min side and `after` on its max side, touching it
 */
/**
 * @typedef {object} AlignOptions
 * @property {AlignTo} [x]
 * @property {AlignTo} [y]
 * @property {AlignTo} [z]
 * @property {number} [gap] space left from the target: `before` and `after` move away from it, `min`
 *   and `max` move inwards from that side; `center` ignores it
 */

const ALIGNMENTS = ['min', 'center', 'max', 'before', 'after'];

/** The rotation that turns each side of a box to face down, -Z, for layFlat(). */
const DOWN = {
  '-Z': [0, 0, 0],
  '+Z': [180, 0, 0],
  '+X': [0, 90, 0],
  '-X': [0, -90, 0],
  '+Y': [-90, 0, 0],
  '-Y': [90, 0, 0],
};

/**
 * The bounding box of what something is aligned to: a shape's, or a point as a box of no size.
 * @param {string} op
 * @param {Point | Solid | Shape2 | number[]} target
 * @returns {{ min: number[], max: number[] }}
 */
function targetBox(op, target) {
  if (target instanceof Solid || target instanceof Shape2) return target.bounds();
  if (target instanceof Point) return { min: target.toArray(), max: target.toArray() };
  if (Array.isArray(target)) {
    const p = toVec3(target);
    return { min: p, max: p };
  }
  throw new Error(`${op}(): the target must be a solid, a 2D shape, a point or [x, y, z]`);
}

/**
 * How far to move a box so it lines up with a target box as `options` says, axis by axis.
 * @param {string} op
 * @param {{ min: number[], max: number[] }} own
 * @param {{ min: number[], max: number[] }} target
 * @param {AlignOptions} options
 * @param {string[]} axes
 */
function alignment(op, own, target, options, axes) {
  const known = new Set([...axes, 'gap']);
  for (const key of Object.keys(options)) {
    if (!known.has(key)) throw new Error(`${op}(): unknown option "${key}"; it takes ${axes.join(', ')} and gap`);
  }
  const gap = options.gap ?? 0;
  return axes.map((axis, k) => {
    const how = options[axis];
    if (how === undefined) return 0;
    if (!ALIGNMENTS.includes(how)) throw new Error(`${op}(): ${axis} must be one of ${ALIGNMENTS.join(', ')}, got ${JSON.stringify(how)}`);
    const [lo, hi, tlo, thi] = [own.min[k], own.max[k], target.min[k], target.max[k]];
    switch (how) {
      case 'min': return tlo + gap - lo;
      case 'max': return thi - gap - hi;
      case 'center': return (tlo + thi) / 2 - (lo + hi) / 2;
      case 'before': return tlo - gap - hi;
      case 'after': return thi + gap - lo;
    }
  });
}

/**
 * A point on a bounding box: its center, or the center of one side.
 * @param {string} op
 * @param {{ min: number[], max: number[] }} box
 * @param {string} side
 * @param {string[]} axes
 */
function anchor(op, box, side, axes) {
  const center = box.min.map((lo, k) => (lo + box.max[k]) / 2);
  if (side === 'center') return center;
  const match = /^([+-])([XYZ])$/.exec(side);
  const k = match ? axes.indexOf(match[2].toLowerCase()) : -1;
  if (k < 0) throw new Error(`${op}(): side must be 'center' or one of ${axes.flatMap((a) => [`+${a.toUpperCase()}`, `-${a.toUpperCase()}`]).join(', ')}, got ${JSON.stringify(side)}`);
  center[k] = match[1] === '+' ? box.max[k] : box.min[k];
  return center;
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

  /**
   * The plane of one side of the bounding box, to draw on and extrude from: `'+X'` is the side at the
   * largest X, its normal pointing out, and so on for `'-X'`, `'+Y'`, `'-Y'`, `'+Z'`, `'-Z'`. Positions
   * in it are world coordinates: Y and Z on an X side, X and Z on a Y side, X and Y on a Z side.
   * `box.face('-X').extrude(window, -wall, { through: true })` cuts a window through the wall at -X.
   * @param {'+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z'} name
   */
  face(name) {
    return faceFrame(name, this.bounds());
  }

  /**
   * The straight edges of the solid, where two flat faces meet, that pass a filter: to count or look at
   * before `fillet()` or `chamfer()` them. Each is `{ from, to, direction, length, normals, convex, angle }`.
   * @param {import('./edges.js').EdgeFilter} [filter]
   * @returns {import('./edges.js').Edge[]}
   */
  edges(filter) {
    return edgesOf(this, filter, 'edges()');
  }

  /**
   * Rounds the solid's straight edges that pass a filter, after the booleans: an outside edge is cut
   * round, an inside one filled round. `cup.fillet(2, { between: ['+Z', '-X'] })` rounds where the top
   * meets the -X side; `{ along: 'z', convex: true }` takes every vertical outside edge. Edges of a curved
   * surface are left alone. Where filleted edges meet at a corner the rounds overlap rather than blend.
   * @param {number} r
   * @param {import('./edges.js').EdgeFilter & { fn?: number }} [filter]
   * @returns {Solid}
   */
  fillet(r, filter) {
    return softenEdges(this, 'round', r, filter);
  }

  /**
   * Cuts the solid's straight edges that pass a filter `size` back along both faces, or fills an inside
   * edge as much: as `fillet()`, with a flat cut instead of a round.
   * @param {number} size
   * @param {import('./edges.js').EdgeFilter} [filter]
   * @returns {Solid}
   */
  chamfer(size, filter) {
    return softenEdges(this, 'chamfer', size, filter);
  }

  /**
   * Turns the solid so `side` of its bounding box faces down, and puts it on the bed: centered on the
   * origin in X and Y, its bottom at Z = 0. `lid.layFlat('+Z')` prints a lid top down; `layFlat()` only
   * moves the solid onto the bed.
   * @param {'+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z'} [side]
   * @returns {Solid}
   */
  layFlat(side = '-Z') {
    const turn = DOWN[/** @type {keyof typeof DOWN} */ (side)];
    if (!turn) throw new Error(`layFlat(): side must be one of ${Object.keys(DOWN).join(', ')}, got ${JSON.stringify(side)}`);
    const turned = this.rotate(turn);
    const { min, max } = turned.bounds();
    return turned.translate([-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2, -min[2]]);
  }

  /**
   * A point on the bounding box: `'center'`, or the center of a side, `'+X'` at the largest X and so on.
   * Use it as a pivot, or to place and align other parts by.
   * @param {'center' | '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z'} [side]
   * @returns {Point}
   */
  at(side = 'center') {
    return new Point(/** @type {Vec3} */ (anchor('at', this.bounds(), side, ['x', 'y', 'z'])));
  }

  /**
   * Moves the solid to line up with another shape, a point or `[x, y, z]`, axis by axis by bounding
   * boxes: `pad.align(floor, { x: 'center', y: 'center', z: 'after' })` centers the pad on the floor
   * and stands it on top. An axis left out does not move.
   * @param {Solid | Shape2 | Point | number[]} target
   * @param {AlignOptions} options
   * @returns {Solid}
   */
  align(target, options) {
    return this.translate(alignment('align', this.bounds(), targetBox('align', target), options, ['x', 'y', 'z']));
  }

  /**
   * The frame on the solid's surface where it is first met looking in from a side: from `at` on
   * `face(side)` straight into the part. Its normal is the surface's, pointing out, so a hole or a
   * boss on a dome or a sloped wall goes in square to it. On a curve the normal is that of the mesh
   * triangle met, so it follows the curve as finely as the solid's `fn`.
   * `dome.surfaceAt('+Z', [42, 0])` is the point on top of the dome above x = 42, y = 0.
   * @param {'+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z'} side
   * @param {number[]} at world coordinates on that side, as for `face()`
   */
  surfaceAt(side, at) {
    const face = faceFrame(side, this.bounds());
    const m = face.matrix;
    const [u, v] = [at[0] ?? 0, at[1] ?? 0];
    // Start a little outside the face, so a surface lying on it is met too.
    const origin = [0, 1, 2].map((k) => m[k] * u + m[4 + k] * v + m[8 + k] + m[12 + k]);
    const dir = [-m[8], -m[9], -m[10]];
    const hit = firstHit(this.manifold.getMesh(), origin, dir);
    if (!hit) throw new Error(`surfaceAt(): nothing of the solid lies under [${u}, ${v}] on its ${side} side`);
    return frameAt(hit.point, hit.normal);
  }
}

/**
 * Where a ray from `origin` along `dir` first meets a mesh, with the outward normal of the triangle
 * met, or null if it misses (Möller–Trumbore against every triangle).
 * @param {{ numProp: number, vertProperties: Float32Array, triVerts: Uint32Array }} mesh
 * @param {number[]} origin
 * @param {number[]} dir
 * @returns {{ point: Vec3, normal: Vec3 } | null}
 */
function firstHit({ numProp, vertProperties, triVerts }, origin, dir) {
  const vertex = (i) => [vertProperties[i * numProp], vertProperties[i * numProp + 1], vertProperties[i * numProp + 2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  let best = null;
  for (let t = 0; t < triVerts.length; t += 3) {
    const [a, b, c] = [vertex(triVerts[t]), vertex(triVerts[t + 1]), vertex(triVerts[t + 2])];
    const e1 = sub(b, a);
    const e2 = sub(c, a);
    const p = cross(dir, e2);
    const det = dot(e1, p);
    if (Math.abs(det) < 1e-12) continue;
    const s = sub(origin, a);
    const w1 = dot(s, p) / det;
    if (w1 < -1e-9 || w1 > 1 + 1e-9) continue;
    const q = cross(s, e1);
    const w2 = dot(dir, q) / det;
    if (w2 < -1e-9 || w1 + w2 > 1 + 1e-9) continue;
    const distance = dot(e2, q) / det;
    if (distance < 0 || (best && distance >= best.distance)) continue;
    best = { distance, normal: cross(e1, e2) };
  }
  if (!best) return null;
  const n = best.normal;
  const length = Math.hypot(n[0], n[1], n[2]);
  return {
    point: [origin[0] + dir[0] * best.distance, origin[1] + dir[1] * best.distance, origin[2] + dir[2] * best.distance],
    normal: [n[0] / length, n[1] / length, n[2] / length],
  };
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

  /**
   * Sweeps the shape along a path of 3D points into a solid, like a tube along a wire.
   * The shape is drawn in XY and stands across the path: +Z of the drawing points along the path.
   * @param {number[][]} path points `[x, y, z]`, such as from `helix()`
   * @param {import('./sweep.js').SweepOptions} [options]
   */
  sweep(path, options = {}) {
    return sweepPolygons(this.toPolygons(), path, options);
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

  /**
   * A point on the bounding box: `'center'`, or the center of a side, `'+X'` at the largest X and so on.
   * @param {'center' | '+X' | '-X' | '+Y' | '-Y'} [side]
   * @returns {Vec2}
   */
  at(side = 'center') {
    return /** @type {Vec2} */ (anchor('at', this.bounds(), side, ['x', 'y']));
  }

  /**
   * Moves the shape to line up with another shape or a point, by X and Y as `Solid.align` does.
   * @param {Shape2 | Solid | Point | number[]} target
   * @param {{ x?: AlignTo, y?: AlignTo, gap?: number }} options
   * @returns {Shape2}
   */
  align(target, options) {
    const box = targetBox('align', target);
    return this.translate(alignment('align', this.bounds(), { min: box.min.slice(0, 2), max: box.max.slice(0, 2) }, options, ['x', 'y']));
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
 * One spec per point from polygon()'s `round` and `chamfer`.
 * @param {number} count
 * @param {unknown} round
 * @param {unknown} chamfer
 * @returns {(EdgeSpec | undefined)[]}
 */
function cornerSpecs(points, round, chamfer) {
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
      if (!level && (!value || typeof value !== 'object')) throw new Error(`polygon(): ${kind} must be a number, a function of the corner's index, or an object like { 0: 1 } by index`);
      const sizes =
        typeof value === 'number' ? points.map(() => value)
        : typeof value === 'function' ? points.map((p, i) => value(i, p) ?? 0)
        : null;
      const entries = sizes ? sizes.map((size, i) => [String(i), size]) : Object.entries(value);
      for (const [key, size] of entries) {
        const i = Number(key);
        if (!(Number.isInteger(i) && i >= 0 && i < count)) throw new Error(`polygon(): ${kind} names corner ${key}, but the corners are 0 to ${count - 1}`);
        if (!(typeof size === 'number' && size >= 0)) throw new Error(`polygon(): ${kind} must be 0 or more, got ${JSON.stringify(size)} for corner ${i}`);
        if (level && size === 0) continue;
        if (set.has(i)) throw new Error(`polygon(): give corner ${i} round or chamfer, not both`);
        set.add(i);
        specs[i] = size === 0 ? undefined : { kind, size };
      }
    }
  }
  return specs;
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
