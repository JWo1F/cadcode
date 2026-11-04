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
  radius: 40, // to the outer corners, at the bottom
  facets: 12,
  depth: 0.1, // how far the inner corners sit in, as a share of `radius`
  height: 90,
  twist: 40, // degrees over the whole height
  flare: 1.3, // top size over bottom size
  wall: 2,
  bottom: 3,

  // Drainage
  hole: 10,
  channel: 3, // width of the grooves under the pot

  // Saucer
  gap: 2, // between pot and saucer wall
  saucerWall: 2,
  saucerH: 14,
  saucerFloor: 2,
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
