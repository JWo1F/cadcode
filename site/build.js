// Builds the site into site/dist: the landing page with a gallery rendered from
// examples/, and the playground with Monaco and the library bundled for the browser.
//
//   node site/build.js
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const SITE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(SITE);
const DIST = path.join(SITE, 'dist');
const ASSETS = path.join(DIST, 'assets');
const EXAMPLES = path.join(ROOT, 'examples');
const CLI = path.join(ROOT, 'src/cli.js');

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(ASSETS, { recursive: true });

// Examples, for the playground's picker.
const examples = Object.fromEntries(
  fs
    .readdirSync(EXAMPLES)
    .filter((file) => file.endsWith('.js'))
    .sort()
    .map((file) => [file.replace(/\.js$/, ''), fs.readFileSync(path.join(EXAMPLES, file), 'utf8')]),
);

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

const virtualModules = {
  name: 'virtual-modules',
  setup(build) {
    const modules = { 'virtual:examples': examples, 'virtual:typings': typings };
    build.onResolve({ filter: /^virtual:/ }, (args) => ({ path: args.path, namespace: 'virtual' }));
    build.onLoad({ filter: /.*/, namespace: 'virtual' }, (args) => ({ contents: JSON.stringify(modules[args.path]), loader: 'json' }));
  },
};

const monaco = (file) => path.join(ROOT, 'node_modules/monaco-editor/esm/vs', file);

await esbuild.build({
  entryPoints: {
    playground: path.join(SITE, 'src/playground.js'),
    'eval-worker': path.join(SITE, 'src/eval-worker.js'),
    'editor.worker': monaco('editor/editor.worker.js'),
    'ts.worker': monaco('language/typescript/ts.worker.js'),
  },
  outdir: ASSETS,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  chunkNames: 'chunk-[hash]',
  loader: { '.ttf': 'file' },
  // manifold's Emscripten glue imports these only when it runs under Node.
  external: ['module', 'node:module', 'fs', 'path', 'url', 'worker_threads'],
  plugins: [virtualModules],
  logLevel: 'warning',
});

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

const cards = Object.keys(examples)
  .map((name) => `<a href="playground.html?example=${name}"><img src="gallery/${name}.png" alt="${name}" width="640" height="480" loading="lazy" /><span>${name}</span></a>`)
  .join('\n');
fs.writeFileSync(path.join(DIST, 'index.html'), fs.readFileSync(path.join(SITE, 'index.html'), 'utf8').replace('<!-- gallery -->', cards));
for (const file of ['playground.html', 'site.css']) fs.copyFileSync(path.join(SITE, file), path.join(DIST, file));
console.log(`site → ${path.relative(ROOT, DIST)}`);
