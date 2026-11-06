// Turns a loaded program module into the solids of one part. Free of Node APIs:
// the CLI and dev server reach it through program.js, the site's playground directly.
import { Solid, Shape2 } from '../lib/index.js';

function flattenModel(model, partName) {
  const solids = [];
  const shapes = [];
  const walk = (item) => {
    if (Array.isArray(item)) item.forEach(walk);
    else if (item instanceof Solid) solids.push(item);
    else if (item instanceof Shape2) shapes.push(item);
    else if (item) throw new Error(`Part "${partName}" contains ${typeof item} ${String(item)}, not a solid or a 2D shape`);
  };
  walk(model);
  return { solids, shapes };
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
 * `ignoreUnknown` skips overrides of parameters the program no longer declares,
 * instead of failing — the dev server keeps the browser's values across edits.
 *
 * @param {{ default?: unknown, params?: Record<string, unknown> }} mod
 * @param {{ part?: string, overrides?: Record<string, unknown>, fallbackToFirst?: boolean, ignoreUnknown?: boolean }} [options]
 * @returns the part's solids and 2D shapes, the part names, the params it ran with and the declared ones (`declared`)
 */
export async function evaluateModule(mod, { part, overrides = {}, fallbackToFirst = false, ignoreUnknown = false } = {}) {
  if (mod.default === undefined) throw new Error('The program has no `export default`');

  const declared = mod.params ?? {};
  const known = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (key in declared) known[key] = value;
    else if (!ignoreUnknown) throw new Error(`Unknown parameter "${key}". Declared: ${Object.keys(declared).join(', ') || 'none'}`);
  }
  const params = { ...declared, ...known };

  const value = typeof mod.default === 'function' ? await mod.default(params) : mod.default;
  const parts = isModel(value) ? { default: value } : value;
  if (!parts || typeof parts !== 'object') throw new Error('The default export must be a model, an object of parts, or a function returning one');

  const partNames = Object.keys(parts);
  if (partNames.length === 0) throw new Error('The program defines no parts');
  const name = part && partNames.includes(part) ? part : partNames[0];
  if (part && part !== name && !fallbackToFirst) throw new Error(`No part "${part}". Parts: ${partNames.join(', ')}`);

  const entry = parts[name];
  const model = typeof entry === 'function' ? await entry(params) : entry;
  return { partNames, part: name, params, declared, ...flattenModel(model, name) };
}
