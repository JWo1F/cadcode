import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const CLI = new URL('../src/cli.js', import.meta.url).pathname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadcode-cli-'));
fs.writeFileSync(path.join(dir, 'parts.js'), `import { cube } from 'cadcode';\nexport default { box: cube(2), lid: cube([2, 2, 1]) };\n`);
fs.writeFileSync(path.join(dir, 'single.js'), `import { cube } from 'cadcode';\nexport default cube(2);\n`);

after(() => fs.rmSync(dir, { recursive: true }));

const cadcode = (...args) => execFileSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8' });
const exists = (...file) => fs.existsSync(path.join(dir, ...file));

test('--all writes one file per part, named <file>-<part>, into the -o directory', () => {
  cadcode('stl', 'parts.js', '--all', '-o', 'out');
  assert.ok(exists('out', 'parts-box.stl'));
  assert.ok(exists('out', 'parts-lid.stl'));
});

test('a part of a multi-part program is named <file>-<part> in the current directory', () => {
  cadcode('stl', 'parts.js', '--part', 'lid');
  assert.ok(exists('parts-lid.stl'));
});

test('a single-part program is named <file>, and -o names the file itself', () => {
  cadcode('stl', 'single.js');
  assert.ok(exists('single.stl'));
  cadcode('png', 'single.js', '-o', 'shots/view.png', '--size', '32x24');
  assert.ok(exists('shots', 'view.png'));
});

test('3mf exports like stl, one file per part', () => {
  cadcode('3mf', 'parts.js', '--all', '-o', 'out3mf');
  assert.ok(exists('out3mf', 'parts-box.3mf'));
  assert.ok(exists('out3mf', 'parts-lid.3mf'));
});

test('parts lists the part names', () => {
  assert.equal(cadcode('parts', 'parts.js'), 'box\nlid\n');
});
