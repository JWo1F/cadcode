import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cube, cylinder, memo, setResolution, square, Solid, Shape2 } from '../src/lib/index.js';
import { loadMemo, memoEntries } from '../src/lib/memo.js';
import { meshGroups } from '../src/core/mesh.js';

// Each test is one "run": the host hands in what the last one kept.
const newRun = (entries) => loadMemo(entries);
// A structured clone, as between the worker and the host.
const overThreads = (entries) => structuredClone(entries);

test('memo builds once per set of arguments within a run', () => {
  newRun();
  let calls = 0;
  const box = memo((size) => (calls++, cube(size)));
  const a = box(10);
  assert.equal(box(10), a);
  box(20);
  assert.equal(calls, 2);
});

test('a later run reuses what an earlier one built, colors included', () => {
  let calls = 0;
  const build = (d) => (calls++, cube(d).subtract(cylinder({ d: d / 2, h: d * 3, center: true })).color('orange'));

  newRun();
  const first = memo(build)(10);
  const kept = overThreads(memoEntries());
  assert.equal(kept.length, 1);

  newRun(kept);
  const again = memo(build)(10);
  assert.equal(calls, 1);
  assert.ok(again instanceof Solid);
  assert.ok(Math.abs(again.volume() - first.volume()) < 1e-3);
  assert.deepEqual(meshGroups([again]).map((g) => g.color), meshGroups([first]).map((g) => g.color));
});

test('2D shapes and nested arrays come back as they were', () => {
  newRun();
  let calls = 0;
  const build = () => (calls++, [square(4).subtract(square(2).translate([1, 1])), [cube(1), null]]);
  memo(build)();
  newRun(overThreads(memoEntries()));
  const [ring, [box, none]] = memo(build)();
  assert.equal(calls, 1);
  assert.ok(ring instanceof Shape2);
  assert.equal(ring.area(), 12);
  assert.equal(box.volume(), 1);
  assert.equal(none, null);
});

test('another source, other arguments or another resolution build again', () => {
  newRun();
  let calls = 0;
  memo((d) => (calls++, cylinder({ d, h: 1 })))(5);
  newRun(overThreads(memoEntries()));
  memo((d) => (calls++, cylinder({ d, h: 2 })))(5);
  memo((d) => (calls++, cylinder({ d, h: 1 })))(6);
  setResolution({ fn: 12 });
  try {
    memo((d) => (calls++, cylinder({ d, h: 1 })))(5);
  } finally {
    setResolution({ fn: 0 });
  }
  assert.equal(calls, 4);
});

test('the cache keeps only what the last run used', () => {
  newRun();
  const box = memo((s) => cube(s));
  box(1);
  box(2);
  newRun(overThreads(memoEntries()));
  box(1);
  assert.equal(memoEntries().length, 1);
});

test('async functions are remembered, and a hit is a promise too', async () => {
  newRun();
  let calls = 0;
  const build = async (s) => (calls++, cube(s));
  const first = memo(build)(3);
  assert.ok(first instanceof Promise);
  assert.equal((await first).volume(), 27);
  newRun(overThreads(memoEntries()));
  const again = memo(build)(3);
  assert.ok(again instanceof Promise);
  assert.equal((await again).volume(), 27);
  assert.equal(calls, 1);
});

test('arguments must be plain data and results must be shapes', () => {
  newRun();
  assert.throws(() => memo((s) => s)(cube(1)), /argument 1 is a solid/);
  assert.throws(() => memo((o) => cube(1))({ base: square(1) }), /argument 1\.base is a 2D shape/);
  assert.throws(() => memo(() => 42)(), /returned number/);
  assert.throws(() => memo(5), /takes a function/);
});
