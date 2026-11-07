/*---
title: Headphone hook
description: A rounded strap that screws under a desk and holds headphones by the band.
---*/
// Headphone hanger that screws to the underside of a desk. It is one bent strap: a plate with two
// countersunk holes, a bend down into the stem, and a wide curved saddle that ends in a lip.
// Every edge of the strap is rounded, so the headband's cushion never rests on a corner.
// Prints lying on its side with no support; the layers then follow the strap round the bends.
//
//   cadcode dev examples/headphone-hook.js
//   cadcode stl examples/headphone-hook.js --part hanger
import { cube, cylinder, mirror, setResolution, square, union } from 'cadcode';

setResolution({ fn: 64 });

export const params = [
  // Strap cross-section
  {
    name: 'Strap',
    children: {
      width: { value: 30, name: 'Width', description: 'Width of the strap, in mm.' },
      t: { value: 6, name: 'Thickness', description: 'Thickness of the strap, in mm.' },
      edge: { value: 2.2, name: 'Edge radius', description: 'Radius of the strap edges, in mm.' },
    },
  },
  {
    name: 'Path',
    children: {
      plate: { value: 64, name: 'Plate length', description: 'Length of the plate along the desk, in mm.' },
      bendR: { value: 8, name: 'Bend radius', description: "Radius inside the plate-to-stem bend, to the strap's centre line, in mm." },
      drop: { value: 42, name: 'Drop', description: 'Length of the straight stem under the bend, in mm.' },
      saddleR: { value: 26, name: 'Saddle radius', description: "Radius of the saddle the headphones hang on, to the strap's centre line, in mm." },
      lip: { value: 12, name: 'Lip', description: 'Length of the straight end after the saddle, in mm.' },
    },
  },
  // #8 countersunk wood screws, 4 mm
  {
    name: 'Screws',
    children: {
      screwD: { value: 4.4, name: 'Screw hole', description: 'Clearance hole for the screw shank, in mm.' },
      headD: { value: 8.4, name: 'Screw head', description: 'Diameter of the countersink for the screw head, in mm.' },
      holeInset: { value: 12, name: 'Hole inset', description: "Distance of each hole from the ends of the plate's straight part, in mm." },
    },
  },
];

export default (p) => {
  const deg = Math.PI / 180;
  const dir = (a) => [Math.cos(a * deg), Math.sin(a * deg)];

  // The strap's cross-section: thickness along X, width along Y, edges rounded.
  const section = () => square([p.t - 2 * p.edge, p.width - 2 * p.edge], { center: true }).offset(p.edge);

  // The strap follows a path in the XY plane, like a turtle. Its width runs along Z, centred.
  // Each piece returns the solid and where the path continues from.
  const straight = ([x, y], a, len) => ({
    solid: section().extrude(len).rotate([90, 0, 0]).rotate(a + 90).translate([x, y, 0]),
    at: [x + len * dir(a)[0], y + len * dir(a)[1]],
    a,
  });
  // `turn` > 0 bends left (counter-clockwise), < 0 right, about a centre `r` to that side.
  const bend = ([x, y], a, r, turn) => {
    const side = turn > 0 ? 90 : -90;
    const [cx, cy] = [x + r * dir(a + side)[0], y + r * dir(a + side)[1]];
    const from = a - side; // angle of the start point, seen from the centre
    const start = turn > 0 ? from : from + turn;
    const end = from + turn;
    return {
      solid: section().translate([r, 0]).revolve({ angle: Math.abs(turn) }).rotate(start).translate([cx, cy, 0]),
      at: [cx + r * dir(end)[0], cy + r * dir(end)[1]],
      a: a + turn,
    };
  };

  // Desk underside at Y = 0, the plate hangs below it, the saddle opens upwards at the bottom.
  const path = () => {
    const pieces = [];
    let s = { at: [0, -p.t / 2], a: 0 };
    const add = (piece) => {
      pieces.push(piece.solid);
      s = piece;
    };
    add(straight(s.at, s.a, p.plate));
    add(bend(s.at, s.a, p.bendR, -90));
    add(straight(s.at, s.a, p.drop));
    const saddleBottom = [s.at[0] + p.saddleR, s.at[1] - p.saddleR];
    add(bend(s.at, s.a, p.saddleR, 180));
    add(straight(s.at, s.a, p.lip));
    return { pieces, saddleBottom };
  };

  // Screws go up into the desk; the heads sink into the plate's lower face.
  const sink = (p.headD - p.screwD) / 2;
  const screwHole = (x) =>
    union(
      cylinder({ d: p.screwD, h: p.t + 2 }).translate([0, 0, -1]),
      cylinder({ d1: p.headD, d2: p.screwD, h: sink }).translate([0, 0, -0.01]),
      cylinder({ d: p.headD, h: 1 }).translate([0, 0, -1]),
    )
      .rotate([-90, 0, 0]) // its axis along +Y, starting at the plate's lower face
      .translate([x, -p.t, 0]);
  // The second hole is the first mirrored about the middle of the plate.
  const holes = () => {
    const first = screwHole(p.holeInset);
    return [first, mirror([1, 0, 0], first).translate([p.plate, 0, 0])];
  };

  // Print orientation: on its side, the strap's width standing up from the bed.
  const hanger = () => union(path().pieces).subtract(holes()).translate([0, 0, p.width / 2]);

  // In use: the path's plane is upright (XZ) and the desk's underside is at Z = 0.
  const mounted = (s) => s.translate([0, 0, -p.width / 2]).rotate([90, 0, 0]);

  // Over-ear headphones hanging by the band, for the assembly view.
  const headphones = () => {
    const [x, z] = path().saddleBottom;
    const [R, band] = [88, 7]; // headband radius and thickness
    const apex = z + p.t / 2; // the band's inside rests on the saddle's top
    const cy = apex - R; // the band's centre
    const arc = square([band, 34], { center: true })
      .offset(2)
      .translate([R + band / 2, 0])
      .revolve({ angle: 200 })
      .rotate(-10) // symmetric about +Y
      .rotate([90, 0, 0])
      .rotate(90) // into the YZ plane, apex up
      .translate([x, 0, cy]);
    const cups = [-1, 1].map((s) =>
      cylinder({ d: 78, h: 34, center: true })
        .rotate([90, 0, 0])
        .translate([x, s * (R - 4), cy - 22]),
    );
    return [arc.color('#2b2d42', 0.55), cups.map((c) => c.color('#3d405b'))]; // a see-through band, so the hanger shows
  };

  const desk = () => cube([140, 90, 18]).translate([-30, -45, 0]);

  return {
    assembly: () => [desk().color('#c9a46c', 0.5), mounted(hanger()).color('#ef8354'), headphones()],
    hanger,
  };
};
