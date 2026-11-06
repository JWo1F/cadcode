import { test } from 'node:test';
import assert from 'node:assert/strict';
import { circle, square, helix, loft } from '../src/lib/index.js';
import { toSTL } from '../src/export/stl.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const ring = (r, n) => circle({ r, fn: n }).toPolygons()[0].map(([x, y]) => [x, y, 0]);

test('sweep: a straight path up +Z matches extrude', () => {
  const swept = square([4, 2]).sweep([[0, 0, 0], [0, 0, 10]]);
  near(swept.volume(), 80);
  assert.deepEqual(swept.bounds(), square([4, 2]).extrude(10).bounds());
});

test('sweep: a mitered corner keeps the tube its full width', () => {
  const tube = square(2, { center: true }).sweep([[0, 0, 0], [10, 0, 0], [10, 10, 0]]);
  near(tube.volume(), 4 * 20, 1e-4);
  const { min, max } = tube.bounds();
  near(min[0], 0);
  near(max[0], 11);
  near(max[1], 10);
});

test('sweep: holes in the profile go along', () => {
  const pipe = square(4, { center: true }).subtract(square(2, { center: true })).sweep([[0, 0, 0], [0, 0, 5], [0, 5, 10]]);
  near(pipe.volume(), 12 * (5 + Math.hypot(5, 5)), 1e-3);
});

test('sweep: a closed path makes a ring like revolve', () => {
  const swept = circle({ r: 1, fn: 16 }).sweep(ring(10, 64), { closed: true });
  const revolved = circle({ r: 1, fn: 16 }).translate([10, 0]).revolve({ fn: 64 });
  near(swept.volume(), revolved.volume(), 1);
  assert.throws(() => circle(1).sweep(ring(10, 16), { closed: true, scale: 2 }), /cannot scale/);
  assert.throws(() => circle(1).sweep(ring(10, 16), { closed: true, twist: 90 }), /whole number of turns/);
});

test('sweep: twist and scale', () => {
  // The twist turns at the path's points, so a smooth one needs many of them.
  const twisted = square([10, 1]).sweep(Array.from({ length: 31 }, (_, i) => [0, 0, i / 3]), { twist: 90 });
  near(twisted.volume(), 100, 10); // flat quads across a turning edge cut a little off
  const top = twisted.slice(9.99).bounds();
  near(top.max[1], 10, 0.05); // the long side turned counterclockwise onto +Y
  const tapered = square(2, { center: true }).sweep([[0, 0, 0], [0, 0, 10]], { scale: 0 });
  near(tapered.volume(), 40 / 3, 1e-4);
});

test('sweep: up keeps the profile upright', () => {
  // Along +X, with +Y kept toward +Z: the 10-wide side of the drawing stands vertically.
  const wall = square([1, 10]).sweep([[0, 0, 0], [20, 0, 0]], { up: [0, 0, 1] });
  const { min, max } = wall.bounds();
  near(max[2] - min[2], 10);
  near(max[1] - min[1], 1);
  assert.throws(() => square(1).sweep([[0, 0, 0], [0, 0, 1]], { up: [0, 0, 1] }), /parallel/);
});

test('sweep: bad paths are refused', () => {
  assert.throws(() => circle(1).sweep([[0, 0, 0]]), /at least 2/);
  assert.throws(() => circle(1).sweep([[0, 0, 0], [0, 0, 5], [0, 0, 0]]), /straight back/);
});

test('helix: a spring is a closed solid of the expected volume', () => {
  const path = helix({ r: 10, pitch: 4, turns: 3, fn: 48 });
  assert.equal(path.length, 3 * 48 + 1);
  near(path.at(-1)[2], 12);
  const spring = circle({ r: 1, fn: 16 }).sweep(path);
  const wire = 3 * Math.hypot(2 * Math.PI * 10, 4);
  near(spring.volume(), circle({ r: 1, fn: 16 }).area() * wire, 2);
  assert.ok(toSTL([spring]).length > 0);
  assert.ok(helix({ d: 20, pitch: 4, height: 4, leftHand: true, fn: 4 })[1][1] < 0);
  assert.throws(() => helix({ r: 5, pitch: 2 }), /turns/);
});

test('loft: between equal and shrinking squares', () => {
  near(loft([square(10, { center: true }), square(10, { center: true })], { z: [0, 10] }).volume(), 1000);
  // A frustum: h / 3 * (A1 + A2 + sqrt(A1 * A2)).
  near(loft([square(10, { center: true }), square(4, { center: true })], { z: [0, 6] }).volume(), 312);
});

test('loft: sections with different point counts keep their corners', () => {
  const vase = loft([square(20, { center: true }), circle({ r: 6, fn: 40 }), circle({ r: 10, fn: 40 })], { z: [0, 10, 30] });
  assert.deepEqual(vase.bounds(), { min: [-10, -10, 0], max: [10, 10, 30] });
  assert.deepEqual(vase.slice(0.001).bounds().max.map((v) => Math.round(v * 10) / 10), [10, 10]);
  assert.ok(toSTL([vase]).length > 0);
});

test('loft: bad input is refused', () => {
  assert.throws(() => loft([square(1)], { z: [0] }), /at least two/);
  assert.throws(() => loft([square(1), square(1)], { z: [0] }), /one height per section/);
  assert.throws(() => loft([square(1), square(1)], { z: [5, 0] }), /must increase/);
  const ring = circle(5).subtract(circle(3));
  assert.throws(() => loft([ring, ring], { z: [0, 1] }), /without holes/);
});
