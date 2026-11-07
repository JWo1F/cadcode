/*---
title: Sierpinski pyramid
description: A tetrahedron of half-size tetrahedra, again and again, printed without supports.
---*/
import { polyhedron, union } from 'cadcode';

// A Sierpinski tetrahedron: a tetrahedron split into four half-size copies at its corners, again
// and again. The copies only touch at their corners, so each one is grown a little about its own
// centre and neighbours overlap into a small solid neck instead of a single point. Prints as it
// stands, on its base, without supports: the sides lean in at about 20 degrees off vertical, and
// every flat underside is one small piece wide, a short bridge between three corners.
export const params = [
  {
    name: 'Pyramid',
    children: {
      edge: { value: 100, name: 'Edge', description: 'Edge length of the whole pyramid, in mm.' },
      // Each level is four times as many pieces; 6 is 4096 of them, 1.6 mm each, and still evaluates
      // in a second, but that is about as fine as a 0.4 mm nozzle can draw.
      level: { value: 5, name: 'Level', description: 'How many times the tetrahedron is split, 0 to 6.' },
      overlap: { value: 0.6, name: 'Overlap', description: "How far each piece's corners reach past the shared point, in mm." },
    },
  },
];

export default (p) => {
  const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const centre = (vs) => [0, 1, 2].map((i) => vs.reduce((s, v) => s + v[i], 0) / vs.length);

  // Base triangle counter-clockwise seen from above, apex over its centre.
  const corners = () => {
    const rb = p.edge / Math.sqrt(3);
    const base = [-15, 105, 225].map((a) => [rb * Math.cos((a * Math.PI) / 180), rb * Math.sin((a * Math.PI) / 180), 0]);
    return [...base, [0, 0, p.edge * Math.sqrt(2 / 3)]];
  };

  const leafEdge = p.edge / 2 ** p.level;
  const grow = 1 + p.overlap / (leafEdge * Math.sqrt(3 / 8)); // corner-to-centre distance is edge * sqrt(3/8)

  // Faces clockwise seen from outside, as polyhedron wants.
  const tetrahedron = (vs) => {
    const c = centre(vs);
    const points = vs.map((v) => lerp(c, v, grow));
    return polyhedron(points, [
      [0, 1, 2],
      [0, 3, 1],
      [1, 3, 2],
      [2, 3, 0],
    ]);
  };

  const pieces = (vs, level) =>
    level === 0 ? [tetrahedron(vs)] : vs.flatMap((v) => pieces(vs.map((w) => lerp(v, w, 0.5)), level - 1));

  // Growing the bottom pieces pushes their bases below zero by the same amount; lift it back.
  const pyramid = () => {
    const solid = union(pieces(corners(), p.level));
    return solid.translate([0, 0, -solid.bounds().min[2]]);
  };

  return { pyramid };
};
