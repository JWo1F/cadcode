import svgpath from 'svgpath';
import { Shape2, CrossSection } from '../shapes.js';
import { flattenBezier } from '../curves.js';
import { toText } from './common.js';
import { parseXML } from './xml.js';

/**
 * @typedef {object} SVGOptions
 * @property {boolean} [center] move the shape's bounding-box center to the origin. Default false: the document's bottom-left corner is at the origin.
 * @property {number} [dpi] pixels per inch, for documents sized in px or without units. Default 96, as browsers and Inkscape use.
 * @property {number} [fn] segments for a full turn of a curve, as for circles. Default: one per `fa` degrees.
 */

// Elements that draw nothing themselves, or only through a reference.
const SKIPPED = new Set(['defs', 'clipPath', 'mask', 'symbol', 'pattern', 'marker', 'title', 'desc', 'metadata', 'style', 'script', 'linearGradient', 'radialGradient', 'filter', 'foreignObject', 'namedview']);
// Elements with an area that the importer cannot turn into one.
const UNSUPPORTED = {
  text: 'text: convert it to paths first (Inkscape: Path → Object to Path)',
  use: 'clones (<use>): unlink them first (Inkscape: Edit → Clone → Unlink Clone)',
  image: 'raster images (<image>): only vector shapes can be imported',
};

/** Millimeters per unit of an SVG length; px is set by the dpi. */
const UNITS = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, q: 0.25 };

/**
 * The filled shapes of an SVG file as a 2D shape, like OpenSCAD's `import("logo.svg")`:
 * paths, rectangles, circles, ellipses, polygons and polylines, with their transforms and
 * fill rules. Strokes are not imported. Sizes come from the document (`width`/`height`
 * in mm, cm, in, pt or px, and its `viewBox`); Y points up, with the document's bottom-left
 * corner at the origin. `import logo from './logo.svg'` next to the program gives the text.
 * @param {string | Uint8Array | ArrayBuffer} source
 * @param {SVGOptions} [options]
 * @returns {Shape2}
 */
export function importSVG(source, options = {}) {
  const { center = false, dpi = 96, fn } = options;
  if (!(dpi > 0)) throw new Error(`importSVG(): dpi must be a positive number, got ${dpi}`);
  const root = parseXML(toText(source, 'importSVG'), 'importSVG()');
  if (root.local !== 'svg') throw new Error(`importSVG(): not an SVG file: its root element is <${root.name}>`);

  const sections = [];
  walk(root, { transform: '', fill: true, fillRule: 'NonZero' }, documentMatrix(root, dpi), fn, sections, true);
  if (sections.length === 0) throw new Error('importSVG(): the file has no filled shapes. Strokes are not imported: convert them first (Inkscape: Path → Stroke to Path)');

  let shape = new Shape2(CrossSection.union(sections));
  if (center && !shape.isEmpty()) {
    const { min, max } = shape.bounds();
    shape = shape.translate([-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2]);
  }
  return shape;
}

/**
 * The matrix from the document's user units to millimeters with Y up, as [a, b, c, d, e, f]:
 * the viewBox fills the document's width and height, and its top-left corner maps to
 * (0, height) so the bottom-left one is the origin.
 */
function documentMatrix(svg, dpi) {
  const px = 25.4 / dpi;
  const box = svg.attributes.viewBox?.trim().split(/[\s,]+/).map(Number);
  const hasBox = box?.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0;
  const [minX, minY, boxWidth, boxHeight] = hasBox ? box : [0, 0, undefined, undefined];
  const width = length(svg.attributes.width, px);
  const height = length(svg.attributes.height, px);

  let sx = px;
  let sy = px;
  if (hasBox) {
    sx = width !== undefined ? width / boxWidth : height !== undefined ? height / boxHeight : px;
    sy = height !== undefined ? height / boxHeight : sx;
    if (width === undefined && height !== undefined) sx = sy;
  }
  const documentHeight = height ?? (hasBox ? boxHeight * sy : 0);
  return [sx, 0, 0, -sy, -minX * sx, documentHeight + minY * sy];
}

/** A length in millimeters, or undefined for none or a percentage. */
function length(value, px) {
  const match = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*([a-z%]*)\s*$/i.exec(value ?? '');
  if (!match || match[2] === '%') return undefined;
  const unit = match[2].toLowerCase();
  if (unit === '' || unit === 'px') return Number(match[1]) * px;
  if (!(unit in UNITS)) throw new Error(`importSVG(): unknown unit in "${value}"`);
  return Number(match[1]) * UNITS[unit];
}

