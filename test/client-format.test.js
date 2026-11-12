import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMm } from '../client/format.js';

test('formatMm keeps up to two decimals and drops trailing zeros', () => {
  const expected = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  assert.equal(formatMm(12), expected(12));
  assert.equal(formatMm(12.5), expected(12.5));
  assert.equal(formatMm(12.345678), expected(12.35));
  assert.equal(formatMm(-0.001), '0');
});
