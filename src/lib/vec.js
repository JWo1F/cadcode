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

/** Column-major 4×4 matrices, as frames and `transform()` take them. */
export const mat4 = {
  /** a × b. @param {number[]} a @param {number[]} b @returns {number[]} */
  multiply(a, b) {
    const out = new Array(16).fill(0);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
      }
    }
    return out;
  },
  /** The point [x, y, z] moved by `m`. @param {number[]} m @param {number} x @param {number} y @param {number} z @returns {Vec3} */
  apply: (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]],
  /** The determinant of the 3×3 part: negative when `m` mirrors. @param {number[]} m */
  determinant: (m) => m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]),
};
