#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Worker } from 'node:worker_threads';
import { bundleProgram, evaluateProgram, parseOverrides, removeBundle } from './core/program.js';

process.setSourceMapsEnabled(true);

const USAGE = `cadcode — code-first CAD

Usage:
  cadcode dev <file>    Live preview in the browser; reloads on save
  cadcode stl <file>    Export a part to binary STL
  cadcode 3mf <file>    Export a part to 3MF, its solids and colors kept apart
  cadcode png <file>    Render a part to a PNG preview
  cadcode parts <file>  List the parts a program defines

Options:
  -p, --part <name>     Part to use (default: the first one)
  -a, --all             stl/3mf/png: export every part
  -s, --set <k=v>       Override a parameter (repeatable); values are JSON or strings
  -o, --out <path>      Output file, or directory with --all
      --view <name>     png: iso, iso-back, front, back, left, right, top, bottom, sheet (default: iso)
      --size <WxH>      png: image size (default: 800x600)
      --port <n>        dev: port (default: 5173)
      --host <addr>     dev: address to bind (default: 127.0.0.1)
      --open            dev: open the browser
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    part: { type: 'string', short: 'p' },
    all: { type: 'boolean', short: 'a' },
    set: { type: 'string', short: 's', multiple: true },
    out: { type: 'string', short: 'o' },
    view: { type: 'string', default: 'iso' },
    size: { type: 'string', default: '800x600' },
    port: { type: 'string', default: '5173' },
    host: { type: 'string', default: '127.0.0.1' },
    open: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

const [command, file] = positionals;

async function main() {
  if (values.help || !command) return void process.stdout.write(USAGE);
  if (!file) throw new Error(`Missing <file>. Try: cadcode ${command} model.js`);
  if (!fs.existsSync(file)) throw new Error(`No such file: ${file}`);
  const overrides = parseOverrides(values.set);

  if (command === 'dev') {
    const { startDevServer } = await import('./dev/server.js');
    return startDevServer({ file, port: Number(values.port), host: values.host, part: values.part, overrides, open: values.open });
  }

  if (!['parts', 'stl', '3mf', 'png'].includes(command)) throw new Error(`Unknown command "${command}"\n\n${USAGE}`);
  const png = command === 'png' ? pngOptions() : undefined;
  const bundle = await bundleProgram(file);
  try {
    if (command === 'parts') return void console.log((await evaluateProgram(bundle, { part: values.part, overrides })).partNames.join('\n'));
    await exportParts(command, bundle, overrides, png);
  } finally {
    removeBundle(bundle);
  }
}

function pngOptions() {
  const [width, height] = values.size.split('x').map(Number);
  if (!width || !height) throw new Error(`--size must look like 800x600, got "${values.size}"`);
  return { width, height, view: values.view };
}

/**
 * Evaluates one part and exports it in a worker of its own, so a part that calls setResolution() or
 * setFit() cannot change the parts exported after it.
 * @returns {Promise<{ part: string, partNames: string[], bytes: Uint8Array }>}
 */
function exportInWorker(bundle, part, overrides, format, png) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./core/export-worker.js', import.meta.url), { workerData: { bundle, part, overrides, format, png } });
    worker.once('message', (message) => {
      if (message.ok) return resolve(message);
      const error = new Error(message.message);
      error.stack = message.stack;
      reject(error);
    });
    worker.once('error', reject);
    worker.once('exit', (code) => reject(new Error(`the export worker stopped (exit code ${code})`)));
  });
}

async function exportParts(format, bundle, overrides, png) {
  const base = path.basename(file).replace(/\.[^.]+$/, '');
  const write = (result) => {
    const name = result.partNames.length > 1 ? `${base}-${result.part}.${format}` : `${base}.${format}`;
    const out = values.all ? path.join(values.out ?? '.', name) : (values.out ?? name);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, result.bytes);
    return out;
  };

  let started = performance.now();
  const first = await exportInWorker(bundle, values.part, overrides, format, png);
  console.log(`${first.part} → ${write(first)} (${Math.round(performance.now() - started)} ms)`);
  if (!values.all) return;
  for (const part of first.partNames.filter((name) => name !== first.part)) {
    started = performance.now();
    const result = await exportInWorker(bundle, part, overrides, format, png);
    console.log(`${part} → ${write(result)} (${Math.round(performance.now() - started)} ms)`);
  }
}

const OWN_SOURCES = path.dirname(new URL(import.meta.url).pathname);

main().catch((error) => {
  console.error(`cadcode: ${error.message}`);
  // Point at the user's code: the first stack frame outside cadcode itself.
  const where = error.stack?.split('\n').find((line) => line.trim().startsWith('at ') && !line.includes(OWN_SOURCES));
  if (where) console.error(`  ${where.trim()}`);
  if (process.env.CADCODE_DEBUG) console.error(error.stack);
  process.exit(1);
});
