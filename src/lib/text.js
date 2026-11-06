import opentype from 'opentype.js';
import liberationSans from './fonts/liberation-sans.js';
import { Shape2, CrossSection, resolution } from './shapes.js';

/**
 * @typedef {object} TextOptions
 * @property {number} [size] height of a capital letter (the font's H), in model units. Default 10.
 * @property {Uint8Array | ArrayBuffer} [font] a TTF, OTF or WOFF file's bytes, e.g. `import font from './Roboto.ttf'`. Default Liberation Sans.
 * @property {'left' | 'center' | 'right'} [halign] which end of each line sits at x = 0. Default 'left'.
 * @property {'baseline' | 'top' | 'center' | 'bottom'} [valign] what sits at y = 0: the first line's baseline, or the top, middle or bottom of the letters. Default 'baseline'.
 * @property {number} [spacing] factor on the distance between letters. Default 1.
 * @property {number} [lineHeight] factor on the font's distance between lines. Default 1.
 * @property {number} [fn] segments for a full turn of a curve, as for circles. Default: one per `fa` degrees.
 */

/** Parsed fonts by their bytes, so a font used for many labels is parsed once. */
const parsed = new WeakMap();
let defaultFont;

function loadFont(bytes) {
  if (bytes === undefined) {
    defaultFont ??= opentype.parse(Uint8Array.from(atob(liberationSans), (c) => c.charCodeAt(0)).buffer);
    return defaultFont;
  }
  if (!(bytes instanceof Uint8Array || bytes instanceof ArrayBuffer)) {
    throw new Error("text(): `font` must be a font file's bytes, e.g. `import font from './Roboto.ttf'`");
  }
  if (!parsed.has(bytes)) {
    const buffer = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    parsed.set(bytes, opentype.parse(buffer));
  }
  return parsed.get(bytes);
}

/** The height of the font's capital H in font units: what `size` scales to. */
function capHeight(font) {
  const glyph = font.charToGlyph('H');
  const height = glyph.index === 0 ? 0 : glyph.getBoundingBox().y2;
  if (!(height > 0)) throw new Error('text(): the font has no capital H, which `size` is measured by');
  return height;
}

/** How far the direction turns along a curve's control polygon, in degrees. */
function turning(points) {
  let total = 0;
  let previous;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    if (Math.hypot(dx, dy) < 1e-12) continue;
    const angle = Math.atan2(dy, dx);
    if (previous !== undefined) {
      let delta = Math.abs(angle - previous);
      if (delta > Math.PI) delta = 2 * Math.PI - delta;
      total += delta;
    }
    previous = angle;
  }
  return (total * 180) / Math.PI;
}

/**
 * Segments for one curve. Like a circle: `fn` per full turn when set, otherwise one per `fa` degrees.
 * `fs` is left out: letters are small, and their curves would come out as straight lines.
 */
function segmentsFor(points, fn) {
  const f = fn ?? resolution.fn;
  const degrees = turning(points);
  return Math.max(1, Math.ceil(f > 0 ? (f * degrees) / 360 : degrees / resolution.fa));
}

/** Point on a Bézier curve of any degree at t, by de Casteljau. */
function bezier(points, t) {
  let row = points;
  while (row.length > 1) row = row.slice(1).map((p, i) => [row[i][0] + (p[0] - row[i][0]) * t, row[i][1] + (p[1] - row[i][1]) * t]);
  return row[0];
}

/** Turns path commands (y pointing down, as opentype.js draws them) into closed contours with y up. */
function contours(commands, fn) {
  const out = [];
  let contour = [];
  let at = [0, 0];
  const close = () => {
    if (contour.length >= 3) out.push(contour);
    contour = [];
  };
  for (const c of commands) {
    if (c.type === 'M') {
      close();
      at = [c.x, -c.y];
      contour.push(at);
    } else if (c.type === 'L') {
      at = [c.x, -c.y];
      contour.push(at);
    } else if (c.type === 'Q' || c.type === 'C') {
      const controls = c.type === 'Q' ? [at, [c.x1, -c.y1], [c.x, -c.y]] : [at, [c.x1, -c.y1], [c.x2, -c.y2], [c.x, -c.y]];
      const n = segmentsFor(controls, fn);
      for (let i = 1; i <= n; i++) contour.push(bezier(controls, i / n));
      at = [c.x, -c.y];
    } else if (c.type === 'Z') {
      close();
    }
  }
  close();
  return out;
}

/**
 * Text as a 2D shape, for labels and engraving: extrude it, or subtract the extrusion from a part.
 * Lines break at `\n`. Letters with holes, such as O and A, come out with their holes.
 * @param {string} string
 * @param {number | TextOptions} [options] a number means `{ size }`
 * @returns {Shape2}
 */
export function text(string, options = {}) {
  const o = typeof options === 'number' ? { size: options } : options;
  const { size = 10, halign = 'left', valign = 'baseline', spacing = 1, lineHeight = 1, fn } = o;
  if (!['left', 'center', 'right'].includes(halign)) throw new Error(`text(): halign must be left, center or right, got "${halign}"`);
  if (!['baseline', 'top', 'center', 'bottom'].includes(valign)) throw new Error(`text(): valign must be baseline, top, center or bottom, got "${valign}"`);

  const font = loadFont(o.font);
  // A font size that makes the capital H `size` tall; opentype.js scales by unitsPerEm.
  const fontSize = (size * font.unitsPerEm) / capHeight(font);
  const scale = fontSize / font.unitsPerEm;
  const lineStep = (font.ascender - font.descender + font.tables.hhea.lineGap) * scale * lineHeight;

  const all = [];
  String(string)
    .split('\n')
    .forEach((line, row) => {
      const glyphs = [];
      const width = font.forEachGlyph(line, 0, 0, fontSize, {}, (glyph, x) => glyphs.push({ glyph, x })) * spacing;
      const shift = halign === 'left' ? 0 : halign === 'center' ? -width / 2 : -width;
      // opentype.js draws with y down, so the next line is at +y here and ends up below once flipped.
      for (const { glyph, x } of glyphs) all.push(...contours(glyph.getPath(x * spacing + shift, row * lineStep, fontSize).commands, fn));
    });

  // Glyphs may overlap their neighbours, and fonts wind their holes either way: NonZero fills both right.
  let shape = new Shape2(all.length > 0 ? new CrossSection(all, 'NonZero') : CrossSection.union([]));
  if (valign !== 'baseline' && !shape.isEmpty()) {
    const { min, max } = shape.bounds();
    const y = valign === 'top' ? max[1] : valign === 'bottom' ? min[1] : (min[1] + max[1]) / 2;
    shape = shape.translate([0, -y]);
  }
  return shape;
}
