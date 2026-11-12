/**
 * The distinct ArrayBuffers behind mesh groups' arrays (positions, indices and a
 * sketch's lines), to hand them to or from a worker without copying them.
 * @param {{ positions: Float32Array, indices: Uint32Array, lines?: Float32Array }[]} groups
 * @returns {ArrayBuffer[]}
 */
export function groupBuffers(groups) {
  return [...new Set(groups.flatMap((g) => [g.positions.buffer, g.indices.buffer, ...(g.lines ? [g.lines.buffer] : [])]))];
}
