// The OpenSCAD-style functional forms on 2D and 3D input, and the Solid methods with no other test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cube, square, circle, polyhedron, intersection, mirror, rotate, scale, color, offset, linearExtrude, hull, union } from '../src/lib/index.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const nearAll = (v, w, eps = 1e-6) => v.forEach((c, i) => near(c, w[i], eps));

test('intersection keeps what every shape covers, in 3D and in 2D', () => {
  near(intersection(cube(4), cube(4).translate([2, 2, 2])).volume(), 8);
  near(intersection(square(4), square(4).translate([1, 3])).area(), 3);
  assert.equal(intersection().isEmpty(), true);
  assert.throws(() => intersection(cube(1), square(1)), /cannot mix/);
});

test('mirror and scale work on solids and on 2D shapes', () => {
  nearAll(mirror([1, 0, 0], cube(2).translate([1, 0, 0])).bounds().min, [-3, 0, 0]);
  nearAll(mirror([0, 1], square(2)).bounds().min, [0, -2]);
  nearAll(scale([2, 3], square(1)).bounds().max, [2, 3]);
  near(scale(2, cube(1)).volume(), 8);
});

test('rotate takes OpenSCAD [0, 0, z] for a 2D shape and refuses a turn out of the plane', () => {
  const turned = rotate([0, 0, 90], square([2, 1]));
  nearAll(turned.bounds().min, [-1, 0]);
  nearAll(turned.bounds().max, [0, 2]);
  nearAll(square([2, 1]).rotate([0, 0, 90]).bounds().max, [0, 2]);
  assert.throws(() => rotate([10, 0, 0], square(1)), /turns about Z only/);
});

test('color colors solids and names the mistake for a 2D shape', () => {
  assert.ok(color('red', cube(1), cube(1).translate([2, 0, 0])).volume() > 0);
  assert.throws(() => color('red', square(1)), /color\(\) works on solids only/);
});

test('offset joins its shapes first, and gives an empty shape for none', () => {
  near(offset({ delta: 1 }, square(2), square(2).translate([2, 0])).area(), 6 * 4);
  near(offset(1).area(), 0);
  assert.throws(() => offset(1, cube(1)), /offset\(\) works on 2D shapes only/);
});

test('linearExtrude takes its options or goes without them', () => {
  near(linearExtrude(3, square(2)).volume(), 12);
  near(linearExtrude(3, [square(2), square(1).translate([5, 0])]).volume(), 15);
  nearAll(linearExtrude(4, { center: true }, square(2)).bounds().min, [0, 0, -2]);
  assert.throws(() => linearExtrude(1, cube(1)), /works on 2D shapes only/);
});

test('polyhedron builds a closed solid and refuses an open one', () => {
  const points = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const clockwise = [[0, 1, 2], [0, 3, 1], [1, 3, 2], [0, 2, 3]];
  near(polyhedron(points, clockwise).volume(), 1 / 6);
  assert.throws(() => polyhedron(points, clockwise.slice(0, 3)), /not a closed solid/);
  assert.throws(() => polyhedron(points, clockwise.map((f) => [...f].reverse())), /inside out/);
});

test('a solid projects to its outline, measures its surface and takes a matrix', () => {
  near(cube([2, 3, 4]).project().area(), 6);
  near(cube([2, 3, 4]).surfaceArea(), 2 * (6 + 8 + 12));
  const moved = cube(1).transform([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1]);
  nearAll(moved.bounds().min, [5, 6, 7]);
});

test('hull wraps solids as a method and as a function', () => {
  near(cube(1).hull(cube(1).translate([3, 0, 0])).volume(), 4);
  near(hull(circle({ r: 1, fn: 4 }), circle({ r: 1, fn: 4 }).translate([4, 0])).area(), 2 + 8);
  near(union(hull(cube(1), cube(1).translate([0, 3, 0]))).volume(), 4);
});

test('sweeping a profile that came out empty gives an empty solid', () => {
  const nothing = square(2).subtract(square(4).translate([-1, -1]));
  assert.equal(nothing.sweep([[0, 0, 0], [0, 0, 10]]).isEmpty(), true);
});
