import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { evaluateModule } from './evaluate.js';

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
  // Real paths: on macOS the temp dir is behind a symlink, and source maps would
  // otherwise resolve the program's path against the wrong base.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cadcode-')));
  return {
    entryPoints: [fs.realpathSync(entry)],
    outfile: path.join(dir, 'program.mjs'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    // The bundle runs in this very Node: esbuild then only uses what it has (e.g. no Uint8Array.fromBase64 before Node 25).
    target: `node${process.versions.node}`,
    sourcemap: 'inline',
    metafile: true,
    logLevel: 'silent',
    // `import font from './Roboto.ttf'` gives the file's bytes, for text({ font }).
    loader: { '.ttf': 'binary', '.otf': 'binary', '.woff': 'binary' },
    plugins: [cadcodePlugin],
  };
}

/** Bundles a program once and returns the path of the bundle; removeBundle deletes it. */
export async function bundleProgram(entry) {
  const options = bundleOptions(entry);
  try {
    await esbuild.build(options);
  } catch (error) {
    removeBundle(options.outfile);
    throw error;
  }
  return options.outfile;
}

/** Deletes a bundle and the temporary directory bundleOptions made for it. */
export function removeBundle(bundlePath) {
  fs.rmSync(path.dirname(bundlePath), { recursive: true, force: true });
}

/**
 * Loads a bundled program and evaluates one part; see evaluateModule.
 *
 * `fallbackToFirst` shows the first part instead of failing when `part` no longer
 * exists — the dev server uses it so renaming a part doesn't blank the preview.
 *
 * @param {string} bundlePath
 * @param {{ part?: string, overrides?: Record<string, unknown>, fallbackToFirst?: boolean }} [options]
 */
export async function evaluateProgram(bundlePath, options) {
  return evaluateModule(await import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`), options);
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
