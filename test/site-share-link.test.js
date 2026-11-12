import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pack, unpack, toBase64Url, fromBase64Url } from '../site/src/share-link.js';

test('base64url has no +, / or padding, and reads back', () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
  const text = toBase64Url(bytes);
  assert.doesNotMatch(text, /[+/=]/);
  assert.deepEqual(fromBase64Url(text), bytes);
  assert.deepEqual(fromBase64Url(toBase64Url(new Uint8Array([251]))), new Uint8Array([251]));
});

test('code packed into a link unpacks to the same code', async () => {
  const code = `import { cube } from 'cadcode';\n// Größe — ✓\nexport default cube(${'1'.repeat(500)});\n`;
  const packed = await pack(code);
  assert.match(packed, /^[\w-]*$/);
  assert.ok(packed.length < code.length);
  assert.equal(await unpack(packed), code);
});

test('a link that is not packed code is refused', async () => {
  await assert.rejects(unpack('not-deflate'));
});
