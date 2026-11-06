// What the importers share: reading their input, and turning a triangle mesh into a solid.
import { Manifold, Mesh, Solid } from '../shapes.js';

/**
 * A file's bytes, from what `import x from './file'` gives or from `fetch`.
 * @param {Uint8Array | ArrayBuffer} input
 * @param {string} caller for the error message, e.g. 'importSTL'
 * @returns {Uint8Array}
 */
export function toBytes(input, caller) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new Error(`${caller}(): expected a file's bytes, e.g. \`import file from './part.stl'\`, got ${describe(input)}`);
}

/**
 * A text file's contents: a string, or its bytes as UTF-8.
 * @param {string | Uint8Array | ArrayBuffer} input
 * @param {string} caller
 * @returns {string}
 */
export function toText(input, caller) {
  if (typeof input === 'string') return input;
  if (input instanceof Uint8Array || input instanceof ArrayBuffer) return new TextDecoder().decode(input);
  throw new Error(`${caller}(): expected the file's text or bytes, got ${describe(input)}`);
}

const describe = (value) => (value === null ? 'null' : Array.isArray(value) ? 'an array' : typeof value);

/**
 * A solid from triangles that list their corners counterclockwise seen from outside.
 * Corners at the same position become one vertex, so files that repeat them per
 * triangle (STL, most 3MF exporters do not) still close up. A mesh that does not
 * enclose a volume fails with the number of edges that have no neighbour.
 *
 * `runs`, when given, splits the triangles into consecutive runs with their own
 * manifold original ID: that is how colors travel (see reserveColorIds).
 * @param {Float32Array} positions xyz per vertex
 * @param {Uint32Array} triangles three vertex indices per triangle
 * @param {string} what names the mesh in errors, e.g. 'importSTL(): the mesh'
 * @param {{ index: Uint32Array, ids: Uint32Array }} [runs]
 * @returns {Solid}
 */
export function solidFromMesh(positions, triangles, what, runs) {
  if (triangles.length === 0) throw new Error(`${what} has no triangles`);
  const mesh = new Mesh({
    numProp: 3,
    vertProperties: positions,
    triVerts: triangles,
    ...(runs && { runIndex: runs.index, runOriginalID: runs.ids }),
  });
  mesh.merge();
  let manifold;
  let status;
  try {
    manifold = new Manifold(mesh);
    status = manifold.status();
  } catch (error) {
    status = error?.message ?? String(error);
  }
  if (status !== 'NoError') {
    const open = openEdges(mesh);
    const detail = open > 0 ? `${open} edge${open === 1 ? '' : 's'} with no neighbouring triangle` : String(status);
    throw new Error(`${what} is not a closed solid (${detail}). Repair it, e.g. in a slicer or a mesh editor, and export it again.`);
  }
  // A closed mesh whose triangles all face inward passes the checks above with a negative volume.
  if (manifold.volume() < 0) throw new Error(`${what} is inside out: its triangles face inward. Flip its normals in a mesh editor and export it again.`);
  return new Solid(manifold);
}

/** Edges used by one triangle only, after the vertices merge() joins. */
function openEdges({ triVerts, mergeFromVert, mergeToVert }) {
  const to = new Map();
  for (let i = 0; i < mergeFromVert.length; i++) to.set(mergeFromVert[i], mergeToVert[i]);
  const vertex = (v) => to.get(v) ?? v;
  const edges = new Map();
  for (let t = 0; t < triVerts.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = vertex(triVerts[t + k]);
      const b = vertex(triVerts[t + ((k + 1) % 3)]);
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const count of edges.values()) if (count === 1) open++;
  return open;
}

/**
 * Joins vertices at exactly the same position, for formats that repeat them per triangle.
 * @param {ArrayLike<number>} corners xyz per triangle corner
 * @returns {{ positions: Float32Array, triangles: Uint32Array }}
 */
export function indexCorners(corners) {
  const index = new Map();
  const positions = [];
  const triangles = new Uint32Array(corners.length / 3);
  const f32 = new Float32Array(3);
  for (let c = 0; c < triangles.length; c++) {
    f32[0] = corners[c * 3];
    f32[1] = corners[c * 3 + 1];
    f32[2] = corners[c * 3 + 2];
    const key = `${f32[0]},${f32[1]},${f32[2]}`;
    let v = index.get(key);
    if (v === undefined) {
      v = index.size;
      index.set(key, v);
      positions.push(f32[0], f32[1], f32[2]);
    }
    triangles[c] = v;
  }
  return { positions: new Float32Array(positions), triangles };
}
