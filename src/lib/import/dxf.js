import { Shape2, CrossSection, segmentsFor } from '../shapes.js';
import { toText } from './common.js';

/**
 * @typedef {object} DXFOptions
 * @property {string | string[]} [layer] import only the entities on this layer, or these layers. Default: every layer.
 * @property {boolean} [center] move the shape's bounding-box center to the origin. Default false: the drawing's own origin.
 * @property {number} [fn] segments for a full circle, as for `circle()`. Arcs get their share. Default: the `fn`/`fa`/`fs` rules.
 */

// Geometry the importer cannot read, which would otherwise go missing without a word.
// Entities that draw no outline (TEXT, MTEXT, DIMENSION, POINT, HATCH...) are skipped, as OpenSCAD does.
const UNSUPPORTED = {
  SPLINE: 'splines: convert them to polylines first (in most CAD programs: explode, or save as an older DXF version with splines as polylines)',
  INSERT: 'blocks (INSERT): explode them first',
};

/** @typedef {number[][]} Points */

/**
 * The closed outlines of a DXF drawing as a 2D shape, like OpenSCAD's `import("plate.dxf")`.
 * Lines, arcs, circles, ellipses and polylines (with bulges) are read; loose lines and arcs
 * that meet end to end are joined into outlines. Outlines inside others are holes. Units
 * are taken as millimeters. `import drawing from './plate.dxf'` next to the program gives the text.
 * @param {string | Uint8Array | ArrayBuffer} source
 * @param {DXFOptions} [options]
 * @returns {Shape2}
 */
export function importDXF(source, options = {}) {
  const { center = false, fn } = options;
  const layers = options.layer === undefined ? undefined : new Set([options.layer].flat().map(String));
  const entities = readEntities(toText(source, 'importDXF'));

  /** @type {Points[]} */
  const closed = [];
  /** @type {{ points: Points, layer: string }[]} */
  const open = [];
  for (const entity of entities) {
    if (layers && !layers.has(entity.layer)) continue;
    if (entity.type in UNSUPPORTED) throw new Error(`importDXF(): the drawing has ${UNSUPPORTED[entity.type]}`);
    const piece = outline(entity, fn);
    if (!piece) continue;
    if (piece.closed) closed.push(piece.points);
    else open.push({ points: piece.points, layer: entity.layer });
  }
  closed.push(...joinPieces(open));
  if (closed.length === 0) {
    const where = layers ? ` on layer ${[...layers].map((l) => `"${l}"`).join(', ')}` : '';
    throw new Error(`importDXF(): the drawing has no closed outlines${where}`);
  }

  let shape = new Shape2(new CrossSection(closed, 'EvenOdd'));
  if (center && !shape.isEmpty()) {
    const { min, max } = shape.bounds();
    shape = shape.translate([-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2]);
  }
  return shape;
}

// ---------------------------------------------------------------------------
// Reading: a DXF file is pairs of lines, a group code and a value. Entities in the
// ENTITIES section each start with code 0 and their type.

/**
 * @typedef {object} Entity
 * @property {string} type
 * @property {string} layer
 * @property {[number, string][]} pairs
 * @property {Entity[]} [vertices] a POLYLINE's VERTEX entities
 */

/** @returns {Entity[]} */
function readEntities(text) {
  const lines = text.split(/\r?\n/);
  /** @type {[number, string][]} */
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isInteger(code)) throw new Error(`importDXF(): not a DXF file: line ${i + 1} should be a group code, got "${lines[i].trim()}"`);
    pairs.push([code, lines[i + 1].trim()]);
  }

  const start = pairs.findIndex(([code, value], i) => code === 0 && value === 'SECTION' && pairs[i + 1]?.[0] === 2 && pairs[i + 1][1] === 'ENTITIES');
  if (start === -1) throw new Error('importDXF(): not a DXF file: it has no ENTITIES section');

  /** @type {Entity[]} */
  const entities = [];
  /** @type {Entity | undefined} */
  let polyline;
  let current;
  for (let i = start + 2; i < pairs.length; i++) {
    const [code, value] = pairs[i];
    if (code === 0) {
      if (value === 'ENDSEC') break;
      current = { type: value, layer: '0', pairs: [] };
      if (value === 'VERTEX' && polyline) polyline.vertices.push(current);
      else if (value === 'SEQEND') polyline = undefined;
      else {
        entities.push(current);
        if (value === 'POLYLINE') polyline = Object.assign(current, { vertices: [] });
      }
    } else if (current) {
      if (code === 8) current.layer = value;
      current.pairs.push([code, value]);
    }
  }
  return entities;
}

