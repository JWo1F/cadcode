/*---
title: Planter
description: A twisted, faceted plant pot with a drainage hole and a matching saucer.
---*/
// A faceted plant pot: a twelve-sided star extruded with a twist and a flare, with a drainage hole,
// channels underneath so water can reach it, and a saucer that follows its outline.
// Both print as they stand, no supports; the pot's flare stays well under 45°.
//
//   cadcode dev examples/planter.js
//   cadcode stl examples/planter.js --all
import { cube, cylinder, polygon, range, setResolution, sphere } from 'cadcode';

setResolution({ fn: 48 });

export const params = {
  // Pot
  radius: { value: 40, name: 'Radius', description: 'Radius to the outer corners, at the bottom, in mm.' },
  facets: { value: 12, name: 'Facets', description: 'Number of points of the star outline.' },
  depth: { value: 0.1, name: 'Facet depth', description: 'How far the inner corners sit in, as a share of the radius.' },
  height: { value: 90, name: 'Height', description: 'Height of the pot, in mm.' },
  twist: { value: 40, name: 'Twist', description: 'Twist over the whole height, in degrees.' },
  flare: { value: 1.3, name: 'Flare', description: 'Top size over bottom size.' },
  wall: { value: 2, name: 'Wall', description: 'Wall thickness of the pot, in mm.' },
  bottom: { value: 3, name: 'Bottom', description: "Thickness of the pot's bottom, in mm." },

  // Drainage
  hole: { value: 10, name: 'Drainage hole', description: 'Diameter of the drainage hole, in mm.' },
  channel: { value: 3, name: 'Channel', description: 'Width of the grooves under the pot, in mm.' },

  // Saucer
  gap: { value: 2, name: 'Gap', description: 'Space between pot and saucer wall, in mm.' },
  saucerWall: { value: 2, name: 'Saucer wall', description: 'Wall thickness of the saucer, in mm.' },
  saucerH: { value: 14, name: 'Saucer height', description: 'Height of the saucer, in mm.' },
  saucerFloor: { value: 2, name: 'Saucer floor', description: 'Floor thickness of the saucer, in mm.' },
};

export default (p) => {
  const profile = () =>
    polygon(
      range(0, 2 * p.facets - 1).map((i) => {
        const a = (i * Math.PI) / p.facets;
        const r = i % 2 ? p.radius * (1 - p.depth) : p.radius;
        return [r * Math.cos(a), r * Math.sin(a)];
      }),
    );

  // Twist and flare grow linearly with height, so a shape extruded taller with both stretched to
  // match follows the same surface: that keeps the inside parallel to the outside.
  const extrude = (shape, h) =>
    shape.extrude(h, {
      twist: (p.twist * h) / p.height,
      scale: 1 + ((p.flare - 1) * h) / p.height,
      divisions: Math.ceil(h / 3),
    });

  const pot = () => {
    const over = 2;
    const span = 3 * p.radius * p.flare;
    const inside = extrude(profile().offset({ delta: -p.wall }), p.height + over).intersect(
      cube([span, span, p.height + over]).translate([-span / 2, -span / 2, p.bottom]),
    );
    const channels = range(0, 2).map((i) => cube([2 * p.radius + 2, p.channel, 2], { center: true }).rotate(i * 60 + 15));
    return extrude(profile(), p.height).subtract(inside, cylinder({ d: p.hole, h: 3 * p.bottom, center: true }), channels);
  };

  // Sharp-cornered offsets keep the saucer's facets lined up with the pot's.
  const saucer = () => {
    const outline = profile().offset({ delta: p.gap + p.saucerWall });
    return outline
      .extrude(p.saucerH)
      .subtract(profile().offset({ delta: p.gap }).extrude(p.saucerH).translate([0, 0, p.saucerFloor]));
  };

  // A succulent for the preview: rings of leaves, longer and flatter towards the outside.
  const plant = () => {
    const soilZ = p.height - 10;
    const soil = extrude(profile().offset({ delta: -p.wall - 0.2 }), soilZ)
      .intersect(cube([300, 300, 6]).translate([-150, -150, soilZ - 6]))
      .color('#5a3d2b');
    const rings = [
      { n: 5, len: 7, tilt: 20, out: 1 },
      { n: 7, len: 11, tilt: 38, out: 4 },
      { n: 9, len: 15, tilt: 55, out: 8 },
      { n: 11, len: 19, tilt: 70, out: 13 },
    ];
    const leaves = rings.flatMap(({ n, len, tilt, out }, k) =>
      range(0, n - 1).map((i) =>
        sphere({ r: 1, fn: 20 })
          .scale([len, len * 0.38, len * 0.16])
          .translate([len * 0.9, 0, 0])
          .rotate([0, -(90 - tilt), 0])
          .translate([out * 0.4, 0, 0])
          .rotate((360 * i) / n + k * 17)
          .translate([0, 0, soilZ + 1 + (3 - k) * 1.5])
          .color(['#6ab187', '#5aa17a', '#4e9170', '#3f7f63'][k]),
      ),
    );
    return [soil, ...leaves];
  };

  console.log(`${(2 * p.radius * p.flare).toFixed(0)} mm across the top corners, ${p.height} mm tall`);

  return {
    assembly: () => [
      saucer().color('#b5651d'),
      pot().translate([0, 0, p.saucerFloor + 0.01]).color('#e9c46a'),
      plant().map((s) => s.translate([0, 0, p.saucerFloor])),
    ],
    pot,
    saucer,
  };
};
