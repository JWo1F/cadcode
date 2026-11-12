import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cube, sphere, square, plane, frameAt, point } from '../src/lib/index.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const close = (v, w, eps) => v.forEach((c, i) => near(c, w[i], eps));

test('a face is the side of the bounding box, its u and v seen from outside', () => {
  const box = cube([20, 10, 8]).translate([5, 0, 0]);
  const minus = box.face('-X');
  close(minus.origin, [5, 0, 0]);
  close(minus.normal, [-1, 0, 0]);
  // u, v on an X side are world Y and Z; seen from -X, u runs along -Y.
  close(minus.place(point([3, 4, 0])).toArray(), [5, -3, 4]);
  close(box.face('+X').place(point([3, 4, 0])).toArray(), [25, 3, 4]);
  close(box.face('+Z').place(point([3, 4, 0])).toArray(), [3, 4, 8]);
  close(box.face('-Z').place(point([3, 4, 0])).toArray(), [-3, 4, 0]);
  close(box.face('-Y').place(point([3, 4, 0])).toArray(), [3, 0, 4]);
  close(box.face('+Y').place(point([3, 4, 0])).toArray(), [-3, 10, 4]);
  assert.throws(() => box.face('X'), /one of \+X/);
});

test('a negative depth extrudes into the part, a positive one out of it', () => {
  const box = cube([20, 10, 8]);
  const into = box.face('-X').extrude(square([4, 2]).translate([-7, 3]), -2);
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
  const window = wall.face('-X').extrude(square([4, 4]).translate([-7, 3]), -2, { through: true });
  close(window.bounds().min, [-1, 3, 3]);
  close(window.bounds().max, [3, 7, 7]);
  near(wall.subtract(window).volume(), 200 - 32);
});

