// Sketches: construction geometry in a frame's 2D coordinates — lines, parallels, perpendiculars,
// circles and where they cross — to work out the points of an outline, as on paper. The guides are
// no geometry of the part: return the sketch in a part and the viewer draws them, dashed, in place.

import { plane } from './frame.js';
import { polygon } from './shapes.js';

/** @typedef {[number, number]} Vec2 */

const EPS = 1e-9;

/** @param {number[]} p @returns {Vec2} */
const vec2 = (p) => {
  if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number') throw new Error(`sketch: a point must be [x, y], got ${JSON.stringify(p)}`);
  return [p[0], p[1]];
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => /** @type {Vec2} */ ([a[0] + b[0], a[1] + b[1]]);
const mul = (a, k) => /** @type {Vec2} */ ([a[0] * k, a[1] * k]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const crossZ = (a, b) => a[0] * b[1] - a[1] * b[0];
const left = (d) => /** @type {Vec2} */ ([-d[1], d[0]]);

/** Adds a guide to its sketch, for the viewer. @template {Line | Circle} T @param {T} guide @returns {T} */
function keep(guide) {
  guide.sketch.guides.push(guide);
  return guide;
}

/** Adds a point to a sketch, for the viewer. @param {Sketch} sketch @param {Vec2} p @returns {Vec2} */
function mark(sketch, p) {
  sketch.points.push(p);
  return p;
}

/**
 * A straight line in a sketch, through two points or endless. Crossings and perpendiculars treat
 * every line as endless; the two points only say how much of it the viewer draws.
 */
export class Line {
  /**
   * @internal
   * @param {Sketch} sketch
   * @param {Vec2} start
   * @param {Vec2} end
   * @param {boolean} endless
   */
  constructor(sketch, start, end, endless) {
    if (Math.hypot(...sub(end, start)) < EPS) throw new Error('sketch.line(): the two points are the same');
    this.sketch = sketch;
    /** @type {Vec2} */
    this.start = start;
    /** @type {Vec2} */
    this.end = end;
    /** Whether it runs on past both points (from `line(p, { angle })`); the viewer draws it across the sketch. */
    this.endless = endless;
  }

  /** The unit direction from start to end. @returns {Vec2} */
  get direction() {
    const d = sub(this.end, this.start);
    return mul(d, 1 / Math.hypot(...d));
  }

  /** Degrees counter-clockwise from +u. @returns {number} */
  get angle() {
    const [dx, dy] = this.direction;
    return (Math.atan2(dy, dx) * 180) / Math.PI;
  }

  /** From start to end. @returns {number} */
  get length() {
    return Math.hypot(...sub(this.end, this.start));
  }

  /** Halfway from start to end. @returns {Vec2} */
  get mid() {
    return this.at(0.5);
  }

  /**
   * The point a fraction `t` of the way from start to end; below 0 or above 1 it lies beyond them.
   * @param {number} t
   * @returns {Vec2}
   */
  at(t) {
    return add(this.start, mul(sub(this.end, this.start), t));
  }

  /**
   * A line `distance` away beside this one, over the same stretch: positive to the left looking from
   * start to end, negative to the right.
   * @param {number} distance
   * @returns {Line}
   */
  parallel(distance) {
    const shift = mul(left(this.direction), distance);
    return keep(new Line(this.sketch, add(this.start, shift), add(this.end, shift), this.endless));
  }

  /**
   * The line through `point` at right angles to this one. From a point off the line it runs from that
   * point to its foot on the line (`.end`); through a point on the line it is endless.
   * @param {number[]} point
   * @returns {Line}
   */
  perpendicular(point) {
    const p = vec2(point);
    const d = this.direction;
    const foot = add(this.start, mul(d, dot(sub(p, this.start), d)));
    const s = this.sketch;
    if (Math.hypot(...sub(foot, p)) > EPS) return keep(new Line(s, p, foot, false));
    return keep(new Line(s, p, add(p, left(d)), true));
  }

  /**
   * Where this line crosses another line (one point; parallel lines throw) or a circle (the points in
   * order from start towards end: none, one where it touches, or two). The points join the sketch.
   * @overload
   * @param {Line} other
   * @returns {Vec2}
   */
  /**
   * @overload
   * @param {Circle} other
   * @returns {Vec2[]}
   */
  /**
   * @param {Line | Circle} other
   * @returns {Vec2 | Vec2[]}
   */
  intersect(other) {
    if (other instanceof Circle) return other.intersect(this);
    if (!(other instanceof Line)) throw new Error('Line.intersect(): the other must be a line or a circle of a sketch');
    const d = this.direction;
    const e = other.direction;
    const denominator = crossZ(d, e);
    if (Math.abs(denominator) < EPS) throw new Error('Line.intersect(): the lines are parallel');
    const t = crossZ(sub(other.start, this.start), e) / denominator;
    return mark(this.sketch, add(this.start, mul(d, t)));
  }
}

/** A circle in a sketch: a guide, not a shape. For a round shape use `circle()`. */
export class Circle {
  /**
   * @internal
   * @param {Sketch} sketch
   * @param {Vec2} center
   * @param {number} r
   */
  constructor(sketch, center, r) {
    if (!(typeof r === 'number' && r > 0)) throw new Error(`sketch.circle(): the radius must be more than 0, got ${r}`);
    this.sketch = sketch;
    /** @type {Vec2} */
    this.center = center;
    /** @type {number} */
    this.r = r;
  }

  /**
   * The point on the circle at `degrees` counter-clockwise from +u.
   * @param {number} degrees
   * @returns {Vec2}
   */
  at(degrees) {
    const a = (degrees * Math.PI) / 180;
    return add(this.center, [this.r * Math.cos(a), this.r * Math.sin(a)]);
  }

  /**
   * Where this circle crosses a line (in order from the line's start towards its end) or another circle
   * (first the point on the left looking from this center to the other's): none, one where they touch,
   * or two. The points join the sketch.
   * @param {Line | Circle} other
   * @returns {Vec2[]}
   */
  intersect(other) {
    const s = this.sketch;
    if (other instanceof Line) {
      const d = other.direction;
      const foot = dot(sub(this.center, other.start), d);
      const closest = add(other.start, mul(d, foot));
      const gap = Math.hypot(...sub(this.center, closest));
      if (gap > this.r + EPS) return [];
      const half = Math.sqrt(Math.max(0, this.r ** 2 - gap ** 2));
      const points = half < EPS ? [closest] : [add(closest, mul(d, -half)), add(closest, mul(d, half))];
      return points.map((p) => mark(s, p));
    }
    if (!(other instanceof Circle)) throw new Error('Circle.intersect(): the other must be a line or a circle of a sketch');
    const between = sub(other.center, this.center);
    const distance = Math.hypot(...between);
    if (distance < EPS) {
      if (Math.abs(this.r - other.r) < EPS) throw new Error('Circle.intersect(): the circles are the same');
      return [];
    }
    if (distance > this.r + other.r + EPS || distance < Math.abs(this.r - other.r) - EPS) return [];
    const along = (distance ** 2 + this.r ** 2 - other.r ** 2) / (2 * distance);
    const d = mul(between, 1 / distance);
    const base = add(this.center, mul(d, along));
    const half = Math.sqrt(Math.max(0, this.r ** 2 - along ** 2));
    const points = half < EPS ? [base] : [add(base, mul(left(d), half)), add(base, mul(left(d), -half))];
    return points.map((p) => mark(s, p));
  }
}

/**
 * A drawing board on a frame: guides to work out points with, and the outlines made from them.
 * `sketch.extrude()` puts an outline into the part; returning the sketch in a part shows its guides.
 */
export class Sketch {
  /**
   * @internal
   * @param {import('./frame.js').Frame} frame
   */
  constructor(frame) {
    /** The frame the sketch is drawn in. */
    this.frame = frame;
    /** @internal @type {(Line | Circle)[]} */
    this.guides = [];
    /** @internal @type {Vec2[]} */
    this.points = [];
    /** @internal @type {import('./shapes.js').Shape2[]} */
    this.profiles = [];
  }

  /**
   * A line through two points, or endless through a point at an angle: `line([0, 0], { angle: 60 })`.
   * @param {number[]} from
   * @param {number[] | { angle: number }} to a second point, or degrees counter-clockwise from +u
   * @returns {Line}
   */
  line(from, to) {
    const a = vec2(from);
    if (to && !Array.isArray(to)) {
      if (typeof to.angle !== 'number') throw new Error('sketch.line(): the second argument must be a point or { angle }');
      const t = (to.angle * Math.PI) / 180;
      return keep(new Line(this, a, add(a, [Math.cos(t), Math.sin(t)]), true));
    }
    return keep(new Line(this, a, vec2(/** @type {number[]} */ (to)), false));
  }

  /**
   * A guide circle, to find points at a distance from a center.
   * @param {number[]} center
   * @param {number} r
   * @returns {Circle}
   */
  circle(center, r) {
    return keep(new Circle(this, vec2(center), r));
  }

  /**
   * Marks a point, so the viewer shows it.
   * @param {number[]} p
   * @returns {Vec2}
   */
  point(p) {
    return mark(this, vec2(p));
  }

  /**
   * A polygon through points of the sketch, with the same arguments as `polygon()`. The viewer draws it
   * in place with the guides.
   * @param {number[][]} points
   * @param {number[][] | import('./shapes.js').PolygonOptions} [paths]
   * @param {import('./shapes.js').PolygonOptions} [options]
   * @returns {import('./shapes.js').Shape2}
   */
  polygon(points, paths, options) {
    const shape = polygon(points, paths, options);
    this.profiles.push(shape);
    return shape;
  }

  /**
   * Extrudes a 2D shape from the sketch's frame, as `frame.extrude()` does.
   * @param {import('./shapes.js').Shape2} shape
   * @param {number} depth
   * @param {import('./frame.js').FrameExtrudeOptions} [options]
   * @returns {import('./shapes.js').Solid}
   */
  extrude(shape, depth, options) {
    return this.frame.extrude(shape, depth, options);
  }
}

/**
 * A new sketch: construction lines and circles to work points out with, on a frame (`plane.XY` when
 * none is given) such as `box.face('-X')`. Return it in a part to see its guides; it never reaches an STL.
 * @param {import('./frame.js').Frame} [frame]
 * @returns {Sketch}
 */
export function sketch(frame = plane.XY) {
  return new Sketch(frame);
}
