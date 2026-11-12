# Changelog

Notable changes to cadcode. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Solids and 2D shapes are built when their geometry is first needed, and each intermediate result is freed as soon as the next step is built. A loop like `plate = plate.subtract(hole)` with 1000 holes went from 2.5 GB and 7 s to 23 MB and 0.2 s; with 4000 it no longer runs out of memory.
- `union`, `subtract`, `intersect` and `hull` on a solid refuse a 2D shape, and on a 2D shape a solid, with a message saying so.

## [0.16.0] - 2026-11-13

### Added

- Wood screw sizes `W3` to `W6` for `screw()`, `screwHole()` and `boss()`.
- `clip(ranges, { outside: true })` keeps what lies outside the ranges, for a notch without a big cube.
- `proMicro()`, `oled091()` and `led5()` take their sizes as options, so a model's own params can drive them; `oled091()` shifts an off-center glass or active area. `frame.place()` takes a component.
- `frame.flip()` turns a frame to face the other way, for a cutter on a plane whose normal points into the part, and `boss()` takes a `floor`.
- `rotate([0, 0, z], shape2)` and `shape2.rotate([0, 0, z])` turn a 2D shape as OpenSCAD does, and `linearExtrude(h, shape)` needs no options.
- The functional forms and `spline()` are typed by what they are given: `union(square(1), square(2))` is a `Shape2` and `spline(points, { closed: true })` a `Shape2`, with no cast.

### Changed

- **Breaking:** every frame is a rotation, so nothing placed on one is mirrored. `face('-X')`, `face('+Y')` and `face('-Z')` run u against its world axis (u = -y on `-X`), so a drawing there reads right from outside; `plane.XZ` faces -Y, as OpenSCAD's `rotate([90, 0, 0])` does, so a positive depth grows towards -Y; `flip()` turns half a turn about v. A thread or a chiral part placed on those faces was mirrored before.
- **Breaking:** `nutTrap()` takes `clearance` instead of `fit`, and `cell()` takes `length` instead of `l`, as the other parts do.
- `cadcode stl --all` (and `3mf`, `png`) builds each part in a fresh worker, as `-p` does, so a part that calls `setResolution()` or `setFit()` no longer changes the parts after it. An unknown command is reported before the program is built.
- A threaded hole (`thread({ internal: true })`) is grown so its facets clear a round screw; at the default resolution an M3 hole bound.
- Lengths in the viewer and playground show up to 2 decimals, the same in the readout and the measure label.
- `ec11().cutout` reaches down to the body's bottom, so it cuts the panel whichever side of it the mounting face is put.
- The examples take holes, standoffs and fits from the hardware library and use `clip`, `ring`, `polarPoint` and cylinder axes. The bracket and hook's M4 countersinks are 8.96 across, and the sensor case's battery rests 0.25 lower.

### Fixed

- `cell().cutout` stops at z = 0 instead of digging `clearance` into the floor the cell rests on.
- `cadcode dev`: after a syntax error, a params or part change kept running the last good code and showed it as ready; the error now stays until the file builds, and downloads report it. A download the browser abandons stops its worker.
- `cadcode dev`: an edit made while the server restarts reaches the model after the reconnect, a colour change is not dropped by a quick edit of another field, and restarting on another file restores that file's camera.
- The viewer and the playground show an error instead of staying on "Building" when the browser cannot render (no WebGL), and the playground says when copying a share link fails.
- `memo()` builds again after `setFit()`, as it does after `setResolution()`.
- `rotate([x, y, z], shape2)` gave a shape of infinite size, and `color()`, `offset()` and `linearExtrude()` failed with a TypeError on 2D input or none; they now work or name the mistake.
- Sweeping a profile that came out empty gives an empty solid instead of crashing, and `polyhedron()` refuses inside-out faces with a readable message.
- The playground rewrites a bare `import 'cadcode'`.

## [0.15.0] - 2026-11-12

### Added

- Hardware: `screw('M3')` gives a metric size's clearance and tap holes, cap and countersunk heads, nut and heat-set insert; `screwHole()`, `boss()` and `nutTrap()` make the solids for them, drawn at z = 0 going down, to place on a face with a frame. `fit('slide')` is the clearance per side for a kind of fit, and `setFit()` changes it everywhere.
- Components: `usbC()`, `proMicro()`, `oled091()`, `ec11()`, `led5()` and `cell()` are common parts as a body to see them in place and the cutout to subtract from an enclosure, with named points, which move together.
- `shape.ring(t)` is a wall along an outline, `cylinder({ axis: 'x' })` lies along an axis, and `.clip({ x, y, z })` keeps what lies within ranges, instead of intersecting with big cubes.
- `path.stroke(width)` and `stroke(points, width)` draw a line of a width, and `polarPoint(r, degrees)` finds a point on a circle or an ellipse.

