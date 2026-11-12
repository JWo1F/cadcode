// Paths: outlines drawn piece by piece — lines, Bézier curves, arcs and smooth splines through
// points — closed into a 2D shape, or left open as the points of a path to sweep along.

import { polygon, circle, union, segmentsFor, cornerSpecs, resolution } from './shapes.js';
import { vec2 as V2 } from './vec.js';

/** @typedef {[number, number]} Vec2 */

const EPS = 1e-9;
const { sub, add, scale: mul, dot, cross: crossZ, distance: dist, normalize: unit, left, fromAngle } = V2;

/** @param {string} op @param {unknown} p @returns {Vec2} */
function vec2(op, p) {
  if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number') throw new Error(`${op}: a point must be [x, y], got ${JSON.stringify(p)}`);
  return [p[0], p[1]];
}

/**
 * @internal What a sketch is told as a path in it grows, so the viewer can draw it: a handle (from an
 * end to its control point), a point the path passes through, the curve so far, and the closed outline.
 * @typedef {{ handle(a: Vec2, b: Vec2): void, point(p: Vec2): void, trace(points: Vec2[]): void, profile(shape: import('./shapes.js').Shape2): void }} PathHooks
 */

/**
 * @typedef {object} SplineEnds
 * @property {number} [start] the direction the curve leaves its first point, degrees counter-clockwise
 *   from +X; without it the curve starts along its first chord (or along the path before it)
 * @property {number} [end] the direction it arrives at its last point, likewise
 */

/**
 * The cubic Bézier pieces of a centripetal Catmull-Rom spline through points: smooth through every
 * point, without the loops and overshoot a uniform spline makes where points are unevenly spaced.
 * @param {Vec2[]} knots
 * @param {{ closed?: boolean, start?: Vec2 | null, end?: Vec2 | null }} ends unit tangents for an open spline's ends
 * @returns {[Vec2, Vec2, Vec2][]} per piece: its two control points and its end
 */
function catmullRom(knots, { closed = false, start = null, end = null }) {
  const n = knots.length;
  const at = (i) => (closed ? knots[(i + n) % n] : knots[i]);
  const pieces = [];
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const [p1, p2] = [at(i), at(i + 1)];
    const chord = dist(p1, p2);
    // A missing neighbour past an open end is the next point reflected through the end.
    const p0 = closed || i > 0 ? at(i - 1) : sub(mul(p1, 2), p2);
    const p3 = closed || i + 2 < n ? at(i + 2) : sub(mul(p2, 2), p1);
    const [d1, d2, d3] = [dist(p0, p1), chord, dist(p2, p3)].map((d) => Math.max(Math.sqrt(d), EPS));
    let c1 = mul(add(add(mul(p2, d1 * d1), mul(p0, -d2 * d2)), mul(p1, 2 * d1 * d1 + 3 * d1 * d2 + d2 * d2)), 1 / (3 * d1 * (d1 + d2)));
    let c2 = mul(add(add(mul(p1, d3 * d3), mul(p3, -d2 * d2)), mul(p2, 2 * d3 * d3 + 3 * d3 * d2 + d2 * d2)), 1 / (3 * d3 * (d3 + d2)));
    if (!closed && i === 0 && start) c1 = add(p1, mul(start, chord / 3));
    if (!closed && i === count - 1 && end) c2 = sub(p2, mul(end, chord / 3));
    pieces.push([c1, c2, p2]);
  }
  return pieces;
}

/**
 * Appends a piece's points (after the path's current one) and records where it ends.
 * @param {Path} path
 * @param {string} op
 * @param {Vec2[]} points
 * @param {Vec2} heading the direction the path is heading at the piece's end
 * @param {Vec2 | null} [lastControl] a cubic's second control point, for `smooth()`
 * @returns {Path}
 */
function append(path, op, points, heading, lastControl = null) {
  if (path.closed) throw new Error(`${op}: the path is closed`);
  if (points.length === 0 || dist(points[points.length - 1], path.end) < EPS) throw new Error(`${op}: the piece goes nowhere`);
  path.hooks?.trace([path.end, ...points]);
  path.pts.push(...points);
  path.joins.push(path.pts.length - 1);
  path.heading = heading;
  path.lastControl = lastControl;
  path.hooks?.point(path.end);
  return path;
}

