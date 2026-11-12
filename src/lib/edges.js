// Edges of a finished solid, and rounding or cutting them after the booleans. A solid is a
// triangle mesh, so an edge is where the surface turns sharply between two faces: found from the
// mesh and chained into runs that follow one flat face — a box's edge, or the whole rim of a
// rounded box's floor. A fillet subtracts (on an outside edge) or adds (on an inside one) the sliver
// between the corner and an arc, swept along the run; a chamfer does the same with a straight cut.

import { Solid, polygon, segmentsFor } from './shapes.js';

/** @typedef {[number, number, number]} Vec3 */

/**
 * An edge of a solid: a run of the mesh's sharp edges along one flat face, the base, with another
 * face, the side, on its other hand. On a box the side is flat too and the edge straight; around a
 * rounded corner the side turns with it.
 * @typedef {object} Edge
 * @property {Vec3[]} points the run, in order; a loop does not repeat its first point
 * @property {boolean} closed whether the run goes all the way round, as a rim does
 * @property {Vec3} from its first point
 * @property {Vec3} to its last point
 * @property {Vec3 | null} direction unit vector from `from` to `to` when the run is straight, else null
 * @property {number} length
 * @property {[Vec3, Vec3]} normals outward normals of the flat face along the whole run and of the
 *   side face where the run starts
 * @property {boolean} convex whether it is an outside edge, as on a box; an inside edge, where a wall
 *   meets a floor, is not
 * @property {number} angle degrees between the two faces' normals: 90 on a box
 */

/**
 * @typedef {'+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z' | number[]} Direction a face's outward direction:
 *   an axis or a vector
 */

/**
 * @typedef {object} EdgeFilter
 * @property {[Direction, Direction]} [between] the two faces where the edge starts point this way, in either order
 * @property {Direction} [touching] one of those two faces points this way
 * @property {'x' | 'y' | 'z' | number[]} [along] the edge is straight and runs along this axis or vector
 * @property {boolean} [convex] only outside edges (true) or only inside ones (false)
 * @property {(edge: Edge) => boolean} [where] any test of your own
 */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => mul(a, 1 / len(a));

/** Faces that meet at less than this many degrees are one surface, such as the facets of a cylinder. */
const SHARP = 20;
const COS_SHARP = Math.cos((SHARP * Math.PI) / 180);
/** Normals within 1° are the same face direction. */
const COS_SAME = Math.cos((1 * Math.PI) / 180);
const same = (a, b) => dot(a, b) > COS_SAME;

/** @param {Direction} d @param {string} op @returns {Vec3} */
function direction(d, op) {
  if (Array.isArray(d)) {
    const v = [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0];
    if (len(v) < 1e-12) throw new Error(`${op}: a direction must not be [0, 0, 0]`);
    return /** @type {Vec3} */ (unit(v));
  }
  const m = /^([+-])([XYZ])$/.exec(String(d));
  if (!m) throw new Error(`${op}: a direction is '+X', '-X', '+Y', '-Y', '+Z', '-Z' or [x, y, z], got ${JSON.stringify(d)}`);
  const v = [0, 0, 0];
  v['XYZ'.indexOf(m[2])] = m[1] === '+' ? 1 : -1;
  return /** @type {Vec3} */ (v);
}

/**
 * The mesh's sharp edges: where the triangles either side turn by more than 20°.
 * @param {Solid} solid
 */
function sharpEdges(solid) {
  const { numProp, vertProperties, triVerts } = solid.manifold.getMesh();
  // Vertices by position: a mesh may split one point into several for its properties.
  const ids = new Map();
  /** @type {number[][]} */
  const points = [];
  const vertexId = (v) => {
    const p = [vertProperties[v * numProp], vertProperties[v * numProp + 1], vertProperties[v * numProp + 2]];
    const key = p.map((c) => Math.round(c * 1e5)).join(',');
    if (!ids.has(key)) {
      ids.set(key, points.length);
      points.push(p);
    }
    return ids.get(key);
  };
  const tris = [];
  for (let t = 0; t < triVerts.length; t += 3) {
    const v = [vertexId(triVerts[t]), vertexId(triVerts[t + 1]), vertexId(triVerts[t + 2])];
    const n = cross(sub(points[v[1]], points[v[0]]), sub(points[v[2]], points[v[0]]));
    if (len(n) > 1e-12) tris.push({ v, n: unit(n) });
  }
  const sides = new Map();
  tris.forEach((tri) => {
    for (let k = 0; k < 3; k++) {
      const [a, b] = [tri.v[k], tri.v[(k + 1) % 3]];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (!sides.has(key)) sides.set(key, []);
      sides.get(key).push({ n: tri.n, other: tri.v[(k + 2) % 3] });
    }
  });
  const edges = [];
  for (const [key, list] of sides) {
    if (list.length !== 2 || dot(list[0].n, list[1].n) > COS_SHARP) continue;
    const [a, b] = key.split(',').map(Number);
    // An outside edge when the second face runs away from the edge below the first face's plane.
    const d = unit(sub(points[b], points[a]));
    const into = sub(points[list[1].other], points[a]);
    const across = sub(into, mul(d, dot(into, d)));
    edges.push({ a, b, normals: [list[0].n, list[1].n], convex: dot(across, list[0].n) < 0 });
  }
  return { points, edges };
}

