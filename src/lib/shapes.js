import { Manifold, CrossSection, Mesh, triangulate } from './manifold.js';
import { resolution, setResolution, segmentsFor, arcPoints, shortArc } from './resolution.js';
import { parseColor } from './colors.js';
import { range } from './util.js';
import { mat4, vec3 } from './vec.js';
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

// The WASM classes and the curve resolution live in their own modules; shapes.js passes them on
// so the library's modules keep one place to import shapes from.
/** @internal */
export { CrossSection, Manifold, Mesh, triangulate, resolution, setResolution, segmentsFor, arcPoints, shortArc };

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
const SKETCH_IS_NOT_A_SHAPE =
  'A sketch and its lines and circles are guides, not shapes: return the sketch in a part to see it, and extrude an outline made from its points (`s.polygon()`, `s.extrude()`) to build with it.';

/** Why `item` cannot go where shapes are expected. @param {unknown} item */
function notAShape(item) {
  const name = /** @type {any} */ (item)?.constructor?.name;
  if (['Sketch', 'Line', 'Circle'].includes(name)) return SKETCH_IS_NOT_A_SHAPE;
  return `Expected a solid or a 2D shape, got ${name && name !== 'Object' ? `a ${name}` : JSON.stringify(item)}`;
}

/** @param {ShapeItems[]} items @returns {any[]} */
/** @internal */
export function flatten(items) {
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
export function solidsFor(op, items) {
  const flat = flatten(items);
  if (flat.some((s) => !(s instanceof Solid))) throw new Error(`${op}() works on solids only, not on 2D shapes`);
  return flat;
}

/** The 2D shapes in `items` joined into one, empty when there are none. @param {string} op @param {any[]} items */
export function shapesFor(op, items) {
  const flat = flatten(items);
  if (flat.some((s) => !(s instanceof Shape2))) throw new Error(`${op}() works on 2D shapes only, not on solids`);
  return new Shape2(CrossSection.union(flat.map((s) => s.section)));
}

/** The Z angle of OpenSCAD's `[x, y, z]` rotation of a 2D shape, which must not turn about X or Y. @param {number[]} angles */
function planarAngle(angles) {
  if ((angles[0] ?? 0) !== 0 || (angles[1] ?? 0) !== 0) throw new Error(`rotate(): a 2D shape turns about Z only, got [${angles.join(', ')}]`);
  return angles[2] ?? 0;
}

/** @param {number[]} v @returns {Vec3} */
export function toVec3(v) {
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
  return mat4.multiply(axisRotation(az, [0, 0, 1]), mat4.multiply(axisRotation(ay, [0, 1, 0]), axisRotation(ax, [1, 0, 0])));
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

/**
 * The box `clip()` keeps: each axis given as `[from, to]` (either end may be `-Infinity` or `Infinity`),
 * the rest the shape's own extent, with room to spare so nothing is cut that should not be.
 * @param {string} op
 * @param {{ min: number[], max: number[] }} bounds
 * @param {Record<string, unknown>} ranges
 * @param {string[]} axes
 */
function clipBox(op, bounds, ranges, axes) {
  for (const key of Object.keys(ranges)) if (!axes.includes(key)) throw new Error(`${op}: unknown axis "${key}"; give ${axes.join(', ')}`);
  return axes.map((axis, k) => {
    const spare = Math.max(1, bounds.max[k] - bounds.min[k]);
    const range = ranges[axis] ?? [-Infinity, Infinity];
    if (!Array.isArray(range) || range.length !== 2 || range.some((v) => typeof v !== 'number' || Number.isNaN(v)) || !(range[0] < range[1])) {
      throw new Error(`${op}: ${axis} must be [from, to] with from < to, got ${JSON.stringify(range)}`);
    }
    return [Math.max(range[0], bounds.min[k] - spare), Math.min(range[1], bounds.max[k] + spare)];
  });
}

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
   * Keeps the part of the solid within ranges along the axes: `dome.clip({ z: [0, Infinity] })` keeps
   * what is above the XY plane, `turret.clip({ x: [-9, 9] })` a slab. Axes left out are not cut. For a
   * section to look inside, `part.clip({ x: [0, Infinity] })`. With `{ outside: true }` it keeps what
   * lies outside that box instead: `base.clip({ x: [-20, 20], y: [-Infinity, 5] }, { outside: true })`
   * cuts a notch.
   * @param {{ x?: [number, number], y?: [number, number], z?: [number, number] }} ranges
   * @param {{ outside?: boolean }} [options]
   * @returns {Solid}
   */
  clip(ranges, options = {}) {
    const box = clipBox('clip()', this.bounds(), ranges ?? {}, ['x', 'y', 'z']);
    if (box.some(([a, b]) => !(a < b))) return options.outside ? this : new Solid(Manifold.compose([]));
    const block = new Solid(Manifold.cube(box.map(([a, b]) => b - a), false)).translate(box.map(([a]) => a));
    return options.outside ? this.subtract(block) : this.intersect(block);
  }

  /**
   * The plane of one side of the bounding box, to draw on and extrude from: `'+X'` is the side at the
   * largest X, its normal pointing out, and so on for `'-X'`, `'+Y'`, `'-Y'`, `'+Z'`, `'-Z'`. Its u and v
   * are Y and Z on an X side, X and Z on a Y side, X and Y on a Z side, seen from outside: world
   * coordinates on `+X`, `-Y` and `+Z`; on `-X`, `+Y` and `-Z` u runs the other way (u = -y on `-X`),
   * so what is drawn there reads right from outside and what is placed there is not mirrored.
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
   * boss on a dome or a sloped wall goes in square to it. On a curve the normal is smoothed across the
   * mesh's facets, close to the true surface's; at a sharp edge each face keeps its own.
   * `dome.surfaceAt('+Z', [42, 0])` is the point on top of the dome above x = 42, y = 0.
   * @param {'+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z'} side
   * @param {number[]} at [u, v] on that side, as for `face()`
   */
  surfaceAt(side, at) {
    const face = faceFrame(side, this.bounds());
    const m = face.matrix;
    const [u, v] = [at[0] ?? 0, at[1] ?? 0];
    // Start a little outside the face, so a surface lying on it is met too.
    const origin = [0, 1, 2].map((k) => m[k] * u + m[4 + k] * v + m[8 + k] + m[12 + k]);
    const dir = [-m[8], -m[9], -m[10]];
    // Vertex normals smoothed across the facets of a curve (turning less than 40° between triangles) and
    // kept apart at sharp edges, to read the surface's own normal off the triangle met.
    const extra = this.manifold.numProp();
    const hit = firstHit(this.manifold.calculateNormals(extra, SMOOTH_UNDER).getMesh(), origin, dir, 3 + extra);
    if (!hit) throw new Error(`surfaceAt(): nothing of the solid lies under [${u}, ${v}] on its ${side} side`);
    return frameAt(hit.point, hit.normal);
  }
}

/** Faces meeting at more than this many degrees are an edge to surfaceAt(), not facets of one curve. */
const SMOOTH_UNDER = 40;

/**
 * Where a ray from `origin` along `dir` first meets a mesh, with the outward normal there, or null if it
 * misses (Möller–Trumbore against every triangle). The normal blends the vertex normals stored at
 * `normalAt` across the triangle met.
 * @param {{ numProp: number, vertProperties: Float32Array, triVerts: Uint32Array }} mesh
 * @param {number[]} origin
 * @param {number[]} dir
 * @returns {{ point: Vec3, normal: Vec3 } | null}
 */
function firstHit({ numProp, vertProperties, triVerts }, origin, dir, normalAt) {
  const vertex = (i) => [vertProperties[i * numProp], vertProperties[i * numProp + 1], vertProperties[i * numProp + 2]];
  const normal = (i) => [0, 1, 2].map((k) => vertProperties[i * numProp + normalAt + k]);
  const { sub, cross, dot } = vec3;
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
    const [na, nb, nc] = [normal(triVerts[t]), normal(triVerts[t + 1]), normal(triVerts[t + 2])];
    const w0 = 1 - w1 - w2;
    best = { distance, normal: [0, 1, 2].map((k) => w0 * na[k] + w1 * nb[k] + w2 * nc[k]) };
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
   * OpenSCAD's `[0, 0, degrees]` is taken too; a turn about X or Y would leave the plane, so it throws.
   * @param {number | number[]} angle
   * @param {RotateOptions} [options]
   * @returns {Shape2}
   */
  rotate(angle, options) {
    const degrees = Array.isArray(angle) ? planarAngle(angle) : angle;
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

  /**
   * A wall `thickness` wide along the outline, inside it: the shape less the shape shrunk by `thickness`,
   * corners kept sharp. `{ outward: true }` puts the wall outside the outline instead. A tube's section,
   * a gasket, a rim.
   * @param {number} thickness
   * @param {{ outward?: boolean }} [options]
   * @returns {Shape2}
   */
  ring(thickness, options = {}) {
    if (!(typeof thickness === 'number' && thickness > 0)) throw new Error(`ring(): thickness must be more than 0, got ${thickness}`);
    return options.outward ? this.offset({ delta: thickness }).subtract(this) : this.subtract(this.offset({ delta: -thickness }));
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
   * Keeps the part of the shape within ranges along X and Y, as `Solid.clip` does:
   * `arch.clip({ y: [0, Infinity] })` keeps what is above the X axis; `{ outside: true }` keeps the rest.
   * @param {{ x?: [number, number], y?: [number, number] }} ranges
   * @param {{ outside?: boolean }} [options]
   * @returns {Shape2}
   */
  clip(ranges, options = {}) {
    const box = clipBox('clip()', this.bounds(), ranges ?? {}, ['x', 'y']);
    if (box.some(([a, b]) => !(a < b))) return options.outside ? this : new Shape2(new CrossSection([], 'Positive'));
    const block = new Shape2(CrossSection.square([box[0][1] - box[0][0], box[1][1] - box[1][0]], false)).translate([box[0][0], box[1][0]]);
    return options.outside ? this.subtract(block) : this.intersect(block);
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
    return new Point(mat4.apply(m, this.x, this.y, this.z));
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
