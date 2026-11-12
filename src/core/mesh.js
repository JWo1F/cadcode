import { colorOfId, union } from '../lib/shapes.js';
import { parseColor } from '../lib/colors.js';

/**
 * @typedef {object} MeshGroup
 * @property {number} body index of the solid this group came from
 * @property {[number, number, number, number] | null} color RGBA in 0..1, null when uncolored
 * @property {Float32Array} positions xyz per vertex
 * @property {Uint32Array} indices three per triangle
 * @property {true} [sketch] a 2D shape: a flat, unlit fill drawn with its outline
 * @property {true} [guide] with `sketch`: a sketch's construction lines, drawn dashed with no fill;
 *   its positions are the lines' ends, for the bounds, and it has no triangles
 * @property {Float32Array} [lines] sketch only: the outline, xyz of both ends per segment
 */

// 2D shapes are drawn like a sketch in a CAD program: a see-through fill on Z=0
// and a bold outline, in a blue no solid is given by default.
export const SKETCH_COLOR = parseColor('#1f6fd1', 0.18);

// A sketch's guides: thin dashed lines in a color apart from the outlines and the default yellow.
export const GUIDE_COLOR = parseColor('#d6336c', 1);

/**
 * Splits each solid's mesh into groups of one color each, for rendering.
 * 2D shapes become one sketch group each, after the solids' groups; then each sketch
 * gives a group per outline, placed on its frame, and one for its guides.
 * @param {import('../lib/shapes.js').Solid[]} solids
 * @param {import('../lib/shapes.js').Shape2[]} [shapes]
 * @param {import('../lib/sketch.js').Sketch[]} [sketches]
 * @returns {MeshGroup[]}
 */
export function meshGroups(solids, shapes = [], sketches = []) {
  const groups = [];
  solids.forEach((solid, body) => {
    const mesh = solid.manifold.getMesh();
    const { runIndex, runOriginalID, triVerts } = mesh;

    /** @type {Map<string, { color: any, tris: number[] }>} */
    const byColor = new Map();
    for (let run = 0; run < runOriginalID.length; run++) {
      const color = colorOfId(runOriginalID[run]) ?? null;
      const key = color ? color.join(',') : '';
      if (!byColor.has(key)) byColor.set(key, { color, tris: [] });
      const tris = byColor.get(key).tris;
      for (let i = runIndex[run]; i < runIndex[run + 1]; i++) tris.push(triVerts[i]);
    }
    for (const { color, tris } of byColor.values()) groups.push(meshGroup(mesh, tris, body, color));
  });
  shapes.forEach((shape, i) => groups.push(sketchGroup(shape, solids.length + i)));
  sketches.forEach((sketch, i) => {
    const body = solids.length + shapes.length + i;
    const { matrix } = sketch.frame;
    for (const profile of sketch.profiles) groups.push(placed(sketchGroup(profile, body), matrix));
    const lines = guideLines(sketch);
    if (lines.length) groups.push(placed({ body, color: GUIDE_COLOR, positions: new Float32Array(lines), indices: new Uint32Array(0), sketch: true, guide: true, lines: new Float32Array(lines) }, matrix));
  });
  return groups;
}

