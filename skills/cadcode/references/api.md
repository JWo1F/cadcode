# cadcode API

Everything is imported from `'cadcode'`. Shapes are immutable; every method returns a new shape.
Wherever several shapes are accepted (`...shapes`), nested arrays and falsy values are allowed.

## Contents

- 3D primitives
- 2D primitives
- `Solid` methods
- `Shape2` methods
- Functions
- Helpers

## 3D primitives

| Function | Notes |
| --- | --- |
| `cube(size = 1, { center = false, round, chamfer, fn })` | `size`: number or `[x, y, z]`. Corner at origin unless centered. `round: r` rounds every edge, `chamfer: c` cuts every edge at 45°, inside the same size. By group: `{ round: { z, top, bottom }, chamfer: { ... } }` — `z` vertical edges, `top`/`bottom` the four around that face; a group takes round or chamfer, not both. A top/bottom treatment follows rounded vertical corners. Errors when a size does not fit. |
| `cylinder({ h, r, d, r1, r2, d1, d2, center = false, round, chamfer, fn })` | Along +Z from z = 0 (or centered). `r1`/`d1` bottom, `r2`/`d2` top for cones. `round`/`chamfer` soften the top and bottom edges inside the same size; `{ top, bottom }` for one end or different sizes. |
| `sphere(r)` / `sphere({ r, d, fn })` | Centered on the origin. |
| `polyhedron(points, faces)` | Faces list point indices **clockwise seen from outside** (OpenSCAD order). Throws if not closed. |

## 2D primitives

| Function | Notes |
| --- | --- |
| `square(size = 1, { center = false })` | `size`: number or `[x, y]`. |
| `circle(r)` / `circle({ r, d, fn })` | Centered. |
| `polygon(points, paths?)` | Even-odd fill: paths inside other paths are holes. |
| `text(string, { size = 10, font, halign = 'left', valign = 'baseline', spacing = 1, lineHeight = 1, fn })` | A number for options is `{ size }`. `size`: height of the capital H. `font`: TTF/OTF/WOFF bytes (`import font from './x.ttf'`), default Liberation Sans. `halign`: left/center/right by advance width; `valign`: baseline (first line's) or top/center/bottom of the ink. `\n` breaks lines. Curves: `fn` per full turn, else one segment per `fa` degrees (`fs` unused). Throws on a font without an H. |

## Importing files

`import x from './file.ext'` next to the program gives the file's contents (the dev server
watches it); the playground has no files, so pass the contents from `fetch` there.

