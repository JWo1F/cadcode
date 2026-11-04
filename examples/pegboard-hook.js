/*---
title: Pegboard hook
description: A J-hook for 1/4" pegboard that locks into two holes so it cannot twist.
---*/
// J-hook for 1/4" pegboard (6.35 mm holes on a 25.4 mm grid). The upper prong goes through a hole
// and turns down behind the board, the lower one plugs the hole below so the hook cannot twist.
// The whole hook is one side profile pushed through its thickness, so it prints lying flat with
// no support, and the layers run along the arm where the load bends it.
//
//   cadcode dev examples/pegboard-hook.js
//   cadcode stl examples/pegboard-hook.js --part hook
import { circle, cube, cylinder, linearExtrude, polygon, product, range, setResolution, square, union } from 'cadcode';

setResolution({ fn: 48 });

export const params = {
  // Pegboard
  pitch: 25.4,
  holeD: 6.35,
  boardT: 6.35, // 1/4" hardboard; 3/16" boards are 4.8

  // Hook
  t: 6, // thickness, and the prongs' size across
  prong: 5.2, // prong height in the profile
  roundTo: 6.1, // prongs are trimmed to this diameter so their corners pass the hole
  drop: 9, // how far the upper prong turns down behind the board
  plate: 4, // against the board's face
  reach: 70, // arm, from the board
  rootH: 13, // arm height at the plate
  tipH: 8, // and at the bend
  bendR: 9, // inside radius of the J
  tipLen: 10, // straight part after the bend
};

export default (p) => {
  const z0 = 0; // lower prong's centre line; the upper one is a pitch above
  const z1 = p.pitch;
  const back = -(p.boardT + 0.8); // behind the board, with a little play
  const armY = -p.rootH / 2; // arm's centre line at the plate

  // Side profile: X points away from the board (its face is X = 0), Y is up.
  const profile = () => {
    const pr = p.prong;
    const plate = square([p.plate, z1 + pr / 2 + 6 - (armY - p.rootH / 2)]).translate([0, armY - p.rootH / 2]);
    const upper = union(
      square([-back + 1, pr]).translate([back, z1 - pr / 2]),
      square([pr, p.drop + pr / 2]).translate([back - pr, z1 + pr / 2 - p.drop - pr / 2]),
    );
    const lower = square([p.boardT + 1, pr]).translate([-p.boardT, z0 - pr / 2]);

    // Tapered arm, then the J: a quarter ring from pointing forward to pointing up.
    const tipY = armY + (p.rootH - p.tipH) / 2; // the arm's centre line droops a little
    const arm = polygon([
      [0, armY - p.rootH / 2],
      [p.reach, tipY - p.tipH / 2],
      [p.reach, tipY + p.tipH / 2],
      [0, armY + p.rootH / 2],
    ]);
    const c = [p.reach, tipY + p.bendR + p.tipH / 2];
    const ring = circle(p.bendR + p.tipH)
      .subtract(circle(p.bendR))
      .intersect(square([p.bendR + p.tipH + 1, p.bendR + p.tipH + 1]).translate([0, -p.bendR - p.tipH - 1]))
      .translate(c);
    const w = p.tipH;
    const tip = union(
      square([w, p.tipLen]).translate([c[0] + p.bendR + (p.tipH - w) / 2, c[1]]),
      circle(w / 2).translate([c[0] + p.bendR + p.tipH / 2, c[1] + p.tipLen]),
    );
    return union(plate, upper, lower, arm, ring, tip)
      .offset(2)
      .offset(-2) // fillets in the inside corners
      .offset(-1)
      .offset(1); // soft outside corners
  };

  // Rods along X and Y through the prongs' centres; the prongs keep only what lies inside them.
  const prongTrim = () => {
    const rod = (h) => cylinder({ d: p.roundTo, h, center: true });
    return union(
      rod(40).rotate([0, 90, 0]).translate([back, z1, p.t / 2]),
      rod(40).rotate([0, 90, 0]).translate([-p.boardT / 2, z0, p.t / 2]),
      rod(40).rotate([90, 0, 0]).translate([back - p.prong / 2, z1, p.t / 2]),
    );
  };

  // Print orientation: the profile on the bed, the thickness along Z.
  const hook = () => {
    const flat = linearExtrude(p.t, {}, profile());
    const prongZone = cube([-back + p.prong + 1, 60, p.t + 2]).translate([back - p.prong - 1, z0 - 30, -1]);
    return flat.subtract(prongZone).union(flat.intersect(prongZone, prongTrim()));
  };

  // In use: profile upright in XZ, thickness centred on Y = 0.
  const mounted = (s) => s.translate([0, 0, -p.t / 2]).rotate([90, 0, 0]);

  // A patch of board, three holes by four, around the hook's two holes.
  const board = () =>
    cube([p.boardT, 3 * p.pitch, 4 * p.pitch])
      .translate([-p.boardT, -1.5 * p.pitch, -1.5 * p.pitch])
      .subtract(
        product([-1, 0, 1], range(-1, 2)).map(([y, z]) =>
          cylinder({ d: p.holeD, h: p.boardT + 2, center: true })
            .rotate([0, 90, 0])
            .translate([-p.boardT / 2, y * p.pitch, z * p.pitch]),
        ),
      );

  // A roll of tape threaded onto the arm, its core resting on the arm's top edge.
  const tape = () => {
    const [rIn, rOut, w, x] = [19, 30, 18, p.reach * 0.6];
    const tipY = armY + (p.rootH - p.tipH) / 2;
    const armTop = armY + p.rootH / 2 + (x / p.reach) * (tipY + p.tipH / 2 - (armY + p.rootH / 2));
    return square([rOut - rIn, w])
      .translate([rIn, -w / 2])
      .revolve()
      .rotate([0, 90, 0]) // axis along the arm
      .translate([x, 0, armTop - rIn]);
  };

  return {
    assembly: () => [board().color('#b98b55'), mounted(hook()).color('#2d6a4f'), tape().color('#d9c27a')],
    hook,
  };
};
