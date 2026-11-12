import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cube, point, plane, setResolution } from '../src/lib/index.js';
import { Component, usbC, proMicro, oled091, ec11, led5, cell } from '../src/lib/components.js';

// Fine enough that every circle has a point at 0°, 90°, 180° and 270°, where its bounds are.
setResolution({ fn: 64 });

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const close = (v, w, eps = 1e-6) => v.forEach((c, i) => near(c, w[i], eps));
const box = (solid, min, max, eps = 1e-6) => {
  const b = solid.bounds();
  close(b.min, min, eps);
  close(b.max, max, eps);
};

test('usbC: mouth at x = 0 facing -X, centered on y = 0 and z = 0', () => {
  const port = usbC();
  box(port.body, [0, -4.47, -1.63], [7.35, 4.47, 1.63], 1e-3);
  // The stadium grown by 0.2, from 12 outside to 0.5 inside.
  box(port.cutout, [-12, -4.67, -1.83], [0.5, 4.67, 1.83], 1e-3);
  close(port.points.mouth.toArray(), [0, 0, 0]);
  assert.equal(usbC({ fn: 8 }).body.manifold.numVert() < usbC().body.manifold.numVert(), true);
  near(usbC({ clearance: 0.5 }).cutout.bounds().max[2], 2.13, 1e-3);
  assert.throws(() => usbC({ clearance: -1 }), /clearance must be 0 or more/);
});

test('proMicro: board on z = 0, connector at the -X edge, cutout only for the connector', () => {
  const mcu = proMicro();
  // The board, and the connector 0.5 past its edge, its bottom 1 below the PCB top.
  box(mcu.body, [-0.5, -8.5, 0], [34, 8.5, 3.86], 1e-3);
  const usbZ = 1.6 - 1.0 + 3.26 / 2;
  close(mcu.points.usb.toArray(), [-0.5, 0, usbZ]);
  box(mcu.cutout, [-12.5, -4.67, usbZ - 1.83], [0, 4.67, usbZ + 1.83], 1e-3);
});

test('oled091: board bottom on z = 0, centered, window up from the glass', () => {
  const oled = oled091();
  box(oled.body, [-19, -6, 0], [19, 6, 2.6]);
  // Pocket 0.2 bigger round the board; window reaching 10 above the glass.
  box(oled.cutout, [-19.2, -6.2, -0.2], [19.2, 6.2, 12.6]);
  // Above the glass only the window is cut: the active area grown by 0.6.
  const window = oled.cutout.slice(5).bounds();
  close(window.min, [-11.8, -3.4]);
  close(window.max, [11.8, 3.4]);
});

test('ec11: mounting face on z = 0, body below, shaft up to `shaft`', () => {
  const enc = ec11();
  box(enc.body, [-6, -6, -6.5], [6, 6, 20], 1e-3);
  close(enc.points.face.toArray(), [0, 0, 0]);
  const { min, max } = enc.cutout.bounds();
  near(max[0] - min[0], 7.4, 1e-3);
  near(min[2], -6.5); // from the body's bottom, through a panel on either side of the face
  near(max[2], 12);
  // The D flat leaves 4.5 across the shaft.
  const shaft = enc.body.slice(15).bounds();
  near(shaft.max[1] - shaft.min[1], 4.5, 1e-3);
  near(ec11({ shaft: 15 }).body.bounds().max[2], 15);
  assert.throws(() => ec11({ shaft: 5 }), /shaft must be more than 7/);
});

test('led5: flange on z = 0, 8.6 tall, hole from the flange up', () => {
  const led = led5();
  box(led.body, [-2.9, -2.9, 0], [2.9, 2.9, 8.6], 1e-2);
  const { min, max } = led.cutout.bounds();
  near(max[0] - min[0], 5.4, 1e-3);
  near(min[2], 1);
  near(max[2], 21);
});

test('cell: lying along +X on z = 0, an 18650 by default', () => {
  const c = cell();
  box(c.body, [0, -9.2, 0], [65.2, 9.2, 18.4], 1e-3);
  box(c.cutout, [-0.2, -9.4, 0], [65.4, 9.4, 18.6], 1e-3); // stops at the floor the cell rests on
  box(cell({ d: 12, length: 30 }).body, [0, -6, 0], [30, 6, 12], 1e-3);
  assert.throws(() => cell({ d: 0 }), /d must be a positive number/);
});

