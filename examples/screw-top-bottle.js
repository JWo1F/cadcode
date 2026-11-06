/*---
title: Screw-top bottle
description: A bottle lofted from a rounded-square body into a round neck, with a threaded neck and a cap that screws on.
---*/
import { circle, cube, cylinder, loft, range, setResolution, square, thread } from 'cadcode';

setResolution({ fn: 64 });

export const params = {
  // Body
  width: 60,
  corner: 10, // radius of the body's vertical edges
  bodyHeight: 90,
  shoulder: 25, // height of the slope from the body to the neck
  wall: 2,

  // Neck and cap
  neckD: 28, // across the thread crests
  neckHeight: 14,
  pitch: 4,
  starts: 2, // a two-start thread closes in half a turn per pitch
  clearance: 0.3,
  capWall: 2.5,
  capTop: 2,
  grips: 24,
};

export default (p) => {
  const depth = p.pitch / 2; // a trapezoid thread is half a pitch deep
  const neckRoot = p.neckD / 2 - depth;
  const neckZ = p.bodyHeight + p.shoulder;
  const bore = neckRoot - p.wall;

  // One outline per section, as loft() wants: a rounded square, then circles.
  const roundedSquare = (w, r) => square(w - 2 * r, { center: true }).offset(r);
  const neckThread = () => thread({ d: p.neckD, pitch: p.pitch, starts: p.starts, length: p.neckHeight, profile: 'trapezoid', taper: 1.5 });

  const bottle = () => {
    const outside = loft(
      [roundedSquare(p.width, p.corner), roundedSquare(p.width, p.corner), circle(p.width / 2 - 4), circle(neckRoot + 0.5)],
      { z: [0, p.bodyHeight, p.bodyHeight + p.shoulder * 0.6, neckZ + 0.5] },
    );
    const inside = loft(
      [roundedSquare(p.width - 2 * p.wall, p.corner - p.wall), roundedSquare(p.width - 2 * p.wall, p.corner - p.wall), circle(p.width / 2 - 4 - p.wall), circle(bore)],
      { z: [p.wall, p.bodyHeight, p.bodyHeight + p.shoulder * 0.6, neckZ - 1] },
    );
    const neck = neckThread().translate([0, 0, neckZ]);
    const mouth = cylinder({ r: bore, h: p.neckHeight + 4 }).translate([0, 0, neckZ - 2]);
    return outside.union(neck).subtract(inside, mouth);
  };

  // The cap is built where it sits on the neck, so its thread lines up with the neck's.
  // Its ceiling meets the rim of the neck; the cutter reaches 1 past each end of its length.
  const capInPlace = () => {
    const outer = p.neckD / 2 + p.clearance + depth + p.capWall;
    const bottom = neckZ + 1;
    const top = neckZ + p.neckHeight + p.capTop;
    const shell = cylinder({ r: outer, h: top - bottom, chamfer: { top: 1 } }).translate([0, 0, bottom]);
    const hole = thread({ d: p.neckD, pitch: p.pitch, starts: p.starts, length: p.neckHeight - 1, profile: 'trapezoid', internal: true, clearance: p.clearance, taper: 1 });
    const grips = range(0, p.grips - 1).map((i) =>
      cylinder({ d: 2.4, h: top - bottom + 2, fn: 12 }).translate([outer + 0.5, 0, bottom - 1]).rotate((360 * i) / p.grips),
    );
    return shell.subtract(hole.translate([0, 0, neckZ]), grips);
  };

  // Printed upside down, its top on the bed.
  const cap = () => {
    const placed = capInPlace().rotate([180, 0, 0]);
    return placed.translate([0, 0, -placed.bounds().min[2]]);
  };

  // A cut-away of the closed bottle, to check that the cap seats on the neck.
  const section = () =>
    [bottle(), capInPlace().color('tomato')].map((s) => s.subtract(cube([200, 100, 400]).translate([-100, -100, -10])));

  console.log(`${p.width} mm wide, ${neckZ + p.neckHeight} mm to the rim, ${p.neckD} mm neck`);

  return { bottle, cap, section };
};
