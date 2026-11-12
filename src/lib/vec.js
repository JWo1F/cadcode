// Small vector helpers shared by the modules that do their own geometry. `vec3` works on [x, y, z],
// `vec2` on [x, y]; both return new arrays and never change their arguments.

/** @typedef {[number, number]} Vec2 */
/** @typedef {[number, number, number]} Vec3 */

export const vec3 = {
  /** @param {number[]} a @param {number[]} b @returns {Vec3} */
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  /** @param {number[]} a @param {number[]} b @returns {Vec3} */
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  /** @param {number[]} a @param {number} k @returns {Vec3} */
  scale: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  /** @param {number[]} a @param {number[]} b */
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  /** @param {number[]} a @param {number[]} b @returns {Vec3} */
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  /** @param {number[]} a */
  length: (a) => Math.hypot(a[0], a[1], a[2]),
  /** @param {number[]} a @returns {Vec3} */
  normalize: (a) => vec3.scale(a, 1 / vec3.length(a)),
};

export const vec2 = {
  /** @param {number[]} a @param {number[]} b @returns {Vec2} */
  add: (a, b) => [a[0] + b[0], a[1] + b[1]],
  /** @param {number[]} a @param {number[]} b @returns {Vec2} */
  sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
  /** @param {number[]} a @param {number} k @returns {Vec2} */
  scale: (a, k) => [a[0] * k, a[1] * k],
  /** @param {number[]} a @param {number[]} b */
  dot: (a, b) => a[0] * b[0] + a[1] * b[1],
  /** The z of the 3D cross product: positive when `b` turns left from `a`. @param {number[]} a @param {number[]} b */
  cross: (a, b) => a[0] * b[1] - a[1] * b[0],
  /** @param {number[]} a @param {number[]} b */
  distance: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]),
  /** @param {number[]} a @returns {Vec2} */
  normalize: (a) => vec2.scale(a, 1 / Math.hypot(a[0], a[1])),
  /** `a` turned 90° counter-clockwise. @param {number[]} a @returns {Vec2} */
  left: (a) => [-a[1], a[0]],
  /** The unit vector at `degrees` from +X. @param {number} degrees @returns {Vec2} */
  fromAngle: (degrees) => [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)],
};
