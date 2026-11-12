import { test } from 'node:test';
import assert from 'node:assert/strict';
import { circle, cube, square, union, grid, polar, range, product } from '../src/lib/index.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const close = (v, w, eps) => v.forEach((c, i) => near(c, w[i], eps));

test('a grid within a region fits as many copies as it can, centered', () => {
  const hole = circle({ d: 1.6, fn: 16 });
  // The hand-written pore grid this replaces: n = floor((a - d) / pitch) + 1, centered.
  const [a, b, d, pitch] = [17, 12.5, 1.6, 3.2];
  const na = Math.floor((a - d) / pitch) + 1;
  const nb = Math.floor((b - d) / pitch) + 1;
  const [oa, ob] = [(a - (na - 1) * pitch) / 2, (b - (nb - 1) * pitch) / 2];
  const byHand = union(product(range(0, na - 1), range(0, nb - 1)).map(([i, j]) => hole.translate([oa + i * pitch, ob + j * pitch])));
  const g = grid(hole, { pitch, within: square([a, b]) });
  near(g.subtract(byHand).area() + byHand.subtract(g).area(), 0);
  // A round region keeps only the copies wholly inside it.
  const disc = grid(square(1, { center: true }), { pitch: 2, within: circle({ r: 5, fn: 64 }) });
  near(disc.area(), 13); // of 5 x 5 candidates 2 apart, the 13 whose square stays within r = 5
  // count, centered on the origin; a solid's footprint fits the region too.
  const pegs = grid(cube([2, 2, 5], { center: true }), { pitch: [10, 6], count: [3, 2] });
  close(pegs.bounds().min, [-11, -4, -2.5]);
  near(grid(cube(1), { pitch: 2, within: square(5) }).volume(), 9);
  // Staggered rows sit half a pitch over and keep one copy fewer.
  near(grid(square(1, { center: true }), { pitch: 2, count: [3, 2], stagger: true }).area(), 5);
  assert.throws(() => grid(hole, { pitch: 2 }), /either within/);
  assert.throws(() => grid(hole, { pitch: 0, count: 2 }), /pitch/);
});

test('polar spreads copies round the origin', () => {
  const ring = polar(square([1, 1], { center: true }), { count: 4, r: 5 });
  close(ring.bounds().min, [-5.5, -5.5]);
  near(ring.area(), 4);
  const fan = polar(cube([1, 0.2, 1]), { count: 3, r: 4, angle: 90 });
  close(fan.bounds().max, [5, 5, 1], 1e-6);
  near(polar(square(1), { count: 1, start: 90 }).bounds().min[0], -1);
  assert.throws(() => polar(square(1), { count: 0 }), /count/);
});
