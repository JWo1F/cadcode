/*---
title: Gear bearing
description: A planetary bearing with herringbone teeth that turns straight off the bed.
---*/
import { circle, cylinder, polygon, range, setResolution, union } from 'cadcode';

setResolution({ fn: 96 });

// A planetary gear bearing that prints in one piece and turns straight off the bed.
// Herringbone teeth hold the sun and planets in the ring, so nothing falls out.
export const params = {
  module: { value: 2, name: 'Module', description: 'Gear module: pitch diameter per tooth, in mm.' },
  sunTeeth: { value: 15, name: 'Sun teeth', description: 'Number of teeth on the sun gear.' },
  planetTeeth: { value: 9, name: 'Planet teeth', description: 'Number of teeth on each planet gear.' },
  planets: { value: 4, name: 'Planets', description: 'Number of planet gears; (sun + ring) teeth must divide evenly by this.' },
  pressureAngle: { value: 20, name: 'Pressure angle', description: 'Tooth pressure angle, in degrees.' },
  addendum: { value: 0.85, name: 'Addendum', description: 'Tooth height above the pitch circle, in modules; short to keep small planets clear.' },
  helix: { value: 30, name: 'Helix angle', description: 'Helix angle of the herringbone teeth, in degrees.' },
  height: { value: 15, name: 'Height', description: 'Height of the bearing, in mm.' },
  rim: { value: 5, name: 'Ring rim', description: 'Ring wall behind the tooth roots, in mm.' },
  clearance: { value: 0.15, name: 'Clearance', description: 'Clearance per flank for printing in place, in mm.' },
  hex: { value: 7, name: 'Hex key', description: 'Hex hole in the sun for a key, across the flats, in mm.' },
};

export default (p) => {
  const ringTeeth = p.sunTeeth + 2 * p.planetTeeth;
  if ((p.sunTeeth + ringTeeth) % p.planets !== 0) {
    throw new Error(`(sun + ring) = ${p.sunTeeth + ringTeeth} teeth is not divisible by ${p.planets} planets`);
  }

  const rad = (deg) => (deg * Math.PI) / 180;
  const inv = (a) => Math.tan(a) - a; // involute function
  const pitchR = (z) => (p.module * z) / 2;

  // External involute gear outline with its first tooth centred on +X.
  const gearProfile = (z, { addendum = p.addendum, dedendum = 1.25 } = {}) => {
    const r = pitchR(z);
    const rb = r * Math.cos(rad(p.pressureAngle));
    const ra = r + addendum * p.module;
    const rf = r - dedendum * p.module;
    const half = Math.PI / (2 * z) + inv(rad(p.pressureAngle));
    // Angle of the flank from the tooth centre line at radius rho.
    const flank = (rho) => half - inv(Math.acos(Math.min(1, rb / rho)));

    const low = Math.max(rb, rf);
    const radii = range(0, 10).map((i) => low + ((ra - low) * i) / 10);
    const side = (sign) => radii.map((rho) => [rho * Math.cos(sign * flank(rho)), rho * Math.sin(sign * flank(rho))]);
    const root = rf < rb ? [[rf * Math.cos(-flank(rb)), rf * Math.sin(-flank(rb))]] : [];
    const rootUp = rf < rb ? [[rf * Math.cos(flank(rb)), rf * Math.sin(flank(rb))]] : [];
    const tooth = polygon([[0, 0], ...root, ...side(-1), ...side(1).reverse(), ...rootUp]);

    return union(
      circle({ r: rf }),
      range(0, z - 1).map((i) => tooth.rotate((360 * i) / z)),
    );
  };

  // Every gear twists so its pitch circle moves by the same arc per millimetre of height, which
  // keeps the teeth in mesh at every layer. The profile as given is the one at mid-height; `over`
  // carries the helix on past both faces, for cutters.
  const herringbone = (profile, z, hand, over = 0) => {
    const h = p.height / 2 + over;
    const twist = (hand * h * Math.tan(rad(p.helix)) * 180) / (Math.PI * pitchR(z));
    const top = profile.extrude(h, { twist, divisions: 24 }).translate([0, 0, p.height / 2]);
    return top.union(top.mirror([0, 0, 1]).translate([0, 0, p.height]));
  };

  const sun = () => {
    const hexHole = circle({ r: p.hex / Math.sqrt(3), fn: 6 }).extrude(p.height + 2).translate([0, 0, -1]);
    return herringbone(gearProfile(p.sunTeeth).offset(-p.clearance), p.sunTeeth, 1).subtract(hexHole);
  };

  const orbit = pitchR(p.sunTeeth) + pitchR(p.planetTeeth);
  const planetAngles = range(0, p.planets - 1).map((i) => (360 * i) / p.planets);
  // Rolling a planet around the sun by `a` turns it by a·(1 + sun/planet); moving it along the
  // orbit already turns it by `a`, so the rest is turned here.
  const planet = (a) =>
    herringbone(
      gearProfile(p.planetTeeth)
        .offset(-p.clearance)
        .rotate((a * p.sunTeeth) / p.planetTeeth),
      p.planetTeeth,
      -1,
    )
      .translate([orbit, 0, 0])
      .rotate(a);

  const ring = () => {
    const outer = pitchR(ringTeeth) + 1.25 * p.module + p.rim;
    // The ring's tooth spaces are an external gear of the same tooth count, cut out with clearance.
    const cutter = gearProfile(ringTeeth, { addendum: 1.25, dedendum: p.addendum }).offset(p.clearance);
    return cylinder({ r: outer, h: p.height }).subtract(herringbone(cutter, ringTeeth, -1, 1));
  };

  console.log(
    `ring ${ringTeeth} teeth, outer Ø${(2 * (pitchR(ringTeeth) + 1.25 * p.module + p.rim)).toFixed(1)} mm, ` +
      `sun:carrier ratio 1:${(1 + ringTeeth / p.sunTeeth).toFixed(2)}`,
  );

  return {
    assembly: () => [
      ring().color('slategray'),
      sun().color('orange'),
      planetAngles.map((a) => planet(a).color('teal')),
    ],
    // One body on the bed; the clearances let it turn once printed.
    print: () => [ring(), sun(), planetAngles.map(planet)],
  };
};
