import { cube, range, square, union } from 'cadcode';

// A Menger sponge: a cube with the middle ninth of every face bored through, repeated on every
// remaining sub-cube. Rather than building thousands of small cubes, each axis gets one cutter:
// the holes of a Sierpinski carpet, extruded straight through the whole cube. Three cutters, one
// boolean. Prints on a face; the holes bridge, so no supports.
export const params = {
  size: 60,
  // 1 to 4. Level 3 takes half a second; level 4 is 400k triangles and about 15 s.
  level: 3,
};

export default (p) => {
  // Every square hole of the carpet: at depth k the cells are size / 3^k, and the hole is the
  // centre cell of each 3x3 group that survived the levels above.
  const carpetHoles = () => {
    const holes = [];
    const visit = (x, y, cell, depth) => {
      const third = cell / 3;
      holes.push(square(third).translate([x + third, y + third]));
      if (depth === 1) return;
      range(0, 2).forEach((i) =>
        range(0, 2).forEach((j) => {
          if (i !== 1 || j !== 1) visit(x + i * third, y + j * third, third, depth - 1);
        }),
      );
    };
    visit(0, 0, p.size, p.level);
    return union(holes);
  };

  const sponge = () => {
    const over = 1;
    const cutter = carpetHoles().extrude(p.size + 2 * over).translate([0, 0, -over]);
    return cube(p.size).subtract(
      cutter, // along Z
      cutter.rotate([90, 0, 0]).translate([0, p.size, 0]), // along Y
      cutter.rotate([0, 90, 0]).translate([0, 0, p.size]), // along X
    );
  };

  return { sponge };
};
