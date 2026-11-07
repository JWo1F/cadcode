/*---
title: Raspberry Pi 3 case
description: A base with port windows and a snap-on cover for the Pi 3 Model B+.
---*/
// Raspberry Pi 3 Model B+ case: a base with the port windows and a cover that snaps onto it.
// Board dimensions from the official mechanical drawing. Base prints bottom down, cover top down.
//
//   cadcode dev examples/pi3-case.js
//   cadcode stl examples/pi3-case.js --part print
import { cube, cylinder, product, range, setResolution, square } from 'cadcode';

setResolution({ fn: 48 });

export const params = {
  // Print
  wall: { value: 2, name: 'Wall', description: 'Wall thickness, in mm.' },
  floor: { value: 1.6, name: 'Floor', description: 'Floor thickness, in mm.' },
  top: { value: 1.6, name: 'Top', description: "Thickness of the cover's top, in mm." },
  gap: { value: 0.5, name: 'Gap', description: 'Clearance from the board to the wall, in mm.' },

  // Board
  boardL: { value: 85, name: 'Board length', description: 'Length of the board, in mm.' },
  boardW: { value: 56, name: 'Board width', description: 'Width of the board, in mm.' },
  boardT: { value: 1.4, name: 'Board thickness', description: 'Thickness of the board, in mm.' },
  standoff: { value: 3, name: 'Standoff', description: 'Height of the standoffs, room for the SD card underneath, in mm.' },
  screwHole: { value: 2.2, name: 'Screw hole', description: 'Hole in the standoffs for M2.5 self-tapping screws, in mm.' },
  headroom: { value: 1.6, name: 'Headroom', description: 'Space over the USB stack, the tallest part, in mm.' },

  // Joint between base and cover
  split: { value: 7.6, name: 'Split height', description: "Height of the joint between base and cover above the board's top face, in mm." },
  lipH: { value: 4, name: 'Lip height', description: 'Height of the lip on the base that the cover fits over, in mm.' },
  lipT: { value: 1, name: 'Lip thickness', description: 'Thickness of the lip, the inner part of the wall, in mm.' },
  fit: { value: 0.15, name: 'Fit', description: 'Clearance between the lip and the cover, in mm.' },
  snapLen: { value: 12, name: 'Snap length', description: 'Length of each snap bump, in mm.' },
  snapIn: { value: 0.4, name: 'Snap depth', description: 'How far the snap bumps stand out of the lip, in mm.' },

  // Vents in the cover, over the SoC
  ventW: { value: 1.6, name: 'Vent width', description: 'Width of each vent slot, in mm.' },
  ventPitch: { value: 3.5, name: 'Vent pitch', description: 'Distance between vent slots, in mm.' },
  vents: { value: 7, name: 'Vents', description: 'Number of vent slots.' },
};