/**
 * Rounds or cuts a closed outline's joins. The cut-back is measured along the outline either side of a
 * join, so a round next to a curve may reach over several of its short segments; the arc is tangent to
 * the directions the outline leaves the join in, and meets the outline where the cut-back ends.
 * @param {Vec2[]} pts the outline, not repeating its first point
 * @param {number[]} joins indices of the joins in `pts`
 * @param {({ kind: 'round' | 'chamfer', size: number } | undefined)[]} specs per join
 * @param {number | undefined} fn
 * @returns {Vec2[]}
 */
function softenJoins(pts, joins, specs, fn) {
  if (!specs.some(Boolean)) return pts;
  const n = pts.length;
  // Distance along the outline to each point, and the whole way round.
  const along = [0];
  for (let i = 1; i < n; i++) along.push(along[i - 1] + dist(pts[i - 1], pts[i]));
  const total = along[n - 1] + dist(pts[n - 1], pts[0]);
  const wrap = (d) => ((d % total) + total) % total;
  const pointAt = (d) => {
    const s = wrap(d);
    let i = 0;
    while (i + 1 < n && along[i + 1] <= s) i++;
    const [a, b] = [pts[i], pts[(i + 1) % n]];
    const span = (i + 1 < n ? along[i + 1] : total) - along[i];
    return span < EPS ? a : add(a, mul(sub(b, a), (s - along[i]) / span));
  };
  const cuts = joins.map((k, j) => {
    const spec = specs[j];
    if (!spec) return null;
    const p = pts[k];
    const u = unit(sub(pts[(k - 1 + n) % n], p)); // back along the way in
    const v = unit(sub(pts[(k + 1) % n], p)); // on along the way out
    const cos = Math.max(-1, Math.min(1, dot(u, v)));
    if (cos < -1 + 1e-9) return null; // no corner here: the outline runs straight through
    if (cos > 1 - 1e-9) throw new Error(`path.close(): join ${j} is a cusp, both sides leave it the same way, so it cannot be ${spec.kind === 'round' ? 'rounded' : 'cut'}`);
    const half = Math.acos(cos) / 2;
    const back = spec.kind === 'round' ? spec.size / Math.tan(half) : spec.size;
    return { j, k, p, u, v, half, back, spec };
  });
  // Each stretch between joins needs room for the cut-backs at both its ends.
  joins.forEach((k, j) => {
    const next = (j + 1) % joins.length;
    const room = wrap(along[joins[next]] - along[k]) || total;
    const need = (cuts[j]?.back ?? 0) + (cuts[next]?.back ?? 0);
    if (need > room + 1e-9) {
      const c = cuts[j] ?? cuts[next];
      throw new Error(`path.close(): ${c.spec.kind} ${c.spec.size} does not fit between joins ${j} and ${next}`);
    }
  });
  // What replaces each cut: where it starts along the outline, and its points.
  const inserts = cuts.filter(Boolean).map((c) => {
    const [a, b] = [pointAt(along[c.k] - c.back), pointAt(along[c.k] + c.back)];
    const out = [a];
    if (c.spec.kind === 'round') {
      const r = c.spec.size;
      const bisector = unit(add(c.u, c.v));
      const center = add(c.p, mul(bisector, r / Math.sin(c.half)));
      const [ta, tb] = [add(c.p, mul(c.u, c.back)), add(c.p, mul(c.v, c.back))];
      const from = Math.atan2(ta[1] - center[1], ta[0] - center[0]);
      let turn = Math.atan2(tb[1] - center[1], tb[0] - center[0]) - from;
      if (turn > Math.PI) turn -= 2 * Math.PI;
      if (turn < -Math.PI) turn += 2 * Math.PI;
      const steps = Math.max(1, Math.ceil((segmentsFor(r, fn) * Math.abs(turn)) / (2 * Math.PI)));
      for (let i = 1; i < steps; i++) {
        const t = from + (turn * i) / steps;
        out.push(/** @type {Vec2} */ ([center[0] + r * Math.cos(t), center[1] + r * Math.sin(t)]));
      }
    }
    out.push(b);
    return { from: wrap(along[c.k] - c.back), to: wrap(along[c.k] + c.back), points: out };
  });
  const inside = (d, { from, to }) => (from <= to ? d > from - 1e-9 && d < to + 1e-9 : d > from - 1e-9 || d < to + 1e-9);
  // The outline's own points outside every cut, and each cut's points, in order round the outline.
  const items = [];
  pts.forEach((p, i) => {
    if (!inserts.some((c) => inside(along[i], c))) items.push({ at: along[i], points: [p] });
  });
  for (const c of inserts) items.push({ at: c.from, points: c.points });
  items.sort((x, y) => x.at - y.at);
  return items.flatMap((item) => item.points);
}

