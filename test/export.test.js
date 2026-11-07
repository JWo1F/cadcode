import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bundleProgram, evaluateProgram, parseOverrides, removeBundle } from '../src/core/program.js';
import { meshGroups } from '../src/core/mesh.js';
import { toSTL } from '../src/export/stl.js';
import { toPNG } from '../src/export/png.js';
import { to3MF } from '../src/export/3mf.js';
import { cube } from '../src/lib/index.js';
import { unzipSync, strFromU8 } from 'fflate';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadcode-test-'));
const program = path.join(dir, 'model.js');
fs.writeFileSync(
  program,
  `import { cube, sphere, square, circle, point } from 'cadcode';
export const params = { size: { value: 10, name: 'Size', description: 'Edge of the cube.' } };
export default (p) => ({
  pair: () => [cube(p.size).color('red'), sphere(3).translate([20, 0, 0])],
  single: cube(1),
  mixed: [cube(1), square(5).translate([10, 0])],
  flat: [square(5), circle(2)],
  withPoint: [cube(1), point([1, 2, 3])],
});`,
);
const bundle = await bundleProgram(program);

// A program importing a font file gets its bytes; the default font stands in for one here.
const { default: fontBase64 } = await import('../src/lib/fonts/liberation-sans.js');
fs.writeFileSync(path.join(dir, 'Font.ttf'), Buffer.from(fontBase64, 'base64'));
fs.writeFileSync(
  path.join(dir, 'label.js'),
  `import { text } from 'cadcode';
import font from './Font.ttf';
export default text('HI', { size: 5, font }).extrude(1);`,
);
const labelBundle = await bundleProgram(path.join(dir, 'label.js'));

after(() => {
  removeBundle(bundle);
  removeBundle(labelBundle);
  fs.rmSync(dir, { recursive: true });
});

test('parts, params and overrides', async () => {
  const result = await evaluateProgram(bundle, { overrides: { size: 4 } });
  assert.deepEqual(result.partNames, ['pair', 'single', 'mixed', 'flat', 'withPoint']);
  assert.equal(result.part, 'pair');
  assert.equal(result.solids.length, 2);
  assert.equal(Math.round(result.solids[0].volume()), 64);
  await assert.rejects(evaluateProgram(bundle, { overrides: { sise: 1 } }), /Unknown parameter "sise"/);
  const lenient = await evaluateProgram(bundle, { overrides: { size: 4, sise: 1 }, ignoreUnknown: true });
  assert.equal(lenient.params.size, 4);
  assert.equal('sise' in lenient.params, false);
  assert.deepEqual(Object.keys(lenient.declared), Object.keys(lenient.params));
  assert.deepEqual(lenient.declared.size, { value: 10, name: 'Size', description: 'Edge of the cube.' });
  assert.equal((await evaluateProgram(bundle)).params.size, 10);
  await assert.rejects(evaluateProgram(bundle, { part: 'nope' }), /No part "nope"/);
  assert.equal((await evaluateProgram(bundle, { part: 'nope', fallbackToFirst: true })).part, 'pair');
  await assert.rejects(evaluateProgram(bundle, { part: 'withPoint' }), /Part "withPoint" contains a point\. A point has no geometry/);
});

test('colors survive into mesh groups', async () => {
  const { solids } = await evaluateProgram(bundle);
  const colors = meshGroups(solids).map((g) => g.color && g.color.slice(0, 3));
  assert.deepEqual(colors, [[1, 0, 0], null]);
});

test('STL has a triangle count matching its size', async () => {
  const stl = toSTL((await evaluateProgram(bundle, { part: 'single' })).solids);
  assert.equal(new DataView(stl.buffer).getUint32(80, true), 12);
  assert.equal(stl.length, 84 + 12 * 50);
});

test('2D shapes are drawn as flat sketches but left out of STL', async () => {
  const mixed = await evaluateProgram(bundle, { part: 'mixed' });
  assert.equal(mixed.solids.length, 1);
  assert.equal(mixed.shapes.length, 1);
  const groups = meshGroups(mixed.solids, mixed.shapes);
  assert.equal(groups.length, 2);
  const sketch = groups[1];
  assert.equal(sketch.sketch, true);
  assert.ok(sketch.positions.every((v, i) => i % 3 !== 2 || v === 0));
  assert.equal(sketch.lines.length, 4 * 6); // a square's four edges
  assert.equal(new DataView(toSTL(mixed.solids).buffer).getUint32(80, true), 12);

  const flat = await evaluateProgram(bundle, { part: 'flat' });
  assert.throws(() => toSTL(flat.solids), /no solids/);
  assert.ok(toPNG(flat, { width: 32, height: 32 }).length > 0);
});

