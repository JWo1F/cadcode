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
  units: 1, // 1u = 19.05 mm key pitch
  base: 18.1, // skirt of a 1u cap
  topW: 12.6, // flat top, left to right
  topD: 14, // flat top, front to back
  height: 8, // to the middle of the top
  tilt: 5, // top leans towards the typist, degrees
  dish: 0.9, // depth of the cylindrical dish

  // Shell
  wall: 1.3,
  roof: 1.6, // under the deepest point of the dish

  // Cherry MX stem
  stemD: 5.5,
  crossL: 4.1, // each arm of the + slot
  crossW: 1.2,
  crossDepth: 4,
  stemDrop: 0.6, // stem bottom above the skirt bottom
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
