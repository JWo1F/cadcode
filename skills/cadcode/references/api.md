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
- Paths
- Hardware and components
- Lofts and threads
- Helpers

## 3D primitives

| Function | Notes |
| --- | --- |
| `tray(size, { wall, floor = wall, round = 0, fn })` | Open-topped box around a cavity `size` `[x, y, z]` with a corner at the origin: walls `wall` thick outside it, a floor `floor` thick below, open at z = size[2]. `round` rounds the outside's vertical corners, the inside's by `round - wall`. Outside is `[x + 2·wall, y + 2·wall, z + floor]` from `[-wall, -wall, -floor]`. |
| `cube(size = 1, { center = false, round, chamfer, fn })` | `size`: number or `[x, y, z]`. Corner at origin unless centered. `round: r` rounds every edge, `chamfer: c` cuts every edge at 45°, inside the same size. By group: `{ round: { z, top, bottom }, chamfer: { ... } }` — `z` vertical edges, `top`/`bottom` the four around that face; a group takes round or chamfer, not both. A top/bottom treatment follows rounded vertical corners. Errors when a size does not fit. |
| `cylinder({ h, r, d, r1, r2, d1, d2, center = false, round, chamfer, axis = 'z', fn })` | Along +Z from z = 0 (or centered); `axis: 'x' \| 'y'` lays it along +X / +Y (instead of `.rotate([0, 90, 0])` / `.rotate([-90, 0, 0])`). `r1`/`d1` bottom, `r2`/`d2` top for cones. `round`/`chamfer` soften the top and bottom edges inside the same size; `{ top, bottom }` for one end or different sizes. |
| `sphere(r)` / `sphere({ r, d, fn })` | Centered on the origin. |
| `polyhedron(points, faces)` | Faces list point indices **clockwise seen from outside** (OpenSCAD order). Throws if not closed. |

## 2D primitives