/** Presentation attributes, from attributes or the style attribute, which wins. */
function presentation(element) {
  const out = { ...element.attributes };
  for (const declaration of (element.attributes.style ?? '').split(';')) {
    const colon = declaration.indexOf(':');
    if (colon > 0) out[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
  }
  return out;
}

function walk(element, inherited, matrix, fn, sections, isRoot = false) {
  if (SKIPPED.has(element.local)) return;
  if (element.local in UNSUPPORTED) throw new Error(`importSVG(): the file has ${UNSUPPORTED[element.local]}`);
  const style = presentation(element);
  if (style.display === 'none') return;

  const state = {
    // The root's own transform does not apply to its size; a nested <svg> is not supported either way.
    transform: isRoot ? '' : `${inherited.transform} ${style.transform ?? ''}`.trim(),
    fill: style.fill === undefined || style.fill === 'inherit' ? inherited.fill : style.fill !== 'none' && style['fill-opacity'] !== '0',
    fillRule: style['fill-rule'] === 'evenodd' ? 'EvenOdd' : style['fill-rule'] === 'nonzero' ? 'NonZero' : inherited.fillRule,
  };
  if (style.visibility === 'hidden') state.fill = false;

  const d = pathOf(element);
  if (d !== undefined && state.fill) {
    const path = svgpath(d);
    if (path.err) throw new Error(`importSVG(): bad path data in <${element.name}${element.attributes.id ? ` id="${element.attributes.id}"` : ''}>: ${path.err}`);
    // Arcs become curves before the transforms: svgpath bends an arc the wrong way under a
    // mirroring matrix, and the document's Y flip is one. svgpath applies queued transforms
    // only when a later call walks the segments, hence the second abs().unarc().
    const contours = flatten(path.abs().unarc().unshort().transform(state.transform).matrix(matrix).abs().unarc(), fn);
    if (contours.length > 0) sections.push(new CrossSection(contours, state.fillRule));
  }
  for (const child of element.children) walk(child, state, matrix, fn, sections);
}

const number = (value, fallback = 0) => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
};

/** An element's outline as path data, or undefined for an element with no area. */
function pathOf({ local, attributes: a }) {
  if (local === 'path') return a.d ?? '';
  if (local === 'rect') {
    const [x, y, w, h] = [number(a.x), number(a.y), number(a.width), number(a.height)];
    if (!(w > 0 && h > 0)) return '';
    let rx = a.rx === undefined ? undefined : number(a.rx);
    let ry = a.ry === undefined ? undefined : number(a.ry);
    rx = Math.min(rx ?? ry ?? 0, w / 2);
    ry = Math.min(ry ?? rx, h / 2);
    if (!(rx > 0 && ry > 0)) return `M${x} ${y}h${w}v${h}h${-w}z`;
    const arc = (dx, dy) => `a${rx} ${ry} 0 0 1 ${dx} ${dy}`;
    return `M${x + rx} ${y}h${w - 2 * rx}${arc(rx, ry)}v${h - 2 * ry}${arc(-rx, ry)}h${-(w - 2 * rx)}${arc(-rx, -ry)}v${-(h - 2 * ry)}${arc(rx, -ry)}z`;
  }
  if (local === 'circle' || local === 'ellipse') {
    const [cx, cy] = [number(a.cx), number(a.cy)];
    const rx = local === 'circle' ? number(a.r) : number(a.rx);
    const ry = local === 'circle' ? rx : number(a.ry);
    if (!(rx > 0 && ry > 0)) return '';
    return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0z`;
  }
  if (local === 'polygon' || local === 'polyline') {
    const n = (a.points ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (n.length < 6) return '';
    // A filled polyline is filled as if closed, like a polygon.
    return `M${n.slice(0, 2).join(' ')}L${n.slice(2).join(' ')}z`;
  }
  return undefined;
}

/** Closed contours from absolute path segments with only M, L, H, V, C, Q and Z. */
function flatten(path, fn) {
  const contours = [];
  let contour = [];
  let at = [0, 0];
  let start = [0, 0];
  const close = () => {
    if (contour.length >= 3) contours.push(contour);
    contour = [];
  };
  path.iterate((segment) => {
    const [command, ...v] = segment;
    if (command === 'M') {
      close();
      at = start = [v[0], v[1]];
      contour.push(at);
    } else if (command === 'L' || command === 'H' || command === 'V') {
      at = command === 'L' ? [v[0], v[1]] : command === 'H' ? [v[0], at[1]] : [at[0], v[0]];
      contour.push(at);
    } else if (command === 'C' || command === 'Q') {
      const controls = [at];
      for (let i = 0; i < v.length; i += 2) controls.push([v[i], v[i + 1]]);
      contour.push(...flattenBezier(controls, fn));
      at = controls[controls.length - 1];
    } else if (command === 'Z') {
      close();
      at = start;
      // Drawing on after Z starts a new subpath at the same point.
      contour.push(at);
    }
  });
  close();
  return contours;
}
