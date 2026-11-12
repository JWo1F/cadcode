// Solids and 2D shapes are built lazily. Each one records the operation that makes it
// from its inputs, and the manifold-3d objects are made only when geometry is asked
// for: a mesh, a bounding box, a volume.
//
// This is about WASM memory. manifold-3d objects live outside the JS heap and are
// freed only by .delete(). A program like `plate = plate.subtract(hole)` in a loop
// would otherwise keep a live handle on every intermediate result, and manifold can
// merge a chain of booleans into one operation only when nothing else holds the
// steps of the chain: with every step held, 1000 holes took 2.5 GB and 7 s instead
// of 33 MB and 0.3 s. Built lazily, every intermediate handle is deleted as soon as
// the step after it exists, and only the shapes geometry was asked of keep theirs.

/**
 * A shape's place in the tree: the WASM object once it is built, or until then its
 * inputs and the function that makes it from their WASM objects.
 * @typedef {{ handle?: any, inputs?: object[], make?: (handles: any[]) => any }} Node
 */

/** @type {WeakMap<object, Node>} */
const nodes = new WeakMap();

/** @internal Gives `shape` a WASM object that is already built: a primitive, an import. */
export function leaf(shape, handle) {
  nodes.set(shape, { handle });
}

/**
 * @internal Gives `shape` the operation that makes it from `inputs`, run when its geometry is asked for.
 * `make` gets the inputs' WASM objects and returns a new one; it must delete any other object it makes,
 * and must not delete the ones it is given.
 * @param {object} shape
 * @param {object[]} inputs
 * @param {(handles: any[]) => any} make
 */
export function deferred(shape, inputs, make) {
  nodes.set(shape, { inputs, make });
}

/** @internal The WASM object of a shape, built if it is not yet. */
export function handleOf(shape) {
  const node = nodes.get(shape);
  return node.handle ?? build([shape])[0];
}

/**
 * @internal Builds several shapes in one pass, so what they share is built once, and keeps the WASM
 * object of each. Intermediate objects are deleted as soon as everything made from them is made.
 * @param {object[]} roots
 * @returns {any[]} the roots' WASM objects
 */
export function build(roots) {
  // Order the unbuilt shapes so inputs come first, and count how many operations use each.
  /** @type {object[]} */
  const order = [];
  /** @type {Map<object, number>} */
  const uses = new Map();
  const seen = new Set();
  // Pushed in reverse, so shapes are built in the order they are given: color() takes a new
  // mesh ID when it is built, and the order of the IDs is the order of a mesh's colors.
  /** @type {[object, boolean][]} */
  const stack = roots.map((root) => /** @type {[object, boolean]} */ ([root, false])).reverse();
  while (stack.length > 0) {
    const [shape, inputsDone] = /** @type {[object, boolean]} */ (stack.pop());
    if (inputsDone) {
      order.push(shape);
      continue;
    }
    const node = /** @type {Node} */ (nodes.get(shape));
    if (node.handle || seen.has(shape)) continue;
    seen.add(shape);
    stack.push([shape, true]);
    const inputs = /** @type {object[]} */ (node.inputs);
    for (const input of inputs) uses.set(input, (uses.get(input) ?? 0) + 1);
    for (let i = inputs.length - 1; i >= 0; i--) stack.push([inputs[i], false]);
  }

  const keep = new Set(roots);
  /** @type {Map<object, any>} the objects made in this pass that are not kept yet */
  const made = new Map();
  for (const shape of order) {
    const node = /** @type {Node} */ (nodes.get(shape));
    const inputs = /** @type {object[]} */ (node.inputs);
    const handle = /** @type {(handles: any[]) => any} */ (node.make)(inputs.map((input) => made.get(input) ?? nodes.get(input)?.handle));
    if (keep.has(shape)) nodes.set(shape, { handle });
    else made.set(shape, handle);
    for (const input of inputs) {
      const left = /** @type {number} */ (uses.get(input)) - 1;
      uses.set(input, left);
      if (left === 0 && made.has(input)) {
        made.get(input).delete();
        made.delete(input);
      }
    }
  }
  return roots.map((root) => nodes.get(root)?.handle);
}
