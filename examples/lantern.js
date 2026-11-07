/*---
title: Lantern
description: A hexagonal tealight lantern with honeycomb windows and a roof that drops on.
---*/
import { circle, cube, cylinder, polygon, range, setResolution, sphere, union } from 'cadcode';

setResolution({ fn: 64 });

// A tealight lantern: a hexagonal shell with a honeycomb of windows in every face, a floor with a
// ring that centres a standard 38 mm tealight, and a roof that drops onto the top rim with a
// chimney and a hanging loop. Both parts print as they stand, without supports: the windows are
// point-up hexagons, the roof's eaves and inner ceiling are 45 degree slopes, and the loop stands
// on a short bridge across the chimney.
export const params = [
  {
    name: 'Shell',
    children: {
      radius: { value: 42, name: 'Radius', description: 'Centre to a corner of the hexagon, which is also the width of each face, in mm.' },
      height: { value: 100, name: 'Height', description: 'Height of the shell, in mm.' },
      wall: { value: 2.4, name: 'Wall', description: 'Wall thickness of the shell, in mm.' },
      floor: { value: 3, name: 'Floor', description: 'Floor thickness, in mm.' },
    },
  },
  {
    name: 'Windows',
    children: {
      cell: { value: 4, name: 'Window size', description: 'Centre to corner of each hexagonal window, in mm.' },
      strut: { value: 1.8, name: 'Strut', description: 'Width of the struts between windows, in mm.' },
      margin: { value: 4, name: 'Corner post', description: 'Solid post at each corner of the hexagon, from the edge of the face, in mm.' },
      below: { value: 10, name: 'Bottom band', description: 'Solid band at the bottom of each face, above the floor, in mm.' },
      above: { value: 10, name: 'Top band', description: 'Solid band at the top of each face, under the roof, in mm.' },
    },
  },
  {
    name: 'Tealight',
    children: {
      tealight: { value: 38, name: 'Tealight diameter', description: 'Diameter of the tealight the floor ring centres, in mm.' },
      tealightH: { value: 16, name: 'Tealight height', description: 'Height of the tealight in the assembly view, in mm.' },
      fit: { value: 0.6, name: 'Fit', description: "Clearance around the tealight and around the roof's lip, in mm." },
    },
  },
  {
    name: 'Roof',
    children: {
      lip: { value: 6, name: 'Lip', description: "How far the roof's lip drops into the shell, in mm." },
      eave: { value: 4, name: 'Eave', description: 'Overhang of the roof past the shell, in mm.' },
      chimney: { value: 9, name: 'Chimney radius', description: 'Radius of the chimney, in mm.' },
      chimneyH: { value: 8, name: 'Chimney height', description: 'Height of the chimney, in mm.' },
      roofWall: { value: 2, name: 'Roof wall', description: 'Wall thickness of the roof, in mm.' },
    },
  },
];

