// Turns a loaded program module into the solids of one part. Free of Node APIs:
// the CLI and dev server reach it through program.js, the site's playground directly.
import { Solid, Shape2, Point } from '../lib/index.js';
import { POINT_IS_NOT_A_SHAPE } from '../lib/shapes.js';

function flattenModel(model, partName) {
  const solids = [];
  const shapes = [];
  const walk = (item) => {
    if (Array.isArray(item)) item.forEach(walk);
    else if (item instanceof Solid) solids.push(item);
    else if (item instanceof Shape2) shapes.push(item);
    else if (item instanceof Point) throw new Error(`Part "${partName}" contains a point. ${POINT_IS_NOT_A_SHAPE}`);
    else if (item) throw new Error(`Part "${partName}" contains ${typeof item} ${String(item)}, not a solid or a 2D shape`);
  };
  walk(model);
  return { solids, shapes };
}

const isModel = (value) => value instanceof Solid || value instanceof Shape2 || Array.isArray(value);

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Throws unless every entry of an object of params is `{ value, name, description }`. */
function checkSpecs(specs, where) {
  for (const [key, spec] of Object.entries(specs)) {
    const missing = !isPlainObject(spec)
      ? ['value', 'name', 'description']
      : [
          ...(spec.value === undefined ? ['value'] : []),
          ...(typeof spec.name === 'string' && spec.name.trim() ? [] : ['name']),
          ...(typeof spec.description === 'string' && spec.description.trim() ? [] : ['description']),
        ];
    if (missing.length) {
      throw new Error(`Parameter "${key}"${where} must be { value, name, description }; ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing`);
    }
  }
}

/**
 * Reads `export const params`: either an object of `{ value, name, description }` entries, or an
 * array of sections `{ name, children }` whose children are such objects. Keys are unique across
 * sections, since the program gets one flat object of values. Throws on the first entry that is wrong.
 *
 * @param {unknown} params
 * @returns {{ declared: Record<string, { value: unknown, name: string, description: string }>, sections: { name: string | null, keys: string[] }[] }}
 *   every entry by key, and the sections in order; an object of params is one section with no name
 */
function readParams(params) {
  if (params === undefined) return { declared: {}, sections: [] };
  if (isPlainObject(params)) {
    checkSpecs(params, '');
    return { declared: /** @type {any} */ (params), sections: [{ name: null, keys: Object.keys(params) }] };
  }
  if (!Array.isArray(params)) throw new Error('`export const params` must be an object of { value, name, description } entries, or an array of { name, children } sections');
  const declared = {};
  const sections = params.map((section, index) => {
    if (!isPlainObject(section) || typeof section.name !== 'string' || !section.name.trim() || !isPlainObject(section.children)) {
      throw new Error(`Params section ${index + 1} must be { name, children }, with a name and an object of parameters`);
    }
    checkSpecs(section.children, ` in section "${section.name}"`);
    for (const key of Object.keys(section.children)) {
      if (key in declared) throw new Error(`Parameter "${key}" is declared twice; keys must be unique across sections`);
      declared[key] = section.children[key];
    }
    return { name: section.name, keys: Object.keys(section.children) };
  });
  return { declared, sections };
}

/**
 * Evaluates one part of a program module.
 *
 * A program `export default`s either a model (a solid or an array of solids), or an
 * object of named parts whose values are models or functions returning models, or a
 * function of `params` returning either, or returning a function that returns a model
 * (one part, built lazily). Any of these functions may be async. `export const params = {...}` declares the
 * parameters that `overrides` may change, each as `{ value, name, description }`, flat or in an array of
 * `{ name, children }` sections; the functions get one flat object of values.
 *
 * `fallbackToFirst` shows the first part instead of failing when `part` no longer
 * exists — the dev server uses it so renaming a part doesn't blank the preview.
 * `ignoreUnknown` skips overrides of parameters the program no longer declares,
 * instead of failing — the dev server keeps the browser's values across edits.
 *
 * @param {{ default?: unknown, params?: unknown }} mod
 * @param {{ part?: string, overrides?: Record<string, unknown>, fallbackToFirst?: boolean, ignoreUnknown?: boolean }} [options]
 * @returns the part's solids and 2D shapes, the part names, the param values it ran with (`params`) and the
 *   declared `{ value, name, description }` entries by key (`declared`) and their `sections`
 */
export async function evaluateModule(mod, { part, overrides = {}, fallbackToFirst = false, ignoreUnknown = false } = {}) {
  if (mod.default === undefined) throw new Error('The program has no `export default`');

  const { declared, sections } = readParams(mod.params);
  const known = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (key in declared) known[key] = value;
    else if (!ignoreUnknown) throw new Error(`Unknown parameter "${key}". Declared: ${Object.keys(declared).join(', ') || 'none'}`);
  }
  const params = { ...Object.fromEntries(Object.entries(declared).map(([key, spec]) => [key, spec.value])), ...known };

  const value = typeof mod.default === 'function' ? await mod.default(params) : mod.default;
  // A returned function is one part, called with params like a part's function.
  const parts = isModel(value) || typeof value === 'function' ? { default: value } : value;
  if (!parts || typeof parts !== 'object') throw new Error('The default export must be a model, an object of parts, or a function returning one');

  const partNames = Object.keys(parts);
  if (partNames.length === 0) throw new Error('The program defines no parts');
  const name = part && partNames.includes(part) ? part : partNames[0];
  if (part && part !== name && !fallbackToFirst) throw new Error(`No part "${part}". Parts: ${partNames.join(', ')}`);

  const entry = parts[name];
  const model = typeof entry === 'function' ? await entry(params) : entry;
  return { partNames, part: name, params, declared, sections, ...flattenModel(model, name) };
}
