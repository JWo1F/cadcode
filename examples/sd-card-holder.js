/*---
title: SD card holder
description: A desk block with slots for SD and microSD cards, tilted so labels face you.
---*/
// Desk holder for memory cards: a tall block with a row of SD slots beside a lower one with two
// columns of microSD slots. The slots lean back so the labels face you, and a finger notch runs
// down each column so a card can be pinched out by its middle. Prints as it stands, no supports.
//
//   cadcode dev examples/sd-card-holder.js
//   cadcode stl examples/sd-card-holder.js --part holder --set sd=8 --set micro=12
import { circle, cube, hull, polygon, product, range, setResolution, square } from 'cadcode';

setResolution({ fn: 64 });

export const params = {
  // How many
  sd: 6,
  micro: 10, // in two columns

  // Cards (SD 32 × 24 × 2.1, microSD 15 × 11 × 1) and their slots
  slack: 0.7, // slot over the card, width and thickness
  sdDepth: 17, // how deep a card sits, along the slot
  microDepth: 8.5,
  sdPitch: 5.5,
  microPitch: 4.2,
  lean: 15, // slots lean back, degrees

  // Block
  sdH: 24,
  microH: 13,
  rim: 4, // solid material round the slots
  chamfer: 1.5,
  corner: 3,

  // Finger notches
  sdNotch: 5, // depth into the top
  microNotch: 3,
};

export default (p) => {
  const SD = { w: 24, h: 32, t: 2.1 };
  const MICRO = { w: 11, h: 15, t: 1 };
  const rows = Math.ceil(p.micro / 2);
  const sin = Math.sin((p.lean * Math.PI) / 180);

  // Slot tops are placed so the slot bottoms, which lean forward, still clear the front rim.
  const firstY = (depth, t) => p.rim + t / 2 + depth * sin;
  const sdYs = range(0, p.sd - 1).map((i) => firstY(p.sdDepth, SD.t) + i * p.sdPitch);
  const microYs = range(0, rows - 1).map((i) => firstY(p.microDepth, MICRO.t) + i * p.microPitch);
  const length = Math.max(sdYs.at(-1) + SD.t / 2, microYs.at(-1) + MICRO.t / 2) + p.rim + 1;

  const sdW = SD.w + p.slack + 2 * p.rim;
  const microW = 2 * (MICRO.w + p.slack) + 3 * p.rim;
  const microX0 = sdW - p.rim; // the two blocks share the wall between them
  const microXs = [microX0 + p.rim + (MICRO.w + p.slack) / 2, microX0 + 2 * p.rim + (3 * (MICRO.w + p.slack)) / 2];

  // Rounded block with a chamfered top edge: a hull of the footprint and a smaller copy on top.
  const rect = (w, d, r) => square([w - 2 * r, d - 2 * r]).translate([r, r]).offset(r);
  const block = (x, w, h) =>
    hull(
      rect(w, length, p.corner).extrude(h - p.chamfer),
      rect(w - 2 * p.chamfer, length - 2 * p.chamfer, p.corner - p.chamfer)
        .translate([p.chamfer, p.chamfer])
        .extrude(0.01)
        .translate([0, 0, h - 0.01]),
    ).translate([x, 0, 0]);

  // Anything standing on its slot's floor at z = -depth, leaned back and moved to the slot's top.
  const lean = (s, x, y, top) => s.rotate([-p.lean, 0, 0]).translate([x, y, top]);
  const slot = (w, t, depth) => cube([w + p.slack, t + p.slack, depth + 10]).translate([-(w + p.slack) / 2, -(t + p.slack) / 2, -depth]);

  const sdSlots = () => sdYs.map((y) => lean(slot(SD.w, SD.t, p.sdDepth), sdW / 2, y, p.sdH));
  const microSlots = () =>
    product(microXs, microYs).map(([x, y]) => lean(slot(MICRO.w, MICRO.t, p.microDepth), x, y, p.microH));

  // A notch is a circle in the end face, swept along the whole length of the block.
  const notch = (x, top, depth, width) => {
    const r = ((width / 2) ** 2 + depth ** 2) / (2 * depth);
    return circle(r)
      .extrude(length + 2)
      .rotate([-90, 0, 0])
      .translate([x, -1, top - depth + r]);
  };
  const notches = () => [
    notch(sdW / 2, p.sdH, p.sdNotch, SD.w * 0.6),
    microXs.map((x) => notch(x, p.microH, p.microNotch, MICRO.w * 0.65)),
  ];

  const holder = () =>
    block(0, sdW, p.sdH)
      .union(block(microX0 - p.corner - 1, microW + p.corner + 1, p.microH)) // reaching into the tall block hides the seam
      .subtract(sdSlots(), microSlots(), notches());

  // Cards for the display: an SD with its clipped corner, and a plain microSD.
  const sdCard = () =>
    polygon([
      [-SD.w / 2, 0],
      [SD.w / 2, 0],
      [SD.w / 2, SD.h - 4],
      [SD.w / 2 - 4, SD.h],
      [-SD.w / 2, SD.h],
    ])
      .extrude(SD.t)
      .rotate([90, 0, 0])
      .translate([0, SD.t / 2, -p.sdDepth]);
  const microCard = () => cube([MICRO.w, MICRO.t, MICRO.h]).translate([-MICRO.w / 2, -MICRO.t / 2, -p.microDepth]);
  const sdColors = ['#1d4e89', '#d1495b', '#1d4e89', '#edae49', '#1d4e89', '#00798c'];
  const cards = () => [
    sdYs.map((y, i) => lean(sdCard(), sdW / 2, y, p.sdH).color(sdColors[i % sdColors.length])),
    product(microXs, microYs)
      .slice(0, p.micro)
      .map(([x, y]) => lean(microCard(), x, y, p.microH).color('#26262b')),
  ];

  console.log(`${(microX0 + microW).toFixed(1)} × ${length.toFixed(1)} × ${p.sdH} mm`);

  return {
    display: () => [holder().color('#e8e6e1'), cards()],
    holder,
  };
};
