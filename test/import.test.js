import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cube, sphere, importSTL } from '../src/lib/index.js';
import { toSTL } from '../src/export/stl.js';
import { bundleProgram, evaluateProgram, removeBundle } from '../src/core/program.js';

const fixture = (name) => fs.readFileSync(new URL(`fixtures/${name}`, import.meta.url));
const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('importSTL reads ASCII STL', () => {
  const solid = importSTL(fixture('tetrahedron.stl'));
  near(solid.volume(), 1000 / 6);
  assert.deepEqual(solid.bounds(), { min: [0, 0, 0], max: [10, 10, 10] });
});

test('importSTL reads binary STL, as cadcode writes it', () => {
  const original = cube(10).subtract(sphere({ r: 4, fn: 24 }).translate([5, 5, 10]));
  const solid = importSTL(toSTL([original]));
  near(solid.volume(), original.volume(), 1e-2);
  // An ArrayBuffer works as well as a Uint8Array.
  const bytes = toSTL([cube(2)]);
  near(importSTL(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).volume(), 8);
});

test('importSTL refuses meshes that are not closed solids', () => {
  assert.throws(() => importSTL(fixture('open.stl')), /not a closed solid \(3 edges with no neighbouring triangle\)/);
  const flipped = fixture('tetrahedron.stl')
    .toString()
    .replace(/(vertex [^\n]+\n)(\s*vertex [^\n]+\n)(\s*vertex [^\n]+\n)/g, (_, a, b, c) => a + c + b);
  assert.throws(() => importSTL(new TextEncoder().encode(flipped)), /inside out/);
  assert.throws(() => importSTL(new TextEncoder().encode('hello')), /not an STL file/);
  assert.throws(() => importSTL('solid x'), /expected a file's bytes/);
});

test('a program imports an STL next to it as bytes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadcode-import-'));
  fs.copyFileSync(new URL('fixtures/tetrahedron.stl', import.meta.url), path.join(dir, 'part.stl'));
  fs.writeFileSync(
    path.join(dir, 'model.js'),
    `import { importSTL } from 'cadcode';\nimport part from './part.stl';\nexport default importSTL(part).translate([0, 0, 5]);\n`,
  );
  const bundle = await bundleProgram(path.join(dir, 'model.js'));
  try {
    const { solids } = await evaluateProgram(bundle);
    near(solids[0].volume(), 1000 / 6);
    assert.equal(solids[0].bounds().min[2], 5);
  } finally {
    removeBundle(bundle);
    fs.rmSync(dir, { recursive: true });
  }
});