/** The first value of a group code, as a number. */
function get(entity, code, fallback = 0) {
  const pair = entity.pairs.find(([c]) => c === code);
  return pair ? Number(pair[1]) : fallback;
}

// ---------------------------------------------------------------------------
// Geometry. Arcs, circles and polylines are drawn in their object coordinate system;
// for a drawing seen from below (extrusion direction 0, 0, -1, which mirrored parts and
// some CAD programs write) that is the plane mirrored in X.

/** @returns {{ points: Points, closed: boolean } | undefined} */
function outline(entity, fn) {
  const mirror = get(entity, 230, 1) < 0 ? ([x, y]) => [-x, y] : (p) => p;
  switch (entity.type) {
    case 'LINE':
      return { points: [[get(entity, 10), get(entity, 20)], [get(entity, 11), get(entity, 21)]], closed: false };
    case 'CIRCLE': {
      const r = get(entity, 40);
      const n = segmentsFor(r, fn);
      const points = [];
      for (let i = 0; i < n; i++) points.push(mirror(polar([get(entity, 10), get(entity, 20)], r, (2 * Math.PI * i) / n)));
      return { points, closed: true };
    }
    case 'ARC': {
      const r = get(entity, 40);
      const from = radians(get(entity, 50));
      let sweep = radians(get(entity, 51)) - from;
      while (sweep <= 0) sweep += 2 * Math.PI;
      return { points: arc([get(entity, 10), get(entity, 20)], r, from, sweep, fn).map(mirror), closed: false };
    }
    case 'ELLIPSE':
      return ellipse(entity, fn);
    case 'LWPOLYLINE':
      return polylinePoints(lwVertices(entity), (get(entity, 70) & 1) === 1, fn, mirror);
    case 'POLYLINE': {
      const flags = get(entity, 70);
      // 3D polylines, polyface meshes and polygon meshes have no 2D outline.
      if (flags & (8 | 16 | 64)) return undefined;
      const vertices = (entity.vertices ?? []).map((v) => ({ x: get(v, 10), y: get(v, 20), bulge: get(v, 42) }));
      return polylinePoints(vertices, (flags & 1) === 1, fn, mirror);
    }
    default:
      return undefined;
  }
}

const radians = (degrees) => (degrees * Math.PI) / 180;
const polar = ([cx, cy], r, angle) => [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];

/** Points along an arc from `from`, turning `sweep` radians (negative: clockwise), ends included. */
function arc(center, r, from, sweep, fn) {
  const steps = Math.max(1, Math.ceil((segmentsFor(r, fn) * Math.abs(sweep)) / (2 * Math.PI)));
  const points = [];
  for (let i = 0; i <= steps; i++) points.push(polar(center, r, from + (sweep * i) / steps));
  return points;
}

/** An ELLIPSE: center, the end of the major axis relative to it, the minor/major ratio, and start and end parameters. */
function ellipse(entity, fn) {
  const c = [get(entity, 10), get(entity, 20)];
  const major = [get(entity, 11), get(entity, 21)];
  const ratio = get(entity, 40, 1);
  const minor = [-major[1] * ratio, major[0] * ratio];
  const from = get(entity, 41, 0);
  let sweep = get(entity, 42, 2 * Math.PI) - from;
  while (sweep <= 0) sweep += 2 * Math.PI;
  const full = Math.abs(sweep - 2 * Math.PI) < 1e-9;
  const steps = Math.max(1, Math.ceil((segmentsFor(Math.hypot(...major), fn) * sweep) / (2 * Math.PI)));
  const points = [];
  for (let i = 0; i <= (full ? steps - 1 : steps); i++) {
    const t = from + (sweep * i) / steps;
    points.push([c[0] + Math.cos(t) * major[0] + Math.sin(t) * minor[0], c[1] + Math.cos(t) * major[1] + Math.sin(t) * minor[1]]);
  }
  return { points, closed: full };
}