### Changed

- `surfaceAt()` smooths the normal across a curve's facets: on a dome it is within a tenth of a degree of the true surface's instead of a degree or two.

## [0.14.0] - 2026-11-12

### Added

- `ellipse([rx, ry])`, or `{ d: [width, height] }`, is a 2D ellipse centered on the origin.

## [0.13.0] - 2026-11-12

### Added

- `path(start)` draws an outline piece by piece: `line`, Bézier `curve`, `quad` and `smooth`, `arc` tangent, at an angle or through a point, and `spline` through points, then `close()` into a 2D shape with rounded or cut joins, which reach along curves as far as they need; curves get their points where they bend; an open path's `points()` are for `sweep()`. `spline(points, { closed, start, end })` is a smooth curve through points on its own. In a sketch, `s.path()` and `s.spline()` show their curve, points and Bézier handles.

### Changed

- The rocket's tail and nose, the cookie cutter's heart and the headphone hook's strap are drawn as paths. The heart is now 70 wide with gently curved sides.

## [0.12.0] - 2026-11-12

### Added

- Frames: `solid.face('-X')`, `plane.XZ` and `frameAt(point, normal)` are planes to draw 2D shapes on and extrude them from with `frame.extrude(shape, depth, { through })`, instead of rotating them into place. Positions on a face are world coordinates. `frame.place(solid)` puts a solid built at the origin onto a frame. `through: 'start'` reaches past the face only, for a pocket, and `center: true` straddles the plane.
- `solid.surfaceAt(side, [u, v])` is the frame where the solid is first met looking in from a side, with the surface's normal: for a hole or a boss square to a dome.
- `polygon(points, { round, chamfer })` rounds or cuts its corners: every one, some by index, or each by a function of its index and point. An inside corner rounds into a fillet.
- `square(size, { round, chamfer })` rounds or cuts its corners inside the same size, and `slot(from, to, width)` makes a stadium for slotted holes and ports.
- `.at(side)` is the center of a shape's bounding box or one of its sides, and `.align(target, { x, y, z, gap })` lines a shape up with another by their boxes: centered, flush with a side, or standing past it.
- `solid.layFlat(side)` turns a side down onto the bed, and `arrange(parts, { gap, columns })` spreads parts over it, for print layouts without hand-placed translates.
- `grid(shape, { pitch, within })` fills a region with as many copies of a shape as fit, centered, or `count` of them; `polar(shape, { count, r })` copies one around the Z axis.
- `solid.fillet(r, filter)` and `solid.chamfer(size, filter)` round or cut edges after the booleans, outside edges cut and inside ones filled, picked by the faces either side (`along`, `touching`, `between`, `convex`, `where`). An edge follows one flat face, so a floor's rim runs on round rounded corners. `solid.edges(filter)` lists what a filter picks.
- `sketch(frame)` gives construction geometry to work points out with: lines through points, or at an angle, endless or for a length, `parallel`, `perpendicular`, circles, and `intersect`. A sketch returned in a part is drawn in place in the viewer and in PNGs, and never exported.

### Changed

- The examples cut and place features with faces and frames instead of rotate chains, and l-bracket, phone-stand and headphone-hook build their profiles from sketches, with a `sketch` part that shows the construction lines.
- The examples use `polar`, `grid`, `slot`, rounded squares, `align`, `layFlat` and `arrange`. Their print, lid, cover and cap parts are now centered on the bed, the rocket takes an odd number of fins, and the lantern's honeycomb rows run 4-3-4.

## [0.11.1] - 2026-11-11

### Changed

- A param with `options` opens a menu styled like the Part menu instead of the browser's own select, and works from the keyboard.

## [0.11.0] - 2026-11-11

### Added

- A param may list `options`, the values it takes. The Parameters panel shows it as a list to pick from, and `--set` takes only one of them.

## [0.10.0] - 2026-11-07

### Added

- `export const params` may be an array of `{ name, children }` sections. The Parameters panel shows each under a heading that folds away, and the examples use them.

## [0.9.0] - 2026-11-07

### Added

- `Shape2.sweep(path, options)` carries a 2D profile along a 3D path, and `helix()` gives a coil's path.
- `loft()` builds a solid through 2D sections stacked along Z. The sections may have different point counts.
- `thread()` makes screw threads: a threaded rod, or the cutter for its hole.
- Examples: a screw-top bottle, a compression spring, and an icon stamp whose async program fetches its SVG by name.
- `memo(fn)` builds once per set of arguments, and in `cadcode dev` and the playground the result is reused across saves while the function's source and arguments stay the same.

