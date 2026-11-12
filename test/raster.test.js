import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cube } from '../src/lib/index.js';
import { meshGroups } from '../src/core/mesh.js';
import { render } from '../src/export/raster.js';

const groups = () => meshGroups([cube(10)], [], []);
const pixel = ({ width, pixels }, x, y) => [...pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
const isBackground = ([r, g, b]) => r > 200 && Math.abs(r - g) < 6 && Math.abs(g - b) < 6;
// The default filament: warm yellow, red over green over blue.
const isModel = ([r, g, b]) => r > g && g > b && r - b > 60;
/** Whether most of the 16 × 16 pixels around (x, y) are the model's: the very centre may be an edge. */
const modelAround = (image, x, y) => {
  let count = 0;
  for (let dy = -8; dy < 8; dy++) for (let dx = -8; dx < 8; dx++) if (isModel(pixel(image, x + dx, y + dy))) count++;
  return count > 128;
};

test('a render has the backdrop at its corners and the model at its centre', () => {
  const image = render(groups(), { width: 80, height: 60 });
  assert.equal(image.pixels.length, 80 * 60 * 4);
  for (const [x, y] of [[0, 0], [79, 0], [0, 59], [79, 59]]) assert.ok(isBackground(pixel(image, x, y)), `corner ${x},${y}: ${pixel(image, x, y)}`);
  assert.ok(modelAround(image, 40, 30));
  assert.equal(pixel(image, 40, 30)[3], 255);
});

test('the backdrop is lighter at the top than at the bottom', () => {
  const image = render(groups(), { width: 40, height: 40 });
  assert.ok(pixel(image, 0, 0)[0] > pixel(image, 0, 39)[0]);
});

test('a sheet places four views in a two by two grid', () => {
  const image = render(groups(), { width: 160, height: 120, view: 'sheet' });
  for (const [ox, oy] of [[0, 0], [80, 0], [0, 60], [80, 60]]) {
    assert.ok(isBackground(pixel(image, ox + 1, oy + 1)), `tile ${ox},${oy} corner`);
    assert.ok(modelAround(image, ox + 40, oy + 30), `tile ${ox},${oy} centre`);
  }
});

test('an unknown view is refused, naming the views', () => {
  assert.throws(() => render(groups(), { view: 'side' }), /Unknown view "side". Views: iso, .*sheet/);
});
