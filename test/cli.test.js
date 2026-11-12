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

test('--all builds each part afresh, so one part setting the resolution leaves the next alone', () => {
  fs.writeFileSync(
    path.join(dir, 'leaky.js'),
    `import { cylinder, setResolution } from 'cadcode';\nexport default {\n  coarse: () => (setResolution({ fn: 6 }), cylinder({ r: 5, h: 1 })),\n  fine: () => cylinder({ r: 5, h: 1 }),\n};\n`,
  );
  cadcode('stl', 'leaky.js', '--all', '-o', 'leaky');
  cadcode('stl', 'leaky.js', '--part', 'fine', '-o', 'fine.stl');
  const triangles = (...file) => fs.readFileSync(path.join(dir, ...file)).readUInt32LE(80);
  assert.equal(triangles('leaky', 'leaky-fine.stl'), triangles('fine.stl'));
  assert.ok(triangles('leaky', 'leaky-coarse.stl') < triangles('fine.stl'));
});

test('an unknown command is named before the program is built', () => {
  fs.writeFileSync(path.join(dir, 'broken.js'), `throw new Error('built');\n`);
  assert.throws(() => execFileSync(process.execPath, [CLI, 'stp', 'broken.js'], { cwd: dir, stdio: 'pipe' }), (error) => {
    assert.match(String(error.stderr), /Unknown command "stp"/);
    return true;
  });
});

test('an error in a part points at the program', () => {
  fs.writeFileSync(path.join(dir, 'fails.js'), `export default { bad: () => { throw new Error('no such hole'); } };\n`);
  assert.throws(() => execFileSync(process.execPath, [CLI, 'stl', 'fails.js'], { cwd: dir, stdio: 'pipe' }), (error) => {
    assert.match(String(error.stderr), /cadcode: no such hole/);
    assert.match(String(error.stderr), /fails\.js:1/);
    return true;
  });
});
