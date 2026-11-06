import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const run = (...args) => execFileSync(process.execPath, [tsc, ...args], { cwd: ROOT, encoding: 'utf8' });

test('a TypeScript program gets the typings by importing "cadcode"', () => {
  run('-p', 'tsconfig.json');
  assert.doesNotThrow(() =>
    run('--ignoreConfig', '--noEmit', '--strict', '--target', 'es2022', '--module', 'nodenext', '--moduleResolution', 'nodenext', 'test/fixtures/consumer.ts'),
  );
});
