import { cylinder, hull, polygon, range, setResolution, sphere } from 'cadcode';

setResolution({ fn: 48 });

// A desk model of a spiral staircase: wedge treads around a central column, a baluster
// at the end of each tread and a handrail that follows them up. Prints standing on its
// base; the treads overhang, so print with supports (tree supports leave the cleanest underside).
export const params = {
  // Stair
  steps: 18,
  turn: 360, // degrees the stair turns from bottom to top
  height: 110,
  radius: 40, // outer edge of the treads
  tread: 3, // thickness
  overlap: 4, // degrees each tread runs under the next

  // Column and base
  columnD: 12,
  baseD: 100,
  baseH: 4,

  // Railing
  balusterD: 1.6,
  railHeight: 22, // above each tread
  railD: 2.4,
};

export default (p) => {
  const step = p.turn / p.steps;
  const rise = (p.height - p.baseH) / p.steps;
  const treadZ = (i) => p.baseH + (i + 1) * rise - p.tread;
  const angle = (i) => i * step;
  const edge = p.radius - 1.5; // balusters stand just inside the outer edge

  // A tread is a ring sector, from inside the column to the outer radius.
  const tread = (i) => {
    const arc = range(0, 8).map((k) => {
      const a = ((angle(i) + ((step + p.overlap) * k) / 8) * Math.PI) / 180;
      return [p.radius * Math.cos(a), p.radius * Math.sin(a)];
    });
    return polygon([[0, 0], ...arc]).extrude(p.tread).translate([0, 0, treadZ(i)]);
  };

  // The middle of a tread's outer edge, where its baluster stands.
  const post = (i, z) => {
    const a = ((angle(i) + step / 2) * Math.PI) / 180;
    return [edge * Math.cos(a), edge * Math.sin(a), z];
  };

  const baluster = (i) => cylinder({ d: p.balusterD, h: p.railHeight, fn: 8 }).translate(post(i, treadZ(i) + p.tread - 0.5));

  // The rail is a chain of hulls between balls on the helix through the baluster tops,
  // three links per step so it curves instead of bending at each post.
  const links = 3;
  const railTop = (t) => post(t, treadZ(t) + p.tread + p.railHeight - 0.5);
  const ball = (t) => sphere({ d: p.railD, fn: 12 }).translate(railTop(t));
  const rail = () => range(0, (p.steps - 1) * links - 1).map((k) => hull(ball(k / links), ball((k + 1) / links)));

  const base = () => cylinder({ d: p.baseD, h: p.baseH, fn: 96 });
  const column = () => cylinder({ d: p.columnD, h: p.height + p.railHeight * 0.6 }).translate([0, 0, p.baseH - 0.5]);
  const finial = () => sphere({ d: p.columnD * 1.4 }).translate([0, 0, p.baseH + p.height + p.railHeight * 0.6]);
  const treads = () => range(0, p.steps - 1).map(tread);
  const balusters = () => range(0, p.steps - 1).map(baluster);

  console.log(`${p.steps} steps of ${rise.toFixed(1)} mm, ${p.baseD} mm across, ${(p.height + p.railHeight).toFixed(0)} mm tall`);

  return {
    display: () => [
      base().color('#8a8f99'),
      column().union(finial()).color('#d8d2c4'),
      treads().map((t) => t.color('#b07a45')),
      balusters().map((b) => b.color('#2a2f36')),
      rail().map((r) => r.color('#2a2f36')),
    ],
    model: () => base().union(column(), finial(), treads(), balusters(), rail()),
  };
};
