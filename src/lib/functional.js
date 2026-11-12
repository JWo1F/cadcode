// The functional forms of the shape methods, as in OpenSCAD.
import { CrossSection, Manifold, Shape2, Solid, flatten, shapesFor, solidsFor } from './shapes.js';

/** @typedef {import('./shapes.js').SolidItems} SolidItems */
/** @typedef {import('./shapes.js').Shape2Items} Shape2Items */
/** @typedef {import('./shapes.js').ShapeItems} ShapeItems */
/** @typedef {import('./shapes.js').RotateOptions} RotateOptions */
/** @typedef {import('./shapes.js').OffsetOptions} OffsetOptions */
/** @typedef {import('./shapes.js').ExtrudeOptions} ExtrudeOptions */
/** @typedef {import('./colors.js').ColorInput} ColorInput */

// Functional forms. They take any mix of shapes and nested arrays (from loops),
// so OpenSCAD's `translate(v) for (...) child();` becomes `translate(v, xs.map(...))`.

function dimension(items, op) {
  if (items.length === 0) return 'empty';
  const solids = items.filter((s) => s instanceof Solid).length;
  if (solids === items.length) return 'solid';
  if (solids === 0) return 'shape2';
  throw new Error(`${op}() cannot mix 2D shapes and 3D solids`);
}

/** Applies a 3D or 2D operation to all items, depending on what they are. */
function combine(items, op, solidOp, shapeOp) {
  const flat = flatten(items);
  switch (dimension(flat, op)) {
    case 'empty':
      return new Solid(Manifold.compose([]));
    case 'solid':
      return new Solid(solidOp(flat.map((s) => s.manifold)));
    case 'shape2':
      return new Shape2(shapeOp(flat.map((s) => s.section)));
  }
}

/**
 * @overload
 * @param {...SolidItems} items
 * @returns {Solid}
 */
/**
 * @overload
 * @param {...Shape2Items} items
 * @returns {Shape2}
 */
/** @param {...ShapeItems} items @returns {Solid | Shape2} */
export function union(...items) {
  return combine(items, 'union', (ms) => Manifold.union(ms), (cs) => CrossSection.union(cs));
}

/**
 * @overload
 * @param {Solid} base
 * @param {...SolidItems} cutters
 * @returns {Solid}
 */
/**
 * @overload
 * @param {Shape2} base
 * @param {...Shape2Items} cutters
 * @returns {Shape2}
 */
/**
 * Subtracts every following shape from the first one.
 * @param {Solid | Shape2} base
 * @param {...ShapeItems} cutters
 * @returns {Solid | Shape2}
 */
export function difference(base, ...cutters) {
  return base.subtract(...cutters);
}

/**
 * @overload
 * @param {...SolidItems} items
 * @returns {Solid}
 */
/**
 * @overload
 * @param {...Shape2Items} items
 * @returns {Shape2}
 */
/** @param {...ShapeItems} items @returns {Solid | Shape2} */
export function intersection(...items) {
  return combine(items, 'intersection', (ms) => Manifold.intersection(ms), (cs) => CrossSection.intersection(cs));
}

/**
 * @overload
 * @param {...SolidItems} items
 * @returns {Solid}
 */
/**
 * @overload
 * @param {...Shape2Items} items
 * @returns {Shape2}
 */
/** Convex hull of all given shapes, like OpenSCAD's hull(). @param {...ShapeItems} items @returns {Solid | Shape2} */
export function hull(...items) {
  return combine(items, 'hull', (ms) => Manifold.hull(ms), (cs) => CrossSection.hull(cs));
}

/**
 * Minkowski sum of all given solids, like OpenSCAD's minkowski(): `minkowski(part, sphere(1))`.
 * See {@link Solid#minkowski}.
 * @param {...SolidItems} items
 * @returns {Solid}
 */
export function minkowski(...items) {
  const [first, ...rest] = solidsFor('minkowski', items);
  return first ? first.minkowski(rest) : new Solid(Manifold.compose([]));
}

/**
 * @overload
 * @param {number[]} v
 * @param {...SolidItems} items
 * @returns {Solid}
 */
/**
 * @overload
 * @param {number[]} v
 * @param {...Shape2Items} items
 * @returns {Shape2}
 */
/** @param {number[]} v @param {...ShapeItems} items @returns {Solid | Shape2} */
export function translate(v, ...items) {
  return union(...items).translate(v);
}

/**
 * @overload
 * @param {number[] | number} angles
 * @param {RotateOptions} options
 * @param {...SolidItems} items
 * @returns {Solid}
 */
/**
 * @overload
 * @param {number[] | number} angles
 * @param {RotateOptions} options
 * @param {...Shape2Items} items
 * @returns {Shape2}
 */
/**
 * @overload
 * @param {number[] | number} angles
 * @param {...SolidItems} items
 * @returns {Solid}
 */
/**
 * @overload
 * @param {number[] | number} angles
 * @param {...Shape2Items} items
 * @returns {Shape2}
 */
/**
 * `rotate(angles, ...shapes)` or `rotate(angles, { around }, ...shapes)`. 2D shapes take one angle, or `[0, 0, z]`.
 * @param {number[] | number} angles
 * @param {...(RotateOptions | ShapeItems)} rest
 * @returns {Solid | Shape2}
 */
export function rotate(angles, ...rest) {
  const first = rest[0];
  const isOptions = first && typeof first === 'object' && !Array.isArray(first) && !(first instanceof Solid) && !(first instanceof Shape2);
  const options = isOptions ? rest.shift() : undefined;
  return union(...rest).rotate(angles, options);
}

/**
 * @overload
 * @param {number[] | number} v
 * @param {...SolidItems} items
 * @returns {Solid}
 */
/**
 * @overload
 * @param {number[] | number} v
 * @param {...Shape2Items} items
 * @returns {Shape2}
 */
/** @param {number[] | number} v @param {...ShapeItems} items @returns {Solid | Shape2} */
export function scale(v, ...items) {
  return union(...items).scale(v);
}

/**
 * @overload
 * @param {number[]} normal
 * @param {...SolidItems} items
 * @returns {Solid}
 */
/**
 * @overload
 * @param {number[]} normal
 * @param {...Shape2Items} items
 * @returns {Shape2}
 */
/** @param {number[]} normal @param {...ShapeItems} items @returns {Solid | Shape2} */
export function mirror(normal, ...items) {
  return union(...items).mirror(normal);
}

/**
 * `color('orange', lid)` or `color('orange', 0.35, lid)`.
 * @param {ColorInput} c
 * @param {...(number | SolidItems)} rest
 * @returns {Solid}
 */
export function color(c, ...rest) {
  const alpha = typeof rest[0] === 'number' ? rest.shift() : undefined;
  return union(solidsFor('color', rest)).color(c, alpha);
}

/** @param {number | OffsetOptions} options @param {...Shape2Items} items @returns {Shape2} */
export function offset(options, ...items) {
  return shapesFor('offset', items).offset(options);
}

/**
 * `linearExtrude(height, shapes)` or `linearExtrude(height, options, shapes)`.
 * @param {number} height
 * @param {ExtrudeOptions | Shape2Items} [options]
 * @param {...Shape2Items} items
 * @returns {Solid}
 */
export function linearExtrude(height, options, ...items) {
  const isOptions = options === undefined || (typeof options === 'object' && options !== null && !Array.isArray(options) && !(options instanceof Shape2) && !(options instanceof Solid));
  return isOptions ? shapesFor('linearExtrude', items).extrude(height, options) : shapesFor('linearExtrude', [options, ...items]).extrude(height);
}
