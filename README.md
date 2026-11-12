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

export const params = {
  width: { value: 60, name: 'Width', description: 'Outside, along X, in mm.' },
  depth: { value: 40, name: 'Depth', description: 'Outside, along Y, in mm.' },
  height: { value: 25, name: 'Height', description: 'Outside, floor included, in mm.' },
  wall: { value: 2, name: 'Wall', description: 'Thickness of the walls and the floor, in mm.' },
};

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

Requires Node 22 or newer. Typings ship with the package, so editors complete the API in JavaScript and TypeScript programs alike.

## Commands

```bash
cadcode dev <file>      # live preview in the browser, reloads on save
cadcode stl <file>      # export a part to binary STL
cadcode 3mf <file>      # export a part to 3MF, its solids and colors kept apart
cadcode png <file>      # render a part to a PNG preview
cadcode parts <file>    # list the parts a program defines
```

| Option | Applies to | Meaning |
| --- | --- | --- |
| `-p, --part <name>` | all | Part to use. The default is the first one. |
| `-a, --all` | stl, 3mf, png | Export every part, one file each. |
| `-s, --set <key=value>` | all | Override a parameter. Repeatable. Values are parsed as JSON, falling back to strings. |
| `-o, --out <path>` | stl, 3mf, png | Output file, or a directory with `--all`. The default is `<name>.stl` or `<name>-<part>.stl` (`.3mf`, `.png`) in the current directory. |
| `--view <name>` | png | `iso` (default), `iso-back`, `front`, `back`, `left`, `right`, `top`, `bottom`, or `sheet` for iso, front, right and top in one image. |
| `--size <WxH>` | png | Image size. The default is `800x600`. |
| `--port <n>` | dev | The default is `5173`. |
| `--host <addr>` | dev | The default is `127.0.0.1`. |
| `--open` | dev | Open the browser. |

```bash
cadcode stl case.js --part box --set wall=2.4
cadcode stl case.js --all -o out/
cadcode 3mf case.js --part assembly
cadcode png case.js --part assembly --view sheet --size 1600x1200
```

### The dev viewer

`cadcode dev` watches the program and every file it imports. On each save it rebuilds the model and swaps it into the page without touching the camera, so you keep your angle, position and zoom while you iterate. The camera is also remembered per file across browser refreshes and server restarts.

- **Rotate**: drag
- **Pan**: shift+drag or right-drag
- **Zoom**: mouse wheel
- **Fit the model to the view**: F, or the Fit button
- **Wireframe**: the Wire button shows only the triangle edges, Solid+Wire draws them over the solid. Press the lit button again to go back to the plain solid.
- **Cut the model open**: S, or the Section button. The model is cut across Z (X and Y keys, or the buttons in the card, switch the axis) and the cut faces are filled in a darker shade of their solid. Move the plane with the slider, or drag the plane's frame in the view; the flip button keeps the other side. The section is remembered per file, and the PNG shows it.
- **Measure**: M, or the Measure button, then click two points on the model. A point near a corner lands on it, and a point on a cut face counts too. The label gives the distance and how far apart the points are along each axis. A third click starts over, Esc clears. A rebuilt model drops the measurement.
- **Switch parts**: the Part menu, shown when the program has more than one part
- **Change parameters**: the Parameters panel, shown when the program has `export const params`. Each row is labelled with the parameter's `name`, with its `description` under it, and params declared in sections are grouped under headings that fold away (remembered per file; a dot marks a folded section with a changed value). Numbers, switches, colours, text, JSON for arrays and objects, and a list for a param with `options`; drag a number's name sideways to scrub it (shift for ten times the step). A changed value is marked and has its own reset. The values outlive edits to the code and restarts of the server, and one the program stops declaring is dropped. `--set` wins over a remembered value. Downloads use them too.
- **Download**: the Download button saves in the format picked last, and its arrow opens the list of formats; picking one saves in it and makes it the button's. The choice is remembered.
  - **STL** and **3MF**: the part, the same files `cadcode stl` and `cadcode 3mf` write.
  - **PNG**: the view as it is, with the section if there is one, without the grid, the axes, the section's frame and the measurement.

Errors appear in the page and in the terminal, with the line in your file. The last good model stays on screen until you fix them. Whatever the program prints with `console.log` appears in the corner of the page.

## Writing a program

A program is an ES module. Its default export is one of these:

