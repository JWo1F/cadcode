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
import { cylinder, polygon, product, setResolution, square } from 'cadcode';

setResolution({ fn: 48 });

export const params = {
  // Legs
  wallLeg: { value: 60, name: 'Wall leg', description: 'Length of the leg up the wall, in mm.' },
  shelfLeg: { value: 80, name: 'Shelf leg', description: 'Length of the leg under the shelf, in mm.' },
  width: { value: 30, name: 'Width', description: 'Width of the bracket, in mm.' },
  thick: { value: 5, name: 'Thickness', description: 'Thickness of both legs, in mm.' },
  fillet: { value: 8, name: 'Fillet', description: 'Radius of the inside corner, in mm.' },
  corner: { value: 2, name: 'Corner radius', description: 'Radius of the outer corners, in mm; keep it under half the thickness.' },

  // Gusset in the middle of the width
  gusset: { value: 4, name: 'Gusset', description: 'Thickness of the gusset, in mm.' },
  gussetReach: { value: 0.7, name: 'Gusset reach', description: 'Fraction of each leg the gusset runs along.' },

  // 4 mm countersunk wood screws
  hole: { value: 4.5, name: 'Screw hole', description: 'Clearance hole for the screw shank, in mm.' },
  head: { value: 8.6, name: 'Screw head', description: 'Diameter of the countersink for the screw head, in mm.' },
  holes: { value: 2, name: 'Holes', description: 'Screw holes per leg, across the width: 1 or 2.' },
};

export default (p) => {
  // The L profile in the XZ plane: X runs along the shelf, Z up the wall.
  // offset(+r).offset(-r) fills the concave corner; offset(-r).offset(+r) rounds the convex ones.
  const profile = () =>
    square([p.shelfLeg, p.thick])
      .union(square([p.thick, p.wallLeg]))
      .offset(p.fillet)
      .offset(-p.fillet)
      .offset(-p.corner)
      .offset(p.corner);

  // A 2D shape in XY, extruded along Z and turned so the extrusion runs along +Y.
  const alongY = (shape, depth, y0) => shape.extrude(depth).rotate([90, 0, 0]).translate([0, y0 + depth, 0]);

  const gusset = () => {
    const a = p.shelfLeg * p.gussetReach;
    const b = p.wallLeg * p.gussetReach;
    const tri = polygon([
      [p.thick - 1, p.thick - 1],
      [a, p.thick - 1],
      [p.thick - 1, b],
    ]).offset(-1.5).offset(1.5); // softened tip
    return alongY(tri, p.gusset, (p.width - p.gusset) / 2);
  };

  // Through hole plus a 90° cone; the cone overshoots the face so it cuts clean.
  const sink = () => [
    cylinder({ d: p.hole, h: p.thick + 2 }).translate([0, 0, -1]),
    cylinder({ d1: p.hole, d2: p.head + 1, h: (p.head + 1 - p.hole) / 2 }).translate([0, 0, p.thick - (p.head - p.hole) / 2]),
  ];

  // Holes sit across the width, clear of the gusset, at the middle of the free stretch of each leg.
  const ys = p.holes === 1 ? [p.width / 2] : [p.width * 0.22, p.width * 0.78];
  const freeShelf = p.thick + p.fillet;
  const freeWall = p.thick + p.fillet;
  const shelfX = [freeShelf + (p.shelfLeg - freeShelf) * 0.35, freeShelf + (p.shelfLeg - freeShelf) * 0.8];
  const wallZ = [freeWall + (p.wallLeg - freeWall) * 0.3, freeWall + (p.wallLeg - freeWall) * 0.75];

  const shelfHoles = () => product(shelfX, ys).map(([x, y]) => sink().map((s) => s.translate([x, y, 0])));
  // Same cutter turned to face +X, the inside of the wall leg.
  const wallHoles = () =>
    product(wallZ, ys).map(([z, y]) => sink().map((s) => s.rotate([0, 90, 0]).translate([0, y, z])));

  const bracket = () =>
    alongY(profile(), p.width, 0).union(gusset()).subtract(shelfHoles(), wallHoles());

  return { bracket };
};
