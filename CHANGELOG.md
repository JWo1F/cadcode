# Changelog

Notable changes to cadcode. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `Shape2.sweep(path, options)` carries a 2D profile along a 3D path, and `helix()` gives a coil's path.
- `loft()` builds a solid through 2D sections stacked along Z. The sections may have different point counts.
- `thread()` makes screw threads: a threaded rod, or the cutter for its hole.
- Examples: a screw-top bottle and a compression spring.

### Changed

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

[Unreleased]: https://github.com/JWo1F/cadcode/compare/139761d...HEAD
[0.8.0]: https://github.com/JWo1F/cadcode/compare/923cfa8...139761d
[0.7.0]: https://github.com/JWo1F/cadcode/compare/e03ad35...923cfa8
[0.6.1]: https://github.com/JWo1F/cadcode/compare/b0aa988...e03ad35
[0.6.0]: https://github.com/JWo1F/cadcode/compare/a83dd66...b0aa988
[0.5.0]: https://github.com/JWo1F/cadcode/compare/810c0bc...a83dd66
[0.4.0]: https://github.com/JWo1F/cadcode/compare/b313f08...810c0bc
[0.3.0]: https://github.com/JWo1F/cadcode/compare/018b06b...b313f08
[0.2.0]: https://github.com/JWo1F/cadcode/tree/018b06b