export default (p) => {
  // Hexagons made with fn: 6 are sized by their corners; a flat-to-flat thickness t is t / cos 30.
  const k = 1 / Math.cos(Math.PI / 6);
  const apothem = p.radius / k;
  const innerR = p.radius - p.wall * k;

  // Point-up hexagons that fit wholly inside one face, in face coordinates: u across, v up.
  const windows = () => {
    const halfW = p.radius / 2 - p.margin;
    const v0 = p.floor + p.below;
    const v1 = p.height - p.above;
    const across = Math.sqrt(3) * p.cell; // flat to flat, horizontally
    const pitch = across + p.strut;
    const rowPitch = (pitch * Math.sqrt(3)) / 2;
    const rows = Math.floor((v1 - v0 - 2 * p.cell) / rowPitch) + 1;
    const top = v0 + p.cell + (v1 - v0 - 2 * p.cell - (rows - 1) * rowPitch) / 2; // centre the block
    const cells = [];
    range(0, rows - 1).forEach((row) => {
      const v = top + row * rowPitch;
      const shift = row % 2 ? pitch / 2 : 0;
      range(-5, 5).forEach((col) => {
        const u = col * pitch + shift;
        if (Math.abs(u) + across / 2 <= halfW) cells.push(circle({ r: p.cell, fn: 6 }).rotate(90).translate([u, v]));
      });
    });
    return union(cells);
  };

  // The window pattern pushed through each face. A hexagon from fn: 6 has corners at 0, 60, ...
  // degrees, so its faces look out at 30, 90, ...; the pattern starts on the face at -90.
  const windowCutters = () => {
    const cutter = windows().extrude(4 * p.wall, { center: true }).rotate([90, 0, 0]).translate([0, -apothem, 0]);
    return range(0, 5).map((i) => cutter.rotate(60 * i));
  };

  const body = () => {
    const shell = cylinder({ r: p.radius, h: p.height, fn: 6 }).subtract(
      cylinder({ r: innerR, h: p.height, fn: 6 }).translate([0, 0, p.floor]),
    );
    const holderR = (p.tealight + p.fit) / 2;
    const holder = cylinder({ r: holderR + 1.6, h: 5 })
      .subtract(cylinder({ r: holderR, h: 7 }).translate([0, 0, -1]))
      .translate([0, 0, p.floor - 0.01]);
    return shell.union(holder).subtract(windowCutters());
  };

  // Half cross-section of the roof, revolved in six steps so it matches the shell. X is the
  // (corner) radius, Y is height; the eaves widen at 45 degrees and the roof rises at 45 degrees.
  const roof = () => {
    const t = p.roofWall * k;
    const rl = innerR - p.fit * k; // outside of the lip
    const ri = rl - t; // inside of the lip
    const re = p.radius + p.eave; // eave
    const rc = p.chimney;
    const zEaveLow = p.lip + (re - rl);
    const zEave = zEaveLow + 1.5;
    const zChim = zEave + (re - rc);
    const zTop = zChim + p.chimneyH;
    const drop = t * Math.SQRT2; // inner slope sits this far under the outer one
    const body = polygon([
      [ri, 0],
      [rl, 0],
      [rl, p.lip],
      [re, zEaveLow],
      [re, zEave],
      [rc, zChim],
      [rc, zTop],
      [rc - t, zTop],
      [rc - t, zChim + t - drop],
      [ri, zEave + re - ri - drop],
    ]).revolve({ fn: 6 });

    // A loop standing on a bar that bridges the chimney mouth, for a hook or a cord.
    const ringR = rc - 1;
    const bar = cube([2 * rc - 1, 3, 2], { center: true }).translate([0, 0, zTop - 1]);
    const loop = circle(ringR)
      .subtract(circle(ringR - 2.4))
      .extrude(3, { center: true })
      .rotate([90, 0, 0])
      .translate([0, 0, zTop - 1 + ringR]);
    return body.union(bar, loop);
  };

  // A tealight in its aluminium cup, for the assembly.
  const tealight = () => {
    const r = p.tealight / 2;
    return [
      cylinder({ r, h: p.tealightH * 0.75 }).subtract(cylinder({ r: r - 0.4, h: p.tealightH })).color('silver'),
      cylinder({ r: r - 0.4, h: p.tealightH * 0.7 }).color('ivory'),
      cylinder({ d: 1, h: 4, fn: 8 }).translate([0, 0, p.tealightH * 0.7]).color('#333'),
      union(sphere(2.6), cylinder({ r1: 2.6, r2: 0, h: 9 }))
        .translate([0, 0, p.tealightH * 0.7 + 5])
        .color('orange', 0.85),
    ].map((s) => s.translate([0, 0, p.floor]));
  };

  const roofZ = p.height - p.lip;
  console.log(`${(2 * apothem).toFixed(0)} mm across the flats, ${(p.height + roof().bounds().max[2] - p.lip).toFixed(0)} mm tall with the roof`);

  return {
    assembly: () => [tealight(), body().color('#e8dcc0'), roof().translate([0, 0, roofZ]).color('#8b2d1f')],
    body,
    roof,
  };
};
