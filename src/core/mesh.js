import { colorOfId, union } from '../lib/shapes.js';
import { parseColor } from '../lib/colors.js';

/**
 * @typedef {object} MeshGroup
 * @property {number} body index of the solid this group came from
 * @property {[number, number, number, number] | null} color RGBA in 0..1, null when uncolored
 * @property {Float32Array} positions xyz per vertex
 * @property {Uint32Array} indices three per triangle
 */

// 2D shapes have no thickness to draw, so the preview shows them as a thin slab
// standing on Z=0, in a color of their own so they read apart from default-gold solids.
const FLAT_THICKNESS = 0.1;
const FLAT_COLOR = parseColor('#4fa3a5');

/**
 * Splits each solid's mesh into groups of one color each, for rendering.
 * 2D shapes become one group each, after the solids' groups.
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
  shapes.forEach((shape, i) => {
    const mesh = shape.extrude(FLAT_THICKNESS).manifold.getMesh();
    groups.push(meshGroup(mesh, mesh.triVerts, solids.length + i, FLAT_COLOR));
  });
  return groups;
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