test('planes through the origin move along their normal', () => {
  close(plane.XZ.normal, [0, -1, 0]);
  const xz = plane.XZ.offset(5);
  close(xz.origin, [0, -5, 0]);
  const s = xz.extrude(square([2, 3]), 4);
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

test('surfaceAt finds where the part is first met from a side, with the surface normal', () => {
  const ball = sphere({ r: 10, fn: 360 });
  const top = ball.surfaceAt('+Z', [0, 0]);
  close(top.origin, [0, 0, 10], 1e-3);
  const f = ball.surfaceAt('+Z', [6, 0]);
  near(f.origin[2], 8, 1e-2);
  close(f.normal, [0.6, 0, 0.8], 1e-2);
  // Facing -X; facets turn the normal by a fraction of a degree.
  const side = ball.surfaceAt('-X', [0, 0]);
  close(side.normal, [-1, 0, 0], 1e-2);
  // A cube's top is met at its face; the first surface met wins over ones behind it.
  const ring = cube([10, 10, 2]).subtract(cube([4, 4, 4]).translate([3, 3, -1]));
  close(ring.surfaceAt('+Z', [1, 1]).origin, [1, 1, 2]);
  close(ring.surfaceAt('+Z', [1, 1]).normal, [0, 0, 1]);
  assert.throws(() => ring.surfaceAt('+Z', [5, 5]), /nothing of the solid lies under \[5, 5\]/);
});

test("through: 'start' reaches back past the plane only; center straddles it", () => {
  const box = cube([20, 10, 8]);
  const top = box.face('+Z');
  const pocket = top.extrude(square(2), -3, { through: 'start' });
  close(pocket.bounds().min, [0, 0, 5]);
  close(pocket.bounds().max, [2, 2, 9]);
  const boss = top.extrude(square(2), 3, { through: 'start' });
  close(boss.bounds().min, [0, 0, 7]);
  close(boss.bounds().max, [2, 2, 11]);
  const slab = plane.XZ.extrude(square(2), 4, { center: true });
  close(slab.bounds().min, [0, -2, 0]);
  close(slab.bounds().max, [2, 2, 2]);
  close(plane.XZ.extrude(square(2), -4, { center: true, through: true }).bounds().min, [0, -3, 0]);
  // Against plane.XZ's -Y normal is +Y.
  close(plane.XZ.extrude(square(2), -4).bounds().max, [2, 4, 2]);
  assert.throws(() => top.extrude(square(2), 3, { center: true, through: 'start' }), /centered/);
  assert.throws(() => top.extrude(square(2), 3, { through: 'end' }), /through must be/);
});

test('surfaceAt reads the normal of a curve, not of the facet it meets', () => {
  const [rx, ry, rz] = [105, 80, 125];
  const dome = sphere({ r: 1, fn: 160 }).scale([rx, ry, rz]);
  const at = [42, 0];
  const z = rz * Math.sqrt(1 - (at[0] / rx) ** 2);
  const g = [at[0] / rx ** 2, 0, z / rz ** 2];
  const n = g.map((v) => v / Math.hypot(...g));
  const f = dome.surfaceAt('+Z', at);
  const off = (Math.acos(f.normal.reduce((s, v, i) => s + v * n[i], 0)) * 180) / Math.PI;
  assert.ok(off < 0.2, `${off}° off the ellipsoid's normal`);
  // Sharp edges stay sharp: next to a box's edge its top still faces straight up.
  close(cube(10).surfaceAt('+Z', [9.99, 5]).normal, [0, 0, 1], 1e-9);
});

test('flip turns a frame half a turn about v to face the other way', () => {
  const f = plane.XZ.offset(3).flip();
  close(f.normal, [0, 1, 0]);
  close(f.origin, [0, -3, 0]);
  close(f.place(point([1, 2, 0])).toArray(), [-1, -3, 2]);
  close(f.place(point([0, 0, 1])).toArray(), [0, -2, 0]);
});

test('every frame is a rotation, so nothing placed on one is mirrored', () => {
  const det = ({ matrix: m }) =>
    m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
  const box = cube([20, 10, 8]);
  const frames = [
    ...['+X', '-X', '+Y', '-Y', '+Z', '-Z'].map((side) => box.face(side)),
    plane.XY, plane.XZ, plane.YZ, plane.XZ.flip(), box.face('-X').flip(),
    frameAt([1, 2, 3], [1, -2, 0.5]), frameAt([0, 0, 0], [0, 0, -1]),
  ];
  for (const f of frames) near(det(f), 1);
});

test('hole and pocket cut into the part; a world face keeps world axes', () => {
  const box = cube([10, 10, 10]);
  const minus = box.face('-X');
  // A hole reaches 1 past both ends of the wall, a pocket 1 back out past the face only.
  assert.deepEqual(minus.hole(square(2), 2).bounds().min[0], -1);
  near(minus.hole(square(2), 2).bounds().max[0], 3);
  near(minus.pocket(square(2), 2).bounds().max[0], 2);
  near(box.subtract(minus.pocket(square(2).translate([-6, 4]), 2)).volume(), 1000 - 8); // u = -y on -X
  assert.throws(() => minus.hole(square(2), 0), /depth must be more than 0/);
  assert.throws(() => minus.pocket(square(2), -1), /depth must be more than 0/);
  // World axes on every side: [1, 2] is at world [1, 2] along the face's two axes.
  for (const [side, at] of [['-X', [1, 2]], ['+Y', [1, 2]], ['-Z', [1, 2]], ['+X', [1, 2]]]) {
    const cut = box.face(side, { world: true }).hole(square([1, 1]).translate(at), 1);
    const { min } = cut.bounds();
    const axes = { X: [1, 2], Y: [0, 2], Z: [0, 1] }[side[1]];
    close(axes.map((k) => min[k]), at, 1e-9);
    near(box.subtract(cut).volume(), 998); // depth 1, reaching 1 past it
  }
  close(box.face('-X', { world: true }).normal, [-1, 0, 0], 1e-12);
});
