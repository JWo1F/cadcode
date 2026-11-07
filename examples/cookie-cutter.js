/*---
title: Cookie cutter
description: A thin blade grown from any 2D outline, with a wide rim to press on.
---*/
// A cookie cutter from a 2D outline: a thin blade grown outwards from the shape with offset(), and a
// wide rim to press on. Prints rim down with the cutting edge up, no supports.
//
//   cadcode dev examples/cookie-cutter.js
//   cadcode stl examples/cookie-cutter.js --part cutter --set shape=star
import { circle, cylinder, hull, polygon, range, setResolution, union } from 'cadcode';

setResolution({ fn: 64 });

export const params = {
  shape: { value: 'heart', name: 'Shape', description: "Outline to cut: 'heart' or 'star'." },
  size: { value: 70, name: 'Size', description: 'Width across the widest part of the outline, in mm.' },

  // Blade
  height: { value: 16, name: 'Height', description: 'Total height of the blade in mm; dough is rarely thicker than 8 mm.' },
  wall: { value: 1.2, name: 'Wall', description: 'Thickness of the upper part of the blade, for stiffness, in mm.' },
  edge: { value: 0.6, name: 'Cutting edge', description: 'Thickness of the cutting edge in mm: two layers of a 0.3 mm nozzle.' },
  edgeH: { value: 5, name: 'Edge height', description: 'How far the thin edge reaches up from the cutting end, in mm.' },

  // Rim
  rim: { value: 5, name: 'Rim width', description: 'How far the rim sticks out from the blade, in mm.' },
  rimT: { value: 2, name: 'Rim thickness', description: 'Thickness of the rim, in mm.' },
};

export default (p) => {
  // Both outlines are drawn 70 mm wide and scaled to `size`.
  const heart = () => {
    const tip = circle(1).translate([0, -30]);
    return union(hull(circle(18).translate([-15, 8]), tip), hull(circle(18).translate([15, 8]), tip))
      .offset(1.5)
      .offset(-1.5); // fill the notch between the lobes with a soft curve
  };

  const star = () => {
    const points = range(0, 9).map((i) => {
      const a = Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 15 : 37;
      return [r * Math.cos(a), r * Math.sin(a)];
    });
    // Blunt the tips and the valleys, so the blade can bend round them and the dough comes out.
    return polygon(points).offset(-3).offset(3).offset(2).offset(-2);
  };

  const outline = () => {
    const shape = { heart, star }[p.shape];
    if (!shape) throw new Error(`unknown shape '${p.shape}', use 'heart' or 'star'`);
    const s = shape();
    const { min, max } = s.bounds();
    return s.scale(p.size / Math.max(max[0] - min[0], max[1] - min[1]));
  };

  // A band of width w just outside the outline.
  const ring = (w) => outline().offset(w).subtract(outline());

  // Rim on the bed, blade rising from it; the inside face is one straight wall so the dough slides out.
  const cutter = () =>
    union(
      ring(p.rim + p.wall).extrude(p.rimT),
      ring(p.wall).extrude(p.height - p.edgeH),
      ring(p.edge).extrude(p.height),
    );

  // The cutter as it is used, edge down, beside the cookie it made.
  const preview = () => {
    const w = p.size + 2 * (p.rim + p.wall);
    const o = outline().offset(-0.3);
    // Stacked insets give the baked cookie a rounded top edge.
    const cookie = union(o.extrude(4.5), o.offset(-1).extrude(5.5), o.offset(-2.2).extrude(6));
    // Sprinkles on a sunflower spiral, kept away from the edge.
    const colors = ['#e63946', '#f1c40f', '#ffffff', '#3a86ff', '#8ac926'];
    const inside = o.offset(-4).extrude(10);
    const sprinkles = range(0, 17).map((i) => {
      const r = 0.36 * p.size * Math.sqrt((i + 0.5) / 18);
      const a = i * 137.5;
      return cylinder({ d: 1.6, h: 5, center: true, fn: 8 })
        .rotate([0, 90, a * 2])
        .translate([r * Math.cos((a * Math.PI) / 180), r * Math.sin((a * Math.PI) / 180), 6])
        .intersect(inside)
        .color(colors[i % colors.length]);
    });
    const at = [w * 0.95, -w * 0.25, 0];
    return [
      cutter().rotate([0, 180, 0]).translate([0, 0, p.height]).color('#2a9d8f'),
      cookie.translate(at).color('#d4a373'),
      sprinkles.map((s) => s.translate(at)),
    ];
  };

  const { min, max } = outline().offset(p.rim + p.wall).bounds();
  console.log(`${(max[0] - min[0]).toFixed(1)} × ${(max[1] - min[1]).toFixed(1)} × ${p.height} mm`);

  return { preview, cutter };
};
