// Evaluates one part of a bundled program and exports it to STL, 3MF or PNG bytes, in a worker
// thread of its own: library state a part sets while it builds (setResolution, setFit, colors)
// then cannot reach the next part of `cadcode stl --all`, and the WASM memory is freed after each.
import { parentPort, workerData } from 'node:worker_threads';
import { evaluateProgram } from './program.js';

// Bundles carry inline source maps; this makes stack traces point at the user's files.
process.setSourceMapsEnabled(true);

/** @type {{ bundle: string, part?: string, overrides: Record<string, unknown>, format: 'stl' | '3mf' | 'png', png: { width: number, height: number, view: string } }} */
const { bundle, part, overrides, format, png } = workerData;

/** @param {Awaited<ReturnType<typeof evaluateProgram>>} result @returns {Promise<Uint8Array>} */
async function encode(result) {
  if (format === 'stl') return (await import('../export/stl.js')).toSTL(result.solids);
  if (format === '3mf') return (await import('../export/3mf.js')).to3MF(result.solids, { name: result.part });
  return (await import('../export/png.js')).toPNG(result, png);
}

try {
  const result = await evaluateProgram(bundle, { part, overrides });
  const bytes = await encode(result);
  // Copied, not transferred: a small Buffer may sit in Node's shared pool.
  parentPort?.postMessage({ ok: true, part: result.part, partNames: result.partNames, bytes });
} catch (error) {
  parentPort?.postMessage({ ok: false, message: error?.message ?? String(error), stack: error?.stack });
}
