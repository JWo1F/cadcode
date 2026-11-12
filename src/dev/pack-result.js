// What an evaluation worker posts for a run that succeeded, shared by the dev server's
// worker (src/dev/worker.js) and the playground's (site/src/eval-worker.js): the
// exported file for a download, or the mesh groups for the view.
import { meshGroups } from '../core/mesh.js';
import { toSTL } from '../export/stl.js';
import { to3MF } from '../export/3mf.js';
import { groupBuffers } from '../../client/mesh-buffers.js';

/**
 * @param {{ solids: any[], shapes: any[], sketches: any[], part: string, partNames: string[] }} result what evaluateModule returned
 * @param {'stl' | '3mf' | undefined} output the format of a download, or nothing for the view
 * @returns {{ message: { ok: true, part: string, partNames: string[], file?: Uint8Array, groups?: ReturnType<typeof meshGroups> }, transfer: ArrayBuffer[] }}
 *   the message, which the caller may add to, and the buffers to transfer with it
 */
export function packResult(result, output) {
  const base = { ok: /** @type {const} */ (true), partNames: result.partNames, part: result.part };
  if (output) {
    const file = output === '3mf' ? to3MF(result.solids, { name: result.part }) : toSTL(result.solids);
    return { message: { ...base, file }, transfer: [/** @type {ArrayBuffer} */ (file.buffer)] };
  }
  const groups = meshGroups(result.solids, result.shapes, result.sketches);
  return { message: { ...base, groups }, transfer: groupBuffers(groups) };
}
