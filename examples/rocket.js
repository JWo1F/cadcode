/*---
title: Rocket
description: A retro model rocket with swept fins, portholes and a nozzle, printed in one piece.
---*/
// A retro model rocket: a turned body with an ogive nose, four swept fins it stands on, a nozzle
// and two portholes. Prints in one piece standing up: the fin feet and the nozzle rim are on the
// bed, and the boat tail above the nozzle widens at 45° so nothing hangs in the air.
//
//   cadcode dev examples/rocket.js
//   cadcode stl examples/rocket.js --part body
import { cylinder, polygon, range, setResolution, union } from 'cadcode';

setResolution({ fn: 72 });

export const params = [
  {
    name: 'Body',
    children: {
      radius: { value: 17, name: 'Body radius', description: 'Radius of the body tube at its widest, in mm.' },
      tail: { value: 10, name: 'Nozzle height', description: 'Height of the nozzle, where the boat tail starts, in mm.' },
      tubeTop: { value: 80, name: 'Tube top', description: 'Height where the nose cone begins, in mm.' },
      noseLength: { value: 50, name: 'Nose length', description: 'Length of the ogive nose cone, in mm.' },
    },
  },
  {
    name: 'Fins',
    children: {
      fins: { value: 4, name: 'Fins', description: 'Number of fins; they come in mirrored pairs, so keep it even.' },
      finT: { value: 3, name: 'Fin thickness', description: 'Thickness of each fin, in mm.' },
      finSpan: { value: 33, name: 'Fin span', description: 'From the axis out to the fin tip, in mm.' },
    },
  },
  {
    name: 'Portholes',
    children: {
      portD: { value: 9, name: 'Porthole', description: 'Diameter of the upper porthole, in mm; the lower one is 0.7 of it.' },
      rim: { value: 1.5, name: 'Porthole rim', description: 'How far the porthole rim stands proud of the body, in mm.' },
    },
  },
];

export default (p) => {
  const R = p.radius;

  // Boat tail: out from the nozzle at 45°, then easing into the tube.
  const tailProfile = () => [
    [0, p.tail],
    [5.5, p.tail],
    [12, p.tail + 6.5],
    ...range(1, 8).map((i) => {
      const t = i / 8;
      return [12 + (R - 12) * (1 - (1 - t) ** 2), p.tail + 6.5 + 18 * t];
    }),
    [R, p.tubeTop],
    [0, p.tubeTop],
  ];

  // Tangent ogive: a circular arc of radius rho that meets the tube without a kink.
  const noseProfile = () => {
    const L = p.noseLength;
    const rho = (R * R + L * L) / (2 * R);
    const steps = 24;
    return [
      [0, p.tubeTop],
      ...range(0, steps - 1).map((i) => {
        const x = (L * i) / steps;
        return [Math.sqrt(rho * rho - x * x) - (rho - R), p.tubeTop + x];
      }),
      [0, p.tubeTop + L],
    ];
  };

  const tube = () => polygon(tailProfile()).revolve();
  const nose = () => polygon(noseProfile()).revolve();

  // A bell that flares towards the bed, hollow inside.
  const nozzle = () =>
    cylinder({ r1: 8, r2: 5.5, h: p.tail }).subtract(cylinder({ r1: 6.5, r2: 2.5, h: p.tail - 3 }).translate([0, 0, -0.01]));

  // One fin in the XZ plane: root inside the body, leading edge sweeping down to a flat foot at z = 0.
  const fin = () => {
    const s = p.finSpan;
    return polygon([
      [3, 52], [12, 41], [21, 27], [s - 3, 13], [s, 5], [s, 0], [s - 10, 0], [12, 6], [3, 13],
    ])
      .offset(-1.5)
      .offset(1.5) // round the tip
      .extrude(p.finT, { center: true })
      .rotate([90, 0, 0]);
  };
  // A fin and its mirror image make a pair; the pairs are turned round the axis.
  const fins = () => {
    const pair = union(fin(), fin().mirror([1, 0, 0]));
    return range(0, p.fins / 2 - 1).map((i) => pair.rotate((360 * i) / p.fins));
  };

  // Portholes face the gap between two fins, towards the default iso camera.
  const portAt = [
    { z: 64, d: p.portD },
    { z: 49, d: p.portD * 0.7 },
  ];
  const facing = -360 / p.fins / 2; // halfway between the first two fins
  const radial = (shape, z) => shape.rotate([0, 90, 0]).translate([0, 0, z]).rotate(facing);
  const rims = () => portAt.map(({ z, d }) => radial(cylinder({ d: d + 3, h: R + p.rim }), z));
  const recess = 1.2;
  const holes = () => portAt.map(({ z, d }) => radial(cylinder({ d, h: recess + 1 }).translate([0, 0, R + p.rim - recess]), z));
  // For the preview: a pane sitting at the bottom of each recess.
  const panes = () => portAt.map(({ z, d }) => radial(cylinder({ d: d - 0.2, h: R + p.rim - recess + 0.2 }), z));

  // A raised band where the nose meets the tube.
  const band = () => cylinder({ r: R + 0.8, h: 2.4 }).translate([0, 0, p.tubeTop - 1.2]);

  const body = () => union(tube(), nose(), nozzle(), fins(), rims(), band()).subtract(holes());

  console.log(`${(2 * p.finSpan).toFixed(0)} mm across the fins, ${p.tubeTop + p.noseLength} mm tall`);

  return {
    assembly: () => [
      tube().color('whitesmoke'),
      nose().color('#e63946'),
      fins().map((f) => f.subtract(tube(), nozzle()).color('#e63946')),
      nozzle().color('#555'),
      band().subtract(tube(), nose()).color('silver'),
      rims().map((r) => r.subtract(tube(), holes()).color('silver')),
      panes().map((g) => g.subtract(tube()).color('#5bc0eb')),
    ],
    body,
  };
};