| Function | Notes |
| --- | --- |
| `square(size = 1, { center = false, round, chamfer, fn })` | `size`: number or `[x, y]`. `round`/`chamfer` inside the same size, as for `polygon` (corner 0 at min x/y, CCW). Use instead of `square([w - 2r, h - 2r]).offset(r)`. |
| `slot(from, to, width, { fn })` | Stadium with round ends of `width` centered on `from`, `to` (hull of two circles). Equal points = circle. Use instead of `square([l, 0.01]).offset(w / 2)` hacks. |
| `circle(r)` / `circle({ r, d, fn })` | Centered. |
| `ellipse([rx, ry])` / `ellipse({ r: [rx, ry], d: [w, h], fn })` | Centered; segments of a circle of max(rx, ry); same points as `circle(1).scale([rx, ry])` — use it instead of that. |
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
| `.clip({ x, y, z }, { outside = false })` | Intersect with a box: each given axis `[from, to]` (±Infinity ok), others unbounded; `outside: true` subtracts the box instead. Replaces BIG-cube half-spaces, slabs and notches. |
| `.isEmpty()` | |
| `.fillet(r, { between, touching, along, convex, where, fn })` / `.chamfer(size, filter)` | Post-boolean edge rounding. Edge = run of mesh edges with > 20° turn, chained along ONE flat face (base) through points where it bends ≤ 60° (rims round rounded corners and cylinder rims are single closed edges; box corners end a run). Outside (convex) edges: subtract swept sliver; inside: union filler (stops at open ends). Filters (all must hold): `between: [dirA, dirB]` (faces at the edge's start, either order), `touching: dir`, `along: 'x'\|'y'\|'z'\|vec` (straight only), `convex: bool`, `where: fn(edge)`. No filter = every edge; zero matches throws. Rounds overlap at corners (no ball blends). Keep r below the adjacent faces' sizes. Order matters: fillet vertical corners first, then rims (they then run round). |
| `.edges(filter)` | `{ points, closed, from, to, direction (null if not straight), length, normals: [base, side at start], convex, angle }[]` — inspect before filleting. |
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
| `.ring(t, { outward = false })` | `shape − shape.offset({ delta: −t })` (or `offset(+t) − shape`): a wall along the whole outline, including an edge meant to stay open — clip it off. |
| `.clip({ x, y })` | As for Solid. |
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
| `solid.face('+X' \| '-X' \| '+Y' \| '-Y' \| '+Z' \| '-Z')` | Side of the **bounding box** (not mesh faces), normal outward. u, v = the other two axes in order, **seen from outside**: X side → (y, z), Y side → (x, z), Z side → (x, y), but on `-X`, `+Y`, `-Z` u is **negated** (−y, −x, −x). So a hole at world `[y, z]` is drawn at `[y, z]` on `+X` and at `[-y, z]` on `-X`. Every frame is a rotation: text reads right from outside, placed parts are never mirrored. `face(side, { world: true })`: u, v along **positive** world axes on every side (+Y → (x, z), −X → (y, z)), for cuts laid out in world coordinates instead of `.mirror([1, 0])`; on `-X`, `+Y`, `-Z` it is a mirror frame, so text/placed parts come out mirrored. |
| `solid.surfaceAt(side, [u, v])` | Ray from `face(side)` at its `[u, v]` (as for `face`) straight in; `frameAt(hit, outward triangle normal)` of the **first** surface met (normal smoothed across facets — within ~0.05° on a fn 160 ellipsoid — and kept per face at edges sharper than 40°). Throws on a miss. Use for features on domes/slopes instead of hand-written surface formulas (`domeZ`, `atan2` tilt). |
| `plane.XY` / `plane.XZ` / `plane.YZ` | Through the origin, u, v world coordinates; normals +Z, **−Y**, +X (`plane.XZ` = OpenSCAD `rotate([90,0,0]) linear_extrude`). |
| `frameAt(origin, normal)` | Any point/normal (e.g. on a dome). Right-handed: v toward +Z (or +Y when the normal is vertical), u = v × normal. |
| `frame.extrude(shape2, depth, { through = false, center = false })` | `depth > 0` along the normal (out), `< 0` against it (into the part), `0` throws. `through: true` adds 1 at both ends (cuts through a wall); `through: 'start'` adds 1 back past the plane only (a blind pocket from a face, or a boss sunk into its base) — never a hand-written `+1`. `center`: plane in the middle, `|depth|` thick; not with `'start'`. |
| `frame.hole(shape2, depth)` | Cutter clean through `depth` (> 0) of material into the part = `extrude(shape2, -depth, { through: true })`. |
| `frame.pocket(shape2, depth)` | Pocket cutter `depth` (> 0) deep from the plane = `extrude(shape2, -depth, { through: 'start' })`. |
| `frame.offset(d)` | Moved along the normal. |
| `frame.flip()` | Half a turn about v: normal and u reversed, v kept (still a rotation). For −Z cutters on a frame whose normal points into the part. |
| `frame.place(solid \| point \| component)` | Local X, Y → u, v; local Z → normal. |
| `frame.origin`, `frame.normal` | `[x, y, z]`. |

`toFront(shape, depth, y0)` (extrude towards -Y from y = y0) is `plane.XZ.offset(-y0).extrude(shape, depth)`; towards +Y it is `extrude(shape, -depth)`.

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

## Paths

| API | Notes |
| --- | --- |
| `path(start, { fn })` | Mutable builder (each method returns the same `Path`); pieces start where the last ended. Curves: a point per `360/fn` degrees of turning, else per `fa` degrees but segments no shorter than `fs` — placed where the curve bends, not evenly in t. |
| `.line(p)` / `.line({ angle, length })` | Straight piece. |
| `.curve(c1, c2, p)` / `.quad(c, p)` / `.smooth(c2, p)` | Cubic / quadratic Bézier; `smooth` mirrors the last cubic's c2 (SVG `S`), else c1 = current point. |
| `.arc(p)` / `.arc(p, { start: deg })` / `.arc(p, { through: q })` | Tangent arc continuing the heading, or leaving at `start` degrees (a corner), or through q (first piece needs start or through); collinear = line. |
| `.spline([p1, …, pn], { start, end })` | Centripetal Catmull-Rom through the points, starting tangent to the heading unless `start` (degrees) overrides it, `end` = arrival angle. |
| `.close({ round, chamfer, fn })` | Adds a closing line if needed → `Shape2`. Corner options index **joins** (0 = start, then each piece's end), number/object/function as for `polygon`; cut-back measured along the outline (reaches over curve segments); tangent joins are skipped, cusps throw, each stretch between joins must fit both cut-backs. |
| `.stroke(width, { cap = 'round' \| 'flat' })` / `stroke(points, width, { cap, closed, fn })` | Polyline of a width: segment rectangles + round joints (and round ends unless flat). |
| `.points()` / `.end` | `[x, y][]` from the start (for `sweep`, map to `[x, 0, y]` etc.) / current point. |
| `spline(points, { closed, start, end, fn })` | Closed → `Shape2` (≥ 3 points), open → `Path` (≥ 2). |
| `s.path(...)` / `s.spline(...)` | Same, in a sketch: viewer shows trace (dashed), piece ends, Bézier handles, and the closed outline. |

Use paths for revolve profiles and organic outlines instead of hand-computed `cos`/`sin` arcs or hulls of circles.

## Hardware and components

Sizes `'M2'`, `'M2.5'`, `'M3'`, `'M4'`, `'M5'`, `'M6'`, `'M8'` (machine) and `'W3'`, `'W3.5'`, `'W4'`, `'W4.5'`, `'W5'`, `'W6'` (wood/chipboard: clearance d + 0.5, 90° countersunk 2d, pan head as capHead, tap 0.75d, nut/insert null → nutTrap/insert throw); others throw. Cutters start at z = 0, go down along -Z, and reach 1 above z = 0 — place them with `face.place(cutter)` (local -Z goes into the part on any face), never a hand-written `+1`. Hole polygons are circumscribed: flats ≥ the diameter at any `fn`.

| API | Notes |
| --- | --- |
| `screw(size)` | `{ d, clearance, tap, capHead: { d, h }, countersunk: { d }, nut: { s, h }, insert: { d, depth } }` in mm. `tap` = pilot for self-tapping into plastic. Insert holes vary by brand. |
| `fit('press' \| 'slide' \| 'loose')` | Clearance per side: 0.1 / 0.2 / 0.4. `setFit({ press, slide, loose })` changes them globally. Use `2 * fit('slide')` instead of a hand-picked `+0.4`. |
| `screwHole(size, { length, head = 'none' \| 'cap' \| 'countersunk', hole = 'clearance' \| 'tap' \| 'insert', headDepth, fn })` | Cap: counterbore head d + 2·fit('slide'), `headDepth` (default head height) deep. Countersunk: 90° cone, head d at z = 0 (`headDepth` sinks it). `insert`: `length` defaults to the insert depth. |
| `boss(size, { h, d, hole = 'tap', floor = 1, fn })` | Cylinder z 0..h with the hole from the top; tap/insert leave a `floor` (insert needs h ≥ depth + floor), clearance goes through. Default d = max(2.2·d, hole + 3.2), rounded up to 0.1. |
| `nutTrap(size, { depth, clearance })` | Hex pocket cutter, across flats s + 2·clearance (default `fit('slide')`), depth nut h + 0.2. Corners on ±X. |
| `Component` | `{ body, cutout, points }`; `translate`, `rotate`, `mirror`, `transform`, `place(frame)`, `align(target, opts)` (by the body's bbox) move all three and return a new one; `at(side)` from the body. `new Component({ body, cutout, points })` for your own. |
| `usbC({ clearance, recess, fn })` | Mouth at x = 0 facing -X, body along +X, centered y = z = 0, 8.94 × 3.26 × 7.35. Cutout from x = 0.5 to -12. `recess: { size: [w, h], gap, round = 0 }` adds a pocket for the plug's overmold, centered on the mouth, from x = -gap out to -12: `gap` is how close the overmold must come, so the pocket's depth in the wall follows the wall. Point `mouth`. |
| `proMicro({ clearance, length, width, thickness, usbDrop, usbOverhang, recess, fn })` | PCB 34 × 17 × 1.6 by default (pass the model's params so the dummy follows them), x 0..34, y centered, z 0..1.6; USB-C mouth at x = -0.5, center z = 2.23. Cutout: connector only, plus `recess` as for `usbC`. Point `usb`. |
| `oled091({ clearance, board, glass, active, glassShift, activeShift })` | Board 38 × 12 × 1.2 on z = 0 centered, glass 30 × 11.5 × 1.4 on top, view +Z. Cutout: pocket + window (active 22.4 × 5.6 + 0.6) up 10 from the glass. |
| `ec11({ clearance, shaft = 20, fn })` | Mounting face z = 0, body 12 × 12 below, bushing d 7 to z 7, D-shaft d 6 to `shaft`. Cutout: d 7 + 2·clearance, z -6.5..12 (cuts the panel with the face on either side of it). Point `face`. |
| `led5({ clearance, d = 5, h = 8.6, flange = [5.8, 1], fn })` | Flange on z = 0, `h` tall in all. Cutout: d 5 + 2·clearance from z 1 up 20. |
| `cell({ d = 18.4, length = 65.2, clearance, fn })` | Along +X from 0 to length, axis y = 0, z = d/2. Cutout: grown by clearance all round, clipped at z = 0 so it never digs into the floor. |

Component dimensions are nominal — tell the user to measure their part.

## Lofts and threads

| Function | Notes |
| --- | --- |
| `loft(sections, { z })` | `Shape2` sections flat at increasing heights `z[i]`, straight faces between neighbours (several sections for a curve). One outline per section, no holes: subtract them after. Point counts are evened by adding points along edges (corners kept); each section starts where it best lines up with the one below. |
| `thread({ d, pitch, length, profile = 'iso', internal = false, clearance = 0.2, starts = 1, leftHand = false, taper = 0, fn })` | Threaded rod along +Z, 0..`length`, `d` = major diameter. Profiles `'iso'` (60°, basic ISO metric), `'trapezoid'` (30°, p/2 deep), `'square'`. `internal: true` = cutter for the matching hole: tooth grown by `clearance` on every face, z from -1 to `length + 1`; subtract it. A rod and a cutter of the same `d`/`pitch` line up at the same z. `taper` (≤ length/3): chamfer from root to crest at each end, countersink on the cutter. `starts`: multi-start, lead = starts × pitch. `fn`: segments per turn. Coarse ISO pitches: M3 0.5, M4 0.7, M5 0.8, M6 1, M8 1.25, M10 1.5, M12 1.75. |

## Helpers

| Function | Notes |
| --- | --- |
| `helix({ r \| d, pitch, turns \| height, leftHand = false, fn })` | `[x, y, z]` points from `[r, 0, 0]`, counterclockwise from above (right-hand), rising `pitch` per turn; `fn` points per turn. For `.sweep()`. |
| `grid(shape, { pitch, within \| count, stagger = false })` | Union of copies (Solid or Shape2, drawn at origin) on an XY grid. `within: Shape2`: n per axis = floor((region − shape size) / pitch) + 1, centered on the region's bbox, then only copies whose footprint lies wholly inside are kept. `count: n \| [nx, ny]`: centered on the origin. `stagger`: odd rows +pitch/2 in X with one copy fewer. Replaces product(range, range) hole grids. |
| `polar(shape, { count, r = 0, start = 0, angle = 360 })` | Union of copies `translate([r, 0])` then `rotate(start + i·step)`; full circle: step = angle/count, else angle/(count−1). |
| `arrange(parts, { gap = 5, columns })` | Print layout: parts (a Solid or an array moving together; falsy kept) in a row along +X or rows of `columns` along +Y (rows left-aligned, parts centered in Y on their row), `gap` apart by bbox, centered on the origin. Z is kept — `layFlat()` first. Returns the same structure. |
| `polarPoint(r \| [rx, ry], deg, center = [0, 0])` | `[cx + rx cos, cy + ry sin]`. |
| `range(start, end, step = 1)` | Inclusive of `end`. |
| `product(...lists)` | Cartesian product: `product([1, 2], ['a'])` → `[[1, 'a'], [2, 'a']]`. |
| `memo(fn)` | Same function, remembering its result per arguments. Key = fn source + JSON args + resolution + fits (`setFit`); in `cadcode dev`/playground it survives across saves (not the CLI). Args: plain data only (no shapes). Result: shapes or nested arrays, may be async. Closure variables (`p`!) and called helpers are NOT in the key: pass them as args or results go stale. |
| `setResolution({ fn, fa, fs })` | Defaults for curves, OpenSCAD rules. `fn > 0` wins; else `ceil(max(min(360/fa, 2πr/fs), 5))`. |
| `parseColor(c, alpha?)` | Returns `[r, g, b, a]`. |
| `Solid`, `Shape2`, `Frame`, `Sketch` | Classes, for `instanceof`. |
