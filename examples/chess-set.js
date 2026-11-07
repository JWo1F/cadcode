/*---
title: Chess set
description: A Staunton-style set turned on a virtual lathe, every piece printed standing.
---*/
// A Staunton-style chess set turned on a virtual lathe: every piece but the knight is one profile
// revolved, with the details cut in afterwards. Each piece prints standing on its base, no supports.
//
//   cadcode dev examples/chess-set.js
//   cadcode stl examples/chess-set.js --all
import { cube, polygon, range, setResolution, sphere, union } from 'cadcode';

setResolution({ fn: 64 });

export const params = [
  {
    name: 'Pieces',
    children: {
      scale: { value: 1, name: 'Scale', description: 'Size of every piece: 1 makes a 75 mm king, a common club size for a 45 mm board.' },
    },
  },
  {
    name: 'Display',
    children: {
      square: { value: 34, name: 'Display square', description: 'Spacing of the pieces in the display layout, in mm before scaling.' },
      light: { value: '#f3e9d2', name: 'Light colour', description: "Colour of the light side's pieces in the display." },
      dark: { value: '#2f2a28', name: 'Dark colour', description: "Colour of the dark side's pieces in the display." },
    },
  },
];

export default (p) => {
  // Profile helpers, in [radius, z] points.
  const rad = (deg) => (deg * Math.PI) / 180;
  const arc = ([cx, cz], r, from, to, n = 10) =>
    range(0, n).map((i) => {
      const a = rad(from + ((to - from) * i) / n);
      return [cx + r * Math.cos(a), cz + r * Math.sin(a)];
    });
  // A stem that flares out at the bottom: radius eases from r0 at z0 to r1 at z1.
  const stem = (r0, z0, r1, z1, n = 10) =>
    range(0, n).map((i) => {
      const t = i / n;
      return [r1 + (r0 - r1) * (1 - t) ** 2, z0 + (z1 - z0) * t];
    });
  // A collar: a flat disc of radius r, height h, at z.
  const collar = (r, z, h = 1.5) => [[r, z], [r, z + h]];

  // Foot with two beads, from the axis out to radius R; ends at z = 7.2.
  const base = (R) => [[0, 0], [R, 0], [R, 1.8], ...arc([R - 1.4, 3.2], 1.4, -45, 90, 6), ...arc([R - 3.4, 6], 1.2, -70, 90, 6)];

  const turn = (points) => polygon(points).revolve().scale(p.scale);

  const pawn = () =>
    turn([...base(12), ...stem(7.5, 8, 4.2, 20), ...collar(7.5, 20.5), [4.6, 23.5], ...arc([0, 29.5], 6.5, -45, 90, 14)]);

  const rook = () => {
    const body = turn([
      ...base(13),
      ...stem(9.8, 8, 7.6, 27, 6),
      [9.6, 29],
      [10.6, 30.2],
      [10.6, 39],
      [8.2, 39],
      [8.2, 36.5],
      [0, 36.5],
    ]);
    // Three slots across the top leave six merlons.
    const slots = range(0, 2).map((i) => cube([30, 3.6, 4], { center: true }).translate([0, 0, 39]).rotate(30 + i * 60));
    return body.subtract(slots.map((s) => s.scale(p.scale)));
  };

  const bishop = () => {
    const body = turn([
      ...base(12.5),
      ...stem(8, 8, 4.5, 30),
      ...collar(8.5, 30.5),
      [6.4, 32.4],
      [6.4, 33.4],
      [4.2, 34.2],
      ...arc([0, 41], 7, -53, 40, 12),
      [2.2, 49.5],
      ...arc([0, 52.2], 2.3, -60, 90, 8),
    ]);
    // The mitre's slit: a thin blade, tilted, coming in from one side only.
    const slit = cube([10, 20, 1.5])
      .translate([0, -10, -0.75])
      .rotate([0, -38, 0])
      .translate([0.5, 0, 42.5]);
    return body.subtract(slit.scale(p.scale));
  };

  const queen = () => {
    const cup = range(0, 8).map((i) => {
      const t = i / 8;
      return [5 + 5.6 * t ** 1.6, 42 + 12 * t];
    });
    const body = turn([
      ...base(13.5),
      ...stem(8.6, 8, 4.8, 38),
      ...collar(9, 38.5),
      [7, 40.6],
      [7, 41.4],
      ...cup,
      [10.6, 58],
      [9.2, 58],
      [7.4, 54.4],
      [2.4, 54.4],
      ...arc([0, 59.5], 3, -55, 90, 8),
    ]);
    // Scallops round the rim leave the crown's points.
    const scallops = range(0, 9).map((i) => sphere({ r: 3.2, fn: 20 }).translate([10.6, 0, 59.2]).rotate(i * 36));
    return body.subtract(scallops.map((s) => s.scale(p.scale)));
  };

  const king = () => {
    const head = range(0, 8).map((i) => {
      const t = i / 8;
      return [5.5 + 4 * t ** 1.4, 48 + 10 * t];
    });
    const body = turn([
      ...base(14),
      ...stem(9, 8, 5.5, 44),
      ...collar(9.5, 44.5),
      [7.5, 46.6],
      [7.5, 47.4],
      ...head,
      [9.8, 59.6],
      ...arc([0, 0], 9.8, 0, 90, 8).map(([r, z]) => [r, 59.6 + 0.4 * z]), // a flattened dome
    ]);
    const cross = union(cube([2.8, 2.8, 12], { center: true }).translate([0, 0, 68]), cube([8.4, 2.8, 2.8], { center: true }).translate([0, 0, 69.4]));
    return body.union(cross.scale(p.scale));
  };

  // The horse's head is a side outline extruded in rounded-off slabs, on a short turned base.
  const knight = () => {
    const foot = turn([...base(13), ...stem(9, 8, 7.5, 12, 4), [0, 12]]);
    const lift = 11.5; // the head stands on the foot's top
    // Side view, nose towards +X.
    const outline = polygon([
      [8.5, 0], [8, 4], [6, 9], [7, 13], [10, 15], [14, 14.5], [17, 16], [17.5, 18.5], [15.5, 21], [11, 26],
      [6, 30.5], [3.5, 31.5], [1.5, 35.5], [0, 31.5], [-3, 30], [-7, 25], [-9.5, 18], [-10, 10], [-9, 0],
    ]).offset(1.5).offset(-1.5);
    // Slabs, each inset further and thicker, round off the sides of the head: [inset, thickness].
    const slabs = [[0, 7], [0.8, 10], [1.8, 12], [3.2, 13.5]];
    const head = union(slabs.map(([inset, t]) => outline.offset(-inset).extrude(t, { center: true })))
      .rotate([90, 0, 0])
      .translate([0, 0, lift]);
    const eyes = [-1, 1].map((s) => sphere({ r: 1.4, fn: 16 }).translate([7.5, s * 6.5, lift + 25]));
    return foot.union(head.scale(p.scale)).subtract(eyes.map((e) => e.scale(p.scale)));
  };

  // Two rows on a strip of board: light pieces in front, dark behind.
  const set = () => {
    const pieces = [rook, knight, bishop, queen, king, pawn];
    const s = p.square * p.scale;
    const board = range(0, pieces.length - 1).flatMap((i) =>
      [0, 1].map((j) =>
        cube([s, s, 4])
          .translate([i * s, j * s, -4])
          .color((i + j) % 2 ? '#c9a77c' : '#7a5232'),
      ),
    );
    const placed = pieces.flatMap((piece, i) => {
      const x = (i + 0.5) * s;
      const shape = piece();
      return [shape.translate([x, s / 2, 0]).color(p.light), shape.rotate(180).translate([x, 1.5 * s, 0]).color(p.dark)];
    });
    return [board, placed];
  };

  return { set, pawn, rook, knight, bishop, queen, king };
};
