/*---
title: L-bracket
description: A shelf bracket with a gusset, a filleted corner and countersunk screw holes.
---*/
// Shelf L-bracket: a wall leg and a shelf leg with a filleted inside corner, a triangular gusset
// between them and countersunk holes for 4 mm wood screws on both legs.
// Prints lying on the shelf leg; the countersinks face up on the shelf leg and sideways on the wall leg.
//
//   cadcode dev examples/l-bracket.js
//   cadcode stl examples/l-bracket.js
import { plane, product, screwHole, setResolution, sketch } from 'cadcode';

setResolution({ fn: 48 });

export const params = [
  {
    name: 'Legs',
    children: {
      wallLeg: { value: 60, name: 'Wall leg', description: 'Length of the leg up the wall, in mm.' },
      shelfLeg: { value: 80, name: 'Shelf leg', description: 'Length of the leg under the shelf, in mm.' },
      width: { value: 30, name: 'Width', description: 'Width of the bracket, in mm.' },
      thick: { value: 5, name: 'Thickness', description: 'Thickness of both legs, in mm.' },
      fillet: { value: 8, name: 'Fillet', description: 'Radius of the inside corner, in mm.' },
      corner: { value: 2, name: 'Corner radius', description: 'Radius of the outer corners, in mm; keep it under half the thickness.' },
    },
  },
  // Gusset in the middle of the width
  {
    name: 'Gusset',
    children: {
      gusset: { value: 4, name: 'Gusset', description: 'Thickness of the gusset, in mm.' },
      gussetReach: { value: 0.7, name: 'Gusset reach', description: 'Fraction of each leg the gusset runs along.' },
    },
  },
  // 4 mm countersunk wood screws
  {
    name: 'Screws',
    children: {
      holes: { value: 2, name: 'Holes', description: 'Screw holes per leg, across the width: 1 or 2.' },
    },
  },
];

export default (p) => {
  // The side profile, drawn in the XZ plane: X runs along the shelf, Z up the wall.
  const s = sketch(plane.XZ);
  const shelf = s.line([0, 0], [p.shelfLeg, 0]); // underside of the shelf leg
  const wall = s.line([0, 0], [0, p.wallLeg]); // back of the wall leg, against the wall
  const shelfTop = shelf.parallel(p.thick); // the shelf rests here
  const wallFace = wall.parallel(-p.thick); // inside of the wall leg
  const inner = shelfTop.intersect(wallFace);

  // The L, its outer corners rounded and the inside corner filleted.
  const profile = s.polygon([shelf.start, shelf.end, shelfTop.end, inner, wallFace.end, wall.end], {
    round: (i) => (i === 3 ? p.fillet : p.corner),
  });

  // The gusset reaches the same fraction along each leg's inside face, and is sunk 1 mm into both
  // legs so it fuses with them; its tips softened.
  const brace = s.line([p.shelfLeg * p.gussetReach, p.thick - 1], [p.thick - 1, p.wallLeg * p.gussetReach]);
  const gussetShape = s.polygon([[p.thick - 1, p.thick - 1], brace.start, brace.end], { round: 1.5 });

  // Pushed along +Y: the profile across the full width, the gusset in the middle.
  const gusset = () => plane.XZ.offset((p.width - p.gusset) / 2).extrude(gussetShape, p.gusset);

  // A through hole with a 90° countersink, sized for M4 (a 4 mm wood screw takes the same).
  const sink = () => screwHole('M4', { length: p.thick + 1, head: 'countersunk' });
  // The cutter at [u, v] on a leg's inside face, going down through the leg.
  const sinkAt = (frame, u, v) => frame.place(sink().translate([u, v, 0]));

  // Holes sit across the width, clear of the gusset, at the middle of the free stretch of each leg.
  const ys = p.holes === 1 ? [p.width / 2] : [p.width * 0.22, p.width * 0.78];
  const freeShelf = p.thick + p.fillet;
  const freeWall = p.thick + p.fillet;
  const shelfX = [freeShelf + (p.shelfLeg - freeShelf) * 0.35, freeShelf + (p.shelfLeg - freeShelf) * 0.8];
  const wallZ = [freeWall + (p.wallLeg - freeWall) * 0.3, freeWall + (p.wallLeg - freeWall) * 0.75];

  const shelfHoles = () => product(shelfX, ys).map(([x, y]) => sinkAt(plane.XY.offset(p.thick), x, y));
  const wallHoles = () => product(wallZ, ys).map(([z, y]) => sinkAt(plane.YZ.offset(p.thick), y, z));

  const bracket = () =>
    plane.XZ.extrude(profile, p.width).union(gusset()).subtract(shelfHoles(), wallHoles());

  return {
    bracket,
    // The bracket with the construction lines of its profile.
    sketch: () => [bracket(), s],
  };
};
