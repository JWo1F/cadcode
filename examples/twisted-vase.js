/*---
title: Twisted vase
description: A lobed vase that twists and flares as it rises.
---*/
import { cube, polygon, range, setResolution } from 'cadcode';

setResolution({ fn: 64 });

export const params = {
  height: { value: 120, name: 'Height', description: 'Height of the vase, in mm.' },
  radius: { value: 35, name: 'Radius', description: 'Radius at the tips of the lobes, in mm.' },
  valley: { value: 0.8, name: 'Valley', description: 'Radius between the lobes, as a share of the tip radius.' },
  lobes: { value: 7, name: 'Lobes', description: 'Number of lobes round the vase.' },
  round: { value: 4, name: 'Rounding', description: 'Fillet radius on both tips and valleys, in mm.' },
  twist: { value: 90, name: 'Twist', description: 'How far the profile turns from bottom to top, in degrees.' },
  topScale: { value: 1.3, name: 'Top scale', description: 'Size of the top as a share of the bottom.' },
  wall: { value: 1.6, name: 'Wall', description: 'Wall thickness, in mm.' },
  bottom: { value: 2, name: 'Bottom', description: 'Floor thickness, in mm.' },
};

export default (p) => {
  const profile = () => {
    const points = range(0, 2 * p.lobes - 1).map((i) => {
      const a = (i * Math.PI) / p.lobes;
      const r = i % 2 === 0 ? p.radius : p.radius * p.valley;
      return [r * Math.cos(a), r * Math.sin(a)];
    });
    // Closing then opening rounds the valleys, opening then closing rounds the tips.
    return polygon(points).offset(p.round).offset(-p.round).offset(-p.round).offset(p.round);
  };

  // Twist and scale grow linearly with height, so a taller extrusion with both stretched to match
  // follows the outer surface exactly and pokes cleanly out of the top.
  const extrude = (shape, h) =>
    shape.extrude(h, {
      twist: (p.twist * h) / p.height,
      scale: 1 + ((p.topScale - 1) * h) / p.height,
    });

  const solid = () => extrude(profile(), p.height);

  const vase = () => {
    const over = 1;
    const span = 4 * p.radius * p.topScale;
    const inside = extrude(profile().offset(-p.wall), p.height + over).intersect(
      cube([span, span, p.height + over], { center: true }).translate([0, 0, p.bottom + (p.height + over) / 2]),
    );
    return solid().subtract(inside);
  };

  console.log(`${(2 * p.radius * p.topScale).toFixed(0)} mm across the top, ${p.height} mm tall`);

  return {
    vase,
    solid, // for the slicer's vase / spiral mode, which makes the walls itself
  };
};
