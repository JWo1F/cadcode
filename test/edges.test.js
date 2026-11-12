import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cube, cylinder } from '../src/lib/index.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const fn = 400;

test('a box has twelve straight edges, picked by the faces either side', () => {
  const box = cube([20, 10, 8]);
  assert.equal(box.edges().length, 12);
  assert.equal(box.edges({ along: 'z' }).length, 4);
  assert.equal(box.edges({ touching: '+Z' }).length, 4);
  const [e] = box.edges({ between: ['+Z', '-X'] });
  assert.deepEqual([e.from, e.to].map((p) => p.map(Math.round)).sort(), [[0, 0, 8], [0, 10, 8]]);
  assert.equal(e.convex, true);
  near(e.angle, 90);
  assert.equal(box.edges({ where: (edge) => edge.length > 15 }).length, 4);
  assert.throws(() => box.edges({ near: 1 }), /unknown filter "near"/);
});

test('fillet rounds outside edges and fills inside ones', () => {
  const box = cube([20, 10, 8]);
  near(box.fillet(2, { along: 'z', fn }).volume(), 1600 - 4 * (4 - Math.PI) * 8, 0.05);
  near(box.chamfer(1, { between: ['+Z', '+X'] }).volume(), 1600 - 0.5 * 10);
  const l = cube([20, 10, 2]).union(cube([2, 10, 20]));
  const [inside] = l.edges({ convex: false });
  assert.equal(l.edges({ convex: false }).length, 1);
  assert.equal(inside.convex, false);
  const filled = l.fillet(3, { convex: false, fn });
  near(filled.volume() - l.volume(), 9 * (1 - Math.PI / 4) * 10, 0.05);
  assert.deepEqual(filled.bounds(), l.bounds()); // nothing sticks out past the ends
  assert.throws(() => box.fillet(1, { convex: false }), /no edge of the solid passes/);
  assert.throws(() => box.fillet(0), /more than 0/);
});

test('a rim runs round rounded corners and a cylinder as one closed edge', () => {
  const tray = cube([40, 30, 10], { round: { z: 4 }, fn: 64 });
  const [rim] = tray.edges({ touching: '-Z' });
  assert.equal(tray.edges({ touching: '-Z' }).length, 1);
  assert.equal(rim.closed, true);
  assert.equal(rim.direction, null);
  const round = tray.fillet(1, { touching: '-Z', fn: 64 });
  assert.ok(round.volume() < tray.volume());
  // The round meets the faces where it touches them, so it leaves no inside edge behind; where the
  // sweep turns onto a rounded corner a sliver under half a millimetre can be left.
  assert.ok(round.edges({ convex: false }).every((e) => e.length < 0.5));
  const can = cylinder({ d: 20, h: 10, fn: 64 });
  assert.equal(can.edges().length, 2);
  assert.ok(can.chamfer(1, { touching: '+Z' }).volume() < can.volume());
});
