import { test } from 'node:test';
import assert from 'node:assert/strict';
import { path, spline, sketch, Path } from '../src/lib/index.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('lines close into a polygon, by points or by angle and length', () => {
  near(path([0, 0]).line([10, 0]).line([10, 10]).line([0, 10]).close().area(), 100);
  const tri = path([0, 0]).line({ angle: 0, length: 10 }).line({ angle: 90, length: 10 }).close();
  near(tri.area(), 50);
  // round softens a join by its index: 0 the start, then each piece's end.
  near(path([0, 0]).line([10, 0]).line([10, 10]).line([0, 10]).close({ round: { 2: 2 }, fn: 400 }).area(), 100 - (4 - Math.PI), 1e-2);
  assert.throws(() => path([0, 0]).line([0, 0]), /goes nowhere/);
  assert.throws(() => path([0, 0]).line([1, 0]).line([1, 1]).close({ round: { 5: 1 } }), /joins are 0 to 2/);
});

test('arcs carry on tangent, or pass through a point', () => {
  const d = path([0, 0], { fn: 400 }).line([10, 0]).arc([10, 10]).line([0, 10]).close();
  near(d.area(), 100 + (Math.PI * 25) / 2, 1e-2);
  near(d.bounds().max[0], 15, 1e-9);
  const half = path([0, 0], { fn: 400 }).arc([10, 0], { through: [5, -5] }).close();
  near(half.area(), (Math.PI * 25) / 2, 1e-2);
  near(half.bounds().min[1], -5, 1e-9);
  // Straight ahead, a tangent arc is a line.
  assert.equal(path([0, 0]).line([1, 0]).arc([5, 0]).points().length, 3);
  assert.throws(() => path([0, 0]).arc([1, 1]), /no direction/);
});

test('Bézier curves and smooth continuations', () => {
  const k = 0.5523; // control distance of a quarter circle of radius 1
  const quarter = path([0, 0], { fn: 400 }).line([10, 0]).curve([10, 10 * k], [10 * k, 10], [0, 10]).close();
  near(quarter.area(), Math.PI * 25, 0.05);
  const q = path([0, 0], { fn: 64 }).quad([5, 10], [10, 0]).close();
  near(q.area(), (2 / 3) * 10 * 5, 0.1); // a parabolic segment: 2/3 of base times height (the peak is at 5)
  const s = path([0, 0], { fn: 64 }).curve([0, 5], [5, 5], [5, 0]).smooth([5, -5], [10, 0]);
  assert.ok(s instanceof Path);
  assert.deepEqual(s.end, [10, 0]);
  // The mirrored handle makes the joint smooth: the points either side of [5, 0] line up across it.
  const pts = s.points();
  const i = pts.findIndex((p) => Math.abs(p[0] - 5) < 1e-9 && Math.abs(p[1]) < 1e-9);
  const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
  const turn = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
  near(turn, 0, 0.1); // no more than the curves' own step on either side
});

test('splines pass through their points, open or closed', () => {
  const open = spline([[0, 0], [5, 10], [10, 0]], { start: 90, end: -90, fn: 64 });
  assert.ok(open instanceof Path);
  const pts = open.points();
  assert.ok(pts.some((p) => Math.abs(p[0] - 5) < 1e-9 && Math.abs(p[1] - 10) < 1e-9));
  // Leaving straight up: the first step is (almost) vertical.
  near(pts[1][0] - pts[0][0], 0, 0.05);
  const ring = spline([[10, 0], [0, 10], [-10, 0], [0, -10]], { closed: true, fn: 128 });
  assert.deepEqual(ring.bounds(), { min: [-10, -10], max: [10, 10] });
  assert.ok(ring.area() > 200 && ring.area() < Math.PI * 100);
  // A spline piece carries on along the path's heading.
  const carried = path([0, 0]).line([10, 0]).spline([[20, 10]]).points();
  assert.ok(carried[2][1] < carried[2][0] - 10); // starts flat, not straight towards [20, 10]
  assert.throws(() => spline([[0, 0], [1, 1]], { closed: true }), /at least 3/);
});

test('a path in a sketch shows its handles, points and curve', () => {
  const s = sketch();
  const shape = s.path([0, 0]).line([10, 0]).curve([12, 5], [8, 10], [5, 12]).close();
  assert.equal(s.guides.length, 2); // the curve's two handles
  assert.equal(s.points.length, 4); // start, the two piece ends, back at the start
  assert.equal(s.profiles[0], shape);
  s.spline([[0, 0], [5, 5], [10, 0]]);
  assert.ok(s.traces.length >= 4);
});
