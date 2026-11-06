// Evaluates a program in a worker thread, for the viewer's meshes or, with
// output 'stl' or '3mf', for a download. Each evaluation gets a fresh worker:
// that frees all WASM memory between runs, resets library state such as
// setResolution(), and lets the server kill a run that a newer save made stale.
import { parentPort, workerData } from 'node:worker_threads';
import { format } from 'node:util';
import { evaluateProgram } from '../core/program.js';
import { meshGroups } from '../core/mesh.js';
import { toSTL } from '../export/stl.js';
import { to3MF } from '../export/3mf.js';
import { loadMemo, memoEntries } from '../lib/memo.js';

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

const { bundle, part, overrides, output, memo } = workerData;
// What memo() built in earlier runs, kept by the server; the preview hands back what this run used.
loadMemo(memo);
const started = performance.now();
try {
  // Overrides of parameters the program has dropped are skipped; the server prunes them.
  const result = await evaluateProgram(bundle, { part, overrides, fallbackToFirst: !output, ignoreUnknown: true });
  if (output) {
    const file = output === '3mf' ? to3MF(result.solids, { name: result.part }) : toSTL(result.solids);
    parentPort.postMessage({ ok: true, partNames: result.partNames, part: result.part, file }, [file.buffer]);
  } else {
    const groups = meshGroups(result.solids, result.shapes);
    parentPort.postMessage(
      {
        ok: true,
        partNames: result.partNames,
        part: result.part,
        // Plain data only: the browser edits these as numbers, strings, booleans and JSON.
        declared: JSON.parse(JSON.stringify(result.declared)),
        groups,
        logs,
        ms: Math.round(performance.now() - started),
        memo: memoEntries(),
      },
      groups.flatMap((g) => [g.positions.buffer, g.indices.buffer, ...(g.lines ? [g.lines.buffer] : [])]),
    );
  }
} catch (error) {
  parentPort.postMessage({ ok: false, message: error?.message ?? String(error), stack: error?.stack, logs });
}
