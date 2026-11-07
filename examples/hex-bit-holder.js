/*---
title: Hex bit holder
description: A stepped tray for 1/4" screwdriver bits, with a strip in front for a label.
---*/
// Tray for 1/4" hex screwdriver bits. The rows climb in steps towards the back so every bit is easy
// to see and pull, and a sloped strip in front takes a label. Prints as it stands, no support.
//
//   cadcode dev examples/hex-bit-holder.js
//   cadcode stl examples/hex-bit-holder.js --part tray
import { circle, cube, cylinder, polygon, product, range, setResolution, square, union } from 'cadcode';

setResolution({ fn: 48 });

export const params = {
  // Layout
  rows: { value: 3, name: 'Rows', description: 'Number of socket rows, front to back.' },
  cols: { value: 8, name: 'Columns', description: 'Number of sockets in each row.' },
  pitch: { value: 10.5, name: 'Pitch', description: 'Socket to socket distance, left to right, in mm.' },
  rowDepth: { value: 13, name: 'Row depth', description: 'Depth of each row, front to back, in mm.' },
  rowRise: { value: 7, name: 'Row rise', description: 'How much higher each row stands than the one in front, in mm.' },

  // Sockets, for 1/4" hex shanks (6.35 mm across flats)
  hexAF: { value: 6.35, name: 'Hex size', description: 'Bit shank across the flats, in mm.' },
  fit: { value: 0.3, name: 'Fit', description: 'Clearance added across the flats, in mm.' },
  socketDepth: { value: 10, name: 'Socket depth', description: 'Depth of each socket, in mm.' },
  floor: { value: 2, name: 'Floor', description: "Thickness under the front row's sockets, in mm." },

  // Body
  margin: { value: 6, name: 'Side margin', description: 'Body beyond the outer sockets, left and right, in mm.' },
  ledge: { value: 12, name: 'Label ledge', description: 'Depth of the sloped label strip in front of the first row, in mm.' },
  ledgeH: { value: 5, name: 'Ledge height', description: "Height of the strip's front edge, in mm." },
  r: { value: 3, name: 'Corner radius', description: 'Radius of the body corners in plan, in mm.' },
};

export default (p) => {
  const W = 2 * p.margin + (p.cols - 1) * p.pitch;
  const D = p.ledge + p.rows * p.rowDepth;
  const rowTop = (i) => p.floor + p.socketDepth + i * p.rowRise;
  const rowY = (i) => p.ledge + (i + 0.5) * p.rowDepth;
  const colX = (c) => p.margin + c * p.pitch;
  const hexD = (af) => af / Math.cos(Math.PI / 6); // across corners

  // Side profile, front at X = 0: the label slope, then one flat step per row.
  const profile = () => {
    const steps = range(0, p.rows - 1).flatMap((i) => [
      [p.ledge + i * p.rowDepth, rowTop(i)],
      [p.ledge + (i + 1) * p.rowDepth, rowTop(i)],
    ]);
    return polygon([[0, 0], [D, 0], ...steps.reverse(), [0, p.ledgeH]])
      .offset(-1.2)
      .offset(1.2); // soften the step edges
  };

  // Profile X runs front to back (world Y), profile Y is height, the extrusion runs along world X.
  const body = () =>
    profile()
      .extrude(W)
      .rotate([90, 0, 0])
      .rotate(90)
      .intersect(cube([W, D, rowTop(p.rows) + 5], { round: { z: p.r } }));

  // Hex pocket with a small lead-in at the mouth; the hexagon's flats face the front.
  const socket = (i, c) => {
    const d = hexD(p.hexAF + p.fit);
    return union(
      cylinder({ d, h: p.socketDepth + 1, fn: 6 }),
      cylinder({ d1: d, d2: d + 1.6, h: 0.8, fn: 6 }).translate([0, 0, p.socketDepth - 0.79]),
    ).translate([colX(c), rowY(i), rowTop(i) - p.socketDepth]);
  };

  const tray = () => body().subtract(product(range(0, p.rows - 1), range(0, p.cols - 1)).map(([i, c]) => socket(i, c)));

  // A 25 mm insert bit: hex shank, twisted torsion neck, and one of four tips.
  const tips = [
    () => union(square([4.6, 1.1], { center: true }), square([1.1, 4.6], { center: true })).extrude(4, { scale: 0.25 }), // Phillips
    () => square([5.5, 0.9], { center: true }).extrude(4, { scale: [0.8, 0.5] }), // slotted
    () => circle({ d: hexD(3), fn: 6 }).extrude(4), // hex key
    () =>
      polygon(range(0, 11).map((k) => [((k % 2 ? 1.5 : 2.4) * Math.cos((k * Math.PI) / 6)), ((k % 2 ? 1.5 : 2.4) * Math.sin((k * Math.PI) / 6))]))
        .offset(0.3)
        .extrude(4), // Torx
  ];
  const bit = (kind) =>
    union(
      cylinder({ d: hexD(p.hexAF), h: 15, fn: 6 }),
      circle({ d: hexD(4.2), fn: 6 }).extrude(6, { twist: 60 }).translate([0, 0, 15]),
      tips[kind]().translate([0, 0, 21]),
    );

  const bits = () =>
    product(range(0, p.rows - 1), range(0, p.cols - 1)).map(([i, c]) =>
      bit((i + c) % tips.length)
        .translate([colX(c), rowY(i), rowTop(i) - p.socketDepth])
        .color('#c9ccd1'),
    );

  console.log(`${W.toFixed(0)} × ${D.toFixed(0)} × ${rowTop(p.rows - 1).toFixed(0)} mm, ${p.rows * p.cols} bits`);

  return {
    assembly: () => [tray().color('#2f6f8f'), bits()],
    tray,
  };
};
