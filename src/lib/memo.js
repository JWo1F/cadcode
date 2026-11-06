// memo(): remembers what an expensive function built, so the next run can skip it.
//
// Every run of a program happens in a fresh worker (the dev server and the
// playground both do this), so the cache cannot live in this module across runs.
// Instead the host keeps it: it hands the entries it has to the next worker
// (loadMemo), and takes back the entries that run used or made (memoEntries).
// An entry holds plain data — meshes as typed arrays and colors as RGBA — that
// survives a structured clone between threads.
import { CrossSection, Manifold, Mesh, Shape2, Solid, colorOfId, reserveColorIds, resolution } from './shapes.js';

/**
 * A stored value; `async` marks the result of a function that returned a promise, so a hit returns one too.
 * @typedef {({ solid: { positions: Float32Array, triangles: Uint32Array, runIndex: Uint32Array, colors: ([number, number, number, number] | null)[] } }
 *   | { shape: [number, number][][] }
 *   | { list: MemoValue[] }
 *   | { none: true }) & { async?: true }} MemoValue
 * @typedef {{ key: string, value: MemoValue }} MemoEntry
 */

/** Entries the host handed in, by key, not yet turned back into shapes. @type {Map<string, MemoValue>} */
let given = new Map();
/**
 * What this run's calls returned, by key, so a second call with the same key gets the very same shapes:
 * `value` is what the call returned, `shapes` what to store (the settled value of a promise), `stored` the entry it came from.
 * @type {Map<string, { value: any, shapes?: any, stored?: MemoValue }>}
 */
const built = new Map();

/**
 * @internal Hands this run the cache the host kept from earlier runs.
 * @param {MemoEntry[]} [entries]
 */
export function loadMemo(entries = []) {
  given = new Map(entries.map((entry) => [entry.key, entry.value]));
  built.clear();
}

/**
 * @internal The entries this run used or made, for the host to keep for the next run.
 * Entries the run did not touch are left out, so the cache follows the program.
 * @returns {MemoEntry[]}
 */
export function memoEntries() {
  const entries = [];
  for (const [key, { value, shapes, stored }] of built) {
    if (stored) entries.push({ key, value: stored });
    else if (!(value instanceof Promise)) entries.push({ key, value: store(value) });
    else if (shapes !== undefined) entries.push({ key, value: { ...store(shapes), async: true } });
    // A promise the program never waited for has nothing to store yet.
  }
  return entries;
}

/**
 * Remembers what `fn` builds for each set of arguments, so it is built once.
 *
 * In `cadcode dev` and in the playground the results also outlive the run: a save
 * that leaves the function's code and arguments as they were reuses them instead
 * of building again. The key is the function's source, its arguments and the
 * resolution set with `setResolution`. A change in a helper the function calls, or
 * in a variable it reads from outside, is not seen, so pass everything the function
 * depends on as arguments.
 *
 * Arguments must be plain data: numbers, strings, booleans, null, arrays and plain
 * objects. The function must return a solid, a 2D shape, or nested arrays of them;
 * it may be async.
 *
 * @template {(...args: any[]) => any} F
 * @param {F} fn
 * @returns {F}
 */
export function memo(fn) {
  if (typeof fn !== 'function') throw new Error(`memo() takes a function, got ${describe(fn)}`);
  const source = fn.toString();
  return /** @type {F} */ (
    (...args) => {
      args.forEach((arg, i) => checkArgument(arg, `argument ${i + 1}`));
      const key = JSON.stringify([source, args, [resolution.fn, resolution.fa, resolution.fs]]);
      if (built.has(key)) return built.get(key).value;
      if (given.has(key)) {
        const stored = /** @type {MemoValue} */ (given.get(key));
        const shapes = restore(stored);
        if (shapes !== undefined) {
          const value = stored.async ? Promise.resolve(shapes) : shapes;
          built.set(key, { value, shapes, stored });
          return value;
        }
      }
      const value = fn(...args);
      if (value instanceof Promise) {
        const pending = value.then((resolved) => {
          checkResult(resolved);
          built.set(key, { value: pending, shapes: resolved });
          return resolved;
        });
        // Until it settles, a second call waits on the same promise; a failure is not remembered.
        built.set(key, { value: pending });
        pending.catch(() => built.delete(key));
        return pending;
      }
      checkResult(value);
      built.set(key, { value });
      return value;
    }
  );
}

const describe = (value) =>
  value === null ? 'null' : Array.isArray(value) ? 'an array' : value instanceof Solid ? 'a solid' : value instanceof Shape2 ? 'a 2D shape' : typeof value;

function checkArgument(value, where) {
  if (value === null || value === undefined || ['number', 'string', 'boolean'].includes(typeof value)) return;
  if (Array.isArray(value)) return value.forEach((item, i) => checkArgument(item, `${where}[${i}]`));
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [name, item] of Object.entries(value)) checkArgument(item, `${where}.${name}`);
    return;
  }
  throw new Error(
    `memo(): ${where} is ${describe(value)}. Arguments must be plain data (numbers, strings, booleans, arrays, objects); pass the numbers a shape is built from instead of the shape.`,
  );
}

function checkResult(value) {
  if (!value || value instanceof Solid || value instanceof Shape2) return;
  if (Array.isArray(value)) return value.forEach(checkResult);
  throw new Error(`memo(): the function returned ${describe(value)}. It must return a solid, a 2D shape, or arrays of them.`);
}

/** A value as plain data. @returns {MemoValue} */
function store(value) {
  if (Array.isArray(value)) return { list: value.map(store) };
  if (value instanceof Shape2) return { shape: value.toPolygons() };
  if (value instanceof Solid) {
    const { vertProperties, numProp, triVerts, runIndex, runOriginalID } = value.manifold.getMesh();
    const positions = new Float32Array(vertProperties.length / numProp * 3);
    for (let v = 0; v < positions.length / 3; v++) positions.set(vertProperties.subarray(v * numProp, v * numProp + 3), v * 3);
    const colors = Array.from(runOriginalID, (id) => colorOfId(id) ?? null);
    return { solid: { positions, triangles: new Uint32Array(triVerts), runIndex: new Uint32Array(runIndex), colors } };
  }
  return { none: true };
}

/** Shapes from plain data, or undefined when a mesh does not come back whole, so the function runs instead. */
function restore(stored) {
  if ('list' in stored) {
    const items = stored.list.map(restore);
    return items.includes(undefined) ? undefined : items;
  }
  if ('shape' in stored) return new Shape2(new CrossSection(stored.shape, 'Positive'));
  if ('solid' in stored) {
    const { positions, triangles, runIndex, colors } = stored.solid;
    const ids = new Uint32Array(reserveColorIds(colors));
    const mesh = new Mesh({ numProp: 3, vertProperties: positions, triVerts: triangles, runIndex, runOriginalID: ids });
    mesh.merge();
    try {
      const manifold = new Manifold(mesh);
      return manifold.status() === 'NoError' ? new Solid(manifold) : undefined;
    } catch {
      return undefined;
    }
  }
  return null;
}
