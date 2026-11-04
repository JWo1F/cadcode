// Builds the site into site/dist: the landing page with a gallery rendered from
// examples/, and the playground with Monaco and the library bundled for the browser.
//
//   node site/build.js
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { renderReference } from './reference/render.js';

const SITE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(SITE);
const DIST = path.join(SITE, 'dist');
const ASSETS = path.join(DIST, 'assets');
const EXAMPLES = path.join(ROOT, 'examples');
const CLI = path.join(ROOT, 'src/cli.js');

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(ASSETS, { recursive: true });

// The reference, rendered from site/reference/content.js. First, because it fails the
// build when an export is undocumented, and the rest takes a while.
const reference = renderReference();

// Every example opens with a frontmatter block — `key: value` lines between /*--- and ---*/ —
// that names it for the gallery. The playground gets the code without it.
const FRONTMATTER = /^\/\*---\n([\s\S]*?)\n---\*\/\n/;

const readExample = (file) => {
  const source = fs.readFileSync(path.join(EXAMPLES, file), 'utf8');
  const match = source.match(FRONTMATTER);
  if (!match) throw new Error(`examples/${file} has no frontmatter`);
  const meta = Object.fromEntries(
    match[1].split('\n').map((line) => {
      const colon = line.indexOf(':');
      return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
    }),
  );
  for (const key of ['title', 'description']) if (!meta[key]) throw new Error(`examples/${file} has no ${key} in its frontmatter`);
  return { meta, code: source.slice(match[0].length) };
};

const exampleFiles = Object.fromEntries(
  fs
    .readdirSync(EXAMPLES)
    .filter((file) => file.endsWith('.js'))
    .sort()
    .map((file) => [file.replace(/\.js$/, ''), readExample(file)]),
);

// Examples, for the playground's picker: the code, and the title and description it shows.
const examples = Object.fromEntries(Object.entries(exampleFiles).map(([name, { code }]) => [name, code]));
const catalog = Object.fromEntries(Object.entries(exampleFiles).map(([name, { meta }]) => [name, { title: meta.title, description: meta.description }]));

// The library's typings, generated from its JSDoc, for the editor's completion and hovers.
const typesDir = fs.mkdtempSync(path.join(DIST, '.types-'));
execFileSync(
  'npx',
  ['tsc', path.join(ROOT, 'src/lib/index.js'), '--allowJs', '--declaration', '--emitDeclarationOnly', '--skipLibCheck',
    '--target', 'es2022', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--outDir', typesDir],
  { stdio: 'inherit', cwd: ROOT },
);
const typings = Object.fromEntries(fs.readdirSync(typesDir).map((file) => [file, fs.readFileSync(path.join(typesDir, file), 'utf8')]));
fs.rmSync(typesDir, { recursive: true });

const virtualModules = (modules) => ({
  name: 'virtual-modules',
  setup(build) {
    build.onResolve({ filter: /^virtual:/ }, (args) => ({ path: args.path, namespace: 'virtual' }));
    build.onLoad({ filter: /.*/, namespace: 'virtual' }, (args) => ({ contents: JSON.stringify(modules[args.path]), loader: 'json' }));
  },
});

const monaco = (file) => path.join(ROOT, 'node_modules/monaco-editor/esm/vs', file);

// Every script and stylesheet is named by its content's hash. Pages serves them with a
// 10-minute cache, and an unchanged name would keep a browser on the previous build's
// code — with the previous build's list of examples.
const bundle = async (entryPoints, modules = {}) => {
  const result = await esbuild.build({ ...bundleOptions, entryPoints, plugins: [virtualModules(modules)] });
  const outputs = {};
  for (const [file, output] of Object.entries(result.metafile.outputs)) {
    if (!output.entryPoint) continue;
    outputs[output.entryPoint] = path.basename(file);
    if (output.cssBundle) outputs[`${output.entryPoint}.css`] = path.basename(output.cssBundle);
  }
  return (entry, ext = '') => outputs[`${path.relative(ROOT, entryPoints[entry])}${ext}`];
};

const bundleOptions = {
  outdir: ASSETS,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  entryNames: '[name]-[hash]',
  chunkNames: 'chunk-[hash]',
  metafile: true,
  loader: { '.ttf': 'file' },
  // manifold's Emscripten glue imports these only when it runs under Node.
  external: ['module', 'node:module', 'fs', 'path', 'url', 'worker_threads'],
  logLevel: 'warning',
};

// Workers first: the playground needs their names.
const workerEntries = {
  'eval-worker': path.join(SITE, 'src/eval-worker.js'),
  'render-worker': path.join(ROOT, 'client/render-worker.js'),
  'editor.worker': monaco('editor/editor.worker.js'),
  'ts.worker': monaco('language/typescript/ts.worker.js'),
};
const worker = await bundle(workerEntries);
const workers = Object.fromEntries(Object.keys(workerEntries).map((name) => [name, worker(name)]));

const playgroundEntries = { playground: path.join(SITE, 'src/playground.js') };
const playground = await bundle(playgroundEntries, { 'virtual:examples': examples, 'virtual:catalog': catalog, 'virtual:typings': typings, 'virtual:workers': workers });

// manifold's glue finds its WASM next to the script it was bundled into.
fs.copyFileSync(path.join(ROOT, 'node_modules/manifold-3d/manifold.wasm'), path.join(ASSETS, 'manifold.wasm'));

// The gallery: each example's first part, rendered by `cadcode png`.
const gallery = path.join(DIST, 'gallery');
fs.mkdirSync(gallery);
for (const name of Object.keys(examples)) {
  execFileSync('node', [CLI, 'png', path.join(EXAMPLES, `${name}.js`), '--size', '640x480', '-o', path.join(gallery, `${name}.png`)], {
    stdio: 'inherit',
  });
}

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cards = Object.entries(exampleFiles)
  .map(([name, { meta }]) => {
    const title = escapeHtml(meta.title);
    return `<a href="playground.html?example=${name}"><img src="gallery/${name}.png" alt="${title}" width="640" height="480" loading="lazy" /><strong>${title}</strong><span>${escapeHtml(meta.description)}</span></a>`;
  })
  .join('\n');
fs.writeFileSync(path.join(DIST, 'index.html'), fs.readFileSync(path.join(SITE, 'index.html'), 'utf8').replace('<!-- gallery -->', cards));
fs.writeFileSync(
  path.join(DIST, 'playground.html'),
  fs
    .readFileSync(path.join(SITE, 'playground.html'), 'utf8')
    .replace('assets/playground.js', `assets/${playground('playground')}`)
    .replace('assets/playground.css', `assets/${playground('playground', '.css')}`),
);
fs.writeFileSync(
  path.join(DIST, 'reference.html'),
  fs.readFileSync(path.join(SITE, 'reference.html'), 'utf8').replace('<!-- index -->', reference.index).replace('<!-- reference -->', reference.body),
);
for (const file of ['site.css', 'reference.css', 'favicon.svg', 'favicon.ico', 'apple-touch-icon.png']) fs.copyFileSync(path.join(SITE, file), path.join(DIST, file));
console.log(`site → ${path.relative(ROOT, DIST)}`);
