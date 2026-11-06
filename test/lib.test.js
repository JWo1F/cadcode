import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cube, cylinder, square, union, difference, hull, translate, rotate, point, range, product } from '../src/lib/index.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('booleans compute volumes', () => {
  near(cube(10).subtract(cube(5)).volume(), 875);
  near(union(cube(2), translate([1, 0, 0], cube(2))).volume(), 12);
  near(difference(cube(2), [null, cube(1), false]).volume(), 7);
});

test('rotate follows OpenSCAD: X then Y then Z, degrees', () => {
  const { min, max } = cube(1).rotate([0, 90, 0]).bounds();
  near(min[2], -1);
  near(max[0], 1);
});

test('rotate around a point, a shape or coordinates', () => {
  const pivot = point([10, 0, 0]);
  const b = cube(2).rotate(180, { around: pivot }).bounds();
  near(b.min[0], 18);
  near(b.max[0], 20);
  near(b.min[1], -2);

  const other = cube([4, 4, 4]).translate([10, 10, 0]); // center [12, 12, 2]
  const c = cube(2).rotate([0, 0, 180], { around: other }).bounds();
  near(c.min[0], 22);
  near(c.min[1], 22);

  const d = cube(2).rotate(90, [1, 0, 0], { around: [0, 0, 5] }).bounds();
  near(d.min[2], 5);
  near(d.max[1], 5);

  const s = square(2).rotate(180, { around: point([5, 5]) }).bounds();
  assert.deepEqual(s.min.map(Math.round), [8, 8]);

  const f = rotate(180, { around: pivot }, cube(2)).bounds();
  near(f.min[0], 18);
});

test('points move like solids', () => {
  const p = point([1, 0, 0]);
  const close = (q, v) => q.toArray().forEach((c, i) => near(c, v[i]));
  close(p.translate([1, 2]), [2, 2, 0]);
  close(p.rotate(90), [0, 1, 0]);
  close(p.rotate([0, 90, 0]), [0, 0, -1]);
  close(p.rotate(90, [0, 1, 0]), [0, 0, -1]);
  close(p.rotate(180, { around: point([2, 0, 0]) }), [3, 0, 0]);
  close(p.scale([3, 1, 1]), [3, 0, 0]);
  close(p.mirror([1, 0, 0]), [-1, 0, 0]);
  close(point([1, 2]), [1, 2, 0]);
});

test('points are refused where shapes are expected', () => {
  assert.throws(() => union(cube(1), point([1, 1, 1])), /point has no geometry/);
  assert.throws(() => cube(1).subtract([point()]), /point has no geometry/);
});

test('2D offset and extrude', () => {
  near(square([4, 2], { center: true }).extrude(3).volume(), 24);
  assert.ok(square([4, 2]).offset(1).area() > 8 + 12);
});

test('hull of two cylinders spans both', () => {
  const b = hull(cylinder({ r: 1, h: 1, fn: 4 }), cylinder({ r: 1, h: 1, fn: 4 }).translate([10, 0, 0])).bounds();
  near(b.max[0] - b.min[0], 12, 1e-3);
});

test('range is inclusive and product is cartesian', () => {
  assert.deepEqual(range(0, 3), [0, 1, 2, 3]);
  assert.deepEqual(range(0, 1, 0.5), [0, 0.5, 1]);
  assert.deepEqual(product([1, 2], ['a']), [[1, 'a'], [2, 'a']]);
});
