import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cube } from '../src/lib/index.js';
import { screw, fit, setFit, screwHole, boss, nutTrap } from '../src/lib/hardware.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
// Across the flats of a 64-sided hole: its bounding box spans its corners, which reach past the flats
// by 1 / cos(180° / 64), as a hole cutter is drawn round its nominal diameter.
const width = (shape) => (shape.bounds().max[0] - shape.bounds().min[0]) * Math.cos(Math.PI / 64);
// Corner to corner, for what is not a hole: a boss's outside, a nut's hexagon.
const span = (shape) => shape.bounds().max[0] - shape.bounds().min[0];

test('screw() looks sizes up in the table', () => {
  assert.deepEqual(screw('M3'), { d: 3, clearance: 3.4, tap: 2.5, capHead: { d: 5.5, h: 3 }, countersunk: { d: 6.72 }, nut: { s: 5.5, h: 2.4 }, insert: { d: 4.0, depth: 5.7 } });
  assert.equal(screw('M2.5').insert.depth, 5.0);
  assert.equal(screw('M8').nut.s, 13);
  // A fresh copy: changing it does not change the table.
  screw('M4').capHead.d = 99;
  assert.equal(screw('M4').capHead.d, 7);
});

test('an unknown size throws, listing the sizes', () => {
  assert.throws(() => screw('M7'), /unknown size "M7"; the sizes are M2, M2.5, M3, M4, M5, M6, M8/);
  assert.throws(() => screw(3), /unknown size 3/);
  assert.throws(() => screwHole('M10', { length: 5 }), /screwHole\(\): unknown size/);
  assert.throws(() => boss('toString', { h: 5 }), /boss\(\): unknown size/);
});

test('fit() and setFit()', () => {
  assert.equal(fit('press'), 0.1);
  assert.equal(fit('slide'), 0.2);
  assert.equal(fit('loose'), 0.4);
  assert.throws(() => fit('tight'), /unknown fit "tight"/);
  try {
    setFit({ slide: 0.3 });
    assert.equal(fit('slide'), 0.3);
    assert.equal(fit('press'), 0.1);
    // The cap counterbore follows the slide fit.
    near(width(screwHole('M3', { length: 10, head: 'cap', fn: 64 })), 5.5 + 0.6, 1e-3);
    assert.throws(() => setFit({ snug: 0.1 }), /unknown fit "snug"/);
    assert.throws(() => setFit({ loose: -1 }), /loose must be 0 or more/);
  } finally {
    setFit({ press: 0.1, slide: 0.2, loose: 0.4 });
  }
  assert.equal(fit('slide'), 0.2);
});

