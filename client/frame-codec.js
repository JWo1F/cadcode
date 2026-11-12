// The dev server's model frames, encoded by src/dev/server.js and decoded by
// client/viewer.js. Free of Node and DOM APIs, so both sides import it.
//
// A frame is binary: a little-endian u32 header length, a JSON header padded with
// spaces to 4 bytes, then each group's positions (f32), indices (u32) and, when it
// has one, its sketch outline (f32). The header's `groups` lists each group's fields
// and the lengths of its arrays.

/**
 * @param {Record<string, unknown>} header everything but the groups; `groups` is added
 * @param {{ positions: Float32Array, indices: Uint32Array, lines?: Float32Array, body?: number, color?: number[], sketch?: boolean, guide?: boolean }[]} groups
 * @returns {Uint8Array}
 */
export function encodeFrame(header, groups) {
  const described = {
    ...header,
    groups: groups.map((g) => ({
      body: g.body,
      color: g.color,
      sketch: g.sketch,
      guide: g.guide,
      vertices: g.positions.length / 3,
      indices: g.indices.length,
      lines: g.lines?.length ?? 0,
    })),
  };
  const json = new TextEncoder().encode(JSON.stringify(described));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const arrays = groups.flatMap((g) => [g.positions, g.indices, ...(g.lines ? [g.lines] : [])]);
  const out = new Uint8Array(4 + jsonLength + arrays.reduce((n, a) => n + a.byteLength, 0));
  new DataView(out.buffer).setUint32(0, jsonLength, true);
  out.fill(0x20, 4, 4 + jsonLength);
  out.set(json, 4);
  let offset = 4 + jsonLength;
  for (const array of arrays) {
    out.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), offset);
    offset += array.byteLength;
  }
  return out;
}

/**
 * The header and the groups of a frame. The groups' arrays are views into `buffer`;
 * `lines` is set only on sketches.
 * @param {ArrayBuffer} buffer
 */
export function decodeFrame(buffer) {
  const headerLength = new DataView(buffer).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength)));
  let offset = 4 + headerLength;
  const groups = header.groups.map((g) => {
    const positions = new Float32Array(buffer, offset, g.vertices * 3);
    offset += positions.byteLength;
    const indices = new Uint32Array(buffer, offset, g.indices);
    offset += indices.byteLength;
    const lines = new Float32Array(buffer, offset, g.lines);
    offset += lines.byteLength;
    return { ...g, positions, indices, lines: g.sketch ? lines : undefined };
  });
  return { header, groups };
}