/** Point on a Bézier curve of any degree at t, by de Casteljau. @param {Vec2[]} controls @param {number} t @returns {Vec2} */
function bezierAt(controls, t) {
  let row = controls;
  while (row.length > 1) row = row.slice(1).map((p, i) => /** @type {Vec2} */ ([row[i][0] + (p[0] - row[i][0]) * t, row[i][1] + (p[1] - row[i][1]) * t]));
  return row[0];
}

/** Samples per curve to find where it bends; the points kept are chosen among them. */
const DENSE = 512;

/**
 * The points along a Bézier curve after its start, up to and including its end, placed where it bends:
 * a point every `360 / fn` degrees of turning, or, without `fn`, every `fa` degrees but never closer
 * than `fs` — the rules a circle follows. A curve that bends hard at one end gets its points there,
 * not spread evenly along the parameter.
 * @param {Vec2[]} controls the start, the control points and the end
 * @param {number | undefined} fn
 * @returns {Vec2[]}
 */
function flattenCurve(controls, fn) {
  const f = fn ?? resolution.fn;
  const step = ((f > 0 ? 360 / f : resolution.fa) * Math.PI) / 180;
  const shortest = f > 0 ? 0 : resolution.fs;
  const dense = Array.from({ length: DENSE + 1 }, (_, i) => bezierAt(controls, i / DENSE));
  const out = [];
  let turned = 0;
  let travelled = 0;
  let heading = null;
  for (let i = 1; i < DENSE; i++) {
    const d = sub(dense[i], dense[i - 1]);
    const length = Math.hypot(d[0], d[1]);
    if (length < EPS) continue;
    const dir = mul(d, 1 / length);
    if (heading) turned += Math.acos(Math.max(-1, Math.min(1, dot(heading, dir))));
    heading = dir;
    travelled += length;
    if (turned >= step - 1e-9 && travelled >= shortest) {
      out.push(dense[i]);
      [turned, travelled] = [0, 0];
    }
  }
  // A last point kept just short of the end would leave a sliver of a segment: let the end take its place.
  if (out.length > 0 && turned < step / 2) out.pop();
  out.push(dense[DENSE]);
  return out;
}

/**
 * An outline built piece by piece from a starting point: `path([0, 0]).line([10, 0]).curve(...).close()`.
 * Every piece starts where the last one ended. `close()` makes a 2D shape; an open path gives its
 * points to `sweep()` with `points()`. A path is built in place: each piece returns the same path.
 */
export class Path {
  /**
   * @internal
   * @param {Vec2} start
   * @param {{ fn?: number }} options
   * @param {PathHooks | null} hooks
   */
  constructor(start, options, hooks) {
    /** @internal @type {Vec2[]} */
    this.pts = [start];
    /** @internal Indices into the points where each piece ends; the start is join 0. @type {number[]} */
    this.joins = [0];
    /** @internal The direction the path is heading at its end, or null before the first piece. @type {Vec2 | null} */
    this.heading = null;
    /** @internal The last cubic's second control point, for `smooth()`. @type {Vec2 | null} */
    this.lastControl = null;
    /** @internal */
    this.fn = options.fn;
    /** @internal */
    this.hooks = hooks;
    /** @internal */
    this.closed = false;
    hooks?.point(start);
  }

  /** Where the path is now: the end of its last piece. @returns {Vec2} */
  get end() {
    return this.pts[this.pts.length - 1];
  }

  /**
   * A straight line to a point, or from here at an angle for a length: `line({ angle: 60, length: 8 })`.
   * @param {number[] | { angle: number, length: number }} to
   * @returns {Path}
   */
  line(to) {
    let p;
    if (to && !Array.isArray(to)) {
      if (typeof to.angle !== 'number' || !(typeof to.length === 'number' && to.length > 0)) throw new Error('path.line(): give a point, or { angle, length } with a length more than 0');
      p = add(this.end, mul(fromAngle(to.angle), to.length));
    } else p = vec2('path.line()', to);
    return append(this, 'path.line()', [p], unit(sub(p, this.end)));
  }

