// Every example must build: each part evaluates to a non-empty mesh, and each part
// with solids exports to STL. The whole run takes about 20 s; gear-bearing is the
// slowest at about 7 s.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bundleProgram, evaluateProgram, removeBundle } from '../src/core/program.js';
import { meshGroups } from '../src/core/mesh.js';
import { toSTL } from '../src/export/stl.js';

const EXAMPLES = new URL('../examples/', import.meta.url);
const files = fs.readdirSync(EXAMPLES).filter((file) => file.endsWith('.js')).sort();

// Examples print their sizes; keep the test output readable.
const quietly = async (run) => {
  const log = console.log;
  console.log = () => {};
  try {
    return await run();
  } finally {
    console.log = log;
  }
};

for (const file of files) {
  test(`example ${file}`, async (t) => {
    const bundle = await bundleProgram(new URL(file, EXAMPLES).pathname);
    t.after(() => removeBundle(bundle));
    const { partNames } = await quietly(() => evaluateProgram(bundle));
    for (const part of partNames) {
      await t.test(part, async () => {
        const result = await quietly(() => evaluateProgram(bundle, { part }));
        const triangles = meshGroups(result.solids, result.shapes).reduce((n, g) => n + g.indices.length / 3, 0);
        assert.ok(triangles > 0, `part "${part}" has no triangles`);
        if (result.solids.length > 0) assert.ok(new DataView(toSTL(result.solids).buffer).getUint32(80, true) > 0);
      });
    }
  });
}
