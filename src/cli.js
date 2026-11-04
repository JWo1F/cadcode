#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { bundleProgram, evaluateProgram, parseOverrides } from './core/program.js';

const USAGE = `cadcode — code-first CAD

Usage:
  cadcode dev <file>    Live preview in the browser; reloads on save
  cadcode stl <file>    Export a part to binary STL
  cadcode png <file>    Render a part to a PNG preview
  cadcode parts <file>  List the parts a program defines

Options:
  -p, --part <name>     Part to use (default: the first one)
  -a, --all             stl/png: export every part
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

  const bundle = await bundleProgram(file);
  const first = await evaluateProgram(bundle, { part: values.part, overrides });

  if (command === 'parts') return void console.log(first.partNames.join('\n'));
  if (command !== 'stl' && command !== 'png') throw new Error(`Unknown command "${command}"\n\n${USAGE}`);

  const ext = command;
  const base = path.basename(file).replace(/\.[^.]+$/, '');
  const parts = values.all ? first.partNames : [first.part];
  for (const part of parts) {
    const result = part === first.part ? first : await evaluateProgram(bundle, { part, overrides });
    const name = parts.length > 1 || first.partNames.length > 1 ? `${base}-${part}.${ext}` : `${base}.${ext}`;
    const out = values.all ? path.join(values.out ?? '.', name) : (values.out ?? name);
    fs.mkdirSync(path.dirname(out), { recursive: true });

    const started = performance.now();
    if (ext === 'stl') {
      const { toSTL } = await import('./export/stl.js');
      fs.writeFileSync(out, toSTL(result.solids));
    } else {
      const { toPNG } = await import('./export/png.js');
      const [width, height] = values.size.split('x').map(Number);
      if (!width || !height) throw new Error(`--size must look like 800x600, got "${values.size}"`);
      fs.writeFileSync(out, toPNG(result.solids, { width, height, view: values.view }));
    }
    console.log(`${part} → ${out} (${Math.round(performance.now() - started)} ms)`);
  }
}

main().catch((error) => {
  console.error(`cadcode: ${error.message}`);
  if (process.env.CADCODE_DEBUG) console.error(error.stack);
  process.exit(1);
});
