import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceToSegment, frameCorners, sectionOffset } from '../client/inspect-geometry.js';

test('distanceToSegment measures to the nearest point of the segment, ends included', () => {
  assert.equal(distanceToSegment(5, 3, [0, 0], [10, 0]), 3);
  assert.equal(distanceToSegment(-4, 3, [0, 0], [10, 0]), 5);
  assert.equal(distanceToSegment(3, 4, [0, 0], [0, 0]), 5); // a segment of no length is its point
});

test('frameCorners spans the box, grown by a margin, at the offset along the axis', () => {
  const box = { min: [0, 0, 0], max: [10, 20, 5] };
  const margin = 20 * 0.08 + 0.5;
  assert.deepEqual(frameCorners(box, 'z', 2), [
    [-margin, -margin, 2],
    [10 + margin, -margin, 2],
    [10 + margin, 20 + margin, 2],
    [-margin, 20 + margin, 2],
  ]);
  for (const corner of frameCorners(box, 'x', 7)) assert.equal(corner[0], 7);
});

test('sectionOffset keeps an offset inside the model and starts outside ones at the middle', () => {
  assert.equal(sectionOffset(3, 0, 10), 3);
  assert.equal(sectionOffset(null, 0, 10), 5);
  assert.equal(sectionOffset(12, 0, 10), 5);
  assert.equal(sectionOffset(-1, 0, 10), 5);
});
