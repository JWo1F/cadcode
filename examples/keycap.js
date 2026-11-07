/*---
title: Keycap
description: A sloped, dished keycap with the cross stem for Cherry MX style switches.
---*/
// Keyboard keycap for Cherry MX style switches: sloped sides, a top tilted towards the typist with
// a cylindrical dish across it, and the standard cross stem. The assembly shows it seated on a
// switch. Prints stem up, resting on the two edges of the dish; turn on supports touching the bed
// if your slicer leaves the shallow dish stringy.
//
//   cadcode dev examples/keycap.js
//   cadcode stl examples/keycap.js --part print --set units=2
import { cube, cylinder, hull, setResolution, square } from 'cadcode';

setResolution({ fn: 48 });

export const params = {
  // Size
  units: { value: 1, name: 'Units', description: 'Key length in units of 19.05 mm key pitch; from 2u a stabiliser stem is added each side.' },
  base: { value: 18.1, name: 'Skirt', description: 'Width and depth of the skirt of a 1u cap, in mm.' },
  topW: { value: 12.6, name: 'Top width', description: 'Width of the flat top of a 1u cap, left to right, in mm.' },
  topD: { value: 14, name: 'Top depth', description: 'Depth of the flat top, front to back, in mm.' },
  height: { value: 8, name: 'Height', description: 'Height to the middle of the top, in mm.' },
  tilt: { value: 5, name: 'Tilt', description: 'How far the top leans towards the typist, in degrees.' },
  dish: { value: 0.9, name: 'Dish depth', description: 'Depth of the cylindrical dish across the top, in mm.' },

  // Shell
  wall: { value: 1.3, name: 'Wall', description: 'Thickness of the side walls, in mm.' },
  roof: { value: 1.6, name: 'Roof', description: 'Thickness of the roof under the deepest point of the dish, in mm.' },

  // Cherry MX stem
  stemD: { value: 5.5, name: 'Stem diameter', description: 'Outer diameter of the stem, in mm.' },
  crossL: { value: 4.1, name: 'Cross length', description: 'Length of each arm of the + slot, in mm.' },
  crossW: { value: 1.2, name: 'Cross width', description: 'Width of the + slot, in mm.' },
  crossDepth: { value: 4, name: 'Cross depth', description: 'Depth of the + slot into the stem, in mm.' },
  stemDrop: { value: 0.6, name: 'Stem drop', description: 'Height of the stem bottom above the skirt bottom, in mm.' },
};

export default (p) => {
  const extra = (p.units - 1) * 19.05; // longer caps grow along X
  const baseW = p.base + extra;
  const topW = p.topW + extra;

  const rect = (w, d, r) => square([w - 2 * r, d - 2 * r], { center: true }).offset(r);

  // Outer body, shrunk inwards by `inset`: a hull of the skirt outline and the tilted top outline.
  const body = (inset, bottomZ) =>
    hull(
      rect(baseW - 2 * inset, p.base - 2 * inset, 1.5).extrude(0.01).translate([0, 0, bottomZ]),
      rect(topW - 2 * inset, p.topD - 2 * inset, 2.5)
        .extrude(0.01)
        .rotate([p.tilt, 0, 0])
        .translate([0, 0, p.height - inset]),
    );

  // Dish: a big cylinder running front to back, tilted with the top. Its radius is the one whose
  // chord across the top is `topW` with the given depth.
  const dishR = ((topW / 2) ** 2 + p.dish ** 2) / (2 * p.dish);
  const dish = () =>
    cylinder({ r: dishR, h: p.topD + 10, center: true, fn: 180 })
      .rotate([90, 0, 0])
      .translate([0, 0, dishR - p.dish])
      .rotate([p.tilt, 0, 0])
      .translate([0, 0, p.height]);

  const roofZ = p.height - p.dish - p.roof; // underside of the roof, at the middle
  const stem = () => {
    const h = roofZ - p.stemDrop + 0.5;
    const cross = [
      cube([p.crossL, p.crossW, p.crossDepth + 1], { center: true }),
      cube([p.crossW, p.crossL, p.crossDepth + 1], { center: true }),
    ].map((c) => c.translate([0, 0, (p.crossDepth + 1) / 2 - 1]));
    return cylinder({ d: p.stemD, h }).subtract(cross).translate([0, 0, p.stemDrop]);
  };
  // Long caps get a stabiliser stem 12 mm each side of centre from 2u up.
  const stems = () => [stem(), p.units >= 2 && [-11.9, 11.9].map((x) => stem().translate([x, 0, 0]))];

  const keycap = () =>
    body(0, 0)
      .subtract(body(p.wall, -1).intersect(cube([200, 200, roofZ + 1]).translate([-100, -100, -1])), dish())
      .union(stems());

  // A plain MX switch for the assembly view: housing, plate-mount clips and the red cross stem.
  const switchBody = () => [
    hull(
      cube([15.6, 15.6, 0.1], { center: true }).translate([0, 0, -6.6]),
      cube([14.6, 14.6, 0.1], { center: true }).translate([0, 0, -0.6]),
    ).color('#3b3b40'),
    cube([14, 14, 5], { center: true }).translate([0, 0, -9.1]).color('#2a2a2e'),
    cube([7.2, 5.6, 1.9], { center: true }).translate([0, 0, -0.45]).color('#c8323a'),
    cube([p.crossL - 0.1, p.crossW - 0.1, p.crossDepth], { center: true }).translate([0, 0, p.stemDrop + p.crossDepth / 2 - 0.5]).color('#c8323a'),
    cube([p.crossW - 0.1, p.crossL - 0.1, p.crossDepth], { center: true }).translate([0, 0, p.stemDrop + p.crossDepth / 2 - 0.5]).color('#c8323a'),
  ];

  // Top made level again, flipped stem up and set down on the bed.
  const print = () => {
    const flipped = keycap().rotate([-p.tilt, 0, 0]).rotate([180, 0, 0]);
    return flipped.translate([0, 0, -flipped.bounds().min[2]]);
  };

  return {
    assembly: () => [keycap().color('#f1ece0'), switchBody()],
    keycap,
    print,
  };
};
