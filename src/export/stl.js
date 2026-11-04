import { mergedSolid } from '../core/mesh.js';

/**
 * Binary STL of the part's solids merged into one.
 * @param {import('../lib/shapes.js').Solid[]} solids
 * @returns {Buffer}
 */
export function toSTL(solids) {
  const { numProp, vertProperties, triVerts } = mergedSolid(solids).manifold.getMesh();
  const triCount = triVerts.length / 3;
  const buf = Buffer.alloc(84 + triCount * 50);
  buf.write('cadcode', 0, 'ascii');
  buf.writeUInt32LE(triCount, 80);

  const p = (v, k) => vertProperties[v * numProp + k];
  let o = 84;
  for (let t = 0; t < triCount; t++) {
    const [a, b, c] = [triVerts[t * 3], triVerts[t * 3 + 1], triVerts[t * 3 + 2]];
    const u = [p(b, 0) - p(a, 0), p(b, 1) - p(a, 1), p(b, 2) - p(a, 2)];
    const w = [p(c, 0) - p(a, 0), p(c, 1) - p(a, 1), p(c, 2) - p(a, 2)];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const len = Math.hypot(...n) || 1;
    for (const value of [n[0] / len, n[1] / len, n[2] / len]) (buf.writeFloatLE(value, o), (o += 4));
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) (buf.writeFloatLE(p(v, k), o), (o += 4));
    o += 2; // attribute byte count
  }
  return buf;
}
