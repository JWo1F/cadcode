/**
 * Numbers from `start` to `end` inclusive, like OpenSCAD's `[start : step : end]`.
 * @param {number} start
 * @param {number} end
 * @param {number} [step]
 * @returns {number[]}
 */
export function range(start, end, step = 1) {
  if (step === 0) throw new Error('range() step must not be 0');
  const out = [];
  const count = Math.floor((end - start) / step + 1e-9);
  for (let i = 0; i <= count; i++) out.push(start + i * step);
  return out;
}

/**
 * Every combination of the given lists, like OpenSCAD's `for (x = xs, y = ys)`:
 * `product([1, 2], [3, 4])` is `[[1, 3], [1, 4], [2, 3], [2, 4]]`.
 * @param {...any[]} lists
 * @returns {any[][]}
 */
export function product(...lists) {
  return lists.reduce((acc, list) => acc.flatMap((combo) => list.map((v) => [...combo, v])), [[]]);
}
