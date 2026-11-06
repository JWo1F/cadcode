/*---
title: Hinged box
description: A small box and lid joined by a hinge that comes off the bed already assembled.
---*/
// Small box with a print-in-place hinge: five knuckles along the back, the box's three carry a
// pin that runs through the lid's two with clearance all round, so the hinge comes off the bed
// already assembled. The hinge axis sits halfway up the closed box, which makes the lid land flat
// on the bed when it is opened all the way — that is how it prints, box and lid side by side.
//
//   cadcode dev examples/hinged-box.js
//   cadcode stl examples/hinged-box.js --part print
import { cube, cylinder, hull, range, setResolution } from 'cadcode';

setResolution({ fn: 48 });

export const params = {
  // Outside of the closed box
  length: 70,
  depth: 50,
  boxH: 26,
  lidH: 10,
  wall: 2,
  floor: 1.6,
  corner: 5,

  // Hinge
  knuckles: 5, // odd: the box has the two ends
  knuckleD: 8,
  pinD: 3.4,
  margin: 6, // from each end of the box to the hinge
  gap: 0.4, // clearance between moving parts, radial and axial

  // Assembly view
  open: 105, // degrees
};

export default (p) => {
  const R = p.knuckleD / 2;
  // Axis behind the back wall (y = depth), clear of it by `gap`, halfway up the closed box so the
  // fully opened lid lies on the bed.
  const axisY = p.depth + p.gap + R;
  const axisZ = (p.boxH + p.lidH) / 2;
  const hingeL = p.length - 2 * p.margin;
  const segL = hingeL / p.knuckles;

  const roundedBox = (l, w, h, r) => cube([l, w, h], { round: r, edges: 'z' });

  // Knuckle i occupies [x0, x1] along X, shortened by half the gap on sides facing a neighbour.
  const span = (i) => {
    const x0 = p.margin + i * segL + (i > 0 ? p.gap / 2 : 0);
    const x1 = p.margin + (i + 1) * segL - (i < p.knuckles - 1 ? p.gap / 2 : 0);
    return [x0, x1 - x0];
  };
  const barrel = (x, len, d) =>
    cylinder({ d, h: len }).rotate([0, 90, 0]).translate([x, axisY, axisZ]);
  const slab = (x, len, y0, y1, z0, z1) => cube([len, y1 - y0, z1 - z0]).translate([x, y0, z0]);

  const boxIdx = range(0, p.knuckles - 1, 2);
  const lidIdx = range(1, p.knuckles - 1, 2);

  // Box knuckles hang off the back wall; the hull down to a strip on the wall gives a 45° underside.
  const boxKnuckles = () =>
    boxIdx.map((i) => {
      const [x, len] = span(i);
      return hull(barrel(x, len, p.knuckleD), slab(x, len, p.depth - p.wall, p.depth, axisZ - 2 * R, axisZ + R));
    });
  // One pin through every knuckle, fixed to the box's.
  const pin = () => barrel(p.margin, hingeL, p.pinD);

  // Lid knuckles hang down from the lid behind the back wall, never closer to it than `gap`.
  const lidKnuckles = () =>
    lidIdx.map((i) => {
      const [x, len] = span(i);
      return hull(barrel(x, len, p.knuckleD), slab(x, len, p.depth + p.gap, axisY + R, p.boxH, p.boxH + p.lidH)).union(
        slab(x, len, p.depth - p.wall, axisY, p.boxH, p.boxH + p.lidH),
      );
    });
  const lidBores = () =>
    lidIdx.map((i) => {
      const [x, len] = span(i);
      return barrel(x - 1, len + 2, p.pinD + 2 * p.gap);
    });

  // Notch in the box's front rim for a thumbnail, and a matching tab on the lid.
  const thumbNotch = () =>
    cylinder({ d: 16, h: 10, center: true }).rotate([90, 0, 0]).scale([1, 1, 0.5]).translate([p.length / 2, 0, p.boxH]);
  const tab = () =>
    hull(
      cube([20, 0.1, p.lidH - 2]).translate([p.length / 2 - 10, 0, p.boxH + 2]),
      cube([14, 0.1, 1.2]).translate([p.length / 2 - 7, -3, p.boxH + p.lidH - 1.2]),
    );

  const box = () =>
    roundedBox(p.length, p.depth, p.boxH, p.corner)
      .subtract(
        roundedBox(p.length - 2 * p.wall, p.depth - 2 * p.wall, p.boxH, p.corner - p.wall).translate([p.wall, p.wall, p.floor]),
        thumbNotch(),
      )
      .union(boxKnuckles(), pin());

  // Lid in its closed position.
  const lid = () =>
    roundedBox(p.length, p.depth, p.lidH, p.corner)
      .subtract(
        roundedBox(p.length - 2 * p.wall, p.depth - 2 * p.wall, p.lidH - p.floor, p.corner - p.wall).translate([p.wall, p.wall, -0.01]),
      )
      .translate([0, 0, p.boxH])
      .union(lidKnuckles(), tab())
      .subtract(lidBores());

  // Opening turns the front of the lid up and over the back.
  const opened = (shape, a) => shape.translate([0, -axisY, -axisZ]).rotate([-a, 0, 0]).translate([0, axisY, axisZ]);

  return {
    assembly: () => [box().color('#e9e4d8'), opened(lid(), p.open).color('#d9534f')],
    print: () => [box(), opened(lid(), 180)],
  };
};