| Function | Notes |
| --- | --- |
| `importSTL(bytes)` | `Solid` from binary or ASCII STL (`Uint8Array` or `ArrayBuffer`). Throws, without repairing, on an open mesh (counts the open edges), an inside-out one, or a file that is not STL. |
| `import3MF(bytes)` | `Solid[]`, one per build item (non-`model` types skipped), in mm, placed by the build/component transforms (components in other model files via `p:path` too). Per-triangle colors from `basematerials` and `colorgroup`; slicer painting/filament settings are not read. Same closed-mesh errors as STL, naming the object. |
| `importSVG(text, { center = false, dpi = 96, fn })` | `Shape2` from SVG text or bytes. Filled `path`/`rect` (incl. `rx`)/`circle`/`ellipse`/`polygon`/`polyline`, group and element `transform`s, `fill-rule`, `fill="none"` and `display:none` honored (attributes or `style`). Units: `width`/`height` + `viewBox` in mm/cm/in/pt/pc, px or unitless at `dpi`. Y up, origin at the document's bottom-left (`center: true`: bbox center at origin). Curves: `fn` per full turn, else `fa` degrees (`fs` unused). Not imported: strokes, CSS classes (`<style>`), gradients; throws on `<text>`, `<use>`, `<image>` and when nothing is filled. |
| `importDXF(text, { layer, center = false, fn })` | `Shape2` from DXF text or bytes, ENTITIES section only. LINE, ARC, CIRCLE, ELLIPSE, LWPOLYLINE and 2D POLYLINE (bulges become arcs), extrusion direction 0,0,-1 mirrored. Loose pieces are joined end to end (tolerance 1e-6 of the drawing's size) into outlines; even-odd fill, so inner outlines are holes. `layer`: string or array. Units: taken as mm (`$INSUNITS` ignored, as in OpenSCAD). Arcs: `fn` per full circle, else `fa`/`fs`. Skips TEXT, MTEXT, DIMENSION, HATCH, POINT; throws on SPLINE, INSERT, an outline that does not close (names its layer and ends), and no outlines. |

## `point`

`point([x, y, z])` marks a place without geometry (never in an STL), e.g. a pivot. It has
`.translate`, `.rotate` (same arguments as `Solid.rotate`), `.scale`, `.mirror`, `.transform`,
each returning a new point, and `.x`, `.y`, `.z`, `.toArray()`. It cannot go into
booleans or a part's export.

## `Solid` methods

| Method | Notes |
| --- | --- |
| `.translate([x, y, z])` | Missing components are 0. |
| `.rotate([x, y, z])` | Degrees; X then Y then Z. |
| `.rotate(a)` | Around Z. |
| `.rotate(a, [x, y, z])` | Around an arbitrary axis through the origin. |
| `.rotate(..., { around })` | Last argument: turn around a `point`, a shape's bounding-box center, or `[x, y, z]` instead of the origin. |
| `.scale(s)` / `.scale([x, y, z])` | Missing components are 1. |
| `.mirror([nx, ny, nz])` | Across the plane through the origin with that normal. |
| `.transform(m)` | Column-major 4×4 as 16 numbers. |
| `.color(c, alpha?)` | CSS name, `#rgb`/`#rrggbb`/`#rrggbbaa`, or `[r, g, b, a]` in 0..1. Preview only. |
| `.union(...shapes)` | |
| `.subtract(...shapes)` | |
| `.intersect(...shapes)` | |
| `.hull(...shapes)` | Convex hull of this and the others. |
| `.minkowski(...solids)` | Minkowski sum: `.minkowski(sphere(r))` rounds all edges and grows the part by r per side. Seconds on non-convex parts. Uncolored result. |
| `.slice(z = 0)` | `Shape2` cross-section at height z. |
| `.project()` | `Shape2` outline projected onto XY. |
| `.volume()`, `.surfaceArea()` | |
| `.bounds()` | `{ min: [x, y, z], max: [x, y, z] }` |
| `.isEmpty()` | |

## `Shape2` methods

| Method | Notes |
| --- | --- |
| `.translate([x, y])`, `.rotate(a)`, `.scale(s \| [x, y])`, `.mirror([nx, ny])` | |
| `.rotate(a, { around })` | Around a `point`, a shape's bounding-box center, or `[x, y]`. |
| `.offset(r)` / `.offset({ r, fn })` | Round corners; negative shrinks. |
| `.offset({ delta, chamfer = false })` | Sharp corners, or cut with `chamfer: true`. |
| `.union()`, `.subtract()`, `.intersect()`, `.hull()` | As for solids, with `Shape2`s. |
| `.extrude(h, { center, twist, scale, divisions })` | `linear_extrude`. `scale` is a number or `[x, y]`. |
| `.revolve({ angle = 360, fn })` | `rotate_extrude`: the shape's X becomes the radius, Y becomes Z. |
| `.area()`, `.bounds()`, `.isEmpty()`, `.toPolygons()` | |

## Functions

They work on solids or on 2D shapes, but not both mixed. With no shapes they return an empty solid.

| Function | Same as |
| --- | --- |
| `union(...shapes)` | |
| `difference(base, ...cutters)` | `base.subtract(...cutters)` |
| `intersection(...shapes)` | |
| `hull(...shapes)` | |
| `minkowski(...solids)` | `first.minkowski(...rest)`; solids only (2D: `offset`) |
| `translate(v, ...shapes)` | `union(...shapes).translate(v)` |
| `rotate(a, ...shapes)` | `union(...shapes).rotate(a)` |
| `rotate(a, { around }, ...shapes)` | `union(...shapes).rotate(a, { around })` |
| `scale(v, ...shapes)` | `union(...shapes).scale(v)` |
| `mirror(n, ...shapes)` | `union(...shapes).mirror(n)` |
| `color(c, alpha?, ...shapes)` | `union(...shapes).color(c, alpha)` |
| `offset(r, ...shapes)` | `union(...shapes).offset(r)` |
| `linearExtrude(h, options, ...shapes)` | `union(...shapes).extrude(h, options)` |

## Helpers

| Function | Notes |
| --- | --- |
| `range(start, end, step = 1)` | Inclusive of `end`. |
| `product(...lists)` | Cartesian product: `product([1, 2], ['a'])` → `[[1, 'a'], [2, 'a']]`. |
| `setResolution({ fn, fa, fs })` | Defaults for curves, OpenSCAD rules. `fn > 0` wins; else `ceil(max(min(360/fa, 2πr/fs), 5))`. |
| `parseColor(c, alpha?)` | Returns `[r, g, b, a]`. |
| `Solid`, `Shape2` | Classes, for `instanceof`. |
