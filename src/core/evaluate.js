// Turns a loaded program module into the solids of one part. Free of Node APIs:
// the CLI and dev server reach it through program.js, the site's playground directly.
import { Solid, Shape2 } from '../lib/index.js';

function flattenModel(model, partName) {
  const solids = [];
  const walk = (item) => {
    if (Array.isArray(item)) item.forEach(walk);
    else if (item instanceof Solid) solids.push(item);
    else if (item instanceof Shape2) throw new Error(`Part "${partName}" contains a 2D shape; extrude it to make a solid`);
    else if (item) throw new Error(`Part "${partName}" contains ${typeof item} ${String(item)}, not a solid`);
  };
  walk(model);
  return solids;
}

const isModel = (value) => value instanceof Solid || value instanceof Shape2 || Array.isArray(value);

/**
 * Evaluates one part of a program module.
 *
 * A program `export default`s either a model (a solid or an array of solids), or an
 * object of named parts whose values are models or functions returning models, or a
 * function of `params` returning either. `export const params = {...}` declares the
 * parameters that `overrides` may change.
 *
 * `fallbackToFirst` shows the first part instead of failing when `part` no longer
 * exists — the dev server uses it so renaming a part doesn't blank the preview.
 *
 * @param {{ default?: unknown, params?: Record<string, unknown> }} mod
 * @param {{ part?: string, overrides?: Record<string, unknown>, fallbackToFirst?: boolean }} [options]
 */
export async function evaluateModule(mod, { part, overrides = {}, fallbackToFirst = false } = {}) {
  if (mod.default === undefined) throw new Error('The program has no `export default`');

  const declared = mod.params ?? {};
  for (const key of Object.keys(overrides)) {
    if (!(key in declared)) throw new Error(`Unknown parameter "${key}". Declared: ${Object.keys(declared).join(', ') || 'none'}`);
  }
  const params = { ...declared, ...overrides };

  const value = typeof mod.default === 'function' ? await mod.default(params) : mod.default;
  const parts = isModel(value) ? { default: value } : value;
  if (!parts || typeof parts !== 'object') throw new Error('The default export must be a model, an object of parts, or a function returning one');

  const partNames = Object.keys(parts);
  if (partNames.length === 0) throw new Error('The program defines no parts');
  const name = part && partNames.includes(part) ? part : partNames[0];
  if (part && part !== name && !fallbackToFirst) throw new Error(`No part "${part}". Parts: ${partNames.join(', ')}`);

  const entry = parts[name];
  const model = typeof entry === 'function' ? await entry(params) : entry;
  return { partNames, part: name, params, solids: flattenModel(model, name) };
}