- **A model**: a solid, or an array of solids. Arrays may nest.
- **An object of named parts**: each value is a model, or a function that returns one. Functions are only called for the part being shown or exported.
- **A function of `params`**: it returns either of the above, or a function that returns a model.

Any of these functions may be `async`, so a program can `await` before building:

```js
export default async (p) => {
  const { gear } = await import('./gear.js');
  return async () => gear({ teeth: p.teeth });
};
```

[`examples/icon-stamp.js`](examples/icon-stamp.js) awaits `fetch()` of an SVG icon by name and builds a stamp from it.

Parameters you might want to change from the command line go in `export const params`. Each one is `{ value, name, description }`: `value` is the default, and `name` and `description` label it in the Parameters panel. All three are required, and a program missing one fails at start. The program's functions get the values alone, so `p.width` is a number.

A parameter that takes one of a few values lists them in `options`, and the panel shows it as a list to pick from. The value must be one of them, and so must `--set`:

```js
export const params = {
  battery: { value: 'round', name: 'Battery', description: 'Which cell the case is sized to.', options: ['round', 'flat'] },
};
```

To group them in the Parameters panel, `params` may instead be an array of sections, each `{ name, children }` with `children` an object of such entries. Keys must be unique across sections, since the program still gets one flat object:

```js
export const params = [
  {
    name: 'Box',
    children: {
      width: { value: 40, name: 'Width', description: 'Outside, along X, in mm.' },
      wall: { value: 2, name: 'Wall', description: 'Thickness of the walls, in mm.' },
    },
  },
  {
    name: 'Lid',
    children: {
      lidH: { value: 6, name: 'Lid height', description: 'Height of the lid, in mm.' },
    },
  },
];
``` `--set` can only override a parameter declared there, so a typo is an error instead of being silently ignored.

