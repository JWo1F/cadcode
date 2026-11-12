// Common parts to build enclosures around: each is a body, a stand-in to see the part in place,
// and a cutout, what to subtract from the enclosure so the part fits and can be reached, moving
// together. Their dimensions are nominal, from parts already modelled: measure yours.
import { Solid, Point, point, cube, cylinder, sphere, circle, square, slot } from './shapes.js';
import { plane } from './frame.js';
import { fit } from './hardware.js';

/** @typedef {import('./shapes.js').RotateOptions} RotateOptions */
/** @typedef {import('./shapes.js').AlignOptions} AlignOptions */
/** @typedef {import('./frame.js').Frame} Frame */

const PCB = '#1f6f3a';
const METAL = '#c4c4c8';
const GLASS = '#1b1d22';
const CELL = '#2f6fd6';
const LED = '#d8262a';
const PLASTIC = '#2b2b2b';

/** How far a port's cutout reaches out of the enclosure, enough for any wall. */
const PORT_REACH = 12;

/**
 * A part as a body and the cutout it needs, and named points on it, which always move together:
 * every method moves all of them and returns a new component. Union `body` into an assembly
 * view; subtract `cutout` from the enclosure.
 * `const mcu = proMicro().translate([5, 0, 2]); box.subtract(mcu.cutout)`
 */
export class Component {
  /**
   * @param {{ body: Solid, cutout: Solid, points?: Record<string, Point> }} parts
   */
  constructor(parts) {
    const { body, cutout, points = {} } = parts ?? {};
    if (!(body instanceof Solid)) throw new Error('Component: body must be a solid');
    if (!(cutout instanceof Solid)) throw new Error('Component: cutout must be a solid');
    for (const [name, p] of Object.entries(points)) {
      if (!(p instanceof Point)) throw new Error(`Component: point "${name}" must be a point`);
    }
    /** The part itself, colored, to see it in place. Never subtract it. */
    this.body = body;
    /** What to subtract from an enclosure so the part fits and can be reached. */
    this.cutout = cutout;
    /** Named points on the part, such as where a connector's mouth is. @type {Readonly<Record<string, Point>>} */
    this.points = Object.freeze({ ...points });
    Object.freeze(this);
  }

  /**
   * The same move applied to the body, the cutout and every point: the one way a component moves.
   * @param {(item: any) => any} move
   * @returns {Component}
   */
  #map(move) {
    return new Component({
      body: move(this.body),
      cutout: move(this.cutout),
      points: Object.fromEntries(Object.entries(this.points).map(([name, p]) => [name, move(p)])),
    });
  }

  /**
   * Applies a column-major 4x4 matrix to everything.
   * @param {number[]} matrix
   * @returns {Component}
   */
  transform(matrix) {
    return this.#map((item) => item.transform(matrix));
  }

  /**
   * @param {number[]} v
   * @returns {Component}
   */
  translate(v) {
    return this.#map((item) => item.translate(v));
  }

  /**
   * Rotates everything, with the same arguments as `Solid.rotate`.
   * @param {number[] | number} angles
   * @param {number[] | RotateOptions} [axis]
   * @param {RotateOptions} [options]
   * @returns {Component}
   */
  rotate(angles, axis, options) {
    return this.#map((item) => item.rotate(angles, axis, options));
  }

  /**
   * Mirrors everything across the plane through the origin with the given normal.
   * @param {number[]} normal
   * @returns {Component}
   */
  mirror(normal) {
    return this.#map((item) => item.mirror(normal));
  }

  /**
   * Moves the component, built around the origin, onto a frame: X and Y to the frame's u and v,
   * Z along its normal. `lid.face('+Z').offset(-wall).place(ec11())` mounts an encoder under a
   * lid `wall` thick, its shaft pointing up through it.
   * @param {Frame} frame
   * @returns {Component}
   */
  place(frame) {
    return this.#map((item) => frame.place(item));
  }

  /**
   * Moves everything so the body's bounding box lines up with a target, as `Solid.align` does.
   * The cutout and the points go along by the same amount.
   * @param {Solid | import('./shapes.js').Shape2 | Point | number[]} target
   * @param {AlignOptions} options
   * @returns {Component}
   */
  align(target, options) {
    const from = this.body.bounds().min;
    const to = this.body.align(target, options).bounds().min;
    return this.translate([to[0] - from[0], to[1] - from[1], to[2] - from[2]]);
  }

  /**
   * A point on the body's bounding box: `'center'`, or the center of a side, as `Solid.at`.
   * @param {'center' | '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z'} [side]
   * @returns {Point}
   */
  at(side = 'center') {
    return this.body.at(side);
  }
}

