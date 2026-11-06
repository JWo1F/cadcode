import { toBytes, solidFromMesh, indexCorners } from './common.js';

/**
 * A solid from an STL file, binary or ASCII, like OpenSCAD's `import("part.stl")`.
 * `import part from './part.stl'` next to the program gives the bytes. The mesh must
 * be closed: one with holes or loose triangles fails with a message instead of being repaired.
 * @param {Uint8Array | ArrayBuffer} bytes
 * @returns {import('../shapes.js').Solid}
 */
export function importSTL(bytes) {
  const data = toBytes(bytes, 'importSTL');
  const corners = isBinary(data) ? binaryCorners(data) : asciiCorners(data);
  const { positions, triangles } = indexCorners(corners);
  return solidFromMesh(positions, triangles, 'importSTL(): the mesh');
}

/**
 * Binary STL: an 80-byte header, a triangle count, then 50 bytes per triangle.
 * Some binary files start their header with "solid" too, so the size decides.
 */
function isBinary(data) {
  if (data.length < 84) return false;
  const count = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(80, true);
  return data.length === 84 + count * 50;
}

function binaryCorners(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint32(80, true);
  const corners = new Float32Array(count * 9);
  for (let t = 0; t < count; t++) {
    // Each triangle: a normal (skipped: the corner order says the same), three corners, two attribute bytes.
    const at = 84 + t * 50 + 12;
    for (let k = 0; k < 9; k++) corners[t * 9 + k] = view.getFloat32(at + k * 4, true);
  }
  return corners;
}

function asciiCorners(data) {
  const text = new TextDecoder().decode(data);
  if (!/^\s*solid\b/.test(text)) throw new Error('importSTL(): not an STL file: it is neither binary STL nor starts with "solid"');
  const corners = [];
  const number = String.raw`([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)`;
  const vertex = new RegExp(String.raw`vertex\s+${number}\s+${number}\s+${number}`, 'g');
  for (const match of text.matchAll(vertex)) corners.push(Number(match[1]), Number(match[2]), Number(match[3]));
  if (corners.length % 9 !== 0) throw new Error('importSTL(): the ASCII STL has a facet without three vertices');
  return corners;
}
