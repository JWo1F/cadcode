// Metric screws, nuts and heat-set inserts for printed parts: their sizes as data, and the
// cutters for the holes, counterbores, countersinks and nut traps they need.
//
// Every cutter is drawn at a surface at z = 0 and goes down into the part along -Z, reaching 1
// above z = 0 so it cuts cleanly through the face it starts on. Put one on a face with a frame:
// `box.subtract(box.face('+Z').place(screwHole('M3', { length: 8 })))`; the frame turns local Z
// into the face's outward normal, so the cutter goes into the part whichever side it is on.
import { Solid, segmentsFor } from './shapes.js';
import { cylinder } from './primitives.js';

/** How far the cutters reach above z = 0, so a subtraction leaves no skin on the face. */
const OVERSHOOT = 1;

/** How thick the floor under a blind hole in a `boss()` is. */
const BOSS_FLOOR = 1;

/** The thinnest wall `boss()` leaves around its hole by default. */
const BOSS_WALL = 1.6;

/**
 * The numbers for each size, in mm:
 * - `clearance`: hole the screw passes through freely (ISO 273, normal fit);
 * - `tap`: pilot hole a screw cuts its own thread into, in printed plastic;
 * - `capHead`: socket cap head, ISO 4762: diameter, and height = the nominal diameter;
 * - `countersunk`: countersunk head diameter, ISO 10642, 90°;
 * - `nut`: hex nut, ISO 4032: across flats `s` and thickness `h`;
 * - `insert`: hole for a typical brass heat-set insert: diameter and depth. Inserts vary by brand.
 */
const SIZES = {
  M2: { d: 2, clearance: 2.4, tap: 1.6, capHead: { d: 3.8, h: 2 }, countersunk: { d: 4.4 }, nut: { s: 4, h: 1.6 }, insert: { d: 3.2, depth: 4.0 } },
  'M2.5': { d: 2.5, clearance: 2.9, tap: 2.0, capHead: { d: 4.5, h: 2.5 }, countersunk: { d: 5.5 }, nut: { s: 5, h: 2.0 }, insert: { d: 3.6, depth: 5.0 } },
  M3: { d: 3, clearance: 3.4, tap: 2.5, capHead: { d: 5.5, h: 3 }, countersunk: { d: 6.72 }, nut: { s: 5.5, h: 2.4 }, insert: { d: 4.0, depth: 5.7 } },
  M4: { d: 4, clearance: 4.5, tap: 3.3, capHead: { d: 7, h: 4 }, countersunk: { d: 8.96 }, nut: { s: 7, h: 3.2 }, insert: { d: 5.6, depth: 8.1 } },
  M5: { d: 5, clearance: 5.5, tap: 4.2, capHead: { d: 8.5, h: 5 }, countersunk: { d: 11.2 }, nut: { s: 8, h: 4.0 }, insert: { d: 6.4, depth: 9.5 } },
  M6: { d: 6, clearance: 6.6, tap: 5.0, capHead: { d: 10, h: 6 }, countersunk: { d: 13.44 }, nut: { s: 10, h: 5.0 }, insert: { d: 8.0, depth: 12.7 } },
  M8: { d: 8, clearance: 9.0, tap: 6.8, capHead: { d: 13, h: 8 }, countersunk: { d: 17.92 }, nut: { s: 13, h: 6.5 }, insert: { d: 9.7, depth: 12.7 } },
  // Wood and chipboard screws (W for wood), to fix a printed part to wood: clearance half a millimetre
  // over the thread, a 90° countersunk head twice the thread across, a pan head for `head: 'cap'`, and
  // a pilot of three quarters of the thread for screwing into plastic. No nut and no insert.
  W3: { d: 3, clearance: 3.5, tap: 2.2, capHead: { d: 6, h: 2.1 }, countersunk: { d: 6 }, nut: null, insert: null },
  'W3.5': { d: 3.5, clearance: 4.0, tap: 2.6, capHead: { d: 7, h: 2.5 }, countersunk: { d: 7 }, nut: null, insert: null },
  W4: { d: 4, clearance: 4.5, tap: 3.0, capHead: { d: 8, h: 2.8 }, countersunk: { d: 8 }, nut: null, insert: null },
  'W4.5': { d: 4.5, clearance: 5.0, tap: 3.4, capHead: { d: 9, h: 3.2 }, countersunk: { d: 9 }, nut: null, insert: null },
  W5: { d: 5, clearance: 5.5, tap: 3.8, capHead: { d: 10, h: 3.5 }, countersunk: { d: 10 }, nut: null, insert: null },
  W6: { d: 6, clearance: 6.6, tap: 4.5, capHead: { d: 12, h: 4.2 }, countersunk: { d: 12 }, nut: null, insert: null },
};