/** @param {string} op @param {unknown} clearance */
function checkClearance(op, clearance) {
  if (!(typeof clearance === 'number' && clearance >= 0)) throw new Error(`${op}: clearance must be 0 or more, got ${JSON.stringify(clearance)}`);
  return clearance;
}

// ---------------------------------------------------------------------------
// USB-C

const USBC = { w: 8.94, h: 3.26, length: 7.35 };

/**
 * The stadium outline of a USB-C receptacle in the YZ plane, centered, grown by `grow`.
 * @param {number} grow
 * @param {number | undefined} fn
 */
function usbOutline(grow, fn) {
  const h = USBC.h + 2 * grow;
  const half = (USBC.w - USBC.h) / 2;
  return slot([-half, 0], [half, 0], h, { fn });
}

/**
 * @typedef {object} ClearanceOptions
 * @property {number} [clearance] how much bigger the cutout is than the part on every side (default `fit('slide')`)
 * @property {number} [fn] segments of a full circle, for the round parts
 */

/**
 * A USB-C receptacle, 8.94 × 3.26 with fully round ends and 7.35 long. Its mouth is at x = 0
 * facing -X and its body runs along +X, centered on y = 0 and z = 0. The cutout is the mouth's
 * outline grown by `clearance`, from x = 0.5 inside out to x = -12, through any wall at -X.
 * Nominal dimensions: measure yours.
 * @param {ClearanceOptions} [options]
 * @returns {Component}
 */
export function usbC(options = {}) {
  const clearance = checkClearance('usbC()', options.clearance ?? fit('slide'));
  const { fn } = options;
  const body = plane.YZ.extrude(usbOutline(0, fn), USBC.length).color(METAL);
  const cutout = plane.YZ.offset(-PORT_REACH).extrude(usbOutline(clearance, fn), PORT_REACH + 0.5);
  return new Component({ body, cutout, points: { mouth: point([0, 0, 0]) } });
}

/** The options that are set, so `{ length: undefined }` keeps the default. @param {Record<string, unknown>} o */
const definedOnly = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// ---------------------------------------------------------------------------
// nRF52840 Pro Micro

const PRO_MICRO = { length: 34, width: 17, thickness: 1.6, usbDrop: 1.0, usbOverhang: 0.5 };

/**
 * An nRF52840 Pro Micro board: a 34 × 17 × 1.6 PCB lying on z = 0 from x = 0 to 34, centered on
 * y = 0, with its mid-mount USB-C at the -X edge, the mouth 0.5 past it at x = -0.5 and the
 * connector's bottom 1 below the PCB's top. The cutout is the connector's only: the board sits
 * inside the enclosure. Point `usb` is the center of the connector's mouth.
 * Nominal dimensions, each an option: measure yours, or pass a model's own params so the board
 * follows them.
 * @param {ClearanceOptions & { length?: number, width?: number, thickness?: number, usbDrop?: number, usbOverhang?: number }} [options]
 *   `usbDrop` how far the connector's bottom is below the PCB's top, `usbOverhang` how far its mouth reaches past the edge
 * @returns {Component}
 */
export function proMicro(options = {}) {
  const { length, width, thickness, usbDrop, usbOverhang } = { ...PRO_MICRO, ...definedOnly(options) };
  for (const [name, v] of Object.entries({ length, width, thickness })) if (!(typeof v === 'number' && v > 0)) throw new Error(`proMicro(): ${name} must be a positive number, got ${JSON.stringify(v)}`);
  const board = cube([length, width, thickness]).translate([0, -width / 2, 0]).color(PCB);
  const usb = usbC(options).translate([-usbOverhang, 0, thickness - usbDrop + USBC.h / 2]);
  return new Component({ body: board.union(usb.body), cutout: usb.cutout, points: { usb: usb.points.mouth } });
}

