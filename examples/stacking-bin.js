/*---
title: Stacking bin
description: A parts bin with a front scoop and a label shelf that stacks without sliding.
---*/
// Stacking parts bin: a rounded tub with a curved scoop where the floor meets the front wall, a
// label shelf on the front, and a stepped base that drops into the top of the bin below so a stack
// cannot slide apart. Prints as it stands; the step and the shelf are 45° underneath.
//
//   cadcode dev examples/stacking-bin.js
//   cadcode stl examples/stacking-bin.js --part bin --set width=100
import { cube, cylinder, hull, polygon, setResolution, square } from 'cadcode';

setResolution({ fn: 64 });

export const params = {
  // Outside
  width: { value: 70, name: 'Width', description: 'Outside width of the bin, in mm.' },
  depth: { value: 110, name: 'Depth', description: 'Outside depth of the bin, front to back, in mm.' },
  height: { value: 55, name: 'Height', description: 'Outside height of the bin, in mm.' },
  corner: { value: 6, name: 'Corner radius', description: 'Radius of the outside vertical corners, in mm.' },
  wall: { value: 1.6, name: 'Wall', description: 'Wall thickness, in mm.' },
  floor: { value: 1.2, name: 'Floor', description: 'Floor thickness, in mm.' },

  // Base that nests into the bin below
  step: { value: 4, name: 'Step', description: 'How far the base drops into the bin below, in mm.' },
  fit: { value: 0.3, name: 'Stacking fit', description: 'Gap per side between the step and the walls it drops between, in mm.' },

  // Inside
  scoop: { value: 18, name: 'Scoop radius', description: 'Radius of the curve from the floor up the front wall, in mm.' },

  // Label shelf
  shelfOut: { value: 7, name: 'Shelf depth', description: 'How far the label shelf stands off the front, in mm.' },
  shelfH: { value: 14, name: 'Label height', description: 'Height of the label face, in mm.' },
};

export default (p) => {
  const H = p.height;
  const rise = p.wall + p.fit; // the 45° flare from the step out to the full wall

  // Every outline is the outer one shrunk with offset, so all the corners stay concentric.
  const outer = square([p.width - 2 * p.corner, p.depth - 2 * p.corner])
    .translate([p.corner, p.corner])
    .offset(p.corner);
  const inner = outer.offset(-p.wall);
  const stepOutline = inner.offset(-p.fit);
  const stepInner = stepOutline.offset(-p.wall);

  const slab = (shape, z) => shape.extrude(0.01).translate([0, 0, z]);

  const solidBody = () =>
    stepOutline
      .extrude(p.step)
      .union(
        hull(slab(stepOutline, p.step), slab(outer, p.step + rise)),
        outer.extrude(H - p.step - rise).translate([0, 0, p.step + rise]),
      );

  const cavity = () => [
    stepInner.extrude(p.step + rise + 0.01 - p.floor).translate([0, 0, p.floor]),
    inner.extrude(H).translate([0, 0, p.step + rise]),
  ];

  // Fill the front-bottom corner of the cavity, then take a quarter cylinder out of it.
  const scoop = () => {
    const y = p.wall + p.scoop; // tangent to the inside of the front wall above the step
    const z = p.floor + p.scoop;
    return cube([p.width, y, z])
      .subtract(cylinder({ r: p.scoop, h: p.width + 2 }).rotate([0, 90, 0]).translate([-1, y, z]))
      .intersect(solidBody());
  };

  // Shelf profile in (y, z): 45° underside, vertical label face, flush with the rim on top.
  // Drawn in 2D and turned so its X runs along Y, its Y up Z, and the extrusion along X.
  const shelfLen = p.width - 2 * p.corner - 4;
  const shelfZ0 = H - p.shelfH - p.shelfOut;
  const shelf = () =>
    polygon([
      [1, shelfZ0 - 1],
      [-p.shelfOut, shelfZ0 + p.shelfOut],
      [-p.shelfOut, H],
      [1, H],
    ])
      .extrude(shelfLen)
      .rotate([90, 0, 0])
      .rotate(90)
      .translate([(p.width - shelfLen) / 2, 0, 0]);

  const bin = () => solidBody().subtract(cavity()).union(scoop(), shelf());

  // A paper label on the shelf face, for the assembly.
  const label = () =>
    cube([shelfLen - 4, 0.3, p.shelfH - 3]).translate([(p.width - shelfLen) / 2 + 2, -p.shelfOut - 0.3, H - p.shelfH + 1]);

  // The upper bin's flare comes down onto the inner edge of the lower rim `fit` above its step.
  const stackZ = H - p.step - p.fit;

  return {
    assembly: () => [
      bin().color('#2f6690'),
      label().color('#f4f1ea'),
      bin().translate([0, 0, stackZ]).color('#e07a2f'),
      label().translate([0, 0, stackZ]).color('#f4f1ea'),
    ],
    bin,
  };
};