/**
 * @typedef {'M2' | 'M2.5' | 'M3' | 'M4' | 'M5' | 'M6' | 'M8' | 'W3' | 'W3.5' | 'W4' | 'W4.5' | 'W5' | 'W6'} ScrewSize
 */

/**
 * The numbers for one metric screw size, in mm.
 * @typedef {object} ScrewData
 * @property {number} d nominal diameter
 * @property {number} clearance hole the screw passes through freely (normal fit)
 * @property {number} tap pilot hole for a screw that cuts its own thread into printed plastic
 * @property {{ d: number, h: number }} capHead socket cap head (ISO 4762): diameter and height
 * @property {{ d: number }} countersunk countersunk head (ISO 10642, 90°): diameter at the top
 * @property {{ s: number, h: number } | null} nut hex nut (ISO 4032): across flats and thickness; null for a wood screw
 * @property {{ d: number, depth: number } | null} insert hole for a typical brass heat-set insert; inserts
 *   vary by brand, so check the datasheet of yours; null for a wood screw
 */

/**
 * The table row for `size`, or an error naming the sizes there are.
 * @param {string} op
 * @param {unknown} size
 * @returns {ScrewData}
 */
function lookup(op, size) {
  const row = typeof size === 'string' && Object.hasOwn(SIZES, size) ? SIZES[/** @type {ScrewSize} */ (size)] : undefined;
  if (!row) throw new Error(`${op}: unknown size ${JSON.stringify(size)}; the sizes are ${Object.keys(SIZES).join(', ')}`);
  return row;
}

/** The part of a size that a wood screw lacks, or an error saying so. @template T @param {string} op @param {string} size @param {T | null} part @param {string} what @returns {T} */
function needs(op, size, part, what) {
  if (!part) throw new Error(`${op}: ${size} is a wood screw, which has no ${what}`);
  return part;
}

/**
 * The numbers for a metric screw size, in mm: its clearance and tap holes, cap and countersunk
 * heads, hex nut and heat-set insert hole. A fresh object each call, so changing it changes nothing else.
 * `screw('M3').capHead.d` is 5.5.
 * @param {ScrewSize} size `'M2'` … `'M8'` for machine screws, `'W3'` … `'W6'` for wood screws
 * @returns {ScrewData}
 */
export function screw(size) {
  return structuredClone(lookup('screw()', size));
}

// ---------------------------------------------------------------------------
// Fits: how much bigger a hole is than what goes into it, per side.

/** @typedef {'press' | 'slide' | 'loose'} FitKind */

const DEFAULT_FITS = Object.freeze({ press: 0.1, slide: 0.2, loose: 0.4 });

/** The fits in force; `setFit()` changes them, as `setResolution()` does the curve defaults. */
const fits = { ...DEFAULT_FITS };

/** @internal The fits in force, for memo()'s key. @returns {Readonly<Record<string, number>>} */
export function currentFits() {
  return { ...fits };
}

/**
 * The clearance per side for a kind of fit, in mm: `'press'` (0.1 by default) for parts pressed
 * in to stay, `'slide'` (0.2) for parts that go in by hand, `'loose'` (0.4) for parts that move
 * freely. Grow a hole by twice this across: `circle({ d: 5 + 2 * fit('slide') })`.
 * @param {FitKind} kind
 * @returns {number}
 */
export function fit(kind) {
  if (!Object.hasOwn(fits, kind)) throw new Error(`fit(): unknown fit ${JSON.stringify(kind)}; use ${Object.keys(fits).map((k) => `'${k}'`).join(', ')}`);
  return fits[kind];
}

/**
 * Changes the clearance of one or more fits for everything built after it, such as to suit a
 * printer that prints holes small. Kinds left out keep their value.
 * @param {{ press?: number, slide?: number, loose?: number }} options
 */
export function setFit(options) {
  for (const [kind, value] of Object.entries(options ?? {})) {
    if (!Object.hasOwn(DEFAULT_FITS, kind)) throw new Error(`setFit(): unknown fit ${JSON.stringify(kind)}; use ${Object.keys(DEFAULT_FITS).join(', ')}`);
    if (!(typeof value === 'number' && value >= 0)) throw new Error(`setFit(): ${kind} must be 0 or more, got ${JSON.stringify(value)}`);
  }
  Object.assign(fits, options);
}

// ---------------------------------------------------------------------------
// Cutters

const HEADS = ['none', 'cap', 'countersunk'];
const HOLES = ['clearance', 'tap', 'insert'];

