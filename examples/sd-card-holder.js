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
import { circle, cube, polygon, product, range, setResolution } from 'cadcode';

setResolution({ fn: 64 });

export const params = {
  // How many
  sd: { value: 6, name: 'SD slots', description: 'Number of SD card slots.' },
  micro: { value: 10, name: 'MicroSD slots', description: 'Number of microSD slots, in two columns.' },

  // Cards (SD 32 × 24 × 2.1, microSD 15 × 11 × 1) and their slots
  slack: { value: 0.7, name: 'Slack', description: 'How much bigger a slot is than its card, in width and thickness, in mm.' },
  sdDepth: { value: 17, name: 'SD depth', description: 'How deep an SD card sits, along the slot, in mm.' },
  microDepth: { value: 8.5, name: 'MicroSD depth', description: 'How deep a microSD card sits, along the slot, in mm.' },
  sdPitch: { value: 5.5, name: 'SD pitch', description: 'Distance between neighbouring SD slots, in mm.' },
  microPitch: { value: 4.2, name: 'MicroSD pitch', description: 'Distance between neighbouring microSD rows, in mm.' },
  lean: { value: 15, name: 'Lean', description: 'How far the slots lean back, in degrees.' },

  // Block
  sdH: { value: 24, name: 'SD block height', description: 'Height of the block with the SD slots, in mm.' },
  microH: { value: 13, name: 'MicroSD block height', description: 'Height of the block with the microSD slots, in mm.' },
  rim: { value: 4, name: 'Rim', description: 'Solid material round the slots, in mm.' },
  chamfer: { value: 1.5, name: 'Chamfer', description: 'Chamfer on the top edges of the blocks, in mm.' },
  corner: { value: 3, name: 'Corner radius', description: 'Radius of the vertical corners of the blocks, in mm.' },

  // Finger notches
  sdNotch: { value: 5, name: 'SD notch', description: 'Depth of the finger notch into the top of the SD block, in mm.' },
  microNotch: { value: 3, name: 'MicroSD notch', description: 'Depth of the finger notches into the top of the microSD block, in mm.' },
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

  // Rounded block with a chamfered top edge.
  const block = (x, w, h) => cube([w, length, h], { round: { z: p.corner }, chamfer: { top: p.chamfer } }).translate([x, 0, 0]);

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
