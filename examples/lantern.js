import { circle, cube, cylinder, polygon, range, setResolution, sphere, union } from 'cadcode';

setResolution({ fn: 64 });

// A tealight lantern: a hexagonal shell with a honeycomb of windows in every face, a floor with a
// ring that centres a standard 38 mm tealight, and a roof that drops onto the top rim with a
// chimney and a hanging loop. Both parts print as they stand, without supports: the windows are
// point-up hexagons, the roof's eaves and inner ceiling are 45 degree slopes, and the loop stands
// on a short bridge across the chimney.
export const params = {
  // Shell
  radius: 42, // centre to a corner of the hexagon; also the width of each face
  height: 100,
  wall: 2.4,
  floor: 3,

  // Windows
  cell: 4, // centre to corner of a window
  strut: 1.8, // between windows
  margin: 4, // solid post at each corner of the hexagon, from the edge of the face
  below: 10, // solid band at the bottom, above the floor
  above: 10, // solid band at the top, under the roof

  // Tealight
  tealight: 38, // diameter
  tealightH: 16,
  fit: 0.6, // around the tealight and around the roof's lip

  // Roof
  lip: 6, // drops into the shell
  eave: 4, // overhang past the shell
  chimney: 9, // radius
  chimneyH: 8,
  roofWall: 2,
};

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
