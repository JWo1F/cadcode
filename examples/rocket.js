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
import { cylinder, frameAt, path, plane, polar, polygon, setResolution, union } from 'cadcode';

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
      fins: { value: 4, name: 'Fins', description: 'Number of fins, spaced evenly round the body.' },
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
  const tube = () =>
    path([0, p.tail])
      .line([5.5, p.tail])
      .line([12, p.tail + 6.5])
      .quad([R, p.tail + 15.5], [R, p.tail + 24.5])
      .line([R, p.tubeTop])
      .line([0, p.tubeTop])
      .close()
      .revolve();

  // Tangent ogive: a circular arc of radius rho that meets the tube without a kink. Its centre lies
  // level with the tube's top, so the arc leaves it upright; it is fixed by passing the tip and the
  // point halfway up. The arc turns only about 38°, hence the fine resolution.
  const nose = () => {
    const L = p.noseLength;
    const rho = (R * R + L * L) / (2 * R);
    const half = [Math.sqrt(rho * rho - (L / 2) ** 2) - (rho - R), p.tubeTop + L / 2];
    return path([0, p.tubeTop], { fn: 240 })
      .line([R, p.tubeTop])
      .arc([0, p.tubeTop + L], { through: half })
      .close()
      .revolve();
  };

  // A bell that flares towards the bed, hollow inside.
  const nozzle = () =>
    cylinder({ r1: 8, r2: 5.5, h: p.tail }).subtract(cylinder({ r1: 6.5, r2: 2.5, h: p.tail - 3 }).translate([0, 0, -0.01]));

  // One fin in the XZ plane, centred on it: root inside the body, leading edge sweeping down to a
  // flat foot at z = 0, every corner rounded.
  const fin = () => {
    const s = p.finSpan;
    const outline = polygon([[3, 52], [12, 41], [21, 27], [s - 3, 13], [s, 5], [s, 0], [s - 10, 0], [12, 6], [3, 13]], { round: 1.5 });
    return plane.XZ.extrude(outline, p.finT, { center: true });
  };
  const fins = () => polar(fin(), { count: p.fins });

  // Portholes face the gap between two fins, towards the default iso camera.
  const portAt = [
    { z: 64, d: p.portD },
    { z: 49, d: p.portD * 0.7 },
  ];
  // Each porthole is built on a frame on the axis at its height, looking out between the first two fins.
  const facing = ((-360 / p.fins / 2) * Math.PI) / 180;
  const radial = (z) => frameAt([0, 0, z], [Math.cos(facing), Math.sin(facing), 0]);
  const rims = () => portAt.map(({ z, d }) => radial(z).place(cylinder({ d: d + 3, h: R + p.rim })));
  const recess = 1.2;
  const holes = () => portAt.map(({ z, d }) => radial(z).offset(R + p.rim - recess).place(cylinder({ d, h: recess + 1 })));
  // For the preview: a pane sitting at the bottom of each recess.
  const panes = () => portAt.map(({ z, d }) => radial(z).place(cylinder({ d: d - 0.2, h: R + p.rim - recess + 0.2 })));

  // A raised band where the nose meets the tube.
  const band = () => cylinder({ r: R + 0.8, h: 2.4 }).translate([0, 0, p.tubeTop - 1.2]);

  const body = () => union(tube(), nose(), nozzle(), fins(), rims(), band()).subtract(holes());

  console.log(`${(2 * p.finSpan).toFixed(0)} mm across the fins, ${p.tubeTop + p.noseLength} mm tall`);

  return {
    assembly: () => [
      tube().color('whitesmoke'),
      nose().color('#e63946'),
      fins().subtract(tube(), nozzle()).color('#e63946'),
      nozzle().color('#555'),
      band().subtract(tube(), nose()).color('silver'),
      rims().map((r) => r.subtract(tube(), holes()).color('silver')),
      panes().map((g) => g.subtract(tube()).color('#5bc0eb')),
    ],
    body,
  };
};
