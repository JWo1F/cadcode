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
| `cube(size = 1, { center = false })` | `size`: number or `[x, y, z]`. Corner at origin unless centered. |
| `cylinder({ h, r, d, r1, r2, d1, d2, center = false, fn })` | Along +Z from z = 0 (or centered). `r1`/`d1` bottom, `r2`/`d2` top for cones. |
| `sphere(r)` / `sphere({ r, d, fn })` | Centered on the origin. |
| `polyhedron(points, faces)` | Faces list point indices **clockwise seen from outside** (OpenSCAD order). Throws if not closed. |

## 2D primitives

| Function | Notes |
| --- | --- |
| `square(size = 1, { center = false })` | `size`: number or `[x, y]`. |
| `circle(r)` / `circle({ r, d, fn })` | Centered. |
| `polygon(points, paths?)` | Even-odd fill: paths inside other paths are holes. |

## `point`

`point([x, y, z])` marks a place without geometry (never in an STL), e.g. a pivot. It has
`.translate`, `.rotate` (same arguments as `Solid.rotate`), `.scale`, `.mirror`, `.transform`,
each returning a new point, and `.x`, `.y`, `.z`, `.toArray()`.

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