### Changed

- Every entry of `export const params` is `{ value, name, description }` instead of a bare value. `name` and `description` label it in the Parameters panel; all three are required, and a program missing one fails at start. The program's functions still get plain values.
- Node 22 or newer is required, because Node 20 has reached end of life. CI runs on Node 22 and 24.

## [0.8.0] - 2026-11-07

### Added

- `cube` and `cylinder` take `round` and `chamfer`, for every edge or by group of edges (`z`, `top`, `bottom`).
- `minkowski()` grows a solid by another one.
- `text()` draws a string as a 2D shape, in Liberation Sans or a font file the program imports.
- `cadcode 3mf` and `to3MF` write a part as 3MF, keeping its solids and colors apart.
- `importSTL`, `import3MF`, `importSVG` and `importDXF` read existing geometry from files the program imports.
- The dev viewer and the playground have Section, which cuts the model with a plane and fills the cut, and Measure, which gives the distance between two picked points.
- One Download button saves STL, 3MF or PNG and remembers the format picked last.
- A program's default function may return a function that builds its one part, and that function may be async.
- The package ships TypeScript typings built from JSDoc.
- Examples: a nameplate and a logo tag.

### Fixed

- Bundles are deleted after a CLI run and when the dev server stops, so they no longer pile up in the temp directory.
- The dev server reports a program that exits without a model, instead of showing "evaluating" forever.

## [0.7.0] - 2026-11-06

### Added

- Shapes can rotate around a point or another shape: `.rotate(a, { around })`.
- `point()` marks a place without geometry, such as a pivot. A point among shapes fails with a message that says what to do.

## [0.6.1] - 2026-11-06

### Fixed

- Moving from one axis view to another keeps the view orthographic.

## [0.6.0] - 2026-11-06

### Added

- The view can turn to look along an axis and show it orthographic.
- The dev viewer and the playground have an XYZ axes gizmo.

## [0.5.0] - 2026-11-06

### Added

- A part may hold 2D shapes. The preview draws them as a sketch, and STL leaves them out.

## [0.4.0] - 2026-11-06

### Added

- The dev viewer has a Parameters panel for changing a program's `params` in the page.

## [0.3.0] - 2026-11-06

### Added

- The dev viewer saves the current view as PNG.
- Wire and Solid+Wire display modes.
- The browser playground, the landing page with a gallery of examples, and the Reference page.
- More examples.

### Changed

- The 3D view renders in a worker on an OffscreenCanvas, so large meshes no longer stall the page.
- The dev viewer takes the playground's studio look.

## [0.2.0] - 2026-11-04

First release.

### Added

- The geometry library over manifold-3d: 3D and 2D primitives, booleans, hull, transforms, extrude and revolve.
- The CLI: `cadcode dev`, `cadcode stl`, `cadcode png` and `cadcode parts`, with named parts and `--set` for params.
- The dev server, whose live three.js viewer reloads on save and downloads STL.
- The cadcode agent skill and the first examples.

[Unreleased]: https://github.com/JWo1F/cadcode/compare/1352a4e...HEAD
[0.16.0]: https://github.com/JWo1F/cadcode/compare/81e43c6...1352a4e
[0.15.0]: https://github.com/JWo1F/cadcode/compare/03842cf...81e43c6
[0.14.0]: https://github.com/JWo1F/cadcode/compare/6c34691...03842cf
[0.13.0]: https://github.com/JWo1F/cadcode/compare/499707c...6c34691
[0.12.0]: https://github.com/JWo1F/cadcode/compare/c49acef...499707c
[0.11.1]: https://github.com/JWo1F/cadcode/compare/599b817...c49acef
[0.11.0]: https://github.com/JWo1F/cadcode/compare/89058c4...599b817
[0.10.0]: https://github.com/JWo1F/cadcode/compare/a2de021...89058c4
[0.9.0]: https://github.com/JWo1F/cadcode/compare/139761d...a2de021
[0.8.0]: https://github.com/JWo1F/cadcode/compare/923cfa8...139761d
[0.7.0]: https://github.com/JWo1F/cadcode/compare/e03ad35...923cfa8
[0.6.1]: https://github.com/JWo1F/cadcode/compare/b0aa988...e03ad35
[0.6.0]: https://github.com/JWo1F/cadcode/compare/a83dd66...b0aa988
[0.5.0]: https://github.com/JWo1F/cadcode/compare/810c0bc...a83dd66
[0.4.0]: https://github.com/JWo1F/cadcode/compare/b313f08...810c0bc
[0.3.0]: https://github.com/JWo1F/cadcode/compare/018b06b...b313f08
[0.2.0]: https://github.com/JWo1F/cadcode/tree/018b06b