export default (p) => {
  const iL = p.gap + p.boardL + p.gap;
  const iW = p.gap + p.boardW + p.gap;
  const boardZ = p.standoff;
  const boardTop = boardZ + p.boardT;
  const iH = boardTop + 16 + p.headroom; // USB stack is 16 mm over the board
  const splitZ = boardTop + p.split;
  const H = iH + p.top;

  const bx = (x) => p.gap + x;
  const by = (y) => p.gap + y;

  // Outline grown by `off` from the interior, with the corner radius growing to match.
  const r0 = 1;
  const outline = (off) => square([iL - 2 * r0, iW - 2 * r0]).translate([r0, r0]).offset(r0 + off);

  const rounded = (w, h, r) => square([w - 2 * r, h - 2 * r], { center: true }).offset(r);
  // Window through the port-side wall (y = 0), with an optional recess for the plug.
  const sideWindow = (x, z, [w, h, r = 1], recess) => [
    rounded(w, h, r).extrude(p.wall + 2).rotate([90, 0, 0]).translate([bx(x), 1, z]),
    recess && rounded(...recess).extrude(p.wall / 2 + 1).rotate([90, 0, 0]).translate([bx(x), -p.wall / 2, z]),
  ];
  // Window through the right end wall (x = iL): width along Y, height along Z, depth along +X.
  const endWindow = (y, z, w, h) =>
    rounded(w, h, 1).extrude(p.wall + 2).rotate([90, 0, 0]).rotate(90).translate([iL - 1, by(y), z]);

  const holes = product([3.5, 61.5], [3.5, 52.5]);

  const ports = () => [
    sideWindow(10.6, boardTop + 1.5, [10, 5], [12.5, 8, 2]), // micro-USB power
    sideWindow(32, boardTop + 3, [16.5, 7.5], [22, 12, 2]), // HDMI
    sideWindow(53.5, boardTop + 3, [7.5, 7.5, 3.7], [10, 10, 4.9]), // audio
    endWindow(9, boardTop + 8, 14.6, 17), // USB pair
    endWindow(27, boardTop + 8, 14.6, 17), // USB pair
    endWindow(45.75, boardTop + 6.75, 17, 14.6), // Ethernet
    // SD card underneath the board's left end, with a scoop above for a fingernail
    cube([p.wall + 2, 13, 2.6]).translate([-p.wall - 1, by(28) - 6.5, boardZ - 2.3]),
    cylinder({ d: 12, h: p.wall / 2 + 1 })
      .rotate([0, 90, 0])
      .translate([-p.wall - 1, by(28), boardZ - 1])
      .intersect(cube([p.wall + 2, 14, 7]).translate([-p.wall - 1, by(28) - 7, boardZ - 1])),
  ];

  // The whole box with every window cut, before it is split in two.
  const shell = () =>
    outline(p.wall)
      .extrude(p.floor + H)
      .translate([0, 0, -p.floor])
      .subtract(outline(0).extrude(iH), ports());

  const below = (z) => cube([iL + 20, iW + 20, z + 20]).translate([-10, -10, -20]);
  const lipRing = (off, h) => outline(off).subtract(outline(-1)).extrude(h).translate([0, 0, splitZ]);

  const snapZ = splitZ + p.lipH / 2;
  const snapXs = [iL / 4, (3 * iL) / 4];
  const snaps = (r, standOut) =>
    product(snapXs, [0, 1]).map(([x, side]) => {
      const face = side === 0 ? -p.lipT : iW + p.lipT;
      const y = side === 0 ? face - r + standOut : face + r - standOut;
      return cylinder({ r, h: p.snapLen, center: true }).rotate([0, 90, 0]).translate([x, y, snapZ]);
    });

  const base = () => {
    // Slits beside each snap, so the stretch of lip carrying it can flex
    const slits = product(snapXs, [-1, 1]).map(([x, s]) =>
      cube([1, iW + 2 * p.wall + 2, p.lipH + 1]).translate([x + s * (p.snapLen / 2 + 1) - 0.5, -p.wall - 1, splitZ + 1]),
    );
    const standoffs = holes.map(([x, y]) =>
      cylinder({ d: 6, h: p.standoff })
        .subtract(cylinder({ d: p.screwHole, h: p.standoff + 1 }).translate([0, 0, 0.6]))
        .translate([bx(x), by(y), 0]),
    );
    const s = shell();
    return s
      .intersect(below(splitZ))
      .union(s.intersect(lipRing(p.lipT, p.lipH)).subtract(slits), snaps(0.6, p.snapIn), standoffs);
  };

  const cover = () => {
    const vents = range(0, p.vents - 1).map((i) =>
      cube([p.ventW, 26, p.top + 2]).translate([bx(19) + i * p.ventPitch, by(18), iH - 1]),
    );
    return shell()
      .subtract(below(splitZ), lipRing(p.lipT + p.fit, p.lipH + p.fit).translate([0, 0, -0.01]), snaps(0.7, p.snapIn + 0.1), vents);
  };

  const board = () => {
    const pcb = cube([p.boardL, p.boardW, p.boardT])
      .subtract(holes.map(([x, y]) => cylinder({ d: 2.75, h: 5, center: true }).translate([x, y, 0])))
      .color('#1f7a3a');
    const metal = [
      cube([7.5, 5.6, 3]).translate([10.6 - 3.75, -1, p.boardT]),
      cube([15, 11.5, 6]).translate([32 - 7.5, -1, p.boardT]),
      cylinder({ d: 6, h: 12 }).rotate([90, 0, 0]).translate([53.5, 11, p.boardT + 3]),
      cube([17.5, 13.1, 16]).translate([p.boardL - 15.4, 9 - 6.55, p.boardT]),
      cube([17.5, 13.1, 16]).translate([p.boardL - 15.4, 27 - 6.55, p.boardT]),
      cube([21.5, 16, 13.5]).translate([p.boardL - 19.4, 45.75 - 8, p.boardT]),
      cube([51, 5, 8.5]).translate([7, 50, p.boardT]),
      cube([15, 11, 1.4]).translate([-2.5, 28 - 5.5, -1.4]),
    ].map((s) => s.color('silver'));
    const soc = cube([14, 14, 1.2]).translate([22, 25, p.boardT]).color('#333');
    return [pcb, metal, soc].flat().map((s) => s.translate([bx(0), by(0), boardZ]));
  };

  console.log(`outer ${(iL + 2 * p.wall).toFixed(1)} × ${(iW + 2 * p.wall).toFixed(1)} × ${(p.floor + H).toFixed(1)} mm`);

  return {
    assembly: () => [base().color('lightgray', 0.7), cover().translate([0, 0, 15]).color('orange', 0.45), board()],
    base: () => base().translate([p.wall, p.wall, p.floor]),
    cover: () => cover().rotate([180, 0, 0]).translate([p.wall, iW + p.wall, H]),
    print: () => [
      base().translate([p.wall, p.wall, p.floor]),
      cover().rotate([180, 0, 0]).translate([p.wall, 2 * iW + 3 * p.wall + 8, H]),
    ],
  };
};