/** LWPOLYLINE vertices: each 10 starts one, 20 is its y, 42 its bulge. */
function lwVertices(entity) {
  const vertices = [];
  for (const [code, value] of entity.pairs) {
    if (code === 10) vertices.push({ x: Number(value), y: 0, bulge: 0 });
    else if (code === 20 && vertices.length) vertices[vertices.length - 1].y = Number(value);
    else if (code === 42 && vertices.length) vertices[vertices.length - 1].bulge = Number(value);
  }
  return vertices;
}

/**
 * A polyline's points. A vertex's bulge curves the segment after it into an arc:
 * the tangent of a quarter of the arc's angle, positive counterclockwise.
 */
function polylinePoints(vertices, closed, fn, mirror) {
  if (vertices.length < 2) return undefined;
  const points = [];
  const segments = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < segments; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    points.push([a.x, a.y]);
    if (Math.abs(a.bulge) > 1e-12) points.push(...bulgeArc([a.x, a.y], [b.x, b.y], a.bulge, fn).slice(1, -1));
  }
  if (!closed) points.push([vertices[vertices.length - 1].x, vertices[vertices.length - 1].y]);
  return { points: points.map(mirror), closed };
}

function bulgeArc(a, b, bulge, fn) {
  const sweep = 4 * Math.atan(bulge);
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const r = chord / (2 * Math.sin(Math.abs(sweep) / 2));
  // The center sits on the chord's perpendicular bisector, on the side the arc turns toward.
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const toCenter = r * Math.cos(sweep / 2) * Math.sign(bulge);
  const normal = [-(b[1] - a[1]) / chord, (b[0] - a[0]) / chord];
  const center = [mid[0] + normal[0] * toCenter, mid[1] + normal[1] * toCenter];
  return arc(center, r, Math.atan2(a[1] - center[1], a[0] - center[0]), sweep, fn);
}

// ---------------------------------------------------------------------------
// Loose pieces into outlines: start from any piece and keep adding the piece that
// begins (or, turned around, ends) where the outline ends, until it comes back to its start.

/** @param {{ points: Points, layer: string }[]} found @returns {Points[]} */
function joinPieces(found) {
  if (found.length === 0) return [];
  const pieces = found.map((piece) => piece.points);
  const all = pieces.flat();
  const extent = Math.max(...[0, 1].map((k) => Math.max(...all.map((p) => p[k])) - Math.min(...all.map((p) => p[k]))));
  const eps = Math.max(extent * 1e-6, 1e-9);
  const same = (p, q) => Math.abs(p[0] - q[0]) <= eps && Math.abs(p[1] - q[1]) <= eps;
  const format = ([x, y]) => `(${Number(x.toFixed(4))}, ${Number(y.toFixed(4))})`;

  const left = new Set(pieces.map((_, i) => i));
  const outlines = [];
  while (left.size > 0) {
    const first = /** @type {number} */ (left.values().next().value);
    left.delete(first);
    const chain = [...pieces[first]];
    while (!(chain.length > 2 && same(chain[0], chain[chain.length - 1]))) {
      const end = chain[chain.length - 1];
      let next;
      for (const i of left) {
        const piece = pieces[i];
        if (same(piece[0], end)) next = piece;
        else if (same(piece[piece.length - 1], end)) next = [...piece].reverse();
        if (next) {
          left.delete(i);
          break;
        }
      }
      if (!next) {
        throw new Error(
          `importDXF(): an outline on layer "${found[first].layer}" is not closed: it runs from ${format(chain[0])} to ${format(end)}, where nothing continues it. Close it in the drawing, or pick only the layers with outlines (\`layer\`).`,
        );
      }
      chain.push(...next.slice(1));
    }
    chain.pop();
    outlines.push(chain);
  }
  return outlines;
}
