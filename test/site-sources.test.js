import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pointCadcodeAt } from '../site/src/cadcode-imports.js';
import { readFrontmatter } from '../site/src/frontmatter.js';

const URL = 'blob:shim';

test('every form of importing cadcode is pointed at the shim', () => {
  assert.equal(pointCadcodeAt(`import { cube } from 'cadcode';`, URL), `import { cube } from "${URL}";`);
  assert.equal(pointCadcodeAt(`import * as c from "cadcode";`, URL), `import * as c from "${URL}";`);
  assert.equal(pointCadcodeAt(`import 'cadcode';`, URL), `import "${URL}";`);
  assert.equal(pointCadcodeAt(`import"cadcode";`, URL), `import"${URL}";`);
  assert.equal(pointCadcodeAt(`export * from 'cadcode';`, URL), `export * from "${URL}";`);
  assert.equal(pointCadcodeAt(`await import( 'cadcode' )`, URL), `await import( "${URL}" )`);
});

test('other modules and strings are left alone', () => {
  const code = `import x from 'cadcode-extra';\nconst name = 'cadcode';\nimport y from './cadcode';`;
  assert.equal(pointCadcodeAt(code, URL), code);
});

const example = (lines) => `/*---\n${lines.join('\n')}\n---*/\nexport default 1;\n`;

test('readFrontmatter splits the meta from the code', () => {
  const { meta, code } = readFrontmatter(example(['title: Knob', 'description: A knob: with a colon']), 'k.js');
  assert.deepEqual(meta, { title: 'Knob', description: 'A knob: with a colon' });
  assert.equal(code, 'export default 1;\n');
});

test('readFrontmatter refuses a line that is not key: value, and missing fields', () => {
  assert.throws(() => readFrontmatter(example(['title: Knob', 'description: x', 'stray line']), 'k.js'), /k\.js: the frontmatter line "stray line"/);
  assert.throws(() => readFrontmatter(example(['title: Knob']), 'k.js'), /no description/);
  assert.throws(() => readFrontmatter('export default 1;\n', 'k.js'), /no frontmatter/);
});

test('every example has readable frontmatter', () => {
  const dir = new globalThis.URL('../examples/', import.meta.url);
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) readFrontmatter(fs.readFileSync(new globalThis.URL(file, dir), 'utf8'), file);
});