// ---------------------------------------------------------------------------
// 0.91" OLED

const OLED = { board: [38, 12, 1.2], glass: [30, 11.5, 1.4], active: [22.4, 5.6], windowGrow: 0.6, windowHeight: 10 };

/**
 * A 0.91" 128×32 OLED module: a 38 × 12 × 1.2 board with its bottom on z = 0, centered on the
 * origin in XY, and 30 × 11.5 × 1.4 of glass centered on top; it is seen from +Z. The cutout is a
 * pocket for the board and glass, `clearance` bigger on every side, and a window over the 22.4 × 5.6
 * active area, 0.6 bigger on each side, reaching 10 up from the glass's top.
 * Nominal dimensions, each an option: measure yours. The glass and the active area are often off
 * center: `glassShift` and `activeShift` move them, as `[x, y]` from the board's center.
 * @param {ClearanceOptions & { board?: number[], glass?: number[], active?: number[], glassShift?: number[], activeShift?: number[] }} [options]
 * @returns {Component}
 */
export function oled091(options = {}) {
  const c = checkClearance('oled091()', options.clearance ?? fit('slide'));
  const [bw, bd, bh] = options.board ?? OLED.board;
  const [gw, gd, gh] = options.glass ?? OLED.glass;
  const [aw, ad] = options.active ?? OLED.active;
  const [gx, gy] = options.glassShift ?? [0, 0];
  const [ax, ay] = options.activeShift ?? [0, 0];
  const top = bh + gh;
  const board = cube([bw, bd, bh], { center: true }).translate([0, 0, bh / 2]).color(PCB);
  const glass = cube([gw, gd, gh], { center: true }).translate([gx, gy, bh + gh / 2]).color(GLASS);
  /** A box `w` × `d` centered on the Z axis, from z = `from` to `to`. @type {(w: number, d: number, from: number, to: number) => Solid} */
  const box = (w, d, from, to) => cube([w, d, to - from], { center: true }).translate([0, 0, (from + to) / 2]);
  const cutout = box(bw + 2 * c, bd + 2 * c, -c, bh + c).union(
    box(gw + 2 * c, gd + 2 * c, -c, top + c).translate([gx, gy, 0]),
    box(aw + 2 * OLED.windowGrow, ad + 2 * OLED.windowGrow, bh, top + OLED.windowHeight).translate([ax, ay, 0]),
  );
  return new Component({ body: board.union(glass), cutout });
}

// ---------------------------------------------------------------------------
// EC11 rotary encoder

const EC11 = { body: [12, 12, 6.5], bushing: { d: 7, h: 7 }, shaft: { d: 6, flat: 4.5 } };

/**
 * @typedef {object} EncoderOptions
 * @property {number} [clearance] how much bigger the bushing's hole is than the bushing on every side (default `fit('slide')`)
 * @property {number} [shaft] how far the shaft's top is above the mounting face (default 20)
 * @property {number} [fn] segments of a full circle
 */

/**
 * An EC11 rotary encoder, mounted from behind a panel: its mounting face is z = 0, the 12 × 12 ×
 * 6.5 body below it, the 7 thick M7 bushing from 0 to 7 above, and the 6 shaft with a D flat (4.5
 * across) up to `shaft`, centered on the Z axis. The cutout is the bushing's hole, `clearance`
 * bigger, from the body's bottom at z = -6.5 up to 12, so it goes through the panel whether the
 * mounting face is put against the panel's back or its front. Point `face` is the center of the
 * mounting face.
 * Nominal dimensions: measure yours.
 * @param {EncoderOptions} [options]
 * @returns {Component}
 */
export function ec11(options = {}) {
  const c = checkClearance('ec11()', options.clearance ?? fit('slide'));
  const { shaft: shaftTop = 20, fn } = options;
  const { body: [bw, bd, bh], bushing, shaft } = EC11;
  if (!(typeof shaftTop === 'number' && shaftTop > bushing.h)) throw new Error(`ec11(): shaft must be more than ${bushing.h}, the bushing's top, got ${JSON.stringify(shaftTop)}`);
  const housing = cube([bw, bd, bh], { center: true }).translate([0, 0, -bh / 2]).color(PLASTIC);
  const collar = cylinder({ d: bushing.d, h: bushing.h, fn }).color(METAL);
  // The D: a circle with the side beyond `flat` from the far edge cut off, on +Y.
  const dShape = circle({ d: shaft.d, fn }).intersect(square([shaft.d, shaft.flat]).translate([-shaft.d / 2, -shaft.d / 2]));
  const stem = dShape.extrude(shaftTop - bushing.h).translate([0, 0, bushing.h]).color(METAL);
  const cutout = cylinder({ d: bushing.d + 2 * c, h: 12 + bh, fn }).translate([0, 0, -bh]);
  return new Component({ body: housing.union(collar, stem), cutout, points: { face: point([0, 0, 0]) } });
}

