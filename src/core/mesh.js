import { colorOfId, union } from '../lib/shapes.js';
import { parseColor } from '../lib/colors.js';

/**
 * @typedef {object} MeshGroup
 * @property {number} body index of the solid this group came from
 * @property {[number, number, number, number] | null} color RGBA in 0..1, null when uncolored
 * @property {Float32Array} positions xyz per vertex
 * @property {Uint32Array} indices three per triangle
 * @property {true} [sketch] a 2D shape: a flat, unlit fill on Z=0 drawn with its outline
 * @property {Float32Array} [lines] sketch only: the outline, xyz of both ends per segment
 */

// 2D shapes are drawn like a sketch in a CAD program: a see-through fill on Z=0
// and a bold outline, in a blue no solid is given by default.
export const SKETCH_COLOR = parseColor('#1f6fd1', 0.18);

/**
 * Splits each solid's mesh into groups of one color each, for rendering.
 * 2D shapes become one sketch group each, after the solids' groups.
 * @param {import('../lib/shapes.js').Solid[]} solids
 * @param {import('../lib/shapes.js').Shape2[]} [shapes]
 * @returns {MeshGroup[]}
 */
export function meshGroups(solids, shapes = []) {
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
  return groups;
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