/**
 * The solid's edges: sharp mesh edges chained into runs along one flat face, through points where the
 * run carries on by itself and bends by at most 60°.
 * @param {Solid} solid
 * @returns {Edge[]}
 */
function findEdges(solid) {
  const { points, edges: sharp } = sharpEdges(solid);
  const at = new Map();
  sharp.forEach((e, i) => {
    for (const v of [e.a, e.b]) {
      if (!at.has(v)) at.set(v, []);
      at.get(v).push(i);
    }
  });
  const dirFrom = (j, v) => {
    const e = sharp[j];
    const w = e.a === v ? e.b : e.a;
    return unit(sub(points[w], points[v]));
  };
  // The mesh edge that carries a run along face `base` on past point `v` from edge `i`: the only other
  // sharp edge there on the same face, turning the same way, bending by at most 60°. Box corners turn
  // 90° and end a run; the facets of a rounded corner carry it on.
  const next = (v, i, base) => {
    const incoming = mul(dirFrom(i, v), -1);
    const on = at.get(v).filter((j) => j !== i && sharp[j].convex === sharp[i].convex && sharp[j].normals.some((n) => same(n, base)));
    if (on.length !== 1) return undefined;
    return dot(incoming, dirFrom(on[0], v)) >= 0.5 - 1e-9 ? on[0] : undefined;
  };
  // The run from edge `s` along face `base`, walking both ways; it may come round to `s` again.
  const runFrom = (s, base, used) => {
    const start = sharp[s];
    const run = new Set([s]);
    const walk = (from) => {
      const ids = [];
      let [v, i] = [from, s];
      for (;;) {
        const j = next(v, i, base);
        if (j === s) return { ids, loop: true };
        if (j === undefined || used.has(j) || run.has(j)) return { ids, loop: false };
        run.add(j);
        v = sharp[j].a === v ? sharp[j].b : sharp[j].a;
        ids.push(v);
        i = j;
      }
    };
    const ahead = walk(start.b);
    const behind = ahead.loop ? { ids: [] } : walk(start.a);
    const ids = [...behind.ids.reverse(), start.a, start.b, ...ahead.ids];
    if (ahead.loop) ids.pop(); // the loop came back to its start
    return { ids, run, closed: ahead.loop };
  };
  const used = new Set();
  /** @type {Edge[]} */
  const out = [];
  sharp.forEach((start, s) => {
    if (used.has(s)) return;
    // Either face of the first mesh edge may be the one the run follows; take the longer run.
    const [a, b] = start.normals.map((n) => ({ base: n, ...runFrom(s, n, used) }));
    const { base, ids, run, closed } = b.run.size > a.run.size ? b : a;
    for (const j of run) used.add(j);
    const first = [...run].map((j) => sharp[j]).find((m) => (m.a === ids[0] && m.b === ids[1]) || (m.a === ids[1] && m.b === ids[0])) ?? start;
    const side = first.normals.find((n) => !same(n, base)) ?? first.normals[1];
    const pts = ids.map((id) => /** @type {Vec3} */ ([...points[id]]));
    let length = 0;
    for (let k = 1; k < pts.length; k++) length += len(sub(pts[k], pts[k - 1]));
    if (closed) length += len(sub(pts[0], pts[pts.length - 1]));
    const chord = sub(pts[pts.length - 1], pts[0]);
    const straight = !closed && Math.abs(len(chord) - length) < 1e-6 * Math.max(1, length);
    out.push({
      points: pts,
      closed,
      from: pts[0],
      to: pts[pts.length - 1],
      direction: straight ? /** @type {Vec3} */ (unit(chord)) : null,
      length,
      normals: [/** @type {Vec3} */ (base), /** @type {Vec3} */ (side)],
      convex: start.convex,
      angle: (Math.acos(Math.max(-1, Math.min(1, dot(base, side)))) * 180) / Math.PI,
    });
  });
  return out;
}

/** Whether an edge passes a filter. @param {Edge} edge @param {EdgeFilter} filter @param {string} op */
function passes(edge, filter, op) {
  const [n1, n2] = edge.normals;
  if (filter.between) {
    const [a, b] = filter.between.map((d) => direction(d, op));
    if (!((same(n1, a) && same(n2, b)) || (same(n1, b) && same(n2, a)))) return false;
  }
  if (filter.touching) {
    const t = direction(filter.touching, op);
    if (!same(n1, t) && !same(n2, t)) return false;
  }
  if (filter.along) {
    const axis = typeof filter.along === 'string' ? direction(`+${filter.along.toUpperCase()}`, op) : direction(filter.along, op);
    if (!edge.direction || Math.abs(dot(edge.direction, axis)) < COS_SAME) return false;
  }
  if (filter.convex !== undefined && edge.convex !== filter.convex) return false;
  if (filter.where && !filter.where(edge)) return false;
  return true;
}

