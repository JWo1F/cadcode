/*---
title: Cable clip
description: Snap-in channels for cables under a desk, one per cable size.
---*/
// Cable clip for the underside or back of a desk: a row of snap-in channels, one per cable size,
// on a base that takes double-sided tape or two countersunk wood screws. The mouth of each channel
// is narrower than its cable, so the cable clicks in and stays. Prints as it stands, no support.
//
//   cadcode dev examples/cable-clip.js
//   cadcode stl examples/cable-clip.js --part clip --set 'cables=[5,5,5]'
import { circle, cube, cylinder, polygon, setResolution, square, union } from 'cadcode';

setResolution({ fn: 64 });

export const params = {
  // Channels, one per cable, by diameter: USB, laptop charger, power lead
  cables: [4, 6, 8],
  wall: 1.8, // ring thickness, and the web between neighbours
  mouth: 0.72, // opening as a share of the cable's diameter: under 1 is what makes it snap
  width: 12, // along the cables

  // Base
  base: 2.6,
  tab: 11, // beyond the channels at each end, for the screws
  r: 3, // corner radius in plan

  // Countersunk wood screw, 3.5 mm (#6)
  screwD: 3.8, // clearance
  headD: 7.4,
};

export default (p) => {
  // Lay the channels out left to right; neighbouring rings share one wall.
  const channels = [];
  let x = p.tab;
  for (const d of p.cables) {
    const R = d / 2 + p.wall;
    channels.push({ d, R, cx: x + R, cz: p.base + d / 2 });
    x += 2 * R - p.wall;
  }
  const L = x + p.wall + p.tab;
  const H = Math.max(...channels.map((c) => c.cz + c.R));

  // Cross-section across the cables: X along the clip, Y is height.
  const profile = () => {
    const rings = channels.map(({ R, cx, cz }) => circle(R).translate([cx, cz]));
    const bores = channels.map(({ d, cx, cz }) => circle(d / 2).translate([cx, cz]));
    // A straight-sided slot down to the bore, flared at the top so the cable finds its way in.
    const mouths = channels.map(({ d, R, cx, cz }) => {
      const m = (p.mouth * d) / 2;
      const neck = cz + 0.8 * (d / 2);
      const top = cz + R + 1;
      return polygon([
        [cx - m, cz],
        [cx + m, cz],
        [cx + m, neck],
        [cx + m + p.wall, top],
        [cx - m - p.wall, top],
        [cx - m, neck],
      ]);
    });
    return union(square([L, p.base]), rings)
      .subtract(bores, mouths)
      .offset(-0.5)
      .offset(0.5) // round the lips
      .offset(0.6)
      .offset(-0.6); // and fillet where the rings meet the base
  };

  // The profile stands up in XZ and is pushed along Y, then the plan's corners are rounded.
  const body = () =>
    profile()
      .extrude(p.width)
      .rotate([90, 0, 0])
      .translate([0, p.width, 0])
      .intersect(cube([L, p.width, H + 2], { round: p.r, edges: 'z' }));

  // Screw from the top: through hole plus a 90° countersink ending flush with the base's top.
  const sink = (p.headD - p.screwD) / 2;
  const screwHole = () =>
    union(
      cylinder({ d: p.screwD, h: p.base + 2 }).translate([0, 0, -1]),
      cylinder({ d1: p.screwD, d2: p.headD, h: sink }).translate([0, 0, p.base - sink + 0.01]),
      cylinder({ d: p.headD, h: H }).translate([0, 0, p.base]), // clear above, for the screwdriver
    ).translate([p.tab / 2, p.width / 2, 0]);

  // One hole at each end: the second is the first mirrored about the clip's middle.
  const clip = () => body().subtract(screwHole(), screwHole().mirror([1, 0, 0]).translate([L, 0, 0]));

  const palette = ['#e4572e', '#29335c', '#f3a712', '#669bbc', '#a8c686'];
  const cables = () =>
    channels.map(({ d, cx, cz }, i) =>
      cylinder({ d, h: 44, center: true }).rotate([90, 0, 0]).translate([cx, p.width / 2, cz]).color(palette[i % palette.length]),
    );

  console.log(`${L.toFixed(1)} × ${p.width} × ${H.toFixed(1)} mm, channels for ${p.cables.join(', ')} mm`);

  return {
    assembly: () => [clip().color('#f4f1ea'), cables()],
    clip,
  };
};
