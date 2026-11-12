// Sketches: construction geometry in a frame's 2D coordinates — lines, parallels, perpendiculars,
// circles and where they cross — to work out the points of an outline, as on paper. The guides are
// no geometry of the part: return the sketch in a part and the viewer draws them, dashed, in place.

import { plane } from './frame.js';
import { polygon } from './primitives.js';
import { sketchPath, splineIn } from './path.js';
import { vec2 as V2 } from './vec.js';

/** @typedef {[number, number]} Vec2 */

const EPS = 1e-9;

/** @param {number[]} p @returns {Vec2} */
const vec2 = (p) => {
  if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number') throw new Error(`sketch: a point must be [x, y], got ${JSON.stringify(p)}`);
  return [p[0], p[1]];
};
const { sub, add, scale: mul, dot, cross: crossZ, left } = V2;

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
    /** @internal The curves of its paths, piece by piece, for the viewer. @type {Vec2[][]} */
    this.traces = [];
  }

  /**
   * A line through two points, endless through a point at an angle (`line([0, 0], { angle: 60 })`), or
   * from a point at an angle for a length (`line([0, 0], { angle: 60, length: 40 })`).
   * @param {number[]} from
   * @param {number[] | { angle: number, length?: number }} to a second point, or degrees counter-clockwise
   *   from +u and, for a line that ends, how long it is
   * @returns {Line}
   */
  line(from, to) {
    const a = vec2(from);
    if (to && !Array.isArray(to)) {
      if (typeof to.angle !== 'number') throw new Error('sketch.line(): the second argument must be a point or { angle, length }');
      const { length } = to;
      if (length !== undefined && !(typeof length === 'number' && length > 0)) throw new Error(`sketch.line(): length must be more than 0, got ${length}`);
      const t = (to.angle * Math.PI) / 180;
      const direction = /** @type {Vec2} */ ([Math.cos(t), Math.sin(t)]);
      return keep(new Line(this, a, add(a, mul(direction, length ?? 1)), length === undefined));
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
   * A path in the sketch, as `path()` makes one: the viewer draws its curve, its points and the handles of
   * its Bézier curves, and its outline once it is closed.
   * @param {number[]} start
   * @param {{ fn?: number }} [options]
   * @returns {import('./path.js').Path}
   */
  path(start, options = {}) {
    return sketchPath(start, options, hooksFor(this));
  }

  /**
   * A spline through points in the sketch, as `spline()` makes one, drawn with its points.
   * @param {number[][]} points
   * @param {import('./path.js').SplineOptions} [options]
   * @returns {import('./shapes.js').Shape2 | import('./path.js').Path}
   */
  spline(points, options = {}) {
    return splineIn(points, options, hooksFor(this));
  }

  /**
   * A polygon through points of the sketch, with the same arguments as `polygon()`. The viewer draws it
   * in place with the guides.
   * @param {number[][]} points
   * @param {number[][] | import('./primitives.js').PolygonOptions} [paths]
   * @param {import('./primitives.js').PolygonOptions} [options]
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
 * What a path tells its sketch as it grows, so the viewer can draw it.
 * @param {Sketch} sketch
 * @returns {import('./path.js').PathHooks}
 */
function hooksFor(sketch) {
  return {
    handle: (a, b) => {
      if (Math.hypot(...sub(b, a)) > EPS) keep(new Line(sketch, a, b, false));
    },
    point: (p) => void mark(sketch, p),
    trace: (points) => void sketch.traces.push(points),
    profile: (shape) => void sketch.profiles.push(shape),
  };
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
