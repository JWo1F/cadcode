import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFrame, decodeFrame } from '../client/frame-codec.js';

const toArrayBuffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

test('a frame decodes to the header and groups it was encoded from', () => {
  const solid = { body: 0, color: [1, 0.5, 0, 1], positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) };
  const sketch = {
    body: 1,
    color: [0, 0, 1, 0.3],
    sketch: true,
    guide: false,
    positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]),
    indices: new Uint32Array([0, 2, 1]),
    lines: new Float32Array([0, 0, 0, 2, 0, 0]),
  };
  // A header of odd length, so the padding is exercised.
  const { header, groups } = decodeFrame(toArrayBuffer(encodeFrame({ type: 'model', file: 'a.js', part: 'é', ms: 3 }, [solid, sketch])));

  assert.equal(header.type, 'model');
  assert.equal(header.file, 'a.js');
  assert.equal(header.part, 'é');
  assert.equal(groups.length, 2);
  assert.deepEqual([...groups[0].positions], [...solid.positions]);
  assert.deepEqual([...groups[0].indices], [...solid.indices]);
  assert.deepEqual(groups[0].color, solid.color);
  assert.equal(groups[0].lines, undefined);
  assert.equal(groups[1].sketch, true);
  assert.deepEqual([...groups[1].indices], [...sketch.indices]);
  assert.deepEqual([...groups[1].lines], [...sketch.lines]);
});

test('arrays that are views into a larger buffer are encoded from their own bytes', () => {
  const shared = new Float32Array([9, 9, 9, 1, 2, 3]);
  const group = { positions: shared.subarray(3), indices: new Uint32Array([0, 0, 0]) };
  const { groups } = decodeFrame(toArrayBuffer(encodeFrame({}, [group])));
  assert.deepEqual([...groups[0].positions], [1, 2, 3]);
});

test('a frame with no groups has only its header', () => {
  const { header, groups } = decodeFrame(toArrayBuffer(encodeFrame({ type: 'model' }, [])));
  assert.equal(header.type, 'model');
  assert.deepEqual(groups, []);
});
