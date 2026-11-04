import { cube, hull, range, sphere, union } from 'cadcode';

// A geodesic frame: an icosahedron whose faces are split into frequency^2 triangles, every new
// corner pushed out onto the sphere. Each edge becomes a strut, the hull of two small balls, and
// a slightly bigger ball sits on each hub. The bottom is cut off flat so it stands and prints;
// with an even frequency and `base: 0` the cut runs just under a ring of struts on the equator,
// which then lie on the bed as a closed foot. Supports are needed only for a nearly full sphere.
export const params = {
  radius: 50,
  // 1 to 6. Struts grow as 30 * frequency^2 for the whole sphere: 4 is 480 and evaluates in
  // about a second; 6 is 1080 and about two.
  frequency: 4,
  strut: 1.4, // radius of a strut
  hub: 2.2, // radius of the ball on each hub
  base: 0, // height of the cut as a share of the radius: 0 is a dome, -0.8 nearly a whole sphere
  fn: 10, // segments around a strut
};

export default (p) => {
  const phi = (1 + Math.sqrt(5)) / 2;
  const norm = (v) => {
    const l = Math.hypot(...v);
    return v.map((c) => c / l);
  };

  // The icosahedron, turned so one corner points straight up; it then has a ring of five corners
  // on each side of the equator and, at even frequency, a ring of hubs on the equator itself.
  const icosahedron = () => {
    const raw = [
      [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
      [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
      [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
    ];
    const faces = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    // Corner 5 is (0, 1, phi): tip it back onto +Z by turning about X.
    const a = Math.atan2(1, phi);
    const turn = ([x, y, z]) => [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
    return { points: raw.map((v) => turn(norm(v))), faces };
  };

  // Split every face into a triangular grid, project the grid onto the sphere, and collect unique
  // hubs and edges. Hubs are keyed by rounded coordinates, so neighbouring faces share them.
  const grid = () => {
    const { points, faces } = icosahedron();
    const f = p.frequency;
    const hubs = new Map();
    const edges = new Map();
    const hubAt = (v) => {
      const s = norm(v).map((c) => c * p.radius);
      const key = s.map((c) => c.toFixed(3)).join(',');
      if (!hubs.has(key)) hubs.set(key, s);
      return key;
    };
    const edge = (a, b) => edges.set(a < b ? `${a}|${b}` : `${b}|${a}`, [hubs.get(a), hubs.get(b)]);

    faces.forEach(([ia, ib, ic]) => {
      const [A, B, C] = [points[ia], points[ib], points[ic]];
      const at = (i, j) => {
        const k = f - i - j;
        return hubAt([0, 1, 2].map((d) => (A[d] * k + B[d] * i + C[d] * j) / f));
      };
      range(0, f).forEach((i) =>
        range(0, f - i).forEach((j) => {
          const here = at(i, j);
          if (i + j < f) {
            edge(here, at(i + 1, j));
            edge(here, at(i, j + 1));
            edge(at(i + 1, j), at(i, j + 1));
          }
        }),
      );
    });
    return { hubs: [...hubs.values()], edges: [...edges.values()] };
  };

  const cutZ = p.base * p.radius - p.strut * 0.6;

  const frame = () => {
    const { hubs, edges } = grid();
    // Only what reaches above the cut is built.
    const keep = (v) => v[2] >= cutZ - p.hub;
    const ball = (r, v) => sphere({ r, fn: p.fn }).translate(v);
    const struts = edges
      .filter(([a, b]) => keep(a) || keep(b))
      .map(([a, b]) => hull(ball(p.strut, a), ball(p.strut, b)));
    const nodes = hubs.filter(keep).map((v) => ball(p.hub, v));
    const span = 2 * p.radius + 4 * p.hub;
    const above = cube([span, span, span], { center: true }).translate([0, 0, cutZ + span / 2]);
    return union(struts, nodes).intersect(above).translate([0, 0, -cutZ]);
  };

  return { frame };
};