/**
 * @internal The edges of a solid that pass a filter.
 * @param {Solid} solid
 * @param {EdgeFilter} [filter]
 * @param {string} [op]
 * @returns {Edge[]}
 */
export function edgesOf(solid, filter = {}, op = 'edges()') {
  const known = ['between', 'touching', 'along', 'convex', 'where'];
  for (const key of Object.keys(filter)) if (!known.includes(key)) throw new Error(`${op}: unknown filter "${key}"; the filters are ${known.join(', ')}`);
  return findEdges(solid).filter((e) => passes(e, filter, op));
}

/**
 * The section that rounds or cuts an edge, in the plane across it with the corner at the origin:
 * drawn with +Y along the base face's normal and +X = base × tangent, as `sweep({ up: base })` places it.
 * An outside edge's cutter reaches a little out past the faces, an inside edge's filler sinks a little
 * into them, so neither leaves a skin.
 */
function section(edge, kind, size, fn) {
  const [base, side] = edge.normals;
  const tangent = unit(sub(edge.points[1], edge.points[0]));
  const X = cross(base, tangent);
  const flat = (p) => [dot(p, X), dot(p, base)];
  const sign = edge.convex ? -1 : 1; // the arc's center lies in the material on an outside edge, in the air on an inside one
  const reach = Math.max(size * 0.05, 0.01);
  const out = (p, n) => add(p, mul(n, -sign * reach));
  // Where the round or cut meets each face, measured from the corner.
  let T1;
  let T2;
  let center = null;
  if (kind === 'round') {
    const k = (sign * size) / (1 + dot(base, side));
    center = add(mul(base, k), mul(side, k));
    T1 = add(center, mul(base, -sign * size));
    T2 = add(center, mul(side, -sign * size));
  } else {
    // Along each face, across the edge, toward the other face's inside.
    const into = (n, other) => {
      const a = unit(cross(tangent, n));
      return dot(a, other) < 0 === edge.convex ? a : mul(a, -1);
    };
    T1 = mul(into(base, side), size);
    T2 = mul(into(side, base), size);
  }
  const pts = [T1, out(T1, base), out([0, 0, 0], add(base, side)), out(T2, side), T2].map(flat);
  // A round closes back from T2 to T1 along the arc, its points on the circle from end to end, so the
  // round meets both faces exactly where it touches them.
  if (center) {
    const [c, a, b] = [center, T2, T1].map(flat);
    const from = Math.atan2(a[1] - c[1], a[0] - c[0]);
    let turn = Math.atan2(b[1] - c[1], b[0] - c[0]) - from;
    if (turn > Math.PI) turn -= 2 * Math.PI;
    if (turn < -Math.PI) turn += 2 * Math.PI;
    const steps = Math.max(1, Math.ceil((segmentsFor(size, fn) * Math.abs(turn)) / (2 * Math.PI)));
    for (let k = 1; k < steps; k++) {
      const t = from + (turn * k) / steps;
      pts.push([c[0] + size * Math.cos(t), c[1] + size * Math.sin(t)]);
    }
  }
  return polygon(counterClockwise(pts));
}

/** The points of a simple polygon, counter-clockwise. */
function counterClockwise(pts) {
  let area = 0;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    area += p[0] * q[1] - q[0] * p[1];
  });
  return area < 0 ? [...pts].reverse() : pts;
}

/** The section swept along the edge. Outside edges reach past open ends, into air; inside ones stop at them. */
function piece(edge, kind, size, fn) {
  const shape = section(edge, kind, size, fn);
  const path = [...edge.points];
  if (!edge.closed && edge.convex) {
    const reach = Math.max(size * 0.05, 0.01);
    const n = path.length;
    path[0] = add(path[0], mul(unit(sub(path[0], path[1])), reach));
    path[n - 1] = add(path[n - 1], mul(unit(sub(path[n - 1], path[n - 2])), reach));
  }
  return shape.sweep(path, { closed: edge.closed, up: edge.normals[0] });
}

/**
 * @internal Rounds or cuts the edges of a solid that pass a filter.
 * @param {Solid} solid
 * @param {'round' | 'chamfer'} kind
 * @param {number} size
 * @param {EdgeFilter & { fn?: number }} [filter]
 * @returns {Solid}
 */
export function softenEdges(solid, kind, size, filter = {}) {
  const op = kind === 'round' ? 'fillet()' : 'chamfer()';
  if (!(typeof size === 'number' && size > 0)) throw new Error(`${op}: the size must be more than 0, got ${size}`);
  const { fn, ...rest } = filter;
  const edges = edgesOf(solid, rest, op);
  if (edges.length === 0) throw new Error(`${op}: no edge of the solid passes the filter`);
  const cutters = edges.filter((e) => e.convex).map((e) => piece(e, kind, size, fn));
  const fillers = edges.filter((e) => !e.convex).map((e) => piece(e, kind, size, fn));
  return solid.subtract(cutters).union(fillers);
}
