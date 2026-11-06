# cadcode

CAD for people who write code. If you have a 3D printer and know JavaScript, you don't have to learn a CAD program to make a bracket: describe the part in code, watch it update in the browser on every save, and send the STL to your slicer.

Try it in the browser: [the playground](https://jwo1f.github.io/cadcode/playground.html).

- **Nothing new to learn.** Variables, loops and functions instead of menus and modes.
- **Models live in git.** A model is a text file: diff it, branch it, revert the change that broke the fit.
- **Tweak, don't redraw.** Sizes are `params`; reprint a variant with `--set width=80`.
- **Ready for the slicer.** Geometry runs on [manifold](https://github.com/elalish/manifold), the boolean engine recent OpenSCAD uses, so solids always come out watertight.

Coming from OpenSCAD? The API keeps its ideas (cube, cylinder, hull, difference, `$fn`), so models port line by line.

```js
import { cube } from 'cadcode';

export const params = { width: 60, depth: 40, height: 25, wall: 2 };

export default (p) =>
  cube([p.width, p.depth, p.height]).subtract(
    cube([p.width - 2 * p.wall, p.depth - 2 * p.wall, p.height]).translate([p.wall, p.wall, p.wall]),
  );
```

```bash
npx cadcode dev box.js
npx cadcode stl box.js --set width=80
```

## Install

```bash
npm install cadcode
```

Requires Node 20 or newer.

## Commands

```bash
cadcode dev <file>      # live preview in the browser, reloads on save
cadcode stl <file>      # export a part to binary STL
cadcode png <file>      # render a part to a PNG preview
cadcode parts <file>    # list the parts a program defines
```

| Option | Applies to | Meaning |
| --- | --- | --- |
| `-p, --part <name>` | all | Part to use. The default is the first one. |
| `-a, --all` | stl, png | Export every part, one file each. |
| `-s, --set <key=value>` | all | Override a parameter. Repeatable. Values are parsed as JSON, falling back to strings. |
| `-o, --out <path>` | stl, png | Output file, or a directory with `--all`. The default is `<name>.stl` or `<name>-<part>.stl` in the current directory. |
| `--view <name>` | png | `iso` (default), `iso-back`, `front`, `back`, `left`, `right`, `top`, `bottom`, or `sheet` for iso, front, right and top in one image. |
| `--size <WxH>` | png | Image size. The default is `800x600`. |
| `--port <n>` | dev | The default is `5173`. |
| `--host <addr>` | dev | The default is `127.0.0.1`. |
| `--open` | dev | Open the browser. |

```bash
cadcode stl case.js --part box --set wall=2.4
cadcode stl case.js --all -o out/
cadcode png case.js --part assembly --view sheet --size 1600x1200
```

### The dev viewer

`cadcode dev` watches the program and every file it imports. On each save it rebuilds the model and swaps it into the page without touching the camera, so you keep your angle, position and zoom while you iterate. The camera is also remembered per file across browser refreshes and server restarts.

- **Rotate**: drag
- **Pan**: shift+drag or right-drag
- **Zoom**: mouse wheel
- **Fit the model to the view**: F, or the Fit button
- **Wireframe**: the Wire button shows only the triangle edges, Solid+Wire draws them over the solid. Press the lit button again to go back to the plain solid.
- **Switch parts**: the Part menu, shown when the program has more than one part
- **Change parameters**: the Parameters panel, shown when the program has `export const params`. Numbers, switches, colours, text, and JSON for arrays and objects; drag a number's name sideways to scrub it (shift for ten times the step). A changed value is marked and has its own reset. The values outlive edits to the code and restarts of the server, and one the program stops declaring is dropped. `--set` wins over a remembered value. The STL download uses them too.
- **Download the part as STL**: the Download STL button. It is the same file `cadcode stl` writes.
- **Save the view as PNG**: the PNG button. It takes the camera as it is, without the grid and axes.

Errors appear in the page and in the terminal, with the line in your file. The last good model stays on screen until you fix them. Whatever the program prints with `console.log` appears in the corner of the page.

## Writing a program

A program is an ES module. Its default export is one of these:

- **A model**: a solid, or an array of solids. Arrays may nest.
- **An object of named parts**: each value is a model, or a function that returns one. Functions are only called for the part being shown or exported.
- **A function of `params`**: it returns either of the above.

Parameters you might want to change from the command line go in `export const params`. `--set` can only override a parameter declared there, so a typo is an error instead of being silently ignored.

```js
import { cube, cylinder, hull, product, setResolution } from 'cadcode';

setResolution({ fn: 48 });

export const params = {
  width: 40,
  depth: 30,
  height: 12,
  wall: 2,
  radius: 3,
};

export default (p) => {
  const roundedBox = (w, d, h, r) =>
    hull(product([r, w - r], [r, d - r]).map(([x, y]) => cylinder({ r, h }).translate([x, y, 0])));

  const tray = () =>
    roundedBox(p.width, p.depth, p.height, p.radius).subtract(
      roundedBox(p.width - 2 * p.wall, p.depth - 2 * p.wall, p.height, p.radius - p.wall).translate([p.wall, p.wall, p.wall]),
    );

  return {
    assembly: () => [tray().color('steelblue'), cube([10, 10, 4]).translate([5, 5, p.wall]).color('orange', 0.6)],
    tray,
  };
};
```

The first part is the default one. The STL of a part merges all its solids into one body. A part may also hold 2D shapes, to check a profile before extruding it: the viewer and PNGs draw them as a sketch on Z=0 (a see-through blue fill with a bold outline), and STL leaves them out (a part with only 2D shapes fails to export). In the viewer and in PNGs each solid keeps its own color and transparency, which is what assembly views are for.

A program can import its own helper files and npm packages like any module. TypeScript files work too.

[`examples/sensor-case.js`](examples/sensor-case.js) is a complete project: a snap-fit case for a board, a battery and a sensor, with `assembly`, `box`, `lid` and `print` parts.

## API

Every shape is immutable: methods return a new shape. Units are whatever your slicer assumes, usually millimeters. Angles are in degrees.

Wherever a list of shapes is accepted, it may contain nested arrays and falsy values. That makes loops and conditionals read naturally:

```js
difference(base, holes.map(([x, y]) => cylinder({ d: 3, h: 10 }).translate([x, y, -1])), withSlot && slot);
```

### 3D primitives

| Function | Notes |
| --- | --- |
| `cube(size, { center })` | `size` is a number or `[x, y, z]`. A corner sits at the origin unless `center: true`. |
| `cylinder({ h, r \| d, r1, r2, d1, d2, center, fn })` | Stands on XY along +Z. Give `r1`/`r2` for a cone. |
| `sphere(r)` or `sphere({ r \| d, fn })` | Centered on the origin. |
| `polyhedron(points, faces)` | Faces list point indices clockwise when seen from outside, as in OpenSCAD. |

### 2D primitives

| Function | Notes |
| --- | --- |
| `square(size, { center })` | `size` is a number or `[x, y]`. |
| `circle(r)` or `circle({ r \| d, fn })` | |
| `polygon(points, paths?)` | Paths inside other paths become holes. |

### Solid methods

| Method | Notes |
| --- | --- |
| `.translate([x, y, z])` | |
| `.rotate([x, y, z])` | Around X, then Y, then Z, like OpenSCAD. `.rotate(a)` turns around Z, and `.rotate(a, [x, y, z])` around any axis. |
| `.scale(s)` or `.scale([x, y, z])` | |
| `.mirror([nx, ny, nz])` | Across the plane through the origin with this normal. |
| `.transform(matrix)` | A column-major 4×4 matrix, as 16 numbers. |
| `.color(name, alpha?)` | A CSS color name, `#rrggbb`, or `[r, g, b, a]` in 0..1. Colors survive booleans. |
| `.union(...shapes)` | |
| `.subtract(...shapes)` | |
| `.intersect(...shapes)` | |
| `.hull(...shapes)` | Convex hull of this shape and the others. |
| `.slice(z)` | The 2D cross-section at height `z`. |
| `.project()` | The 2D outline seen from above. |
| `.volume()`, `.surfaceArea()`, `.bounds()`, `.isEmpty()` | `bounds()` returns `{ min: [x, y, z], max: [x, y, z] }`. |

### 2D shape methods

| Method | Notes |
| --- | --- |
| `.translate([x, y])`, `.rotate(a)`, `.scale(s)`, `.mirror([nx, ny])` | |
| `.offset(r)` | Grow (or shrink, when negative) with rounded corners. `.offset({ delta })` keeps corners sharp, and `.offset({ delta, chamfer: true })` cuts them. |
| `.union()`, `.subtract()`, `.intersect()`, `.hull()` | Same as for solids. |
| `.extrude(h, { center, twist, scale, divisions })` | Extrudes along +Z, like `linear_extrude`. |
| `.revolve({ angle, fn })` | Revolves the shape around the Y axis into a solid around Z, like `rotate_extrude`. |
| `.area()`, `.bounds()`, `.isEmpty()`, `.toPolygons()` | |

### Functions

These take any mix of shapes and nested arrays, so OpenSCAD's nesting style works as well as method chaining:

| Function | Equivalent |
| --- | --- |
| `union(...shapes)` | |
| `difference(base, ...cutters)` | `base.subtract(...cutters)` |
| `intersection(...shapes)` | |
| `hull(...shapes)` | |
| `translate(v, ...shapes)` | `union(...shapes).translate(v)` |
| `rotate(a, ...shapes)` | `union(...shapes).rotate(a)` |
| `scale(v, ...shapes)` | `union(...shapes).scale(v)` |
| `mirror(n, ...shapes)` | `union(...shapes).mirror(n)` |
| `color(c, alpha?, ...shapes)` | `union(...shapes).color(c, alpha)` |
| `offset(r, ...shapes)` | `union(...shapes).offset(r)` |
| `linearExtrude(h, options, ...shapes)` | `union(...shapes).extrude(h, options)` |

### Helpers

| Function | Notes |
| --- | --- |
| `range(start, end, step = 1)` | Includes `end`, like OpenSCAD's `[start : step : end]`. |
| `product(...lists)` | Every combination, like `for (x = xs, y = ys)`: `product([1, 2], ['a', 'b'])` gives `[[1, 'a'], [1, 'b'], [2, 'a'], [2, 'b']]`. |
| `setResolution({ fn, fa, fs })` | Default segment count for curves, with the same rules as OpenSCAD's `$fn`, `$fa` and `$fs`. Any primitive also takes its own `fn`. |

## Porting from OpenSCAD

| OpenSCAD | cadcode |
| --- | --- |
| `$fn = 40;` | `setResolution({ fn: 40 });` |
| `cylinder(d = 5, h = 2, center = true);` | `cylinder({ d: 5, h: 2, center: true })` |
| `translate([x, y, 0]) rotate([0, 90, 0]) cube(s);` | `cube(s).rotate([0, 90, 0]).translate([x, y, 0])` |
| `difference() { a(); b(); c(); }` | `difference(a(), b(), c())` |
| `for (x = xs, y = ys) translate([x, y]) c();` | `product(xs, ys).map(([x, y]) => c().translate([x, y]))` |
| `for (i = [0 : n - 1])` | `range(0, n - 1).map((i) => ...)` |
| `linear_extrude(h) offset(r = 1) square(s, center = true);` | `square(s, { center: true }).offset(1).extrude(h)` |
| `color("orange", 0.35) lid();` | `lid().color('orange', 0.35)` |
| `module box() { ... }` | `const box = () => ...` |
| `part = "box";` with `-D 'part="box"'` | Named parts and `--part box` |
| `wall = 2;` with `-D wall=2.4` | `export const params = { wall: 2 }` and `--set wall=2.4` |
| `echo(...)` | `console.log(...)` |

When chaining, read OpenSCAD's transforms from the innermost one out. `translate(t) rotate(r) child` becomes `child.rotate(r).translate(t)`.

## License

MIT