/** Moves a group drawn in a frame's u, v onto the frame. */
function placed(group, m) {
  const move = (xyz) => {
    for (let i = 0; i < xyz.length; i += 3) {
      const [x, y, z] = [xyz[i], xyz[i + 1], xyz[i + 2]];
      xyz[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
      xyz[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      xyz[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }
  };
  move(group.positions);
  if (group.lines) move(group.lines);
  return group;
}

const CIRCLE_SEGMENTS = 72;

/**
 * A sketch's guides as segments on z = 0 of its frame, xyz of both ends: lines over their stretch,
 * endless ones across the sketch, circles, and a small cross on each marked point. "Across the sketch"
 * is everything else in it with a tenth of its size spare on every side.
 * @param {import('../lib/sketch.js').Sketch} sketch
 * @returns {number[]}
 */
function guideLines(sketch) {
  const lines = sketch.guides.filter((g) => 'start' in g);
  const circles = sketch.guides.filter((g) => 'r' in g);
  const corners = [
    ...lines.flatMap((l) => (l.endless ? [l.start] : [l.start, l.end])),
    ...circles.flatMap(({ center: [x, y], r }) => [[x - r, y - r], [x + r, y + r]]),
    ...sketch.points,
    ...sketch.profiles.flatMap((p) => {
      const { min, max } = p.bounds();
      return p.isEmpty() ? [] : [min, max];
    }),
  ];
  if (corners.length === 0) return [];
  const min = [Math.min(...corners.map((c) => c[0])), Math.min(...corners.map((c) => c[1]))];
  const max = [Math.max(...corners.map((c) => c[0])), Math.max(...corners.map((c) => c[1]))];
  const size = Math.hypot(max[0] - min[0], max[1] - min[1]) || 10;
  const spare = size / 10;
  const box = { min: [min[0] - spare, min[1] - spare], max: [max[0] + spare, max[1] + spare] };

  const out = [];
  const segment = (a, b) => out.push(a[0], a[1], 0, b[0], b[1], 0);
  for (const line of lines) {
    if (!line.endless) segment(line.start, line.end);
    else {
      const ends = across(line.start, line.direction, box);
      if (ends) segment(...ends);
    }
  }
  for (const { center, r } of circles) {
    const at = (k) => [center[0] + r * Math.cos((2 * Math.PI * k) / CIRCLE_SEGMENTS), center[1] + r * Math.sin((2 * Math.PI * k) / CIRCLE_SEGMENTS)];
    for (let k = 0; k < CIRCLE_SEGMENTS; k++) segment(at(k), at(k + 1));
  }
  const arm = size / 60;
  for (const [x, y] of sketch.points) {
    segment([x - arm, y - arm], [x + arm, y + arm]);
    segment([x - arm, y + arm], [x + arm, y - arm]);
  }
  return out;
}

/** Where an endless line through `p` along `d` enters and leaves a box, or null if it misses it. */
function across(p, d, { min, max }) {
  let enter = -Infinity;
  let leave = Infinity;
  for (let k = 0; k < 2; k++) {
    if (Math.abs(d[k]) < 1e-12) {
      if (p[k] < min[k] || p[k] > max[k]) return null;
      continue;
    }
    const [a, b] = [(min[k] - p[k]) / d[k], (max[k] - p[k]) / d[k]];
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
  }
  if (enter > leave) return null;
  return [[p[0] + d[0] * enter, p[1] + d[1] * enter], [p[0] + d[0] * leave, p[1] + d[1] * leave]];
}

/** A 2D shape's group: the bottom face of a unit extrusion, turned to face up, and the outline. */
function sketchGroup(shape, body) {
  const mesh = shape.extrude(1).manifold.getMesh();
  const { numProp, vertProperties, triVerts } = mesh;
  const z = (v) => vertProperties[v * numProp + 2];
  const tris = [];
  for (let t = 0; t < triVerts.length; t += 3) {
    const [a, b, c] = [triVerts[t], triVerts[t + 1], triVerts[t + 2]];
    if (z(a) === 0 && z(b) === 0 && z(c) === 0) tris.push(a, c, b);
  }
  const lines = [];
  for (const loop of shape.toPolygons()) {
    loop.forEach(([x, y], k) => {
      const [nx, ny] = loop[(k + 1) % loop.length];
      lines.push(x, y, 0, nx, ny, 0);
    });
  }
  return { ...meshGroup(mesh, tris, body, SKETCH_COLOR), sketch: true, lines: new Float32Array(lines) };
}

/** One group from the given triangle corners of a mesh, with its vertices renumbered from 0. */
function meshGroup({ numProp, vertProperties }, tris, body, color) {
  const remap = new Map();
  const positions = [];
  const indices = new Uint32Array(tris.length);
  for (let i = 0; i < tris.length; i++) {
    const v = tris[i];
    let n = remap.get(v);
    if (n === undefined) {
      n = remap.size;
      remap.set(v, n);
      positions.push(vertProperties[v * numProp], vertProperties[v * numProp + 1], vertProperties[v * numProp + 2]);
    }
    indices[i] = n;
  }
  return { body, color, positions: new Float32Array(positions), indices };
}

/** Bounding box over all groups. */
export function groupBounds(groups) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const { positions } of groups) {
    for (let i = 0; i < positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], positions[i + k]);
        max[k] = Math.max(max[k], positions[i + k]);
      }
    }
  }
  return { min, max };
}

/** The solids of a part merged into one, as written to STL. */
export function mergedSolid(solids) {
  return union(solids);
}
