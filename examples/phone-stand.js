/*---
title: Phone stand
description: A desk stand for a phone in its case, with a slot for the charging cable.
---*/
// Desk stand for a phone, upright or sideways, case on. The phone leans back on a sloped plate and
// sits on a raised seat behind a lip; a slot through the seat and lip lets the charging plug hang
// below the phone and the cable leave at the front. The side profile is open like a truss.
// Prints as it stands, no support: every face is vertical, flat or leans back by at most 25°.
//
//   cadcode dev examples/phone-stand.js
//   cadcode stl examples/phone-stand.js --part stand
import { circle, cube, frameAt, setResolution, sketch, square, union } from 'cadcode';

setResolution({ fn: 48 });

export const params = [
  {
    name: 'Frame',
    children: {
      width: { value: 76, name: 'Width', description: 'Width of the stand, side to side, in mm.' },
      angle: { value: 65, name: 'Angle', description: 'Angle of the back plate from the desk, in degrees.' },
      back: { value: 100, name: 'Back length', description: 'Length of the back plate from the seat up, in mm.' },
      plate: { value: 5, name: 'Plate', description: 'Thickness of the back plate, in mm.' },
      foot: { value: 92, name: 'Foot', description: 'Depth of the stand on the desk, front to back, in mm.' },
      base: { value: 5, name: 'Base', description: 'Thickness of the bottom bar, in mm.' },
    },
  },
  // Where the phone stands
  {
    name: 'Seat',
    children: {
      seatZ: { value: 20, name: 'Seat height', description: 'Height of the seat, room for a USB-C plug under the phone, in mm.' },
      seatDepth: { value: 13, name: 'Seat depth', description: 'Depth of the seat, for the phone plus case, in mm.' },
      lip: { value: 9, name: 'Lip', description: 'Height of the front lip above the seat, in mm.' },
      lipT: { value: 5, name: 'Lip thickness', description: 'Thickness of the front lip, in mm.' },
    },
  },
  // Cable slot through the seat and lip
  {
    name: 'Cable slot',
    children: {
      slotW: { value: 14, name: 'Slot width', description: 'Width of the cable slot, in mm; a USB-C plug is about 12 × 6.5 mm.' },
      slotFloor: { value: 3, name: 'Slot floor', description: 'Material left under the cable slot, in mm.' },
      r: { value: 6, name: 'Corner radius', description: 'Radius of the corners in plan, in mm.' },
    },
  },
];

export default (p) => {
  // The side profile is drawn with the front at u = 0 and v up. Its plane runs u along -X from
  // X = foot, so the front ends up at +X, facing the default camera, and extrudes along +Y.
  const s = sketch(frameAt([p.foot, 0, 0], [0, 1, 0]));
  const seatBack = p.lipT + p.seatDepth;
  const desk = s.line([0, 0], [p.foot, 0]);
  // The phone leans on the plate's face, from the seat up `back` at `angle`.
  const plateFace = s.line([seatBack, p.seatZ], { angle: p.angle, length: p.back });
  const plateBack = plateFace.parallel(-p.plate);
  const front = plateFace.end; // top of the plate, phone side
  const top = plateBack.end;
  const strut = s.line(desk.end, top); // from the back of the foot up to the top of the plate

  // Convex corners rounded, the two inside corners at the seat filleted.
  const outline = s.polygon(
    [desk.start, desk.end, top, front, plateFace.start, [p.lipT, p.seatZ], [p.lipT, p.seatZ + p.lip], [0, p.seatZ + p.lip]],
    { round: (i) => (i === 4 || i === 5 ? 3 : 1.5) },
  );
  // The window between the plate, the base and the rear strut, a wall in from each; its front edge
  // (the post) stands a wall behind the seat.
  const post = s.line([seatBack + p.plate, 0], [seatBack + p.plate, p.seatZ]);
  const base = desk.parallel(p.plate);
  const strutIn = strut.parallel(p.plate);
  const window = s.polygon(
    [base.intersect(post), base.intersect(strutIn), strutIn.intersect(plateBack), plateBack.intersect(post)],
    { round: 5 },
  );
  const profile = outline.subtract(window);

  // The profile pushed across the width; the plan's corners are rounded.
  const body = () => s.extrude(profile, p.width).intersect(cube([p.foot, p.width, front[1] + 5], { round: { z: p.r } }));

  // Round-ended slot from under the phone out through the lip.
  const slotEnd = seatBack - p.slotW / 2 - 1;
  const slot = () =>
    union(square([slotEnd + 1, p.slotW]).translate([-1, -p.slotW / 2]), circle(p.slotW / 2).translate([slotEnd, 0]))
      .extrude(p.seatZ + p.lip)
      .translate([0, p.width / 2, p.slotFloor]);

  // The slot and the phone are built with the front at X = 0, like the profile, then turned round
  // to the stand's front.
  const turn = (solid) => solid.rotate(180).translate([p.foot, p.width, 0]);

  const stand = () => body().subtract(turn(slot()));

  // A phone in a case, for the assembly view.
  // Its back-bottom edge, moved to the origin, tilts back and sits in the corner between seat and plate.
  const tilt = 90 - p.angle;
  const phone = () => {
    const [w, h, t] = [72, 150, 9];
    const shell = square([t - 2, w - 8], { center: true })
      .offset(4)
      .extrude(h)
      .intersect(cube([t, w, h], { center: true }).translate([0, 0, h / 2]));
    return [
      shell.color('#1d1d1f'),
      cube([0.6, w - 6, h - 6], { center: true }).translate([-t / 2, 0, h / 2]).color('#3b5b7a'),
    ].map((part) =>
      turn(part.translate([-t / 2, 0, 0]).rotate([0, tilt, 0]).translate([seatBack, p.width / 2, p.seatZ])),
    );
  };

  console.log(`${p.foot} × ${p.width} × ${front[1].toFixed(0)} mm`);

  return {
    assembly: () => [stand().color('#e8e4da'), phone()],
    stand,
    // The stand with the construction lines of its side profile.
    sketch: () => [stand(), s],
  };
};
