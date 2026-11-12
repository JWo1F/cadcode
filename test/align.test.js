import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cube, square, point } from '../src/lib/index.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const close = (v, w) => v.forEach((c, i) => near(c, w[i]));

test('at gives the center of the box or of a side', () => {
  const box = cube([20, 10, 4]).translate([10, 0, 0]);
  close(box.at().toArray(), [20, 5, 2]);
  close(box.at('+X').toArray(), [30, 5, 2]);
  close(box.at('-Z').toArray(), [20, 5, 0]);
  close(square([4, 2]).at('+Y'), [2, 2]);
  assert.throws(() => box.at('top'), /side must be/);
  assert.throws(() => square(1).at('+Z'), /side must be/);
});

test('align lines boxes up axis by axis', () => {
  const floor = cube([40, 20, 2]);
  const pad = cube([10, 6, 3]).translate([100, 100, 100]);
  const b = pad.align(floor, { x: 'center', y: 'center', z: 'after' }).bounds();
  close(b.min, [15, 7, 2]);
  close(b.max, [25, 13, 5]);
  // gap: away from the target for before / after, inwards for min / max; axes left out stay.
  const g = pad.align(floor, { x: 'min', y: 'max', z: 'before', gap: 1 }).bounds();
  close(g.min, [1, 13, -4]);
  close(pad.align(floor, { x: 'max' }).bounds().min, [30, 100, 100]);
  close(pad.align(point([0, 0, 0]), { z: 'center' }).bounds().min, [100, 100, -1.5]);
  close(pad.align([0, 0, 50], { z: 'after' }).bounds().min, [100, 100, 50]);
  close(square(2).align(floor, { x: 'after' }).bounds().min, [40, 0]);
  assert.throws(() => pad.align(floor, { z: 'top' }), /z must be one of/);
  assert.throws(() => pad.align(floor, { w: 'min' }), /unknown option "w"/);
  assert.throws(() => square(1).align(floor, { z: 'min' }), /unknown option "z"/);
});
