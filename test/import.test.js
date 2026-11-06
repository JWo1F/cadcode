import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { cube, sphere, cylinder, importSTL, import3MF } from '../src/lib/index.js';
import { toSTL } from '../src/export/stl.js';
import { to3MF } from '../src/export/3mf.js';
import { meshGroups } from '../src/core/mesh.js';
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

// A tetrahedron with its right-angle corner at the origin and legs of 10, as 3MF mesh XML.
const TETRAHEDRON = `<mesh><vertices>
  <vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/>
</vertices><triangles>
  <triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="3" v3="2"/><triangle v1="1" v2="2" v3="3" p1="1"/>
</triangles></mesh>`;

const package3MF = (models) =>
  zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    '_rels/.rels': strToU8(
      '<?xml version="1.0"?><Relationships><Relationship Target="/3D/3dmodel.model" Id="r0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
    ),
    ...Object.fromEntries(Object.entries(models).map(([name, xml]) => [name, strToU8(xml)])),
  });

const colorsOf = (solid) => meshGroups([solid]).map((g) => g.color && g.color.map((c) => Math.round(c * 100) / 100));

test('import3MF reads back what cadcode writes, solids and colors', () => {
  const parts = [cube(10).color('red').union(sphere(4).translate([10, 10, 10]).color('blue')), cylinder({ r: 3, h: 5 }).translate([30, 0, 0])];
  const solids = import3MF(to3MF(parts));
  assert.equal(solids.length, 2);
  solids.forEach((solid, i) => near(solid.volume(), parts[i].volume(), 1e-2));
  assert.deepEqual(colorsOf(solids[0]), [[1, 0, 0, 1], [0, 0, 1, 1]]);
  assert.deepEqual(colorsOf(solids[1]), [null]);
});

test('import3MF follows components, other model files, transforms, mirroring, color groups and units', () => {
  const root = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
 <!-- a comment -->
 <resources>
  <m:colorgroup id="1" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"><m:color color="#FF0000"/><m:color color="#0000FFFF"/></m:colorgroup>
  <object id="2" name="tetra" pid="1" pindex="0">${TETRAHEDRON}</object>
  <object id="3" name="pair"><components>
   <component objectid="2" transform="1 0 0 0 1 0 0 0 1 20 0 0"/>
   <component p:path="/3D/Objects/part.model" objectid="1" transform="-1 0 0 0 1 0 0 0 1 0 0 0"/>
  </components></object>
 </resources>
 <build><item objectid="3"/><item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 5"/></build>
</model>`;
  const part = `<?xml version="1.0"?><model unit="millimeter"><resources><object id="1">${TETRAHEDRON.replace(' p1="1"', '')}</object></resources><build/></model>`;
  const [pair, single] = import3MF(package3MF({ '3D/3dmodel.model': root, '3D/Objects/part.model': part }));

  // The mirrored copy comes out right side out: its volume counts, not cancels.
  near(pair.volume(), 2 * (1000 / 6));
  assert.deepEqual(pair.bounds(), { min: [-10, 0, 0], max: [30, 10, 10] });
  assert.equal(single.bounds().min[2], 5);
  assert.deepEqual(colorsOf(single), [[1, 0, 0, 1], [0, 0, 1, 1]]);

  const inCentimeters = root.replace('unit="millimeter"', 'unit="centimeter"');
  near(import3MF(package3MF({ '3D/3dmodel.model': inCentimeters, '3D/Objects/part.model': part }))[1].volume(), 1000 * (1000 / 6), 1);
});

test('import3MF explains files it cannot read', () => {
  assert.throws(() => import3MF(new Uint8Array([1, 2, 3])), /not a zip archive/);
  assert.throws(() => import3MF(zipSync({ 'a.txt': strToU8('hi') })), /has no 3D model/);
  const open = `<model><resources><object id="1">${TETRAHEDRON.replace(/<triangle v1="1"[^>]*>/, '')}</object></resources><build><item objectid="1"/></build></model>`;
  assert.throws(() => import3MF(package3MF({ '3D/3dmodel.model': open })), /object "object 1" is not a closed solid \(3 edges/);
  const empty = '<model><resources/><build/></model>';
  assert.throws(() => import3MF(package3MF({ '3D/3dmodel.model': empty })), /nothing on its build plate/);
});