```js
import { cube, setResolution } from 'cadcode';

setResolution({ fn: 48 });

export const params = {
  width: { value: 40, name: 'Width', description: 'Outside, along X, in mm.' },
  depth: { value: 30, name: 'Depth', description: 'Outside, along Y, in mm.' },
  height: { value: 12, name: 'Height', description: 'Outside, floor included, in mm.' },
  wall: { value: 2, name: 'Wall', description: 'Thickness of the walls and the floor, in mm.' },
  radius: { value: 3, name: 'Corner radius', description: 'Radius of the vertical edges, in mm.' },
};

export default (p) => {
  // Only the vertical edges are rounded, so the tray stands on a flat bottom.
  const roundedBox = (w, d, h, r) => cube([w, d, h], { round: { z: r } });

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

The first part is the default one. The STL of a part merges all its solids into one body. The 3MF keeps each solid as its own object, in its colors: the core 3MF base materials, per triangle, so a union of colored pieces keeps them. Slicers read the separate bodies; whether they turn the colors into filaments is up to each slicer (PrusaSlicer ignores them). A part may also hold 2D shapes, to check a profile before extruding it: the viewer and PNGs draw them as a sketch on Z=0 (a see-through blue fill with a bold outline), and STL leaves them out (a part with only 2D shapes fails to export). In the viewer and in PNGs each solid keeps its own color and transparency, which is what assembly views are for.

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
| `cube(size, { center, round, chamfer, fn })` | `size` is a number or `[x, y, z]`. A corner sits at the origin unless `center: true`. `round: r` rounds every edge and `chamfer: c` cuts every edge at 45°, inside the same size. Either also takes sizes by group of edges, `z` (the vertical ones), `top` and `bottom` (around those faces): `{ round: { z: 3 }, chamfer: { top: 1 } }` keeps a flat bottom. |
| `cylinder({ h, r \| d, r1, r2, d1, d2, center, round, chamfer, fn })` | Stands on XY along +Z. Give `r1`/`r2` for a cone. `round` and `chamfer` soften the top and bottom edges inside the same size; `{ chamfer: { top: 1 } }` does one end only. |
| `sphere(r)` or `sphere({ r \| d, fn })` | Centered on the origin. |
| `polyhedron(points, faces)` | Faces list point indices clockwise when seen from outside, as in OpenSCAD. |

### 2D primitives

| Function | Notes |
| --- | --- |
| `square(size, { center, round, chamfer, fn })` | `size` is a number or `[x, y]`. `round` and `chamfer` soften the corners inside the same size, all or by index (0 at the smallest x and y, counter-clockwise) or function, as for `polygon`. |
| `slot(from, to, width, { fn })` | A stadium: round ends of `width` centered on two points, for slotted holes and ports. |
| `circle(r)` or `circle({ r \| d, fn })` | |
| `polygon(points, paths?, { round, chamfer, fn })` | Paths inside other paths become holes. `round: r` rounds every corner and `chamfer: c` cuts it; an object sizes some by index into `points` (`{ round: { 3: 4 }, chamfer: { 1: 2 } }`) and a function each by its index and point (`{ round: (i) => (i % 2 ? 2 : 3) }`). An inside corner rounds into a fillet. |
| `text(string, { size, font, halign, valign, spacing, lineHeight, fn })` | Text for labels and engraving; letters keep their holes, `\n` breaks lines. `size` is the height of a capital letter (default 10). `halign` is `left`, `center` or `right`; `valign` is `baseline`, `top`, `center` or `bottom`. The font is Liberation Sans unless `font` gives a font file's bytes: `import font from './Roboto.ttf'` (TTF, OTF or WOFF). Curves follow `fn` and `fa`, not `fs`. |

### Solid methods

| Method | Notes |
| --- | --- |
| `.translate([x, y, z])` | |
| `.rotate([x, y, z])` | Around X, then Y, then Z, like OpenSCAD. `.rotate(a)` turns around Z, and `.rotate(a, [x, y, z])` around any axis. |
| `.rotate(..., { around })` | A last argument that turns around a `point`, another shape's bounding-box center, or `[x, y, z]` instead of the origin: `lid.rotate([-110, 0, 0], { around: hinge })`. |
| `.scale(s)` or `.scale([x, y, z])` | |
| `.mirror([nx, ny, nz])` | Across the plane through the origin with this normal. |
| `.transform(matrix)` | A column-major 4×4 matrix, as 16 numbers. |
| `.color(name, alpha?)` | A CSS color name, `#rrggbb`, or `[r, g, b, a]` in 0..1. Colors survive booleans. |
| `.union(...shapes)` | |
| `.subtract(...shapes)` | |
| `.intersect(...shapes)` | |
| `.hull(...shapes)` | Convex hull of this shape and the others. |
| `.minkowski(...shapes)` | Minkowski sum, like OpenSCAD's `minkowski()`: `.minkowski(sphere(1))` rounds every edge and grows the part by 1 on each side. Fast for convex shapes, seconds for a part with holes. The result is uncolored. |
| `.slice(z)` | The 2D cross-section at height `z`. |
| `.project()` | The 2D outline seen from above. |
| `.volume()`, `.surfaceArea()`, `.bounds()`, `.isEmpty()` | `bounds()` returns `{ min: [x, y, z], max: [x, y, z] }`. |
| `.fillet(r, filter)`, `.chamfer(size, filter)` | Round or cut edges after the booleans: outside edges are cut, inside ones (wall meets floor) filled. `filter` picks them by the faces either side: `{ along: 'z' }`, `{ touching: '-Z' }`, `{ between: ['+Z', '-X'] }`, `{ convex: false }`, `{ where: (edge) => ... }`; none takes every edge. An edge follows one flat face, so a floor's rim runs on round rounded corners. Where rounds meet at a corner they overlap rather than blend. |
| `.edges(filter)` | The edges a filter picks, to check before rounding them: `{ points, closed, length, normals, convex, angle, ... }`. |
| `.layFlat(side = '-Z')` | Turns that side of the bounding box down and puts the solid on the bed, centered in X and Y: `lid.layFlat('+Z')` prints a lid top down. |
| `.at(side = 'center')` | A `point` at the center of the bounding box or of a side, `'+X'` … `'-Z'`. |
| `.align(target, { x, y, z, gap })` | Lines up with another shape or a point by bounding boxes, per axis: `'min'`, `'center'`, `'max'`, or `'before'` / `'after'` to sit wholly past its min or max side. `gap` leaves space. `pad.align(floor, { x: 'center', y: 'center', z: 'after' })` stands the pad centered on the floor. |

### 2D shape methods