test('body, cutout and points move together', () => {
  const mcu = proMicro();
  const moved = mcu.translate([10, 20, 30]);
  close(moved.body.bounds().min, mcu.body.bounds().min.map((v, i) => v + [10, 20, 30][i]));
  close(moved.cutout.bounds().min, mcu.cutout.bounds().min.map((v, i) => v + [10, 20, 30][i]));
  close(moved.points.usb.toArray(), [9.5, 20, 30 + 2.23]);

  const turned = mcu.rotate(90);
  close(turned.points.usb.toArray(), [0, -0.5, 2.23]);
  close(turned.cutout.bounds().min, mcu.cutout.rotate(90).bounds().min);

  const mirrored = mcu.mirror([1, 0, 0]);
  close(mirrored.points.usb.toArray(), [0.5, 0, 2.23]);
  near(mirrored.cutout.bounds().max[0], 12.5);

  const placed = ec11().place(plane.XY.offset(5));
  close(placed.points.face.toArray(), [0, 0, 5]);
  near(placed.cutout.bounds().min[2], 5 - 6.5);
});

test('align moves everything by the body\'s bounds', () => {
  const floor = cube([100, 100, 3]);
  const mcu = proMicro().align(floor, { x: 'min', y: 'center', z: 'after', gap: 0 });
  close(mcu.body.bounds().min, [0, 41.5, 3]);
  // The cutout went by the same amount as the body: +0.5 in X, +50 in Y, +3 in Z.
  close(mcu.cutout.bounds().min, [-12, 50 - 4.67, 3 + 2.23 - 1.83], 1e-3);
  close(mcu.points.usb.toArray(), [0, 50, 3 + 2.23]);
  close(mcu.at('-Z').toArray(), [17.25, 50, 3]);
});

test('a component is built from solids and points, and never changes', () => {
  const c = new Component({ body: cube(2), cutout: cube(3), points: { tip: point([1, 1, 2]) } });
  assert.ok(Object.isFrozen(c));
  assert.ok(Object.isFrozen(c.points));
  const moved = c.translate([1, 0, 0]);
  close(c.points.tip.toArray(), [1, 1, 2]);
  close(moved.points.tip.toArray(), [2, 1, 2]);
  assert.throws(() => new Component({ body: cube(1) }), /cutout must be a solid/);
  assert.throws(() => new Component({ body: cube(1), cutout: cube(1), points: { a: [0, 0, 0] } }), /point "a" must be a point/);
});

test('components take their sizes as options, and frames place them', async () => {
  const { proMicro, oled091, led5, ec11 } = await import('../src/lib/components.js');
  const { plane } = await import('../src/lib/frame.js');
  const board = proMicro({ length: 33, width: 18, fn: 32 });
  assert.ok(Math.abs(board.body.bounds().max[0] - 33) < 1e-6);
  assert.ok(Math.abs(board.body.bounds().max[1] - 9) < 1e-6);
  const shifted = oled091({ activeShift: [2, 0] });
  const plain = oled091();
  assert.ok(Math.abs(shifted.cutout.clip({ z: [3, 20] }).bounds().min[0] - plain.cutout.clip({ z: [3, 20] }).bounds().min[0] - 2) < 1e-6);
  const three = led5({ d: 3, h: 5.3, flange: [3.8, 1], fn: 32 });
  assert.ok(Math.abs(three.body.bounds().max[2] - 5.3) < 1e-6);
  // The encoder's hole goes through a panel on either side of its mounting face.
  const e = ec11({ fn: 32 });
  assert.ok(e.cutout.bounds().min[2] <= -6.5 + 1e-9 && e.cutout.bounds().max[2] >= 12 - 1e-9);
  const placed = plane.XZ.offset(-5).place(e); // plane.XZ faces -Y, so -5 along it is y = 5
  assert.ok(Math.abs(placed.points.face.y - 5) < 1e-9);
});