// ---------------------------------------------------------------------------
// 5 mm LED

const LED5 = { d: 5, h: 8.6, flange: { d: 5.8, h: 1 }, reach: 20 };

/**
 * A 5 mm LED standing on z = 0: a 5.8 × 1 flange at the bottom and a 5 cylinder with a round top,
 * 8.6 tall in all. The cutout is a hole `clearance` bigger, from the flange's top at z = 1 up 20,
 * so the flange stops it against the inside of a wall.
 * Nominal dimensions: measure yours. `d`, `h` and `flange` (`[d, h]`) make a 3 mm LED or any other.
 * @param {ClearanceOptions & { d?: number, h?: number, flange?: number[] }} [options]
 * @returns {Component}
 */
export function led5(options = {}) {
  const c = checkClearance('led5()', options.clearance ?? fit('slide'));
  const { fn, d = LED5.d, h = LED5.h } = options;
  const [fd, fh] = options.flange ?? [LED5.flange.d, LED5.flange.h];
  if (!(d > 0 && h > d / 2 && fd >= d && fh >= 0)) throw new Error(`led5(): want d > 0, h > d / 2 and a flange at least d across, got d ${d}, h ${h}, flange [${fd}, ${fh}]`);
  const r = d / 2;
  const flange = cylinder({ d: fd, h: Math.max(fh, 1e-3), fn });
  const barrel = cylinder({ d, h: h - r, fn });
  const dome = sphere({ r, fn }).translate([0, 0, h - r]).intersect(cube([d, d, r]).translate([-r, -r, h - r]));
  const body = flange.union(barrel, dome).color(LED);
  const cutout = cylinder({ d: d + 2 * c, h: LED5.reach, fn }).translate([0, 0, fh]);
  return new Component({ body, cutout });
}

// ---------------------------------------------------------------------------
// Cylindrical cells

/**
 * @typedef {object} CellOptions
 * @property {number} [d] diameter (default 18.4, an 18650)
 * @property {number} [l] length (default 65.2, an 18650)
 * @property {number} [clearance] how much bigger the cutout is than the cell on every side (default `fit('slide')`)
 * @property {number} [fn] segments of a full circle
 */

/**
 * A cylindrical cell lying along +X from x = 0 to `l`, its axis on y = 0 at z = d / 2, so it rests
 * on z = 0. An 18650 by default; `cell({ d: 12, l: 30 })` for a 12 × 30 Li-ion. The cutout is the
 * cell grown by `clearance` all round, to subtract for a cradle.
 * Nominal dimensions: measure yours.
 * @param {CellOptions} [options]
 * @returns {Component}
 */
export function cell(options = {}) {
  const { d = 18.4, l = 65.2, fn } = options;
  const c = checkClearance('cell()', options.clearance ?? fit('slide'));
  if (!(typeof d === 'number' && d > 0)) throw new Error(`cell(): d must be a positive number, got ${JSON.stringify(d)}`);
  if (!(typeof l === 'number' && l > 0)) throw new Error(`cell(): l must be a positive number, got ${JSON.stringify(l)}`);
  /** A cylinder on the cell's axis from x = `from` to `to`. @type {(diameter: number, from: number, to: number) => Solid} */
  const along = (diameter, from, to) => plane.YZ.offset(from).extrude(circle({ d: diameter, fn }).translate([0, d / 2]), to - from);
  // The cutout stops at z = 0, where the cell rests, so it never digs into the floor it lies on.
  return new Component({ body: along(d, 0, l).color(CELL), cutout: along(d + 2 * c, -c, l + c).clip({ z: [0, Infinity] }) });
}
