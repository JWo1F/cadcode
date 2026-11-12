// The manifold-3d WASM instance. Every solid and 2D shape must come from this one instance.
import Module from 'manifold-3d';

const wasm = await Module();
wasm.setup();
const { Manifold, CrossSection, Mesh } = wasm;
/** @internal The WASM instance's classes, for text() and the importers: shapes must all come from one instance. */
export { CrossSection, Manifold, Mesh };
/** @internal Triangles covering polygons (counterclockwise outlines, clockwise holes), as indices into their points in order. */
export const triangulate = (polygons) => wasm.triangulate(polygons);
