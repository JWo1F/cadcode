import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cube, cylinder, sphere, square, union, difference, hull, minkowski, translate, rotate, point, range, product } from '../src/lib/index.js';

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

test('cube round and chamfer keep the size', () => {
  const rounded = cube(10, { round: 1, fn: 256 });
  assert.deepEqual(rounded.bounds(), { min: [0, 0, 0], max: [10, 10, 10] });
  // 8³ core, six 8×8×1 slabs, twelve quarter cylinders, eight eighth spheres.
  near(rounded.volume(), 512 + 6 * 64 + Math.PI * 24 + (4 / 3) * Math.PI, 0.05);
  // Twelve edge prisms of 1/2 × 8, and eight corners of 1 - 1/6.
  near(cube(10, { chamfer: 1 }).volume(), 1000 - 48 - 8 * (5 / 6));
  assert.deepEqual(cube([10, 8, 6], { round: 1, center: true }).bounds(), { min: [-5, -4, -3], max: [5, 4, 3] });
  assert.throws(() => cube(10, { round: 6 }), /round 6 does not fit/);
  assert.throws(() => cube(10, { round: 1, chamfer: 1 }), /not both/);
});

test('cube round and chamfer by group of edges', () => {
  // Four edges of length l each lose the corner a quarter circle leaves in its square, or a triangle.
  const spandrel = 4 * (1 - Math.PI / 4);
  const vertical = cube([10, 20, 30], { round: { z: 1 }, fn: 512 });
  assert.deepEqual(vertical.bounds(), { min: [0, 0, 0], max: [10, 20, 30] });
  near(vertical.volume(), 6000 - spandrel * 30, 0.01);
  near(cube([10, 20, 30], { chamfer: { z: 1 } }).volume(), 6000 - 2 * 30);
  // A chamfered top around sharp vertical edges: four wedges of section 1/2, mitred where they
  // meet, so each corner counts the 1/3 the two wedges share only once.
  near(cube([10, 20, 30], { chamfer: { top: 1 } }).volume(), 6000 - (1 / 2) * 2 * (10 + 20) + 4 * (1 / 3));
  // Rounded vertical edges and a top chamfered around them, as a hull of the plan and its inset copy.
  const plan = (w, d, r) => square([w - 2 * r, d - 2 * r]).translate([r, r]).offset({ r, fn: 512 });
  const expected = hull(plan(10, 20, 3).extrude(29), plan(8, 18, 2).translate([1, 1]).extrude(1).translate([0, 0, 29]));
  const mixed = cube([10, 20, 30], { round: { z: 3 }, chamfer: { top: 1 }, fn: 512 });
  assert.ok(Math.abs(mixed.volume() - expected.volume()) < expected.volume() * 1e-3);
  assert.deepEqual(mixed.bounds(), { min: [0, 0, 0], max: [10, 20, 30] });
  // Round vertical edges whose arcs meet across the narrow side.
  assert.ok(cube([4, 4, 1], { round: { z: 2 } }).volume() > 0);
  assert.throws(() => cube(10, { round: { up: 1 } }), /no edges "up"/);
  assert.throws(() => cube(10, { round: { top: 1 }, chamfer: { top: 1 } }), /not both/);
  assert.throws(() => cube([10, 10, 3], { round: { top: 2, bottom: 2 } }), /do not fit in the height/);
});

test('cylinder round and chamfer cut the top and bottom edges', () => {
  const full = Math.PI * 25 * 10;
  // Two rings of triangles with legs 1, their centroid 5 - 1/3 from the axis.
  near(cylinder({ r: 5, h: 10, chamfer: 1, fn: 512 }).volume(), full - 2 * 2 * Math.PI * (5 - 1 / 3) * 0.5, 0.05);
  // Two rings of the area a quarter circle leaves in its square, centroid (10 - 3π) / (12 - 3π) in from the corner.
  const spandrel = 1 - Math.PI / 4;
  const inset = (10 - 3 * Math.PI) / (12 - 3 * Math.PI);
  const rounded = cylinder({ r: 5, h: 10, round: 1, fn: 512, center: true });
  near(rounded.volume(), full - 2 * 2 * Math.PI * (5 - inset) * spandrel, 0.05);
  near(rounded.bounds().min[2], -5);
  near(rounded.bounds().max[0], 5, 1e-3);
  assert.throws(() => cylinder({ r: 1, h: 10, round: 2 }), /round 2 does not fit/);
  // One end only: the bottom stays flat.
  const top = cylinder({ r: 5, h: 10, chamfer: { top: 1 }, fn: 512 });
  near(top.volume(), full - 2 * Math.PI * (5 - 1 / 3) * 0.5, 0.05);
  near(top.slice(0.001).area(), Math.PI * 25, 0.01);
});

test('minkowski grows a solid by another', () => {
  const b = minkowski(cube(10), sphere(1)).bounds();
  assert.deepEqual(b, { min: [-1, -1, -1], max: [11, 11, 11] });
  near(cube(2).minkowski(cube(1, { center: true }), null).volume(), 27);
  assert.throws(() => minkowski(cube(1), square(1)), /solids only/);
});

test('range is inclusive and product is cartesian', () => {
  assert.deepEqual(range(0, 3), [0, 1, 2, 3]);
  assert.deepEqual(range(0, 1, 0.5), [0, 0.5, 1]);
  assert.deepEqual(product([1, 2], ['a']), [[1, 'a'], [2, 'a']]);
});
