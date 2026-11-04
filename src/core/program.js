import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { Solid, Shape2 } from '../lib/index.js';

const LIB_URL = pathToFileURL(fileURLToPath(new URL('../lib/index.js', import.meta.url))).href;

// User programs import 'cadcode'. It must resolve to this very copy of the
// library: colors are tracked in module state, and the program's solids are
// read back by our exporters.
const cadcodePlugin = {
  name: 'cadcode',
  setup(build) {
    build.onResolve({ filter: /^cadcode$/ }, () => ({ path: LIB_URL, external: true }));
  },
};

/**
 * esbuild options that bundle a user program (and its local imports) into one ESM file.
 * Bundling lets programs import their own helper files and npm packages, and
 * gives the dev server the list of files to watch.
 */
export function bundleOptions(entry) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadcode-'));
  return {
    entryPoints: [path.resolve(entry)],
    outfile: path.join(dir, 'program.mjs'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    sourcemap: 'inline',
    metafile: true,
    logLevel: 'silent',
    plugins: [cadcodePlugin],
  };
}

/** Bundles a program once and returns the path of the bundle. */
export async function bundleProgram(entry) {
  const options = bundleOptions(entry);
  await esbuild.build(options);
  return options.outfile;
}

function flattenModel(model, partName) {
  const solids = [];
  const walk = (item) => {
    if (Array.isArray(item)) item.forEach(walk);
    else if (item instanceof Solid) solids.push(item);
    else if (item instanceof Shape2) throw new Error(`Part "${partName}" contains a 2D shape; extrude it to make a solid`);
    else if (item) throw new Error(`Part "${partName}" contains ${typeof item} ${String(item)}, not a solid`);
  };
  walk(model);
  return solids;
}

const isModel = (value) => value instanceof Solid || value instanceof Shape2 || Array.isArray(value);

/**
 * Loads a bundled program and evaluates one part.
 *
 * A program `export default`s either a model (a solid or an array of solids), or an
 * object of named parts whose values are models or functions returning models, or a
 * function of `params` returning either. `export const params = {...}` declares the
 * parameters that `overrides` may change.
 *
 * @param {string} bundlePath
 * @param {{ part?: string, overrides?: Record<string, unknown> }} [options]
 */
export async function evaluateProgram(bundlePath, { part, overrides = {} } = {}) {
  const mod = await import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`);
  if (mod.default === undefined) throw new Error('The program has no `export default`');

  const declared = mod.params ?? {};
  for (const key of Object.keys(overrides)) {
    if (!(key in declared)) throw new Error(`Unknown parameter "${key}". Declared: ${Object.keys(declared).join(', ') || 'none'}`);
  }
  const params = { ...declared, ...overrides };

  const value = typeof mod.default === 'function' ? await mod.default(params) : mod.default;
  const parts = isModel(value) ? { default: value } : value;
  if (!parts || typeof parts !== 'object') throw new Error('The default export must be a model, an object of parts, or a function returning one');

  const partNames = Object.keys(parts);
  if (partNames.length === 0) throw new Error('The program defines no parts');
  const name = part && partNames.includes(part) ? part : partNames[0];
  if (part && part !== name) throw new Error(`No part "${part}". Parts: ${partNames.join(', ')}`);

  const entry = parts[name];
  const model = typeof entry === 'function' ? await entry(params) : entry;
  return { partNames, part: name, params, solids: flattenModel(model, name) };
}

/** Parses `key=value` overrides; values are JSON when they parse, strings otherwise. */
export function parseOverrides(pairs = []) {
  const out = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq < 1) throw new Error(`Expected key=value, got "${pair}"`);
    const raw = pair.slice(eq + 1);
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw;
    }
    out[pair.slice(0, eq)] = value;
  }
  return out;
}
