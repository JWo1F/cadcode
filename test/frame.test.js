import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cube, square, plane, frameAt, point } from '../src/lib/index.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const close = (v, w) => v.forEach((c, i) => near(c, w[i]));

test('a face is the side of the bounding box, in world coordinates', () => {
  const box = cube([20, 10, 8]).translate([5, 0, 0]);
  const minus = box.face('-X');
  close(minus.origin, [5, 0, 0]);
  close(minus.normal, [-1, 0, 0]);
  // u, v on an X side are world Y and Z.
  close(minus.place(point([3, 4, 0])).toArray(), [5, 3, 4]);
  close(box.face('+Z').place(point([3, 4, 0])).toArray(), [3, 4, 8]);
  close(box.face('-Y').place(point([3, 4, 0])).toArray(), [3, 0, 4]);
  assert.throws(() => box.face('X'), /one of \+X/);
});

test('a negative depth extrudes into the part, a positive one out of it', () => {
  const box = cube([20, 10, 8]);
  const into = box.face('-X').extrude(square([4, 2]).translate([3, 3]), -2);
  close(into.bounds().min, [0, 3, 3]);
  close(into.bounds().max, [2, 7, 5]);
  near(into.volume(), 16);
  const out = box.face('+Z').extrude(square(2), 3);
  close(out.bounds().min, [0, 0, 8]);
  close(out.bounds().max, [2, 2, 11]);
  assert.throws(() => box.face('+Z').extrude(square(2), 0), /depth/);
});

test('through reaches 1 past both ends, so a cut leaves no skin', () => {
  const wall = cube([2, 10, 10]);
  const window = wall.face('-X').extrude(square([4, 4]).translate([3, 3]), -2, { through: true });
  close(window.bounds().min, [-1, 3, 3]);
  close(window.bounds().max, [3, 7, 7]);
  near(wall.subtract(window).volume(), 200 - 32);
});

test('planes through the origin move along their normal', () => {
  const xz = plane.XZ.offset(-5);
  close(xz.origin, [0, -5, 0]);
  const s = xz.extrude(square([2, 3]), -4);
  close(s.bounds().min, [0, -9, 0]);
  close(s.bounds().max, [2, -5, 3]);
  close(plane.YZ.normal, [1, 0, 0]);
  close(plane.XY.place(point([1, 2, 3])).toArray(), [1, 2, 3]);
});

test('frameAt keeps v up the slope and turns the right way round', () => {
  const f = frameAt([0, 0, 10], [1, 0, 1]);
  const s = Math.SQRT1_2;
  close(f.normal, [s, 0, s]);
  close(f.place(point([0, 1, 0])).toArray(), [-s, 0, 10 + s]);
  close(f.place(point([1, 0, 0])).toArray(), [0, 1, 10]);
  close(frameAt(point([1, 1, 1]), [0, 0, -1]).place(point([0, 1, 0])).toArray(), [1, 2, 1]);
  assert.throws(() => frameAt([0, 0, 0], [0, 0, 0]), /normal/);
});