  /**
   * A cubic Bézier curve to `to`, leaving towards `c1` and arriving from `c2`.
   * @param {number[]} c1
   * @param {number[]} c2
   * @param {number[]} to
   * @returns {Path}
   */
  curve(c1, c2, to) {
    const [a, b, p] = [vec2('path.curve()', c1), vec2('path.curve()', c2), vec2('path.curve()', to)];
    const start = this.end;
    this.hooks?.handle(start, a);
    this.hooks?.handle(p, b);
    const heading = dist(b, p) > EPS ? unit(sub(p, b)) : dist(a, p) > EPS ? unit(sub(p, a)) : unit(sub(p, start));
    return append(this, 'path.curve()', flattenCurve([start, a, b, p], this.fn), heading, b);
  }

  /**
   * A quadratic Bézier curve to `to`, pulled towards one control point `c`.
   * @param {number[]} c
   * @param {number[]} to
   * @returns {Path}
   */
  quad(c, to) {
    const [k, p] = [vec2('path.quad()', c), vec2('path.quad()', to)];
    const start = this.end;
    this.hooks?.handle(start, k);
    this.hooks?.handle(p, k);
    const heading = dist(k, p) > EPS ? unit(sub(p, k)) : unit(sub(p, start));
    return append(this, 'path.quad()', flattenCurve([start, k, p], this.fn), heading);
  }

  /**
   * A cubic Bézier curve that carries on smoothly from the last one: its first control point mirrors the
   * last curve's second through the current point, like SVG's `S`. After anything but a curve it is the
   * current point itself.
   * @param {number[]} c2
   * @param {number[]} to
   * @returns {Path}
   */
  smooth(c2, to) {
    const here = this.end;
    const c1 = this.lastControl ? sub(mul(here, 2), this.lastControl) : here;
    return this.curve(c1, c2, to);
  }

  /**
   * A circular arc to `to`: carrying on along the direction the path is heading, leaving in a direction
   * of its own with `{ start }` (degrees counter-clockwise from +X, which also turns a corner), or through
   * a point with `{ through }`. The first piece of a path needs `start` or `through`, having no direction yet.
   * @param {number[]} to
   * @param {{ through?: number[], start?: number }} [options]
   * @returns {Path}
   */
  arc(to, options = {}) {
    const op = 'path.arc()';
    const a = this.end;
    const b = vec2(op, to);
    let center;
    let turn; // signed angle swept, counter-clockwise positive
    if (options.through !== undefined && options.start !== undefined) throw new Error(`${op}: give through or start, not both`);
    if (options.through !== undefined) {
      const q = vec2(op, options.through);
      // The circle through a, q and b.
      const d = 2 * (a[0] * (q[1] - b[1]) + q[0] * (b[1] - a[1]) + b[0] * (a[1] - q[1]));
      if (Math.abs(d) < EPS) return this.line(b);
      const sq = (p) => p[0] * p[0] + p[1] * p[1];
      center = /** @type {Vec2} */ ([
        (sq(a) * (q[1] - b[1]) + sq(q) * (b[1] - a[1]) + sq(b) * (a[1] - q[1])) / d,
        (sq(a) * (b[0] - q[0]) + sq(q) * (a[0] - b[0]) + sq(b) * (q[0] - a[0])) / d,
      ]);
      const angle = (p) => Math.atan2(p[1] - center[1], p[0] - center[0]);
      const ccw = crossZ(sub(q, a), sub(b, q)) > 0;
      const span = (from, toAngle) => {
        let t = toAngle - from;
        if (ccw) while (t <= 0) t += 2 * Math.PI;
        else while (t >= 0) t -= 2 * Math.PI;
        return t;
      };
      turn = span(angle(a), angle(b));
    } else {
      const heading = options.start !== undefined ? fromAngle(options.start) : this.heading;
      if (!heading) throw new Error(`${op}: the first piece of a path has no direction to carry on; give { start } or { through }`);
      const n = left(heading);
      const chord = sub(b, a);
      const along = dot(chord, n);
      if (Math.abs(along) < EPS) return this.line(b); // straight ahead: a line
      // The circle tangent to the heading at a, through b.
      const r = dot(chord, chord) / (2 * along);
      center = add(a, mul(n, r));
      const [u, v] = [sub(a, center), sub(b, center)];
      turn = Math.atan2(crossZ(u, v), dot(u, v));
      // Heading on round the circle: the turn takes the side the heading points to.
      if (r > 0 && turn < 0) turn += 2 * Math.PI;
      if (r < 0 && turn > 0) turn -= 2 * Math.PI;
    }
    const r = dist(a, center);
    const from = Math.atan2(a[1] - center[1], a[0] - center[0]);
    const steps = Math.max(1, Math.ceil((segmentsFor(r, this.fn) * Math.abs(turn)) / (2 * Math.PI)));
    const points = [];
    for (let k = 1; k < steps; k++) {
      const t = from + (turn * k) / steps;
      points.push(/** @type {Vec2} */ ([center[0] + r * Math.cos(t), center[1] + r * Math.sin(t)]));
    }
    points.push(b);
    const radial = unit(sub(b, center));
    return append(this, op, points, turn > 0 ? left(radial) : mul(left(radial), -1));
  }

