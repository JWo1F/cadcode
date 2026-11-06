// Evaluates the playground's code, for the view's meshes or, with output 'stl',
// for a download. Like the dev server, every evaluation gets a fresh worker:
// that frees the WASM memory and resets library state such as setResolution().
import * as cadcode from '../../src/lib/index.js';
import { evaluateModule } from '../../src/core/evaluate.js';
import { meshGroups } from '../../src/core/mesh.js';
import { toSTL } from '../../src/export/stl.js';

// The code is loaded from a blob URL, where a bare `'cadcode'` cannot resolve.
// It is pointed at a module re-exporting this worker's copy of the library:
// solids must come from the same copy that evaluateModule and the exporters read.
self.cadcode = cadcode;
const shim = Object.keys(cadcode)
  .map((name) => `export const ${name} = self.cadcode.${name};`)
  .join('\n');
const SHIM_URL = URL.createObjectURL(new Blob([shim], { type: 'text/javascript' }));

const logs = [];
const show = (value) => (typeof value === 'string' ? value : value instanceof Error ? value.stack : JSON.stringify(value) ?? String(value));
for (const level of ['log', 'info', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    logs.push({ level, text: args.map(show).join(' ') });
    original(...args);
  };
}

self.onmessage = async ({ data: { code, part, output } }) => {
  const started = performance.now();
  const source = code.replace(/(\bfrom\s*|\bimport\s*\(\s*)(['"])cadcode\2/g, `$1"${SHIM_URL}"`);
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    const result = await evaluateModule(await import(url), { part, fallbackToFirst: output !== 'stl' });
    if (output === 'stl') {
      const stl = toSTL(result.solids);
      self.postMessage({ ok: true, partNames: result.partNames, part: result.part, stl }, [stl.buffer]);
    } else {
      const groups = meshGroups(result.solids, result.shapes);
      self.postMessage(
        { ok: true, partNames: result.partNames, part: result.part, groups, logs, ms: Math.round(performance.now() - started) },
        groups.flatMap((g) => [g.positions.buffer, g.indices.buffer]),
      );
    }
  } catch (error) {
    // Stack frames name the blob URL; the person reading them knows the code as the editor.
    const stack = error?.stack?.replaceAll(url, 'program.js');
    self.postMessage({ ok: false, message: error?.message ?? String(error), stack, logs });
  }
};

// The library's import awaits its WASM, and a message posted before this handler
// existed would be lost; the page waits for this before sending the code.
self.postMessage({ ready: true });
