// Evaluates a program in a worker thread. Each evaluation gets a fresh worker:
// that frees all WASM memory between runs, resets library state such as
// setResolution(), and lets the server kill a run that a newer save made stale.
import { parentPort, workerData } from 'node:worker_threads';
import { format } from 'node:util';
import { evaluateProgram } from '../core/program.js';
import { meshGroups } from '../core/mesh.js';

// Bundles carry inline source maps; this makes stack traces point at the user's files.
process.setSourceMapsEnabled(true);

const logs = [];
for (const level of ['log', 'info', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    logs.push({ level, text: format(...args) });
    original(...args);
  };
}

const { bundle, part, overrides } = workerData;
const started = performance.now();
try {
  const result = await evaluateProgram(bundle, { part, overrides, fallbackToFirst: true });
  const groups = meshGroups(result.solids);
  parentPort.postMessage(
    {
      ok: true,
      partNames: result.partNames,
      part: result.part,
      groups,
      logs,
      ms: Math.round(performance.now() - started),
    },
    groups.flatMap((g) => [g.positions.buffer, g.indices.buffer]),
  );
} catch (error) {
  parentPort.postMessage({ ok: false, message: error?.message ?? String(error), stack: error?.stack, logs });
}
