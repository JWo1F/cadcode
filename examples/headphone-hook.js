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
import { cube, cylinder, frameAt, plane, screwHole, setResolution, sketch, square } from 'cadcode';

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
  // #8 countersunk wood screws, 4 mm: holes sized for M4
  {
    name: 'Screws',
    children: {
      holeInset: { value: 12, name: 'Hole inset', description: "Distance of each hole from the ends of the plate's straight part, in mm." },
    },
  },
];

export default (p) => {
  // The strap's centre line in print orientation: the desk's underside along Y = 0, the plate below
  // it, the stem down from the bend, and the saddle opening upwards. The strap stands on the bed;
  // the sketch is drawn on its upper side, where it shows from above.
  const s = sketch(plane.XY.offset(p.width));
  const underside = s.line([0, 0], [p.plate, 0]);
  const plate = underside.parallel(-p.t / 2);
  const bend = s.circle([plate.end[0], plate.end[1] - p.bendR], p.bendR);
  const stem = s.line(bend.at(0), [bend.at(0)[0], bend.at(0)[1] - p.drop]);
  const saddle = s.circle([stem.end[0] + p.saddleR, stem.end[1]], p.saddleR);
  const lip = s.line(saddle.at(0), [saddle.at(0)[0], saddle.at(0)[1] + p.lip]);
  const saddleBottom = s.point(saddle.at(270));

  // The strap's cross-section: thickness along u, width along v from the bed up, edges rounded.
  const section = () =>
    square([p.t, p.width], { center: true, round: p.edge }).translate([0, p.width / 2]);

  // The centre line itself, one path along the lines and round the circles; each arc carries on
  // tangent to the line before it. The strap is its section swept along it, standing upright.
  const centre = s.path(plate.start).line(plate.end).arc(stem.start).line(stem.end).arc(lip.start).line(lip.end);
  const strap = () => section().sweep(centre.points().map(([x, y]) => [x, y, 0]), { up: [0, 0, 1] });

  // Screws go up into the desk; the heads sink into the plate's lower face, halfway up the width.
  // The lower face looks down -Y, with u along X and v up the width.
  const lowerFace = frameAt([0, -p.t, 0], [0, -1, 0]);
  const sink = () => screwHole('M4', { length: p.t + 1, head: 'countersunk' });
  const holes = () => [p.holeInset, p.plate - p.holeInset].map((x) => lowerFace.place(sink().translate([x, p.width / 2, 0])));

  // Print orientation: on its side, the strap's width standing up from the bed.
  const hanger = () => strap().subtract(holes());

  // In use: the path's plane is upright (XZ) and the desk's underside is at Z = 0.
  const mounted = (s) => s.translate([0, 0, -p.width / 2]).rotate([90, 0, 0]);

  // Over-ear headphones hanging by the band, for the assembly view.
  const headphones = () => {
    const [x, z] = saddleBottom;
    const [R, band] = [88, 7]; // headband radius and thickness
    const apex = z + p.t / 2; // the band's inside rests on the saddle's top
    const cy = apex - R; // the band's centre
    const ring = square([band + 4, 38], { center: true, round: 2 })
      .translate([R + band / 2, 0])
      .revolve({ angle: 200 })
      .rotate(-10); // symmetric about +Y
    const headband = plane.YZ.place(ring).translate([x, 0, cy]); // into the YZ plane, apex up
    const cups = [-1, 1].map((s) =>
      cylinder({ d: 78, h: 34, center: true, axis: 'y' }).translate([x, s * (R - 4), cy - 22]),
    );
    return [headband.color('#2b2d42', 0.55), cups.map((c) => c.color('#3d405b'))]; // a see-through band, so the hanger shows
  };

  const desk = () => cube([140, 90, 18]).translate([-30, -45, 0]);

  return {
    assembly: () => [desk().color('#c9a46c', 0.5), mounted(hanger()).color('#ef8354'), headphones()],
    hanger,
    // The hanger with the strap's centre line it is built along.
    sketch: () => [hanger(), s],
  };
};