| Method | Notes |
| --- | --- |
| `.translate([x, y])`, `.rotate(a)`, `.scale(s)`, `.mirror([nx, ny])` | |
| `.rotate(a, { around })` | Around a `point`, another shape's bounding-box center, or `[x, y]`. |
| `.offset(r)` | Grow (or shrink, when negative) with rounded corners. `.offset({ delta })` keeps corners sharp, and `.offset({ delta, chamfer: true })` cuts them. |
| `.union()`, `.subtract()`, `.intersect()`, `.hull()` | Same as for solids. |
| `.extrude(h, { center, twist, scale, divisions })` | Extrudes along +Z, like `linear_extrude`. |
| `.revolve({ angle, fn })` | Revolves the shape around the Y axis into a solid around Z, like `rotate_extrude`. |
| `.sweep(path, { closed, twist, scale, up })` | Sweeps the shape along a path of `[x, y, z]` points, for handles, pipes and springs. The shape stands across the path, its drawing's +Z along it, and is carried along without twisting; `up: [0, 0, 1]` instead keeps its +Y toward that direction. `closed: true` joins the path's end to its start. `twist` (degrees, counterclockwise) and `scale` work as in `extrude`. Corners are mitered. |
| `.area()`, `.bounds()`, `.isEmpty()`, `.toPolygons()` | |
| `.at(side)`, `.align(target, { x, y, gap })` | As for solids, in X and Y; `at` returns `[x, y]`. |

### Functions

These take any mix of shapes and nested arrays, so OpenSCAD's nesting style works as well as method chaining:

| Function | Equivalent |
| --- | --- |
| `union(...shapes)` | |
| `difference(base, ...cutters)` | `base.subtract(...cutters)` |
| `intersection(...shapes)` | |
| `hull(...shapes)` | |
| `minkowski(...solids)` | `first.minkowski(...rest)`. Solids only; 2D shapes have `offset`. |
| `translate(v, ...shapes)` | `union(...shapes).translate(v)` |
| `rotate(a, ...shapes)` | `union(...shapes).rotate(a)` |
| `rotate(a, { around }, ...shapes)` | `union(...shapes).rotate(a, { around })` |
| `scale(v, ...shapes)` | `union(...shapes).scale(v)` |
| `mirror(n, ...shapes)` | `union(...shapes).mirror(n)` |
| `color(c, alpha?, ...shapes)` | `union(...shapes).color(c, alpha)` |
| `offset(r, ...shapes)` | `union(...shapes).offset(r)` |
| `linearExtrude(h, options, ...shapes)` | `union(...shapes).extrude(h, options)` |

### Frames

A frame is a plane with its own 2D coordinates: draw a shape in them and extrude it along the plane's normal, instead of a `rotate().translate()` chain.

```js
const usb = square([9, 3.3], { center: true }).offset(0.5).translate([usbY, usbZ]);
box.subtract(box.face('-X').extrude(usb, -wall, { through: true }));
```

| Function | Notes |
| --- | --- |
| `solid.face(name)` | The side `'+X'`, `'-X'`, `'+Y'`, `'-Y'`, `'+Z'` or `'-Z'` of the bounding box, its normal pointing out. Positions in it are world coordinates: Y and Z on an X side, X and Z on a Y side, X and Y on a Z side. |
| `solid.surfaceAt(side, [u, v])` | The frame where the solid is first met looking in from `face(side)` at `[u, v]`, with the surface's normal: a hole or a boss square to a dome or a slope. On a curve the normal is the mesh triangle's, as fine as the solid's `fn`. Throws when nothing lies under `[u, v]`. |
| `plane.XY`, `plane.XZ`, `plane.YZ` | The planes through the origin, u and v world coordinates as for `face`; the normals are +Z, +Y and +X. |
| `frameAt(origin, normal)` | A frame at any point and normal, such as on a curved surface. v points as close to +Z as the plane allows (+Y when the normal is vertical) and u = v × normal, so a drawing reads the right way round from outside. |
| `frame.extrude(shape, depth, { through, center })` | A positive `depth` goes along the normal (out of a face), a negative one against it (into the part). `through: true` reaches 1 past both ends, so a cut leaves no skin; `through: 'start'` reaches 1 back past the plane only, for a pocket cut into a face. `center: true` puts the plane in the middle. |
| `frame.offset(d)`, `frame.place(solidOrPoint)` | The plane moved along its normal; a solid or point built at the origin moved onto the frame (Z along the normal). `.origin` and `.normal` read it. |

### Sketches

