import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cube, cylinder, square, union, difference, hull, translate, range, product } from '../src/lib/index.js';

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