test('a plain screw hole goes length down from z = 0 and 1 above', () => {
  const hole = screwHole('M3', { length: 10, fn: 64 });
  const { min, max } = hole.bounds();
  near(min[2], -10);
  near(max[2], 1);
  near(width(hole), 3.4, 1e-6);
  near(width(screwHole('M3', { length: 10, hole: 'tap', fn: 64 })), 2.5);
  assert.throws(() => screwHole('M3'), /give the hole's length/);
  assert.throws(() => screwHole('M3', { length: 0 }), /length must be a positive number/);
  assert.throws(() => screwHole('M3', { length: 5, head: 'pan' }), /head must be one of/);
  assert.throws(() => screwHole('M3', { length: 5, hole: 'thread' }), /hole must be one of/);
});

test('a cap head gets a counterbore a slide fit bigger, head height deep', () => {
  const hole = screwHole('M3', { length: 10, head: 'cap', fn: 64 });
  near(width(hole), 5.5 + 0.4, 1e-6);
  // Counterbore down to -3 (k = d), then the clearance hole.
  near(width(hole.slice(-2.9)), 5.9, 1e-6);
  near(width(hole.slice(-3.1)), 3.4, 1e-6);
  near(width(screwHole('M3', { length: 10, head: 'cap', headDepth: 5, fn: 64 }).slice(-4.9)), 5.9, 1e-6);
  assert.throws(() => screwHole('M3', { length: 3, head: 'cap' }), /shallower than the hole/);
});

test('a countersunk head is a 90° cone, the head diameter at z = 0', () => {
  const hole = screwHole('M3', { length: 10, head: 'countersunk', fn: 64 });
  near(width(hole.slice(-1e-4)), 6.72, 1e-3);
  // 90°: the radius shrinks by 1 for every 1 down, to the clearance hole at (6.72 - 3.4) / 2.
  near(width(hole.slice(-0.5)), 6.72 - 1, 1e-3);
  near(width(hole.slice(-1.7)), 3.4, 1e-6);
  // headDepth sinks the cone below the surface.
  near(width(screwHole('M3', { length: 10, head: 'countersunk', headDepth: 1, fn: 64 }).slice(-0.9)), 6.72, 1e-3);
});

test('a hole is at least its diameter across its flats, however coarse', () => {
  // At the default resolution an M3 clearance hole has few sides; its flats still clear 3.4.
  const coarse = screwHole('M3', { length: 5 }).slice(-2);
  const [loop] = coarse.toPolygons();
  const flats = Math.min(...loop.map((p, i) => {
    const q = loop[(i + 1) % loop.length];
    return Math.abs(p[0] * q[1] - q[0] * p[1]) / Math.hypot(q[0] - p[0], q[1] - p[1]);
  }));
  assert.ok(2 * flats >= 3.4 - 1e-9, `${2 * flats} across the flats`);
});

test('an insert hole is the insert\'s diameter and depth', () => {
  const hole = screwHole('M3', { hole: 'insert', fn: 64 });
  near(hole.bounds().min[2], -5.7);
  near(width(hole), 4.0);
  near(screwHole('M3', { hole: 'insert', length: 8 }).bounds().min[2], -8);
});

test('a screw hole cuts into the face it is placed on', () => {
  const box = cube([20, 20, 10]);
  const cut = box.subtract(box.face('+Z').place(screwHole('M3', { length: 4, fn: 32 }).translate([10, 10, 0])));
  assert.ok(cut.volume() < box.volume());
  // Going in along -X from the -X face: the hole stays inside x = 0..4.
  const side = box.face('-X').place(screwHole('M3', { length: 4, fn: 32 }).translate([10, 5, 0]));
  near(side.bounds().min[0], -1);
  near(side.bounds().max[0], 4);
});

test('a boss stands on z = 0 with its hole open at the top', () => {
  const b = boss('M3', { h: 8, fn: 64 });
  const { min, max } = b.bounds();
  near(min[2], 0);
  near(max[2], 8);
  // Default d for a tap hole: max(2.2 × 3, 2.5 + 3.2) = 6.6.
  near(max[0] - min[0], 6.6);
  const solidDisc = Math.PI * 3.3 ** 2;
  assert.ok(b.slice(7.9).area() < solidDisc * 0.9, 'hole open at the top');
  assert.ok(b.slice(0.5).area() > solidDisc * 0.99, '1 thick floor under a blind hole');
  // A clearance boss is open right through.
  assert.ok(boss('M3', { h: 8, hole: 'clearance', fn: 64 }).slice(0.5).area() < solidDisc * 0.9);
  // An insert boss: d = max(6.6, 4 + 3.2) = 7.2, and h must hold the insert over the floor.
  near(span(boss('M3', { h: 8, hole: 'insert', fn: 64 })), 7.2);
  assert.throws(() => boss('M3', { h: 6, hole: 'insert' }), /needs a hole 5.7 deep/);
  assert.throws(() => boss('M3', { h: 8, d: 2 }), /leaves no wall/);
  assert.throws(() => boss('M3', {}), /h must be a positive number/);
});

test('a nut trap is a hexagon a slide fit bigger across the flats', () => {
  const trap = nutTrap('M3');
  const { min, max } = trap.bounds();
  // Flats face ±Y, corners point along ±X.
  near(max[1] - min[1], 5.5 + 0.4);
  near(max[0] - min[0], ((5.5 + 0.4) * 2) / Math.sqrt(3));
  near(min[2], -(2.4 + 0.2));
  near(max[2], 1);
  near(nutTrap('M3', { fit: 0, depth: 3 }).bounds().max[1], 5.5 / 2);
  near(nutTrap('M3', { depth: 3 }).bounds().min[2], -3);
  assert.throws(() => nutTrap('M3', { depth: -1 }), /depth must be a positive number/);
});
