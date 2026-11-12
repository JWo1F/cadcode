// How a model is drawn, shared by the browser's view (client/render-worker.js) and
// the software renderer behind `cadcode png` (src/export/raster.js), so a preview
// image looks like the view.

/** The colour of a solid that has none: the filament yellow. */
export const DEFAULT_COLOR = '#f2c14e';

/** Where faces meet at more than this many degrees, an outline is drawn. */
export const EDGE_ANGLE = 25;

/** A sketch's outline, in CSS pixels (the view) or output pixels (a PNG). */
export const SKETCH_LINE_WIDTH = 2.5;
