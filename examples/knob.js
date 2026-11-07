/*---
title: Knob
description: A knurled knob with a pointer, for a 6 mm D-shaft potentiometer.
---*/
import { cube, cylinder, polygon, range, setResolution } from 'cadcode';

setResolution({ fn: 96 });

export const params = {
  // Grip
  d: { value: 24, name: 'Diameter', description: 'Diameter of the grip, in mm.' },
  height: { value: 16, name: 'Height', description: 'Overall height of the knob, in mm.' },
  chamfer: { value: 1.5, name: 'Chamfer', description: 'Chamfer on the top edge of the grip, in mm.' },
  knurls: { value: 18, name: 'Knurls', description: 'Number of grooves around the grip.' },
  knurlD: { value: 2, name: 'Knurl diameter', description: 'Diameter of each groove, in mm.' },

  // Skirt with the pointer
  skirtD: { value: 30, name: 'Skirt diameter', description: 'Diameter of the skirt that carries the pointer, in mm.' },
  skirtH: { value: 3, name: 'Skirt height', description: 'Height of the skirt, in mm.' },

  // D-shaft of a 6 mm potentiometer
  shaftD: { value: 6, name: 'Shaft diameter', description: 'Diameter of the potentiometer shaft, in mm.' },
  shaftFlat: { value: 4.5, name: 'Shaft flat', description: 'Width of the shaft across the flat, in mm.' },
  shaftDepth: { value: 11, name: 'Shaft depth', description: 'Depth of the D-hole, in mm.' },
  fit: { value: 0.2, name: 'Fit', description: 'Clearance added to the hole, across the round and the flat, in mm.' },
};

export default (p) => {
  const r = p.d / 2;
  const skirtR = p.skirtD / 2;

  // Half cross-section: X is the radius, Y becomes Z when revolved.
  const body = () =>
    polygon([
      [0, 0],
      [skirtR, 0],
      [skirtR, p.skirtH],
      [r, p.skirtH + 1],
      [r, p.height - p.chamfer],
      [r - p.chamfer, p.height],
      [0, p.height],
    ]).revolve();

  const knurling = () =>
    range(0, p.knurls - 1).map((i) =>
      cylinder({ d: p.knurlD, h: p.height, fn: 16 })
        .translate([r + p.knurlD / 4, 0, p.skirtH + 2])
        .rotate((360 * i) / p.knurls),
    );

  const pointer = () => cube([skirtR, 1.2, 1]).translate([r - 1, -0.6, p.skirtH - 0.8]);
  const topMark = () => cube([r - 3, 1.2, 1]).translate([2, -0.6, p.height - 0.6]);

  const shaftHole = () => {
    const d = p.shaftD + p.fit;
    const flat = p.shaftFlat + p.fit;
    // Round on -Y, flat at `flat` from the round side.
    return cylinder({ d, h: p.shaftDepth + 1 })
      .intersect(cube([d + 2, flat + 1, p.shaftDepth + 3]).translate([-d / 2 - 1, -d / 2 - 1, -1]))
      .translate([0, 0, -1]);
  };

  // Prints as it stands: the skirt is on the bed and the blind end of the D-hole is a short bridge.
  const knob = () => body().subtract(knurling(), pointer(), topMark(), shaftHole());

  return { knob };
};