A sketch is construction geometry on a frame, to work out the points of an outline as on paper: lines, parallels, perpendiculars, circles and where they cross. Points are plain `[x, y]` in the frame's coordinates. Return the sketch in a part and the viewer draws its guides in place, dashed and on top of the part, with the crossings marked; it never reaches an STL and cannot go into a boolean.

```js
const s = sketch(box.face('+Z'));
const base = s.line([0, 0], [60, 0]);
const top = base.parallel(12);                 // 12 to the left of base
const tip = top.intersect(s.line([10, 0], { angle: 60 }));
const plate = s.polygon([base.start, base.end, top.end, tip], { round: { 3: 2 } });
return { part: () => [box.union(s.extrude(plate, 3)), s] };
```

| Function | Notes |
| --- | --- |
| `sketch(frame = plane.XY)` | A new sketch on a frame. |
| `s.line(a, b)`, `s.line(a, { angle, length })` | A guide through two points, or from `a` at an angle (degrees from +u) for `length`; without `length` it is endless. Crossings treat every line as endless. A line has `.start`, `.end`, `.direction`, `.angle`, `.length`, `.mid`, `.at(t)`. |
| `line.parallel(d)` | `d` to the left looking from start to end (negative: right), over the same stretch. |
| `line.perpendicular(p)` | Through `p` at right angles; from a point off the line it ends at its foot (`.end`). |
| `line.intersect(other)` | One point with a line (parallel lines throw); with a circle a list of 0, 1 or 2, from the line's start towards its end. |
| `s.circle(center, r)` | A guide circle, with `.at(degrees)` and `.intersect(lineOrCircle)`. |
| `s.point(p)` | Marks a point for the viewer. |
| `s.polygon(points, paths?, options?)`, `s.extrude(shape, depth, { through })` | `polygon()` drawn in place with the guides; `frame.extrude()` from the sketch's frame. |

### Lofts and threads

| Function | Notes |
| --- | --- |
| `loft(sections, { z })` | A solid through 2D sections laid flat at heights `z`, joined by straight faces: a square base into a round neck. Each section is one outline without holes (cut holes afterwards). Sections with different point counts are evened out, keeping their corners. |
| `thread({ d, pitch, length, profile, internal, clearance, starts, leftHand, taper, fn })` | A screw thread along +Z from 0 to `length`, `d` across the crests. `profile` is `'iso'` (60°, the default), `'trapezoid'` (30°, sturdier for lids) or `'square'`. `internal: true` gives the cutter for a threaded hole instead: `clearance` (default 0.2) bigger on every face of the tooth and 1 longer at each end, to subtract from a nut or a cap. `taper` chamfers both ends over that length so the thread starts cleanly (a countersink on a hole). `starts` winds several threads side by side, for a quick-turn lid. |

### Helpers

| Function | Notes |
| --- | --- |
| `point([x, y, z])` | A place without geometry, such as a pivot for `rotate(..., { around })`. It has `.translate`, `.rotate`, `.scale`, `.mirror`, `.transform`, so it can move with its part, and `.x`, `.y`, `.z`, `.toArray()`. It cannot go into booleans or an export. |
| `helix({ r \| d, pitch, turns \| height, leftHand, fn })` | Points along a helix around Z from `[r, 0, 0]`, rising `pitch` per turn: a path for `.sweep()`. `fn` is points per turn. |
| `grid(shape, { pitch, within \| count, stagger })` | Copies of a shape or solid on a grid in XY, unioned. `within: region` fills a 2D region with as many as fit wholly inside, centered on it: `grid(circle({ d: 1.6 }), { pitch: 3.2, within: square([17, 12]) })`. `count: [nx, ny]` centers them on the origin. `stagger` makes a honeycomb. |
| `polar(shape, { count, r, start, angle })` | Copies around Z (the origin in 2D), moved out `r` then turned: knurls, spokes, bolt circles. `angle` < 360 spans an arc end to end. |
| `arrange(parts, { gap = 5, columns })` | Spreads parts over the bed for a print layout: a row along +X (or rows of `columns`), `gap` apart, centered on the origin. A part may be an array of solids that move together. Lay them flat first. |
| `range(start, end, step = 1)` | Includes `end`, like OpenSCAD's `[start : step : end]`. |
| `product(...lists)` | Every combination, like `for (x = xs, y = ys)`: `product([1, 2], ['a', 'b'])` gives `[[1, 'a'], [1, 'b'], [2, 'a'], [2, 'b']]`. |
| `memo(fn)` | Builds once per set of arguments. In `cadcode dev` and the playground the result outlives the run, so a save that leaves the function and its arguments as they were skips it: `const ring = memo((teeth, module) => ...)`. The key is the function's source, its arguments and the resolution; a helper it calls or a variable it reads from outside (such as `p`) is not part of it, so pass those as arguments. Arguments are plain data; the result is shapes or arrays of them. |
| `setResolution({ fn, fa, fs })` | Default segment count for curves, with the same rules as OpenSCAD's `$fn`, `$fa` and `$fs`. Any primitive also takes its own `fn`. |