/** The package's files, and the model's objects with their triangles' materials. */
function read3MF(bytes) {
  const files = unzipSync(bytes);
  const xml = strFromU8(files['3D/3dmodel.model']);
  const objects = [...xml.matchAll(/<object ([^>]*)>(.*?)<\/object>/g)].map(([, attrs, body]) => ({
    name: attrs.match(/name="([^"]*)"/)[1],
    pindex: attrs.match(/pindex="(\d+)"/)?.[1],
    vertices: body.match(/<vertex /g).length,
    triangles: [...body.matchAll(/<triangle ([^>]*)\/>/g)].map(([, t]) => t.match(/p1="(\d+)"/)?.[1]),
  }));
  const colors = [...xml.matchAll(/displaycolor="([^"]+)"/g)].map((m) => m[1]);
  return { files, xml, objects, colors };
}

test('3MF keeps each solid as its own object, in millimeters', async () => {
  const { files, xml, objects, colors } = read3MF(to3MF((await evaluateProgram(bundle)).solids, { name: 'pair' }));
  assert.deepEqual(Object.keys(files).sort(), ['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
  assert.match(strFromU8(files['_rels/.rels']), /Target="\/3D\/3dmodel\.model"/);
  assert.match(xml, /<model unit="millimeter"/);
  assert.deepEqual(objects.map((o) => o.name), ['pair-1', 'pair-2']);
  assert.equal(objects[0].triangles.length, 12);
  assert.equal(objects[0].vertices, 8);
  assert.match(xml, /<item objectid="2"\/>\s*<item objectid="3"\/>/);
  // The red cube has one material for all of it; the plain sphere has none.
  assert.deepEqual(colors, ['#FF0000']);
  assert.equal(objects[0].pindex, '0');
  assert.ok(objects[0].triangles.every((m) => m === undefined));
  assert.equal(objects[1].pindex, undefined);
});

test('3MF keeps the colors of a union per triangle', () => {
  const solid = cube(2).color('red').union(cube(2).translate([2, 0, 0]).color('#0000ff', 0.5), cube(1).translate([0, 0, 2]));
  const { objects, colors } = read3MF(to3MF([solid], { name: 'a<b' }));
  assert.equal(objects.length, 1);
  assert.equal(objects[0].name, 'a&#60;b');
  // Uncolored faces of a colored solid take the viewer's color.
  assert.deepEqual(new Set(colors), new Set(['#FF0000', '#0000FF80', '#F2C14E']));
  const own = objects[0].pindex;
  const named = new Set(objects[0].triangles.filter(Boolean));
  assert.equal(named.has(own), false);
  assert.equal(named.size, 2);
});

test('3MF of the same model is the same bytes, and needs a solid', async () => {
  const solids = (await evaluateProgram(bundle)).solids;
  assert.deepEqual(to3MF(solids), to3MF(solids));
  const flat = await evaluateProgram(bundle, { part: 'flat' });
  assert.throws(() => to3MF(flat.solids), /no solids/);
});

test('PNG is a valid image of the requested size', async () => {
  const png = toPNG(await evaluateProgram(bundle), { width: 64, height: 48, view: 'sheet' });
  assert.deepEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47]);
  assert.equal(png.readUInt32BE(16), 64);
  assert.equal(png.readUInt32BE(20), 48);
});

test('a program imports a font file as bytes for text()', async () => {
  const { solids } = await evaluateProgram(labelBundle);
  near(solids[0].bounds().max[1], 5);
});

test('overrides parse JSON values and fall back to strings', () => {
  assert.deepEqual(parseOverrides(['a=2.5', 'b=true', 'c=hello', 'd=[1,2]']), { a: 2.5, b: true, c: 'hello', d: [1, 2] });
});

test('a program may be async, and may return a function that builds its one part', async () => {
  const { evaluateModule } = await import('../src/core/evaluate.js');
  const params = { size: { value: 2, name: 'Size', description: 'Edge of the cube.' } };
  const lazy = await evaluateModule({ params, default: async (p) => async (q) => cube(p.size + q.size) });
  assert.deepEqual(lazy.partNames, ['default']);
  assert.equal(Math.round(lazy.solids[0].volume()), 64);
  const parts = await evaluateModule({ params, default: async () => ({ a: async (p) => cube(p.size) }) }, { overrides: { size: 3 } });
  assert.equal(Math.round(parts.solids[0].volume()), 27);
});

test('every param needs a value, a name and a description', async () => {
  const { evaluateModule } = await import('../src/core/evaluate.js');
  const run = (params) => evaluateModule({ params, default: () => cube(1) });
  await assert.rejects(run({ size: 10 }), /Parameter "size" must be \{ value, name, description \}; value, name, description are missing/);
  await assert.rejects(run({ size: { value: 10, name: 'Size' } }), /Parameter "size" .*; description is missing/);
  await assert.rejects(run({ size: { name: 'Size', description: 'Edge.' } }), /Parameter "size" .*; value is missing/);
  await assert.rejects(run({ size: { value: 10, name: ' ', description: 'Edge.' } }), /; name is missing/);
  await assert.rejects(run([1]), /must be an object/);
  assert.equal((await run({ on: { value: false, name: 'On', description: 'A switch.' } })).params.on, false);
});
