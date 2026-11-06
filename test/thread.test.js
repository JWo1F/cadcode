import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cylinder, thread } from '../src/lib/index.js';
import { toSTL } from '../src/export/stl.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('thread: a rod sits between its root and crest cylinders', () => {
  const rod = thread({ d: 10, pitch: 1.5, length: 20 });
  assert.deepEqual(rod.bounds().min.map(Math.round), [-5, -5, 0]);
  assert.deepEqual(rod.bounds().max.map(Math.round), [5, 5, 20]);
  const depth = (5 / 8) * (Math.sqrt(3) / 2) * 1.5;
  const core = Math.PI * (5 - depth) ** 2 * 20;
  const full = Math.PI * 25 * 20;
  assert.ok(rod.volume() > core && rod.volume() < full);
  assert.ok(toSTL([rod]).length > 0);
});

test('thread: the hole cutter takes in the rod with room to spare', () => {
  const rod = thread({ d: 10, pitch: 1.5, length: 20 });
  const hole = thread({ d: 10, pitch: 1.5, length: 20, internal: true });
  near(rod.subtract(hole).volume(), 0, 1e-3);
  assert.ok(hole.volume() > rod.volume());
  assert.deepEqual([hole.bounds().min[2], hole.bounds().max[2]], [-1, 21]);
  // Even with no clearance the two line up and do not overlap.
  near(rod.subtract(thread({ d: 10, pitch: 1.5, length: 20, internal: true, clearance: 0 })).volume(), 0, 1e-3);
});

test('thread: a nut is one closed solid with a hole through it', () => {
  const nut = cylinder({ d: 17, h: 8, fn: 6 }).subtract(thread({ d: 10, pitch: 1.5, length: 8, internal: true, taper: 1 }));
  assert.equal(nut.manifold.genus(), 1);
  assert.ok(toSTL([nut]).length > 0);
});

test('thread: taper, profiles, starts and hand', () => {
  const plain = thread({ d: 10, pitch: 1.5, length: 10 });
  assert.ok(thread({ d: 10, pitch: 1.5, length: 10, taper: 1.5 }).volume() < plain.volume());
  for (const profile of ['trapezoid', 'square']) assert.ok(thread({ d: 30, pitch: 4, length: 12, profile, starts: 2 }).volume() > 0);
  const left = thread({ d: 10, pitch: 1.5, length: 10, leftHand: true });
  near(left.volume(), plain.volume(), 1e-3);
  assert.ok(left.subtract(plain).volume() > 1, 'a left-hand thread differs from a right-hand one');
});

test('thread: bad options are refused', () => {
  assert.throws(() => thread({ d: 10, pitch: 1.5 }), /length/);
  assert.throws(() => thread({ d: 10, pitch: 1.5, length: 5, profile: 'acme' }), /unknown profile/);
  assert.throws(() => thread({ d: 10, pitch: 1.5, length: 6, taper: 3 }), /third of the length/);
  assert.throws(() => thread({ d: 2, pitch: 4, length: 6 }), /too coarse/);
  assert.throws(() => thread({ d: 10, pitch: 1.5, length: 6, starts: 1.5 }), /whole number/);
});