### Importing files

Existing geometry comes in through an `import` of the file next to the program, which gives its contents, and a function that turns them into shapes. The dev server reloads when an imported file changes, as it does for code. In the playground, which has no files, pass the contents from `fetch`.

```js
import { cylinder, importSTL, importSVG } from 'cadcode';
import bracket from './bracket.stl';
import logo from './logo.svg';

export default importSTL(bracket)
  .subtract(cylinder({ d: 5, h: 20 }).translate([10, 10, -1]))
  .union(importSVG(logo, { center: true }).extrude(1).translate([20, 10, 4]));
```

| Function | Notes |
| --- | --- |
| `importSTL(bytes)` | A solid from a binary or ASCII STL. The mesh must be closed: one with holes, loose triangles or inward-facing triangles fails with a message saying so, instead of being repaired. |
| `import3MF(bytes)` | An array of solids, one per object on the 3MF's build plate, in millimeters and where the file places them. Colors from the core spec's base materials and the materials extension's color groups come along per triangle; slicer-specific painting and filament settings do not. Each object must be a closed mesh, as for STL. |
| `importSVG(text, { center, dpi, fn })` | A 2D shape of the SVG's filled paths, rectangles, circles, ellipses, polygons and polylines, with their transforms and fill rules. Sizes come from the document's `width`, `height` and `viewBox` (mm, cm, in, pt, or px at `dpi`, default 96); Y points up and the document's bottom-left corner is the origin, or the shape's center with `center: true`. Strokes, CSS classes, text, clones and images are not imported; text, clones and images fail with how to convert them. |
| `importDXF(text, { layer, center, fn })` | A 2D shape of a DXF drawing's closed outlines: lines, arcs, circles, ellipses and polylines with bulges. Loose lines and arcs that meet end to end are joined; outlines inside others are holes. `layer` picks one layer or an array of them. Units are taken as millimeters. Text and dimensions are skipped; an outline that does not close, splines and blocks fail with what to do. |

[`examples/logo-tag.js`](examples/logo-tag.js) puts an SVG logo on a keyring tag, raised or engraved.

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
| `metric_thread(8, 1.25, 10);` (threads.scad) | `thread({ d: 8, pitch: 1.25, length: 10 })`, and `internal: true` for the hole |
| `color("orange", 0.35) lid();` | `lid().color('orange', 0.35)` |
| `text("A1", size = 10, halign = "center");` | `text('A1', { size: 9.55, halign: 'center' })`: `size` is the height of a capital, which in OpenSCAD's Liberation Sans is 0.955 of its `size` |
| `text("A1", font = "Roboto");` | `import font from './Roboto.ttf';` then `text('A1', { font })` |
| `import("part.stl");` | `import part from './part.stl';` then `importSTL(part)` |
| `import("logo.svg", center = true);` | `import logo from './logo.svg';` then `importSVG(logo, { center: true })` |
| `import("plate.dxf", layer = "cut");` | `import plate from './plate.dxf';` then `importDXF(plate, { layer: 'cut' })` |
| `import("part.3mf");` | `import part from './part.3mf';` then `import3MF(part)`, an array of solids |
| `module box() { ... }` | `const box = () => ...` |
| `part = "box";` with `-D 'part="box"'` | Named parts and `--part box` |
| `wall = 2;` with `-D wall=2.4` | `export const params = { wall: { value: 2, name: 'Wall', description: '…' } }` and `--set wall=2.4` |
| `echo(...)` | `console.log(...)` |

When chaining, read OpenSCAD's transforms from the innermost one out. `translate(t) rotate(r) child` becomes `child.rotate(r).translate(t)`.

## License

MIT
