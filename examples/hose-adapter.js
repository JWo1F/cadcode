/*---
title: Hose adapter
description: From a shop-vacuum hose cuff to a garden hose, revolved from one cross-section.
---*/
// Hose adapter: a tapered friction cone that pushes into a shop-vacuum hose cuff on one end, a
// barbed spigot for a garden or pond hose on the other, and a gripping collar between them.
// The whole body is one half cross-section revolved around Z. Prints standing on the cone end;
// every slope inside and out is 45° or steeper, so it needs no supports.
//
//   cadcode dev examples/hose-adapter.js
//   cadcode stl examples/hose-adapter.js --set bigOD=32 --set hoseID=13
import { circle, polygon, range, setResolution } from 'cadcode';

setResolution({ fn: 96 });

export const params = [
  // Friction cone, into the vacuum cuff
  {
    name: 'Cone',
    children: {
      bigOD: { value: 35, name: 'Cone diameter', description: 'Outside diameter of the cone at its root, in mm; 35 mm suits most 1.25" cuffs.' },
      taper: { value: 1.2, name: 'Taper', description: 'Diameter the cone loses towards its tip, in mm.' },
      coneLen: { value: 30, name: 'Cone length', description: 'Length of the friction cone, in mm.' },
      wall: { value: 2.4, name: 'Cone wall', description: 'Wall thickness of the cone, in mm.' },
    },
  },
  // Barbed spigot, inside the hose
  {
    name: 'Spigot',
    children: {
      hoseID: { value: 19, name: 'Hose bore', description: 'Inside diameter of the hose in mm; 19 is a 3/4" hose.' },
      barbs: { value: 4, name: 'Barbs', description: 'Number of barbs on the spigot.' },
      barbLen: { value: 6, name: 'Barb length', description: 'Length of each barb, in mm.' },
      barbOver: { value: 1.2, name: 'Barb overlap', description: "How far the barb crest stands over the hose's inside radius, in mm." },
      spigotWall: { value: 2.2, name: 'Spigot wall', description: 'Wall thickness of the spigot, in mm.' },
    },
  },
  // Collar between them
  {
    name: 'Collar',
    children: {
      collarOD: { value: 44, name: 'Collar diameter', description: 'Outside diameter of the collar, in mm.' },
      collarH: { value: 10, name: 'Collar height', description: 'Height of the collar, in mm.' },
      ribs: { value: 24, name: 'Grip grooves', description: 'Number of finger grooves round the collar.' },
    },
  },
];

export default (p) => {
  const rTip = (p.bigOD - p.taper) / 2;
  const rRoot = p.bigOD / 2;
  const rIn = rTip - p.wall; // bore of the cone end, straight
  const rCollar = p.collarOD / 2;
  const rBase = p.hoseID / 2 - 0.4; // spigot between barbs, a little under the hose
  const rCrest = p.hoseID / 2 + p.barbOver;
  const rBore = rBase - p.spigotWall;

  // Heights up the part
  const zCollar0 = p.coneLen; // 45° flare from the cone up to the collar
  const zCollar1 = zCollar0 + (rCollar - rRoot);
  const zCollar2 = zCollar1 + p.collarH;
  const neck = rCollar - 1 - rBase; // 45° shoulder from the collar down to the spigot
  const zRoof = zCollar2 - 2; // inside, the wide bore narrows at 45° under the collar
  const zSpigot = zCollar2 + neck;
  const zTop = zSpigot + p.barbs * p.barbLen + 2;

  // Each barb rises at 45° to its crest, then tapers back over the rest of its length,
  // so the hose slides on from the top and resists being pulled off.
  const barbPoints = range(0, p.barbs - 1).flatMap((i) => {
    const z = zSpigot + i * p.barbLen;
    const rise = rCrest - rBase;
    return [
      [rBase, z],
      [rCrest, z + rise],
      [rBase, z + p.barbLen],
    ];
  });

  // Half cross-section: X is the radius, Y is height. Outside going up, then the bore coming down.
  const profile = () =>
    polygon([
      [rIn, 0],
      [rTip, 0],
      [rRoot, zCollar0],
      [rCollar - 1, zCollar1 - 1],
      [rCollar, zCollar1],
      [rCollar, zCollar2 - 1],
      [rCollar - 1, zCollar2],
      ...barbPoints,
      [rBase, zTop - 0.8],
      [rBase - 0.8, zTop],
      [rBore, zTop],
      [rBore, zRoof + (rIn - rBore)],
      [rIn, zRoof],
    ]);

  // Rounded grooves round the collar, made in 2D and extruded through its height.
  const grooves = () =>
    range(0, p.ribs - 1)
      .map((i) => circle({ r: 1.4, fn: 16 }).translate([rCollar + 0.5, 0]).rotate((360 * i) / p.ribs))
      .reduce((a, b) => a.union(b))
      .extrude(p.collarH - 2)
      .translate([0, 0, zCollar1 + 0.5]);

  console.log(`cone ${p.bigOD} → ${(p.bigOD - p.taper).toFixed(1)} mm, spigot for ${p.hoseID} mm hose, ${zTop.toFixed(1)} mm long`);

  const adapter = () => profile().revolve().subtract(grooves());

  return { adapter };
};
