// Screw threads for printing: a threaded rod, or the cutter for a threaded hole.
import { Solid, cylinder, polygon, square, union, segmentsFor } from './shapes.js';
import { tube } from './sweep.js';

/** @typedef {import('./shapes.js').Vec2} Vec2 */

/**
 * The tooth of each profile, for pitch `p`: how deep it is, and its half-width at the crest and at the root.
 * @type {Record<string, (p: number) => { depth: number, crest: number, root: number }>}
 */
const PROFILES = {
  // ISO metric basic profile: 60° flanks, a flat of p/8 at the crest and p/4 at the root.
  iso: (p) => ({ depth: (5 / 8) * (Math.sqrt(3) / 2) * p, crest: p / 16, root: (3 * p) / 8 }),
  // Trapezoidal, 30° between the flanks, half a pitch deep: strong, for lids and lead screws.
  trapezoid: (p) => {
    const lean = (p / 4) * Math.tan(Math.PI / 12);
    return { depth: p / 2, crest: p / 4 - lean, root: p / 4 + lean };
  },
  // Square: straight flanks, half a pitch deep and half a pitch wide.
  square: (p) => ({ depth: p / 2, crest: p / 4, root: p / 4 }),
};

/**
 * @typedef {object} ThreadOptions
 * @property {number} d Major diameter: across the crests of the rod. For `internal`, the rod the hole is for.
 * @property {number} pitch Distance from one crest to the next along the axis.
 * @property {number} length How long along +Z, from 0.
 * @property {'iso' | 'trapezoid' | 'square'} [profile] The tooth shape (default `'iso'`).
 * @property {boolean} [internal] Make the cutter for a threaded hole instead of a rod: subtract it from a nut or a lid.
 * @property {number} [clearance] For `internal`: how much bigger the hole is than the rod on every face of the tooth (default 0.2).
 * @property {number} [starts] Separate threads wound side by side (default 1); each turn then advances `starts * pitch`.
 * @property {boolean} [leftHand] Wind the other way.
 * @property {number} [taper] Length of the lead-in chamfer at each end, so the thread starts cleanly (default 0).
 * @property {number} [fn] Segments per turn. Without it the `setResolution` defaults apply, as for a circle of diameter `d`.
 */

/**
 * A screw thread along +Z from 0 to `length`: a threaded rod, or with `internal: true` the solid to
 * subtract for a threaded hole, `clearance` bigger and reaching 1 past both ends so it cuts through.
 * @param {ThreadOptions} options
 * @returns {Solid}
 */
export function thread(options) {
  const { d, pitch, length, profile = 'iso', internal = false, clearance = 0.2, starts = 1, leftHand = false, taper = 0, fn } = options ?? {};
  if (!(d > 0)) throw new Error('thread(): `d`, the major diameter, must be positive');
  if (!(pitch > 0)) throw new Error('thread(): `pitch` must be positive');
  if (!(length > 0)) throw new Error('thread(): `length` must be positive');
  const shape = PROFILES[profile];
  if (!shape) throw new Error(`thread(): unknown profile '${profile}'; use ${Object.keys(PROFILES).map((k) => `'${k}'`).join(', ')}`);
  if (!(Number.isInteger(starts) && starts >= 1)) throw new Error('thread(): `starts` must be a whole number, 1 or more');
  if (!(taper >= 0 && taper <= length / 3)) throw new Error('thread(): `taper` must be between 0 and a third of the length');

  const { depth, crest, root } = shape(pitch);
  if (d / 2 - depth <= 0) throw new Error('thread(): the pitch is too coarse for this diameter');
  // The rod's crest and root radii; a hole is `clearance` bigger.
  const grow = internal ? clearance : 0;
  const major = d / 2 + grow;
  const minor = d / 2 - depth + grow;
  const perTurn = segmentsFor(d / 2, fn);
  const lead = pitch * starts;

  // The tooth in (radius, z), centered on z = 0. It reaches below the root into the core so the two
  // overlap, with straight sides there so neighbouring turns never touch.
  const rodMajor = d / 2;
  const rodMinor = d / 2 - depth;
  const sag = rodMinor * (1 - Math.cos(Math.PI / perTurn));
  const sink = Math.min(rodMinor / 2, Math.max(depth / 4, 2 * sag));
  /** @type {Vec2[]} */
  const outline = [[rodMinor - sink, -root], [rodMinor, -root], [rodMajor, -crest], [rodMajor, crest], [rodMinor, root], [rodMinor - sink, root]];
  let tooth = polygon(crest === root ? [outline[0], outline[2], outline[3], outline[5]] : outline);
  // The hole is bigger than the rod by `clearance` on every face; trimmed so turns stay apart.
  if (internal) tooth = tooth.offset({ delta: clearance }).intersect(square([major + sink + 1, pitch * 0.98]).translate([0, -pitch * 0.49]));
  const ring = tooth.toPolygons();

  // Wind the tooth from below 0 to past the end; the envelope trims both ends flat. Starting on a
  // whole number of leads puts a tooth at z = 0 on +X for rods and holes alike, so they line up.
  const from = -Math.ceil((lead + pitch + 1) / lead) * lead;
  const to = length + lead + pitch + (internal ? 1 : 0);
  const steps = Math.ceil(((to - from) / lead) * perTurn);
  const place = (step, r, z) => {
    const a = (2 * Math.PI * step) / perTurn;
    return /** @type {import('./shapes.js').Vec3} */ ([r * Math.cos(a), r * Math.sin(a), z + from + (lead * step) / perTurn]);
  };
  const wound = tube(ring, steps + 1, place, false, 'thread()');
  const teeth = Array.from({ length: starts }, (_, i) => wound.rotate((360 * i) / starts));
  const reach = internal ? 1 : 0;
  const core = cylinder({ r: minor, h: length + 2 * reach + 2, fn: perTurn }).translate([0, 0, -reach - 1]);
  let result = union(core, teeth);

  const outer = major + depth / 10;
  if (internal) {
    result = result.intersect(cylinder({ r: outer, h: length + 2, fn: perTurn }).translate([0, 0, -1]));
    if (taper > 0) {
      // A countersink at each face, from the full major diameter down to the root over `taper`.
      const wide = major + (major - minor) / taper;
      const countersink = polygon([[0, -1], [wide, -1], [minor, taper], [0, taper]]).revolve({ fn: perTurn });
      result = result.union(countersink, countersink.mirror([0, 0, 1]).translate([0, 0, length]));
    }
  } else {
    // A chamfer at each end from the root up to the crests over `taper`, past the crests to `outer`.
    const rise = ((outer - minor) * taper) / (major - minor);
    const envelope = taper > 0
      ? polygon([[0, 0], [minor, 0], [outer, rise], [outer, length - rise], [minor, length], [0, length]])
      : square([outer, length]);
    result = result.intersect(envelope.revolve({ fn: perTurn }));
  }
  return leftHand ? result.mirror([1, 0, 0]) : result;
}
