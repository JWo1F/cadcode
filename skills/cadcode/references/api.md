# cadcode API

Everything is imported from `'cadcode'`. Shapes are immutable; every method returns a new shape.
Wherever several shapes are accepted (`...shapes`), nested arrays and falsy values are allowed.

## Contents

- 3D primitives
- 2D primitives
- `Solid` methods
- `Shape2` methods
- Functions
- Frames
- Sketches
- Lofts and threads
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
| `square(size = 1, { center = false, round, chamfer, fn })` | `size`: number or `[x, y]`. `round`/`chamfer` inside the same size, as for `polygon` (corner 0 at min x/y, CCW). Use instead of `square([w - 2r, h - 2r]).offset(r)`. |
| `slot(from, to, width, { fn })` | Stadium with round ends of `width` centered on `from`, `to` (hull of two circles). Equal points = circle. Use instead of `square([l, 0.01]).offset(w / 2)` hacks. |
| `circle(r)` / `circle({ r, d, fn })` | Centered. |
| `polygon(points, paths?, { round, chamfer, fn })` | Even-odd fill: paths inside other paths are holes. `paths` may be left out with options second. `round`/`chamfer`: number = every corner, function `(i, [x, y]) => size` (0/undefined = sharp) = each corner, `{ index: size }` = by index into `points` (an index wins over a number/function; a round and a chamfer at the same level on one corner throw). Inside (reflex) corners round into fillets. Throws when a size does not fit along a side. Replaces `hull()` of circles and `offset(r).offset(-r)` tricks for per-corner radii. |
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
| `.layFlat(side = '-Z')` | Rotate so that bbox side faces -Z, then center in XY and set min z = 0. Print orientation: `lid.layFlat('+Z')`. Replaces hand-written onBed/faceDown helpers. |
| `.at(side = 'center')` | `Point` at the bbox center or a side's center (`'+X'`…`'-Z'`). |
| `.align(target, { x, y, z, gap = 0 })` | Translate so bboxes line up per axis: `'min'`/`'max'` flush on that side (gap = inset), `'center'`, `'before'`/`'after'` wholly past target's min/max (gap = clearance). Target: Solid, Shape2, Point or `[x, y, z]`. Omitted axes don't move. Prefer over hand-computed `translate` from another part's dimensions. |

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
| `.sweep(path, { closed = false, twist = 0, scale = 1, up })` | Along `path`, `[x, y, z]` points. The drawing's +Z follows the path, carried without twist (rotation-minimizing); `up: v` keeps its +Y toward `v` instead. Starts as `extrude` would on a path along +Z. `closed` loops back to the first point (no scale; twist only in whole turns). Corners mitered. A path tighter than the profile self-intersects: no check. |
| `.area()`, `.bounds()`, `.isEmpty()`, `.toPolygons()` | |
| `.at(side)`, `.align(target, { x, y, gap })` | As for `Solid`, X/Y only; `at` returns `[x, y]`. |

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

## Frames

A `Frame` is a plane with 2D coordinates u, v and a normal w. Use it instead of `.extrude().rotate().translate()` chains.

| Function | Notes |
| --- | --- |
| `solid.face('+X' \| '-X' \| '+Y' \| '-Y' \| '+Z' \| '-Z')` | Side of the **bounding box** (not mesh faces), normal outward. u, v = **world coordinates** of the other two axes in order: X side → (y, z), Y side → (x, z), Z side → (x, y). So a hole at world `[y, z]` on either X side is drawn at `[y, z]`. Text drawn on a `-X`, `+Y` or `-Z` side reads mirrored from outside. |
| `solid.surfaceAt(side, [u, v])` | Ray from `face(side)` at world `[u, v]` straight in; `frameAt(hit, outward triangle normal)` of the **first** surface met (facet normal: coarse `fn` = coarse normal). Throws on a miss. Use for features on domes/slopes instead of hand-written surface formulas (`domeZ`, `atan2` tilt). |
| `plane.XY` / `plane.XZ` / `plane.YZ` | Through the origin, u, v world coordinates; normals +Z, +Y, +X. |
| `frameAt(origin, normal)` | Any point/normal (e.g. on a dome). Right-handed: v toward +Z (or +Y when the normal is vertical), u = v × normal. |
| `frame.extrude(shape2, depth, { through = false, center = false })` | `depth > 0` along the normal (out), `< 0` against it (into the part), `0` throws. `through: true` adds 1 at both ends (cuts through a wall); `through: 'start'` adds 1 back past the plane only (a blind pocket from a face, or a boss sunk into its base) — never a hand-written `+1`. `center`: plane in the middle, `|depth|` thick; not with `'start'`. |
| `frame.offset(d)` | Moved along the normal. |
| `frame.place(solid \| point)` | Local X, Y → u, v; local Z → normal. |
| `frame.origin`, `frame.normal` | `[x, y, z]`. |

