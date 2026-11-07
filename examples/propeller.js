/*---
title: Propeller
description: A fan propeller with twisted, tapered blades and a domed spinner.
---*/
import { cube, cylinder, polygon, range, setResolution, sphere, union } from 'cadcode';

setResolution({ fn: 64 });

// A fan propeller: cambered, tapering blades that twist from a steep pitch at the hub to a shallow
// one at the tip, on a hub with a domed spinner and a bore for the motor shaft. Each blade is one
// airfoil section extruded along the blade with twist and scale. Prints hub-down; the blades
// overhang, so give them supports (tree supports come off cleanly).
export const params = {
  diameter: { value: 127, name: 'Diameter', description: 'Tip-to-tip diameter of the propeller, in mm (5 inch).' },
  blades: { value: 3, name: 'Blades', description: 'Number of blades, spaced evenly round the hub.' },

  // Blade section: a NACA four-digit airfoil, e.g. 4412 is 4 % camber at 40 % chord, 12 % thick.
  chord: { value: 24, name: 'Root chord', description: 'Width of the blade section at the root, in mm.' },
  taper: { value: 0.5, name: 'Taper', description: 'Tip chord as a share of the root chord.' },
  camber: { value: 0.04, name: 'Camber', description: 'Maximum camber of the airfoil, as a share of the chord.' },
  camberAt: { value: 0.4, name: 'Camber position', description: 'Where the maximum camber sits, as a share of the chord from the leading edge.' },
  thickness: { value: 0.12, name: 'Thickness', description: 'Maximum thickness of the airfoil, as a share of the chord.' },
  rootPitch: { value: 38, name: 'Root pitch', description: 'Blade angle at the hub, in degrees from the plane of rotation.' },
  tipPitch: { value: 14, name: 'Tip pitch', description: 'Blade angle at the tip, in degrees from the plane of rotation.' },

  // Hub
  hubD: { value: 20, name: 'Hub diameter', description: 'Diameter of the hub, in mm.' },
  hubH: { value: 14, name: 'Hub height', description: 'Height of the hub under the spinner, in mm.' },
  spinner: { value: 9, name: 'Spinner height', description: 'Height of the dome on top of the hub, in mm.' },
  shaftD: { value: 5, name: 'Shaft diameter', description: 'Diameter of the motor shaft the bore fits, in mm.' },
  fit: { value: 0.15, name: 'Bore fit', description: 'Clearance added to the bore diameter, in mm.' },
};

export default (p) => {
  const deg = (r) => (r * 180) / Math.PI;
  const R = p.diameter / 2;
  const rootAt = p.hubD / 2 - 2; // blades start inside the hub so they join it

  // NACA 4-digit section, chord along X from 0 to 1, as a closed outline: upper surface from the
  // trailing edge forward, then lower surface back.
  const airfoil = (n = 28) => {
    const { camber: m, camberAt: c, thickness: t } = p;
    const xs = range(0, n).map((i) => (1 - Math.cos((Math.PI * i) / n)) / 2); // bunched at both edges
    const surface = (x, side) => {
      const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1036 * x ** 4);
      const yc = x < c ? (m / c ** 2) * (2 * c * x - x * x) : (m / (1 - c) ** 2) * (1 - 2 * c + 2 * c * x - x * x);
      const dyc = x < c ? ((2 * m) / c ** 2) * (c - x) : ((2 * m) / (1 - c) ** 2) * (c - x);
      const th = Math.atan(dyc);
      return [x - side * yt * Math.sin(th), yc + side * yt * Math.cos(th)];
    };
    const upper = xs.map((x) => surface(x, 1)).reverse();
    const lower = xs.slice(1, -1).map((x) => surface(x, -1));
    return polygon([...upper, ...lower]);
  };

  // The section is centred on its 35 % chord point, so twist and taper happen about the blade's
  // spine, then turned so the chord sits at the root pitch. Extruded along Z, then laid along X:
  // the chord's X becomes axial (-Z), its Y stays tangential.
  const blade = () => {
    const length = R - rootAt;
    const section = airfoil()
      .translate([-0.35, 0])
      .scale(p.chord)
      .rotate(90 - p.rootPitch);
    return section
      .extrude(length, { twist: p.rootPitch - p.tipPitch, scale: p.taper, divisions: 24 })
      .rotate([0, 90, 0])
      .translate([rootAt, 0, p.hubH / 2]);
  };

  const hub = () => {
    const r = p.hubD / 2;
    const dome = sphere(r)
      .scale([1, 1, p.spinner / r])
      .intersect(cube([p.hubD, p.hubD, p.spinner], { center: true }).translate([0, 0, p.spinner / 2]));
    return cylinder({ r, h: p.hubH }).union(dome.translate([0, 0, p.hubH]));
  };

  const propeller = () => {
    const blades = range(0, p.blades - 1).map((i) => blade().rotate((360 * i) / p.blades));
    // Rounds the tips in plan view, and trims anything that dips under the bed.
    const trim = cylinder({ r: R, h: p.hubH + 40, fn: 128 });
    const bore = cylinder({ d: p.shaftD + p.fit, h: p.hubH + p.spinner + 2, fn: 32 }).translate([0, 0, -1]);
    return union(hub(), union(blades).intersect(trim)).subtract(bore);
  };

  console.log(`${p.diameter} mm across, pitch ${p.rootPitch}° at the hub to ${p.tipPitch}° at the tip`);

  return { propeller };
};
