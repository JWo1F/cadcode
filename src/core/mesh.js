import { colorOfId, union } from '../lib/shapes.js';

/**
 * @typedef {object} MeshGroup
 * @property {number} body index of the solid this group came from
 * @property {[number, number, number, number] | null} color RGBA in 0..1, null when uncolored
 * @property {Float32Array} positions xyz per vertex
 * @property {Uint32Array} indices three per triangle
 */

/**
 * Splits each solid's mesh into groups of one color each, for rendering.
 * @param {import('../lib/shapes.js').Solid[]} solids
 * @returns {MeshGroup[]}
 */
export function meshGroups(solids) {
  const groups = [];
  solids.forEach((solid, body) => {
    const mesh = solid.manifold.getMesh();
    const { numProp, vertProperties, triVerts, runIndex, runOriginalID } = mesh;

    /** @type {Map<string, { color: any, tris: number[] }>} */
    const byColor = new Map();
    for (let run = 0; run < runOriginalID.length; run++) {
      const color = colorOfId(runOriginalID[run]) ?? null;
      const key = color ? color.join(',') : '';
      if (!byColor.has(key)) byColor.set(key, { color, tris: [] });
      const tris = byColor.get(key).tris;
      for (let i = runIndex[run]; i < runIndex[run + 1]; i++) tris.push(triVerts[i]);
    }

    for (const { color, tris } of byColor.values()) {
      const remap = new Map();
      const positions = [];
      const indices = new Uint32Array(tris.length);
      tris.forEach((v, i) => {
        let n = remap.get(v);
        if (n === undefined) {
          n = remap.size;
          remap.set(v, n);
          positions.push(vertProperties[v * numProp], vertProperties[v * numProp + 1], vertProperties[v * numProp + 2]);
        }
        indices[i] = n;
      });
      groups.push({ body, color, positions: new Float32Array(positions), indices });
    }
  });
  return groups;
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