/**
 * The diameter to give a hole's polygon so it is at least `d` across everywhere: a polygon through
 * points on a circle is narrower than the circle across its flats, and a hole cut at the default
 * resolution (a hexagon for M3) would not take its screw. The corners reach a little past `d` instead.
 * @param {number} d
 * @param {number | undefined} fn
 */
const holeDiameter = (d, fn) => d / Math.cos(Math.PI / segmentsFor(d / 2, fn));

/**
 * A vertical hole cutter of diameter `d`, at least `d` across its flats, from z = `from` up to z = `to`.
 * @param {number} d
 * @param {number} from
 * @param {number} to
 * @param {number | undefined} fn
 */
const rod = (d, from, to, fn) => cylinder({ d: holeDiameter(d, fn), h: to - from, fn: segmentsFor(d / 2, fn) }).translate([0, 0, from]);

/** @param {string} op @param {string} name @param {unknown} value */
function positive(op, name, value) {
  if (!(typeof value === 'number' && value > 0)) throw new Error(`${op}: ${name} must be a positive number, got ${JSON.stringify(value)}`);
}

/**
 * @typedef {object} ScrewHoleOptions
 * @property {number} [length] how deep the hole goes below z = 0, head recess included. Needed for
 *   `'clearance'` and `'tap'`; for `'insert'` it defaults to the insert's depth
 * @property {'none' | 'cap' | 'countersunk'} [head] the recess at the top for the screw's head (default `'none'`)
 * @property {'clearance' | 'tap' | 'insert'} [hole] the hole below it: the screw passes through, cuts its
 *   own thread, or takes a heat-set insert (default `'clearance'`)
 * @property {number} [headDepth] for `'cap'`: how deep the counterbore is (default the head's height, so the
 *   head sits flush); for `'countersunk'`: how far below the surface the cone starts (default 0, flush)
 * @property {number} [fn] segments of a full circle
 */

/**
 * The solid to subtract for a screw's hole, drawn at a surface at z = 0 going down into the part
 * along -Z, `length` deep. A `'cap'` head gets a counterbore `fit('slide')` bigger than the head
 * all round; a `'countersunk'` one a 90° cone, the head's diameter at z = 0. The cutter also reaches
 * 1 above z = 0, so it cuts cleanly through the face. Put it on a face with a frame:
 * `box.subtract(box.face('+Z').place(screwHole('M3', { length: 10, head: 'cap' })))`.
 * @param {ScrewSize} size
 * @param {ScrewHoleOptions} [options]
 * @returns {Solid}
 */
export function screwHole(size, options = {}) {
  const op = 'screwHole()';
  const s = lookup(op, size);
  const { head = 'none', hole = 'clearance', fn } = options;
  if (!HEADS.includes(head)) throw new Error(`${op}: head must be one of ${HEADS.map((h) => `'${h}'`).join(', ')}, got ${JSON.stringify(head)}`);
  if (!HOLES.includes(hole)) throw new Error(`${op}: hole must be one of ${HOLES.map((h) => `'${h}'`).join(', ')}, got ${JSON.stringify(hole)}`);
  const length = options.length ?? (hole === 'insert' ? needs(op, size, s.insert, 'heat-set insert').depth : undefined);
  if (length === undefined) throw new Error(`${op}: give the hole's length, how deep it goes below z = 0`);
  positive(op, 'length', length);

  const holeD = hole === 'clearance' ? s.clearance : hole === 'tap' ? s.tap : needs(op, size, s.insert, 'heat-set insert').d;
  const shaft = rod(holeD, -length, OVERSHOOT, fn);
  if (head === 'none') return shaft;

  if (head === 'cap') {
    const depth = options.headDepth ?? s.capHead.h;
    positive(op, 'headDepth', depth);
    if (depth >= length) throw new Error(`${op}: the counterbore (${depth} deep) must be shallower than the hole (${length})`);
    return shaft.union(rod(s.capHead.d + 2 * fit('slide'), -depth, OVERSHOOT, fn));
  }

  // Countersunk: a 90° cone narrows by 1 in radius for every 1 it goes down, from the head's
  // diameter to the hole's. Above it, a bore of the head's diameter up past the surface.
  const sink = options.headDepth ?? 0;
  if (!(typeof sink === 'number' && sink >= 0)) throw new Error(`${op}: headDepth must be 0 or more, got ${JSON.stringify(sink)}`);
  const coneHeight = (s.countersunk.d - holeD) / 2;
  if (sink + coneHeight >= length) throw new Error(`${op}: the countersink (${sink + coneHeight} deep) must be shallower than the hole (${length})`);
  const n = segmentsFor(s.countersunk.d / 2, fn);
  const cone = cylinder({ d1: holeDiameter(holeD, n), d2: holeDiameter(s.countersunk.d, n), h: coneHeight, fn: n }).translate([0, 0, -sink - coneHeight]);
  return shaft.union(cone, rod(s.countersunk.d, -sink, OVERSHOOT, fn));
}

