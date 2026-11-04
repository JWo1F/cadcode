import { cylinder, hull, product, range, setResolution, sphere, square } from 'cadcode';

setResolution({ fn: 48 });

// Any size from the command line: npx cadcode stl grid-organizer.js --set cols=4 --set rows=2
export const params = {
  cols: 3,
  rows: 2,
  cell: 40, // inside of one pocket
  height: 30,
  wall: 1.6,
  floor: 1.2,
  corner: 4, // outer corner radius
  pocketCorner: 3,
  scoop: 6, // fillet where the pocket floor meets the front wall, for fingers
};

export default (p) => {
  const L = p.cols * p.cell + (p.cols + 1) * p.wall;
  const W = p.rows * p.cell + (p.rows + 1) * p.wall;

  const roundedBox = (l, w, h, r) =>
    hull(product([r, l - r], [r, w - r]).map(([x, y]) => cylinder({ r, h }).translate([x, y, 0])));

  const pocket = () => {
    const r = p.pocketCorner;
    const depth = p.height - p.floor + 1;
    const straight = square([p.cell - 2 * r, p.cell - 2 * r], { center: true })
      .offset(r)
      .extrude(depth - p.scoop)
      .translate([0, 0, p.scoop]);
    // The lower part is a hull of the full outline and two spheres in the front corners,
    // which round the front floor edge into a scoop.
    const scoop = hull(
      straight,
      [-1, 1].map((s) => sphere(p.scoop).translate([s * (p.cell / 2 - p.scoop), -p.cell / 2 + p.scoop, p.scoop])),
      // Floor behind the scoop.
      square([p.cell - 2 * r, p.cell - p.scoop - 2 * r], { center: true })
        .offset(r)
        .translate([0, p.scoop / 2])
        .extrude(0.01),
    );
    return scoop.translate([p.cell / 2, p.cell / 2, p.floor]);
  };

  const organizer = () =>
    roundedBox(L, W, p.height, p.corner).subtract(
      product(range(0, p.cols - 1), range(0, p.rows - 1)).map(([c, r]) =>
        pocket().translate([p.wall + c * (p.cell + p.wall), p.wall + r * (p.cell + p.wall), 0]),
      ),
    );

  console.log(`outer ${L.toFixed(1)} × ${W.toFixed(1)} × ${p.height} mm`);

  return { organizer };
};
