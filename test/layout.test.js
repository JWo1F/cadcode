import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cube, cylinder, arrange } from '../src/lib/index.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const close = (v, w) => v.forEach((c, i) => near(c, w[i]));

test('layFlat turns a side down and puts the solid on the bed, centered', () => {
  // A wedge-ish part: a tall post on a plate, so each side down gives a different box.
  const part = cube([10, 6, 2]).union(cube([2, 2, 8]).translate([0, 0, 2])).translate([50, 50, 50]);
  const top = part.layFlat('+Z').bounds();
  close(top.min, [-5, -3, 0]);
  close(top.max, [5, 3, 10]);
  // The post stood at -X; with +X down it points up from the plate's low end.
  const side = part.layFlat('+X').bounds();
  close([side.max[2] - side.min[2], side.min[2]], [10, 0]);
  near(part.layFlat('+X').at('+Z').z, 10);
  close(part.layFlat().bounds().min, [-5, -3, 0]);
  close(part.layFlat('-Y').bounds().max, [5, 5, 6]);
  assert.throws(() => part.layFlat('top'), /side must be one of/);
});

test('arrange spreads parts in rows, gap apart, centered on the origin', () => {
  const [a, b, c] = arrange([cube([10, 4, 1]), [cube([6, 8, 2]), cylinder({ d: 2, h: 5 }).translate([3, 4, 2])], false && cube(1)], { gap: 2 });
  close(a.bounds().min, [-9, -2, 0]); // 18 wide in all: 10 + 2 + 6; 8 deep
  close(b[0].bounds().min, [3, -4, 0]);
  near(b[1].bounds().min[2], 2); // a part's solids move together, heights kept
  near(b[1].at().x, 6, 0.2); // the cylinder's facets make its box a little lopsided
  assert.equal(c, false);
  const rows = arrange([cube(4), cube(4), cube(4)], { gap: 1, columns: 2 });
  close(rows[2].bounds().min, [-4.5, 0.5, 0]);
  close(rows[1].bounds().max, [4.5, -0.5, 4]);
  assert.throws(() => arrange([cube(1)], { columns: 0 }), /columns/);
  assert.throws(() => arrange([{}]), /solid or an array/);
});
