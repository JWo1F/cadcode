import { cube, hull, range, setResolution, sphere, union } from 'cadcode';

setResolution({ fn: 20 });

// A (p, q) torus knot: the tube winds p times around the axis and q times through the hole.
// p and q must be coprime, or the curve closes early into separate loops.
export const params = {
  p: 3,
  q: 5,
  radius: 30, // centre of the torus the knot lies on
  swing: 12, // how far the curve swings off that circle
  tube: 4, // radius of the tube
  segments: 240,
  flatBottom: 1, // cut off this much under the lowest point so it stands on the bed
};

export default (k) => {
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  if (gcd(k.p, k.q) !== 1) throw new Error(`p = ${k.p} and q = ${k.q} share a factor; the knot would not close`);

  const point = (t) => {
    const r = k.radius + k.swing * Math.cos(k.q * t);
    return [r * Math.cos(k.p * t), r * Math.sin(k.p * t), k.swing * Math.sin(k.q * t)];
  };

  // A tube is a chain of hulls between neighbouring balls; the balls round every joint.
  const knot = () => {
    const balls = range(0, k.segments - 1).map((i) => sphere(k.tube).translate(point((2 * Math.PI * i) / k.segments)));
    return union(balls.map((ball, i) => hull(ball, balls[(i + 1) % balls.length])));
  };

  const print = () => {
    const bottom = -k.swing - k.tube + k.flatBottom;
    const size = 2 * (k.radius + k.swing + k.tube) + 2;
    return knot()
      .intersect(cube([size, size, size], { center: true }).translate([0, 0, bottom + size / 2]))
      .translate([0, 0, -bottom]);
  };

  return { knot, print };
};
