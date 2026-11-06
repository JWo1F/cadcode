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
  rows: 3,
  cols: 8,
  pitch: 10.5, // socket to socket, left to right
  rowDepth: 13, // front to back, per row
  rowRise: 7, // each row stands this much higher than the one in front

  // Sockets, for 1/4" hex shanks (6.35 mm across flats)
  hexAF: 6.35,
  fit: 0.3, // added across flats
  socketDepth: 10,
  floor: 2, // under the front row's sockets

  // Body
  margin: 6, // beyond the outer sockets, left and right
  ledge: 12, // sloped label strip in front of the first row
  ledgeH: 5, // height of the strip's front edge
  r: 3, // corner radius in plan
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
