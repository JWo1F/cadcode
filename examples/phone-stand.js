// Desk stand for a phone, upright or sideways, case on. The phone leans back on a sloped plate and
// sits on a raised seat behind a lip; a slot through the seat and lip lets the charging plug hang
// below the phone and the cable leave at the front. The side profile is open like a truss.
// Prints as it stands, no support: every face is vertical, flat or leans back by at most 25°.
//
//   cadcode dev examples/phone-stand.js
//   cadcode stl examples/phone-stand.js --part stand
import { circle, cube, polygon, setResolution, square, union } from 'cadcode';

setResolution({ fn: 48 });

export const params = {
  width: 76,
  angle: 65, // of the back plate, from the desk
  back: 100, // length of the back plate, from the seat up
  plate: 5, // its thickness
  foot: 92, // front to back, on the desk
  base: 5, // thickness of the bottom bar

  // Where the phone stands
  seatZ: 20, // height of the seat: room for a USB-C plug under the phone
  seatDepth: 13, // phone plus case
  lip: 9, // above the seat
  lipT: 5,

  // Cable slot through the seat and lip
  slotW: 14, // a USB-C plug is about 12 × 6.5 mm
  slotFloor: 3,

  r: 6, // corner radius in plan
};

export default (p) => {
  const a = (p.angle * Math.PI) / 180;
  const seatBack = p.lipT + p.seatDepth;
  const front = [seatBack + p.back * Math.cos(a), p.seatZ + p.back * Math.sin(a)]; // top of the plate, phone side
  const top = [front[0] + p.plate * Math.sin(a), front[1] - p.plate * Math.cos(a)];

  // Side profile, front at X = 0, Y up.
  const profile = () => {
    const outline = polygon([
      [0, 0],
      [p.foot, 0],
      top,
      front,
      [seatBack, p.seatZ],
      [p.lipT, p.seatZ],
      [p.lipT, p.seatZ + p.lip],
      [0, p.seatZ + p.lip],
    ]);
    // The triangle between the plate, the base and the rear strut, inset by a wall all round.
    const window = outline
      .offset({ delta: -p.plate })
      .intersect(square([p.foot, p.foot * 2]).translate([seatBack + p.plate, 0]))
      .offset(-5)
      .offset(5);
    return outline.offset(-1.5).offset(1.5).offset(3).offset(-3).subtract(window);
  };

  // The profile stands in XZ and is pushed along Y; the plan's corners are rounded.
  const body = () =>
    profile()
      .extrude(p.width)
      .rotate([90, 0, 0])
      .translate([0, p.width, 0])
      .intersect(square([p.foot - 2 * p.r, p.width - 2 * p.r]).translate([p.r, p.r]).offset(p.r).extrude(front[1] + 5));

  // Round-ended slot from under the phone out through the lip.
  const slotEnd = seatBack - p.slotW / 2 - 1;
  const slot = () =>
    union(square([slotEnd + 1, p.slotW]).translate([-1, -p.slotW / 2]), circle(p.slotW / 2).translate([slotEnd, 0]))
      .extrude(p.seatZ + p.lip)
      .translate([0, p.width / 2, p.slotFloor]);

  // Built with the front at X = 0, then turned round so the front faces the default camera.
  const turn = (s) => s.rotate(180).translate([p.foot, p.width, 0]);

  const stand = () => turn(body().subtract(slot()));

  // A phone in a case, for the assembly view.
  // Its back-bottom edge sits in the corner between seat and plate.
  const tilt = 90 - p.angle;
  const tiltR = (tilt * Math.PI) / 180;
  const phone = () => {
    const [w, h, t] = [72, 150, 9];
    const shell = square([t - 2, w - 8], { center: true })
      .offset(4)
      .extrude(h)
      .intersect(cube([t, w, h], { center: true }).translate([0, 0, h / 2]));
    return [
      shell.color('#1d1d1f'),
      cube([0.6, w - 6, h - 6], { center: true }).translate([-t / 2, 0, h / 2]).color('#3b5b7a'),
    ].map((s) =>
      s
        .rotate([0, tilt, 0])
        .translate([seatBack - (t / 2) * Math.cos(tiltR), p.width / 2, p.seatZ + (t / 2) * Math.sin(tiltR)]),
    ).map(turn);
  };

  console.log(`${p.foot} × ${p.width} × ${front[1].toFixed(0)} mm`);

  return {
    assembly: () => [stand().color('#e8e4da'), phone()],
    stand,
  };
};
