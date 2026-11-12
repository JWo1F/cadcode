import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cube, union, sketch, Sketch, plane } from '../src/lib/index.js';
import { evaluateModule } from '../src/core/evaluate.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const close = (v, w, eps) => v.forEach((c, i) => near(c, w[i], eps));

test('a parallel lies to the left for a positive distance, over the same stretch', () => {
  const s = sketch();
  const base = s.line([0, 0], [60, 0]);
  const top = base.parallel(12);
  close(top.start, [0, 12]);
  close(top.end, [60, 12]);
  close(base.parallel(-3).start, [0, -3]);
  near(base.length, 60);
  close(base.mid, [30, 0]);
  close(base.at(0.25), [15, 0]);
  near(s.line([0, 0], [1, 1]).angle, 45);
  assert.equal(s.guides.length, 4);
});

test('lines cross where their endless extensions meet', () => {
  const s = sketch();
  const top = s.line([0, 0], [60, 0]).parallel(12);
  const slope = s.line([10, 0], { angle: 45 });
  assert.equal(slope.endless, true);
  close(top.intersect(slope), [22, 12]);
  // Beyond both segments still counts.
  close(s.line([0, 0], [1, 0]).intersect(s.line([5, 1], [5, 2])), [5, 0]);
  assert.throws(() => top.intersect(s.line([0, 0], [1, 0])), /parallel/);
  assert.equal(s.points.length, 2);
});

test('a perpendicular from a point runs to its foot; through a point on the line it is endless', () => {
  const s = sketch();
  const base = s.line([0, 0], [10, 0]);
  const drop = base.perpendicular([4, 7]);
  close(drop.end, [4, 0]);
  assert.equal(drop.endless, false);
  const up = base.perpendicular([3, 0]);
  assert.equal(up.endless, true);
  near(up.angle, 90);
});

test('circles cross lines and circles in a stated order', () => {
  const s = sketch();
  const c = s.circle([0, 0], 5);
  const pts = c.intersect(s.line([-10, 3], [10, 3]));
  close(pts[0], [-4, 3]);
  close(pts[1], [4, 3]);
  assert.deepEqual(s.line([-10, 9], [10, 9]).intersect(c), []);
  close(c.intersect(s.line([-10, 5], [10, 5]))[0], [0, 5]);
  const [a, b] = c.intersect(s.circle([8, 0], 5));
  close(a, [4, 3]); // left looking from this center to the other's
  close(b, [4, -3]);
  close(c.at(90), [0, 5], 1e-12);
  assert.throws(() => s.circle([0, 0], 0), /radius/);
});

test('an outline from sketch points extrudes from the sketch frame', () => {
  const box = cube([20, 10, 8]);
  const s = sketch(box.face('-X'));
  const floor = s.line([2, 2], [8, 2]);
  const lid = floor.parallel(3);
  const window = s.polygon([floor.start, floor.end, lid.end, lid.start]);
  near(window.area(), 18);
  assert.equal(s.profiles.length, 1);
  const cut = s.extrude(window, -2, { through: true });
  near(box.subtract(cut).volume(), 1600 - 18 * 3, 1e-6);
  assert.equal(sketch().frame, plane.XY);
});

test('a sketch is not a shape', () => {
  const s = sketch();
  assert.throws(() => union(cube(1), s), /guides, not shapes/);
  assert.throws(() => cube(1).subtract(s.line([0, 0], [1, 0])), /guides, not shapes/);
  assert.throws(() => cube(1).subtract({ x: 1 }), /Expected a solid or a 2D shape/);
});

test('a part may return a sketch beside its solids', async () => {
  const s = sketch();
  s.line([0, 0], [1, 0]);
  const result = await evaluateModule({ default: { part: () => [cube(1), s] } });
  assert.equal(result.solids.length, 1);
  assert.ok(result.sketches[0] instanceof Sketch);
  await assert.rejects(evaluateModule({ default: { part: () => [s.line([0, 0], [1, 1])] } }), /return the sketch itself/);
  const alone = await evaluateModule({ default: s });
  assert.equal(alone.sketches.length, 1);
});
