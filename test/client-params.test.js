import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stable, same, kindOf, stepOf, formatJSON, followServer } from '../client/params-values.js';

test('stable and same ignore key order, not array order', () => {
  assert.equal(stable({ b: 1, a: { d: 2, c: 3 } }), stable({ a: { c: 3, d: 2 }, b: 1 }));
  assert.ok(same({ a: 1, b: 2 }, { b: 2, a: 1 }));
  assert.ok(!same([1, 2], [2, 1]));
});

test('kindOf picks the control a param is edited with', () => {
  assert.equal(kindOf({ value: 2, options: [1, 2] }), 'choice');
  assert.equal(kindOf({ value: 2 }), 'number');
  assert.equal(kindOf({ value: true }), 'boolean');
  assert.equal(kindOf({ value: '#ff8800' }), 'color');
  assert.equal(kindOf({ value: 'ff8800' }), 'text');
  assert.equal(kindOf({ value: [1, 2] }), 'json');
});

test('stepOf follows the value’s last decimal, down to four places', () => {
  assert.equal(stepOf(12), 1);
  assert.equal(stepOf(1.5), 0.1);
  assert.equal(stepOf(0.25), 0.01);
  assert.equal(stepOf(0.123456), 0.0001);
});

test('formatJSON writes one line with a space after commas and colons', () => {
  assert.equal(formatJSON([4, 6, 8]), '[4, 6, 8]');
  assert.equal(formatJSON({ a: 1, b: [2] }), '{"a": 1, "b": [2]}');
});

test('followServer keeps the panel’s values until the server has run with them', () => {
  const declared = { a: 1, b: 2 };
  const waiting = followServer({ sent: { a: 5 }, overrides: { a: 5 }, serverOverrides: {}, declared });
  assert.deepEqual(waiting, { sent: { a: 5 }, overrides: { a: 5 } });
  const caughtUp = followServer({ sent: { a: 5 }, overrides: { a: 5 }, serverOverrides: { a: 5 }, declared });
  assert.deepEqual(caughtUp, { sent: null, overrides: { a: 5 } });
});

test('followServer follows the server when nothing is waiting, and drops undeclared params', () => {
  const result = followServer({ sent: null, overrides: { a: 5 }, serverOverrides: { b: 7, gone: 1 }, declared: { a: 1, b: 2 } });
  assert.deepEqual(result, { sent: null, overrides: { b: 7 } });
  // A sent param the program dropped does not keep the panel waiting.
  const dropped = followServer({ sent: { gone: 1 }, overrides: { gone: 1 }, serverOverrides: {}, declared: { a: 1 } });
  assert.deepEqual(dropped, { sent: null, overrides: {} });
});