`toFront(shape, depth, y0)` (extrude towards -Y from y = y0) is `plane.XZ.offset(y0).extrude(shape, -depth)`.

## Sketches

Construction geometry in a frame's 2D coordinates. Points are plain `[x, y]` (feed them to `polygon`,
`.translate`). Return the sketch in a part to see the guides (dashed, crossings marked) — debugging aid only:
never exported, and passing a sketch, line or circle to a boolean throws.

| API | Notes |
| --- | --- |
| `sketch(frame = plane.XY)` | `Sketch` on a frame (`box.face('-X')`, `plane.XZ.offset(y)`, `frameAt`). `s.frame` reads it. |
| `s.line(a, b)` / `s.line(a, { angle, length })` | Segment for drawing, **endless for crossings**; `{ angle }` without `length` is endless (drawn across the sketch). Props: `start`, `end`, `endless`, `direction`, `angle`, `length`, `mid`; `at(t)` (t may go past 0..1). |
| `line.parallel(d)` | `+d` left looking start→end, `-d` right; same stretch; endless stays endless. |
| `line.perpendicular(p)` | Through `p`; off the line: from `p` to the foot (`.end` = foot); on the line: endless. |
| `line.intersect(line)` | `[x, y]`; parallel throws. |
| `line.intersect(circle)` / `circle.intersect(line)` | `[]`, `[touch]` or `[p1, p2]` ordered along the line's direction. |
| `circle.intersect(circle)` | Ordered: left of the line from this center to the other first. Same circle throws. |
| `s.circle(c, r)` | Guide circle (`center`, `r`, `at(deg)`). Not `circle()` the shape. |
| `s.point(p)` | Marks `p` in the viewer, returns it. Crossings are marked automatically. |
| `s.polygon(...)` | Same args as `polygon()`; drawn in place. Returns `Shape2` in frame coords. |
| `s.extrude(shape, depth, { through })` | `s.frame.extrude(...)`. |

## Lofts and threads

| Function | Notes |
| --- | --- |
| `loft(sections, { z })` | `Shape2` sections flat at increasing heights `z[i]`, straight faces between neighbours (several sections for a curve). One outline per section, no holes: subtract them after. Point counts are evened by adding points along edges (corners kept); each section starts where it best lines up with the one below. |
| `thread({ d, pitch, length, profile = 'iso', internal = false, clearance = 0.2, starts = 1, leftHand = false, taper = 0, fn })` | Threaded rod along +Z, 0..`length`, `d` = major diameter. Profiles `'iso'` (60°, basic ISO metric), `'trapezoid'` (30°, p/2 deep), `'square'`. `internal: true` = cutter for the matching hole: tooth grown by `clearance` on every face, z from -1 to `length + 1`; subtract it. A rod and a cutter of the same `d`/`pitch` line up at the same z. `taper` (≤ length/3): chamfer from root to crest at each end, countersink on the cutter. `starts`: multi-start, lead = starts × pitch. `fn`: segments per turn. Coarse ISO pitches: M3 0.5, M4 0.7, M5 0.8, M6 1, M8 1.25, M10 1.5, M12 1.75. |

## Helpers

| Function | Notes |
| --- | --- |
| `helix({ r \| d, pitch, turns \| height, leftHand = false, fn })` | `[x, y, z]` points from `[r, 0, 0]`, counterclockwise from above (right-hand), rising `pitch` per turn; `fn` points per turn. For `.sweep()`. |
| `arrange(parts, { gap = 5, columns })` | Print layout: parts (a Solid or an array moving together; falsy kept) in a row along +X or rows of `columns` along +Y, `gap` apart by bbox, centered on the origin. Z is kept — `layFlat()` first. Returns the same structure. |
| `range(start, end, step = 1)` | Inclusive of `end`. |
| `product(...lists)` | Cartesian product: `product([1, 2], ['a'])` → `[[1, 'a'], [2, 'a']]`. |
| `memo(fn)` | Same function, remembering its result per arguments. Key = fn source + JSON args + resolution; in `cadcode dev`/playground it survives across saves (not the CLI). Args: plain data only (no shapes). Result: shapes or nested arrays, may be async. Closure variables (`p`!) and called helpers are NOT in the key: pass them as args or results go stale. |
| `setResolution({ fn, fa, fs })` | Defaults for curves, OpenSCAD rules. `fn > 0` wins; else `ceil(max(min(360/fa, 2πr/fs), 5))`. |
| `parseColor(c, alpha?)` | Returns `[r, g, b, a]`. |
| `Solid`, `Shape2`, `Frame`, `Sketch` | Classes, for `instanceof`. |
