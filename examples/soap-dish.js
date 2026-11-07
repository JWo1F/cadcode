/*---
title: Soap dish
description: An oval dish with draining ribs, standing in an optional drip tray.
---*/
// Oval soap dish: a soft, flared bowl with ribs that hold the bar off the floor and slots between
// them that let the water through, and an optional drip tray it stands in on four little posts.
// Both are a half cross-section revolved and then stretched into an oval. They print as they stand.
//
//   cadcode dev examples/soap-dish.js
//   cadcode stl examples/soap-dish.js --part dish
import { cube, cylinder, hull, polygon, product, range, setResolution, sphere, square } from 'cadcode';

setResolution({ fn: 72 });

export const params = {
  // Dish
  r: { value: 40, name: 'Half width', description: 'Half the short side of the dish, in mm; the long side is Oval times longer.' },
  oval: { value: 1.45, name: 'Oval', description: 'How many times longer the long side is than the short one.' },
  height: { value: 22, name: 'Height', description: 'Height of the dish, in mm.' },
  wall: { value: 2.4, name: 'Wall', description: 'Wall thickness of the dish and the tray, in mm.' },
  round: { value: 10, name: 'Floor rounding', description: 'Radius where the floor turns into the wall, in mm.' },
  flare: { value: 7, name: 'Flare', description: 'How much wider the rim is than the edge of the floor, in mm.' },

  // Ribs and drain slots
  ribs: { value: 6, name: 'Ribs', description: 'Number of ribs running the long way across the floor.' },
  ribH: { value: 2.4, name: 'Rib height', description: 'Height of the ribs above the floor, in mm.' },
  ribW: { value: 2.4, name: 'Rib width', description: 'Width of the ribs at their base, in mm.' },
  slotW: { value: 3, name: 'Slot width', description: 'Width of the drain slots, in mm.' },
  slotLen: { value: 10, name: 'Slot length', description: 'Length of the drain slots, in mm.' },

  // Tray
  tray: { value: true, name: 'Tray', description: 'Make the drip tray the dish stands in.' },
  trayGap: { value: 3, name: 'Tray gap', description: 'Gap between the dish and the tray, all round, in mm.' },
  trayH: { value: 10, name: 'Tray height', description: 'Height of the tray, in mm.' },
  post: { value: 3, name: 'Post height', description: "How high the dish stands above the tray's floor, in mm." },
};

export default (p) => {
  // Half cross-section of a bowl: X is the radius, Y is height. A flared core with its corners
  // rounded by `round`, hollowed by `wall`, cut off at the rim height and rounded at the rim.
  const bowl = (r, h, round, flare, wall) => {
    const rb = r - round - flare; // flat floor, outside
    const rt = r - round; // where the rim's rounding starts
    const core = polygon([
      [-rb, round],
      [rb, round],
      [rt, 2 * h],
      [-rt, 2 * h],
    ]);
    const outside = core.offset(round);
    const section = outside
      .subtract(outside.offset(-wall))
      .intersect(square([2 * (r + round), h]).translate([-r - round, 0]))
      .offset(-wall * 0.45)
      .offset(wall * 0.45) // round the rim; before halving, so the axis keeps a straight edge
      .intersect(square([r + round, h]));
    // The inside of the bowl as a solid, for trimming ribs to the wall.
    const inside = outside.offset(-wall).intersect(square([r + round, 2 * h]));
    return {
      shell: section.revolve().scale([p.oval, 1, 1]),
      inside: inside.revolve().scale([p.oval, 1, 1]),
      floorR: rb,
    };
  };

  const dishBowl = () => bowl(p.r, p.height, p.round, p.flare, p.wall);

  const ribYs = () => {
    const span = 2 * (p.r - p.round - p.flare);
    const pitch = span / p.ribs;
    return range(0, p.ribs - 1).map((i) => -span / 2 + (i + 0.5) * pitch);
  };

  const dish = () => {
    const { shell, inside, floorR } = dishBowl();
    // Ribs run the long way and stop at the wall, so they follow the bowl's curve.
    const ribs = ribYs()
      .map((y) =>
        hull(
          cube([4 * p.r, p.ribW, 0.01], { center: true }).translate([0, y, p.wall]),
          cube([4 * p.r, p.ribW * 0.5, 0.01], { center: true }).translate([0, y, p.wall + p.ribH]),
        ),
      )
      .map((rib) => rib.intersect(inside));
    // Slots in the gaps between ribs, on the flat part of the floor only.
    const ys = ribYs();
    const gaps = ys.slice(1).map((y, i) => (y + ys[i]) / 2);
    const xs = range(-1, 1).map((i) => i * (p.slotLen + 6));
    const slots = product(xs, gaps)
      .filter(([x, y]) => Math.hypot((Math.abs(x) + p.slotLen / 2) / p.oval, y) < floorR - 3)
      .map(([x, y]) =>
        square([p.slotLen - p.slotW, 0.01], { center: true })
          .offset(p.slotW / 2)
          .extrude(p.wall + 2)
          .translate([x, y, -1]),
      );
    return shell.union(ribs).subtract(slots);
  };

  // The tray is the same bowl, bigger and lower, with posts the dish stands on.
  const trayR = p.r + p.trayGap + p.wall;
  const tray = () => {
    const { shell } = bowl(trayR, p.trayH, p.round, 2, p.wall);
    const posts = product([-1, 1], [-1, 1]).map(([sx, sy]) =>
      cylinder({ d: 6, h: p.wall + p.post - 1 })
        .union(sphere({ d: 6, fn: 24 }).scale([1, 1, 0.34]).translate([0, 0, p.wall + p.post - 1]))
        .translate([sx * (p.r - p.round - p.flare) * 0.55 * p.oval, sy * (p.r - p.round - p.flare) * 0.55, 0]),
    );
    return shell.union(posts);
  };

  // A 70 × 45 × 22 mm bar of soap lying on the ribs, for the assembly view.
  const soap = () =>
    cube([70, 45, 22], { center: true, round: 7, fn: 24 })
      .translate([0, 0, p.wall + p.ribH + 11]);

  const lift = p.tray ? p.wall + p.post : 0;
  console.log(`dish ${(2 * p.r * p.oval).toFixed(0)} × ${2 * p.r} × ${p.height} mm, tray ${(2 * trayR * p.oval).toFixed(0)} × ${2 * trayR} mm`);

  return {
    assembly: () => [
      p.tray && tray().color('#5c7a6b'),
      dish().translate([0, 0, lift]).color('#e9e4d8'),
      soap().translate([0, 0, lift]).color('#f2b5a0'),
    ],
    dish,
    tray,
  };
};