  /**
   * A smooth curve through points, carrying on along the direction the path is heading (a centripetal
   * Catmull-Rom spline, made of cubic Bézier pieces).
   * @param {number[][]} through the points to pass through, the last one where the piece ends
   * @param {SplineEnds} [options] `start` to leave in a direction of its own instead, turning a corner; `end` the arrival direction
   * @returns {Path}
   */
  spline(through, options = {}) {
    const op = 'path.spline()';
    if (!Array.isArray(through) || through.length === 0) throw new Error(`${op}: give at least one point to pass through`);
    const knots = [this.end, ...through.map((p) => vec2(op, p))];
    const start = options.start !== undefined ? fromAngle(options.start) : this.heading;
    const end = options.end !== undefined ? fromAngle(options.end) : null;
    const pieces = catmullRom(knots, { start, end });
    let from = this.end;
    const points = [];
    let lastControl = null;
    for (const [c1, c2, p] of pieces) {
      points.push(...flattenCurve([from, c1, c2, p], this.fn));
      lastControl = c2;
      from = p;
    }
    for (const k of through.slice(0, -1)) this.hooks?.point(vec2(op, k));
    const last = pieces[pieces.length - 1];
    const heading = dist(last[1], last[2]) > EPS ? unit(sub(last[2], last[1])) : unit(sub(last[2], knots[knots.length - 2]));
    return append(this, op, points, heading, lastControl);
  }

  /**
   * Closes the path back to its start with a straight line if it is not there already, and makes it a
   * 2D shape. `round` and `chamfer` soften the corners where pieces meet, as for `polygon()`, by the
   * index of the join: 0 is the start, then the end of each piece in order.
   * @param {import('./shapes.js').PolygonOptions} [options]
   * @returns {import('./shapes.js').Shape2}
   */
  close(options = {}) {
    if (this.closed) throw new Error('path.close(): the path is closed already');
    if (dist(this.end, this.pts[0]) > EPS) this.line(this.pts[0]);
    this.closed = true;
    const pts = this.pts.slice(0, -1);
    const joins = this.joins.slice(0, -1); // the last join is the start again
    const specs = cornerSpecs(joins.map((k) => pts[k]), options.round, options.chamfer, 'path.close()', 'join');
    const shape = polygon(softenJoins(pts, joins, specs, options.fn ?? this.fn));
    this.hooks?.profile(shape);
    return shape;
  }

  /**
   * The path drawn as a line `width` wide: a groove to engrave, a raised stroke, a wire channel. Its
   * ends are round, or square-cut with `{ cap: 'flat' }`; its bends are always round.
   * @param {number} width
   * @param {StrokeOptions} [options]
   * @returns {import('./shapes.js').Shape2}
   */
  stroke(width, options = {}) {
    return stroke(this.pts, width, { fn: this.fn, ...options });
  }

  /** The points along the path so far, from its start: a path to `sweep()` along, or to draw with. @returns {Vec2[]} */
  points() {
    return this.pts.map((p) => /** @type {Vec2} */ ([...p]));
  }
}

