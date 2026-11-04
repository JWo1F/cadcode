// A six-sided die with rounded edges: a cube cut by a sphere, with spherical pips in the standard
// layout, so opposite faces add up to seven. Prints on any face, no supports.
//
//   cadcode dev examples/dice.js
//   cadcode stl examples/dice.js --part die
import { cube, product, setResolution, sphere } from 'cadcode';

setResolution({ fn: 64 });

export const params = {
  // Body
  size: 16, // edge of a standard large die
  round: 1.5, // sphere diameter as a share of the edge: 1.0 is a ball, √3 a sharp cube

  // Pips
  pipD: 3.6,
  pipDepth: 1.3, // depth of each dimple
  pipSpread: 0.27, // pip offset from the face centre, as a share of the edge
};

export default (p) => {
  const half = p.size / 2;
  const a = p.size * p.pipSpread;

  // Pip spots on a face, in units of `a`.
  const layouts = {
    1: [[0, 0]],
    2: [[-1, -1], [1, 1]],
    3: [[-1, -1], [0, 0], [1, 1]],
    4: product([-1, 1], [-1, 1]),
    5: [...product([-1, 1], [-1, 1]), [0, 0]],
    6: [...product([-1, 1], [-1, 1]), [-1, 0], [1, 0]],
  };

  // Where each number goes: a rotation that carries the top face (+Z) onto it.
  // 1 top / 6 bottom, 2 right / 5 left, 3 back / 4 front.
  const faces = { 1: [0, 0, 0], 6: [180, 0, 0], 2: [0, 90, 0], 5: [0, -90, 0], 3: [-90, 0, 0], 4: [90, 0, 0] };

  const pips = () =>
    Object.entries(faces).map(([n, turn]) =>
      layouts[n].map(([u, v]) =>
        sphere({ d: p.pipD, fn: 20 })
          .translate([u * a, v * a, half + p.pipD / 2 - p.pipDepth])
          .rotate(turn),
      ),
    );

  const body = () => cube(p.size, { center: true }).intersect(sphere({ d: p.size * p.round, fn: 96 }));

  // One up, six on the bed.
  const die = () => body().subtract(pips()).translate([0, 0, half]);

  // A few dice on the table, each turned to show a different number.
  const set = () => {
    const placed = (turn, yaw, x, y, color, pipColor) =>
      body()
        .color(color)
        .subtract(pips().flat().map((s) => s.color(pipColor)))
        .rotate(turn)
        .rotate(yaw)
        .translate([x, y, half]);
    return [
      placed([0, 0, 0], 12, 0, 0, '#d62828', 'white'), // shows 1
      placed([90, 0, 0], -20, 24, 2, 'ivory', '#222'), // 3 comes up
      placed([0, -90, 0], 35, 8, 24, '#1d4ed8', 'white'), // 2 comes up
      placed([180, 0, 0], -8, -17, 19, '#222', 'gold'), // 6 comes up
    ];
  };

  return { set, die };
};
