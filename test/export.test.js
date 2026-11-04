import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bundleProgram, evaluateProgram, parseOverrides } from '../src/core/program.js';
import { meshGroups } from '../src/core/mesh.js';
import { toSTL } from '../src/export/stl.js';
import { toPNG } from '../src/export/png.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadcode-test-'));
const program = path.join(dir, 'model.js');
fs.writeFileSync(
  program,
  `import { cube, sphere } from 'cadcode';
export const params = { size: 10 };
export default (p) => ({
  pair: () => [cube(p.size).color('red'), sphere(3).translate([20, 0, 0])],
  single: cube(1),
});`,
);
const bundle = await bundleProgram(program);

test('parts, params and overrides', async () => {
  const result = await evaluateProgram(bundle, { overrides: { size: 4 } });
  assert.deepEqual(result.partNames, ['pair', 'single']);
  assert.equal(result.part, 'pair');
  assert.equal(result.solids.length, 2);
  assert.equal(Math.round(result.solids[0].volume()), 64);
  await assert.rejects(evaluateProgram(bundle, { overrides: { sise: 1 } }), /Unknown parameter "sise"/);
  await assert.rejects(evaluateProgram(bundle, { part: 'nope' }), /No part "nope"/);
  assert.equal((await evaluateProgram(bundle, { part: 'nope', fallbackToFirst: true })).part, 'pair');
});

test('colors survive into mesh groups', async () => {
  const { solids } = await evaluateProgram(bundle);
  const colors = meshGroups(solids).map((g) => g.color && g.color.slice(0, 3));
  assert.deepEqual(colors, [[1, 0, 0], null]);
});

test('STL has a triangle count matching its size', async () => {
  const stl = toSTL((await evaluateProgram(bundle, { part: 'single' })).solids);
  assert.equal(stl.readUInt32LE(80), 12);
  assert.equal(stl.length, 84 + 12 * 50);
});

test('PNG is a valid image of the requested size', async () => {
  const png = toPNG((await evaluateProgram(bundle)).solids, { width: 64, height: 48, view: 'sheet' });
  assert.deepEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47]);
  assert.equal(png.readUInt32BE(16), 64);
  assert.equal(png.readUInt32BE(20), 48);
});

test('overrides parse JSON values and fall back to strings', () => {
  assert.deepEqual(parseOverrides(['a=2.5', 'b=true', 'c=hello', 'd=[1,2]']), { a: 2.5, b: true, c: 'hello', d: [1, 2] });
});