/**
 * Starts a path at a point: an outline drawn piece by piece with `line`, `curve`, `quad`, `smooth`,
 * `arc` and `spline`, then `close()`d into a 2D shape.
 * @param {number[]} start
 * @param {{ fn?: number }} [options] segments of a full turn for the path's curves, as for a circle
 * @returns {Path}
 */
export function path(start, options = {}) {
  return new Path(vec2('path()', start), options, null);
}

/**
 * @internal A path in a sketch.
 * @param {number[]} start
 * @param {{ fn?: number }} options
 * @param {PathHooks} hooks
 */
export function sketchPath(start, options, hooks) {
  return new Path(vec2('sketch.path()', start), options, hooks);
}

/**
 * @typedef {SplineEnds & { closed?: boolean, fn?: number }} SplineOptions
 */

/**
 * A smooth curve through points (a centripetal Catmull-Rom spline). Closed, it is a 2D shape; open, a
 * path to carry on with or to take the points of.
 * @param {number[][]} points
 * @param {SplineOptions} [options]
 * @returns {import('./shapes.js').Shape2 | Path}
 */
export function spline(points, options = {}) {
  return splineIn(points, options, null);
}

/**
 * @internal `spline()`, told to a sketch if there is one.
 * @param {number[][]} points
 * @param {SplineOptions} options
 * @param {PathHooks | null} hooks
 */
export function splineIn(points, options, hooks) {
  const op = 'spline()';
  if (!Array.isArray(points) || points.length < (options.closed ? 3 : 2)) throw new Error(`${op}: give at least ${options.closed ? 3 : 2} points`);
  const knots = points.map((p) => vec2(op, p));
  const start = new Path(knots[0], { fn: options.fn }, hooks);
  if (!options.closed) return start.spline(knots.slice(1), { start: options.start, end: options.end });
  const pieces = catmullRom(knots, { closed: true });
  let from = knots[0];
  const pts = [];
  pieces.forEach(([c1, c2, p], i) => {
    const flat = flattenCurve([from, c1, c2, p], options.fn);
    // The last piece comes back to the first point, which the outline already has.
    pts.push(...(i === pieces.length - 1 ? flat.slice(0, -1) : flat));
    from = p;
  });
  for (const k of knots.slice(1)) hooks?.point(k);
  hooks?.trace([knots[0], ...pts, knots[0]]);
  const shape = polygon([knots[0], ...pts], { fn: options.fn });
  hooks?.profile(shape);
  return shape;
}

/**
 * @typedef {object} StrokeOptions
 * @property {'round' | 'flat'} [cap] the ends: round (half a circle past each end) or cut square at the ends
 * @property {boolean} [closed] join the last point back to the first
 * @property {number} [fn] segments of a full circle for the round ends and bends
 */

/**
 * A line `width` wide through points, as a 2D shape: strokes of a hand-drawn font, an engraved seam, a
 * channel. Bends are round; ends are round, or square-cut with `{ cap: 'flat' }`.
 * @param {number[][]} points
 * @param {number} width
 * @param {StrokeOptions} [options]
 * @returns {import('./shapes.js').Shape2}
 */
export function stroke(points, width, options = {}) {
  const op = 'stroke()';
  if (!(typeof width === 'number' && width > 0)) throw new Error(`${op}: width must be more than 0, got ${width}`);
  const pts = points.map((p) => vec2(op, p));
  if (pts.length < 2) throw new Error(`${op}: give at least 2 points`);
  const { cap = 'round', closed = false, fn } = options;
  if (cap !== 'round' && cap !== 'flat') throw new Error(`${op}: cap must be 'round' or 'flat', got ${JSON.stringify(cap)}`);
  const r = width / 2;
  const dot = (p) => circle({ r, fn }).translate(p);
  const runs = closed ? [...pts, pts[0]] : pts;
  const pieces = [];
  for (let i = 1; i < runs.length; i++) {
    const [a, b] = [runs[i - 1], runs[i]];
    if (dist(a, b) < EPS) continue;
    const n = mul(left(unit(sub(b, a))), r);
    pieces.push(polygon([add(a, n), add(b, n), sub(b, n), sub(a, n)]));
  }
  // Round at every bend; at the ends only for round caps.
  const joints = closed || cap === 'round' ? pts : pts.slice(1, -1);
  return union(pieces, joints.map(dot));
}