/**
 * @typedef {object} BossOptions
 * @property {number} h height, from z = 0
 * @property {number} [floor] how thick the bottom under a blind hole is (default 1); 0 opens it to the part below
 * @property {number} [d] outer diameter (default the larger of 2.2 × the screw's diameter and the hole
 *   plus 1.6 of wall each side, rounded up to 0.1)
 * @property {'tap' | 'insert' | 'clearance'} [hole] the hole down its middle: `'tap'` for a screw that cuts
 *   its own thread and `'insert'` for a heat-set insert, both stopping 1 above the bottom; `'clearance'`
 *   goes right through (default `'tap'`)
 * @property {number} [fn] segments of a full circle
 */

/**
 * A screw boss: a cylinder standing on z = 0, `h` tall, with the hole for the screw from its top
 * down. Union it onto a floor; the floor under a blind hole is 1 thick.
 * @param {ScrewSize} size
 * @param {BossOptions} options
 * @returns {Solid}
 */
export function boss(size, options) {
  const op = 'boss()';
  const s = lookup(op, size);
  const { h, hole = 'tap', d: diameter, floor = BOSS_FLOOR, fn } = options ?? {};
  if (!(typeof floor === 'number' && floor >= 0)) throw new Error(`${op}: floor must be 0 or more, got ${JSON.stringify(floor)}`);
  positive(op, 'h', h);
  if (!['tap', 'insert', 'clearance'].includes(hole)) throw new Error(`${op}: hole must be 'tap', 'insert' or 'clearance', got ${JSON.stringify(hole)}`);
  const holeD = hole === 'clearance' ? s.clearance : hole === 'tap' ? s.tap : needs(op, size, s.insert, 'heat-set insert').d;
  // Rounded up, so the wall is never thinner than BOSS_WALL; the small epsilon keeps 6.6 from becoming 6.7.
  const d = diameter ?? Math.ceil(Math.max(2.2 * s.d, holeD + 2 * BOSS_WALL) * 10 - 1e-9) / 10;
  positive(op, 'd', d);
  if (d <= holeD) throw new Error(`${op}: d ${d} leaves no wall around the ${holeD} hole`);

  const depth = hole === 'clearance' ? h : h - floor;
  if (depth <= 0) throw new Error(`${op}: h must be more than the floor, ${floor}, for a blind hole, got ${h}`);
  if (hole === 'insert' && depth < s.insert.depth) {
    throw new Error(`${op}: an ${size} insert needs a hole ${s.insert.depth} deep, but h ${h} leaves ${depth}; make h at least ${s.insert.depth + floor}`);
  }
  // The hole reaches past the top, and for a through hole past the bottom too, so it leaves no skin.
  const bottom = hole === 'clearance' ? -OVERSHOOT : h - depth;
  return cylinder({ d, h, fn }).subtract(rod(holeD, bottom, h + OVERSHOOT, fn));
}

/**
 * @typedef {object} NutTrapOptions
 * @property {number} [depth] how deep the pocket goes below z = 0 (default the nut's thickness + 0.2)
 * @property {number} [clearance] how much bigger than the nut across the flats, on every side (default `fit('slide')`)
 */

/**
 * The solid to subtract for a hexagonal pocket a nut drops into: drawn at a surface at z = 0 going
 * down along -Z, `clearance` bigger than the nut across the flats on every side, and reaching 1 above
 * z = 0. Corners point along ±X, flats face ±Y. Place it with a frame, as `screwHole()`.
 * @param {ScrewSize} size
 * @param {NutTrapOptions} [options]
 * @returns {Solid}
 */
export function nutTrap(size, options = {}) {
  const op = 'nutTrap()';
  const s = lookup(op, size);
  const nut = needs(op, size, s.nut, 'nut');
  const depth = options.depth ?? nut.h + 0.2;
  const clearance = options.clearance ?? fit('slide');
  positive(op, 'depth', depth);
  if (!(typeof clearance === 'number' && clearance >= 0)) throw new Error(`${op}: clearance must be 0 or more, got ${JSON.stringify(clearance)}`);
  // A six-sided cylinder has a corner on +X; across its corners is 2 / √3 times across its flats.
  const acrossCorners = ((nut.s + 2 * clearance) * 2) / Math.sqrt(3);
  return cylinder({ d: acrossCorners, h: depth + OVERSHOOT, fn: 6 }).translate([0, 0, -depth]);
}
