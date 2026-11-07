---
name: cadcode
description: >
  How to model 3D-printable parts as code with cadcode, the JavaScript CAD library and CLI
  (`cadcode dev`, `cadcode stl`, `cadcode 3mf`, `cadcode png`): primitives (`cube`, `cylinder`, `sphere`,
  `square`, `circle`, `polygon`, `text`), booleans (`union`, `difference`, `intersection`, `hull`,
  `minkowski`), rounded and chamfered edges,
  2D `offset`/`extrude`/`revolve`, importing STL, 3MF, SVG and DXF files (`importSTL`, `import3MF`, `importSVG`, `importDXF`), colors, `params` and named parts. Use this skill whenever a
  project's package.json has `cadcode`, whenever code imports from 'cadcode', and whenever the
  user wants to design, model, modify or export a physical part in code — an enclosure, case,
  bracket, mount, box with lid, adapter, spacer, knob — or wants an STL or a rendered preview of
  one, or wants to port an OpenSCAD `.scad` file to JavaScript, even if cadcode is not named. It
  carries the program format, the API, the OpenSCAD differences and a render-and-look loop for
  checking geometry, so reach for it even for a small dimension tweak.
---

# cadcode

cadcode is code-first CAD: a model is an ES module that builds solids with a small,
OpenSCAD-flavoured API, and a CLI turns it into a live browser preview, STL files and PNG renders.
Geometry runs on manifold (WASM), so every boolean result is a watertight solid. Units are
millimetres by convention, angles are degrees, and **Z is up**.

```sh
npm install cadcode          # Node 22+
npx cadcode dev model.js     # live preview, reloads on save, keeps the camera
npx cadcode stl model.js --part box
npx cadcode png model.js --part assembly --view sheet -o preview.png
```

Plain JavaScript, no build step. Programs may also be `.ts`; they are bundled with esbuild, so
they can import their own helper files and npm packages.

## Program format

```js
import { cube, cylinder, square, union, difference, hull, product, range, setResolution } from 'cadcode';

setResolution({ fn: 48 }); // like $fn = 48; top level, before building anything

// Everything a user might tune, each as { value, name, description }: all three are required,
// and name and description label it in the Parameters panel. The functions below get the values
// alone (p.width is 40). `--set key=value` can only override keys declared here. For many params,
// group them as an array of sections instead: [{ name: 'Box', children: { width: {...}, ... } }, ...],
// keys unique across sections; the panel shows each section under a heading that folds away.
export const params = {
  width: { value: 40, name: 'Width', description: 'Outside, along X, in mm.' },
  depth: { value: 30, name: 'Depth', description: 'Outside, along Y, in mm.' },
  height: { value: 12, name: 'Height', description: 'Outside, floor included, in mm.' },
  wall: { value: 2, name: 'Wall', description: 'Thickness of the walls and the floor, in mm.' },
};

export default (p) => {
  // Derived dimensions and helpers live inside the function, so they see overridden params.
  const inner = [p.width - 2 * p.wall, p.depth - 2 * p.wall];

  const box = () =>
    cube([p.width, p.depth, p.height]).subtract(
      cube([...inner, p.height]).translate([p.wall, p.wall, p.wall]),
    );

  return {
    assembly: () => [box().color('lightgray', 0.5), cube([5, 5, 5]).translate([10, 10, p.wall]).color('orange')],
    box, // printable parts: plain, uncolored, in print orientation
  };
};
```

What `export default` may be:

- a **model** — a `Solid`, or an array of solids (arrays may nest);
- an **object of named parts** — values are models, or functions returning models (only the part
  being shown or exported is called, so expensive parts cost nothing until asked for);
- a **function of `params`** returning either of those, or returning a function that returns a model
  (one part, called with `params`).

Every one of these functions may be `async`.

The **first part is the default** for `dev`, `stl`, `3mf` and `png`. Put the part the user looks at most
first — usually the assembly.

A part that is an array renders each solid separately with its own color and transparency, which
is what assembly views want. `cadcode stl` merges the part's solids into one body (`cadcode 3mf`
keeps them as separate objects, with their colors), so make the
printable parts the ones that are actually printed, positioned and oriented for the bed (e.g. a lid
flipped upside down, a `print` part laying several pieces side by side).

`console.log` output shows in the terminal and in the viewer corner — handy for reporting outer
dimensions, like OpenSCAD's `echo`.

## Modelling: the things that bite

**Shapes are immutable.** Every method returns a new shape; `box.translate(...)` on its own line
does nothing. Chain, or assign the result.

**Transform order reads left to right.** `cube(s).rotate([0, 90, 0]).translate([x, y, 0])` rotates
first, then moves. OpenSCAD's `translate(t) rotate(r) child()` is applied innermost first, so it
becomes `child().rotate(r).translate(t)` — reverse the order when porting.

**`rotate([x, y, z])` turns around X, then Y, then Z,** exactly as OpenSCAD. `rotate(a)` is around Z;
`rotate(a, [ax, ay, az])` is around any axis. A last `{ around }` argument turns around a
`point([x, y, z])`, another shape's bounding-box center, or `[x, y, z]` instead of the origin:
`lid.rotate([-110, 0, 0], { around: hinge })`. A cylinder lies along X after `.rotate([0, 90, 0])`,
along Y after `.rotate([-90, 0, 0])` (or `[90, 0, 0]`, pointing −Y).

**Primitives sit on the origin like OpenSCAD's:** `cube` has a corner at the origin unless
`{ center: true }`; `cylinder` stands on XY and grows along +Z unless `center: true`; `sphere` and
`circle` are centred.

**Options are objects.** `cylinder({ d: 5, h: 2, center: true })`, `cube([10, 20, 3], { center: true })`.
`cylinder` needs `h` and one of `r`/`d` (or `r1`/`r2`, `d1`/`d2` for cones). `sphere(5)` and
`circle(5)` accept a bare radius.

**Make cutters overshoot.** A hole through a 2 mm wall should be longer than 2 mm and start outside
it (`cylinder({ d: 3, h: wall + 2 }).translate([x, y, -1])`, or `center: true` with extra height).
Exactly coplanar faces leave zero-thickness skins or slivers.

**Lists can nest and skip.** Every function or method that takes shapes accepts nested arrays and
falsy values, so loops and conditionals go straight in:

```js
difference(
  plate,
  product([5, 35], [5, 25]).map(([x, y]) => cylinder({ d: 3.2, h: 10, center: true }).translate([x, y, 0])),
  withSlot && slot,
);
```

`product(xs, ys)` is OpenSCAD's `for (x = xs, y = ys)`; `range(a, b, step)` is `[a : step : b]` and
**includes** `b`.

**Slow rebuilds in `cadcode dev`:** wrap the expensive builder in `memo(fn)`, and the dev server and playground
reuse its result across saves while its source and arguments stay the same. Pass every value it uses as an
argument (plain data, e.g. `memo((teeth, module) => ...)(p.teeth, p.module)`): a `p` read from the closure or
an edited helper is not in the key, and the stale result comes back.

**2D needs extruding.** `square`, `circle`, `polygon` and `.offset()` make `Shape2`s; turn them into
solids with `.extrude(h, { center, twist, scale })`, `.revolve({ angle })` or `.sweep(path)` (along `[x, y, z]`
points: a handle, a pipe, or a spring along `helix({ r, pitch, turns })`). `loft([a, b, c], { z: [0, 10, 30] })`
joins sections at those heights, for a square base flowing into a round neck. Screw threads come from
`thread({ d, pitch, length })`; the matching hole is `thread({ ..., internal: true })` subtracted from the nut
(0.2 mm `clearance` by default; printed threads under about M8 rarely work, prefer `profile: 'trapezoid'` and a
pitch of 2 to 4 for lids). A 2D shape left in a part is
only a preview: drawn as a sketch on Z=0 (a see-through blue fill with a bold outline), left out of STL (a part with no solids fails to export). `.extrude` grows along +Z, so a profile meant for a side wall is extruded and
then rotated into place (`.extrude(depth).rotate([0, 90, 0])` points it along +X after rotation).
Rounded-rectangle cut-outs: `square([w - 2 * r, h - 2 * r], { center: true }).offset(r).extrude(depth)`.

**Text.** `text('A1', { size: 5, halign: 'center', valign: 'center' })` is a `Shape2`; extrude it for raised
letters, or subtract the extrusion for engraving (sink it: extrude a bit deeper than the cut and
translate it so it pokes out of the face). `size` is the **height of a capital letter**; OpenSCAD's
capitals in Liberation Sans are 0.955 of its `size`, so `size = 10` there is `size: 9.55` here. Default font Liberation Sans, with Cyrillic; another font
is a file next to the program: `import font from './Roboto.ttf'` then `text(s, { font })`. For
printing, keep letters at least ~5 mm tall and strokes over two nozzle widths, or use a bold font.

**Importing files.** A file next to the program is imported for its contents, then turned into
shapes: `import part from './part.stl'` then `importSTL(part)` is a `Solid` to cut, combine and
move like any other; `import3MF(model)` gives an array of solids, one per object, with their colors.
`import logo from './logo.svg'` then `importSVG(logo, { center: true })` is a `Shape2` in mm, Y up,
to extrude or engrave; only filled shapes come in, so a logo drawn with strokes needs Stroke to Path first.
`importDXF(drawing, { layer: 'cut' })` reads a DXF's closed outlines (holes inside), joining loose lines and
arcs; pick the outline layer when the drawing also has center lines or construction geometry. The dev server reloads when the file changes. The mesh must be closed and
face outward; otherwise it throws and says what is wrong, and the fix is to repair the file (a
slicer or mesh editor), not to work around it in code. Check an imported part's `bounds()` before
placing it: files keep whatever origin and orientation they were drawn in.

**Rounded and chamfered edges.** `cube(size, { round: r })` rounds every edge and
`cube(size, { chamfer: c })` cuts every edge at 45°; `cylinder({ d, h, round })` / `{ chamfer }`
do the top and bottom edges. All keep the given size. A flat bottom prints better, so for
enclosures and trays pick edges by group — `z` (vertical), `top`, `bottom` — and leave the bottom
sharp. Round and chamfer mix by group, and a top chamfer follows the rounded corners:

```js
const roundedBox = (l, w, h, r) => cube([l, w, h], { round: { z: r } });
const block = cube([60, 30, 20], { round: { z: 3 }, chamfer: { top: 1.5 } });
cylinder({ d: 20, h: 8, chamfer: { top: 1 } }); // flat bottom, chamfered top
```

For any other shape, `part.minkowski(sphere(r))` rounds every edge but grows the part by `r` on
each side (shrink it first), and on a part with holes or pockets it takes seconds: round simple
pieces, then do the booleans.

**Colors** (`.color('orange', 0.35)`, `color('orange', 0.35, shape)`, CSS names, `#hex`,
`[r, g, b, a]`) are for previews; STL has none, and 3MF carries them as base materials, which
slicers may or may not map to filaments (PrusaSlicer ignores them). A color survives booleans, so a colored part
unioned into something else keeps its faces' color. Apply color last, outside the booleans of a
printable part, and leave printable parts uncolored.

**Resolution.** `setResolution({ fn })` sets the default segment count, or `{ fa, fs }` for
OpenSCAD's adaptive rule (defaults `fa: 12, fs: 2`, which makes small holes visibly polygonal).
Any curved primitive also takes its own `fn`. Without `fn`, a radius-1 cylinder has 5 sides —
set a resolution for anything with small holes or pins.

Functional forms (`translate(v, ...shapes)`, `rotate`, `scale`, `mirror`, `color`, `offset`,
`linearExtrude`) union their shapes and then transform, for code that reads better nested.

The complete signatures are in [references/api.md](references/api.md). For porting a `.scad` file,
read [references/openscad.md](references/openscad.md) first — it maps every construct.

## Checking the geometry: render and look

You can't see the viewer, but you can render. After writing or changing a model, render it and
read the image before saying the work is done:

```sh
npx cadcode png model.js --part assembly --view sheet -o /tmp/preview.png   # iso, front, right, top
npx cadcode png model.js --part box --view iso --size 1200x900 -o /tmp/box.png
```

Then open the PNG with the Read tool. Views: `iso`, `iso-back`, `front`, `back`, `left`, `right`,
`top`, `bottom`, `sheet`. Translucent colors in an assembly let you see inside; render single
parts to check holes and walls. Look for: holes that go through (vs. blind or missing), parts in
the right place relative to each other, nothing floating, the print part flat on Z = 0.

Numbers beat eyeballing for fit and size: log bounds and volumes from the program or a scratch
script. When the user checks a fit by hand, point them at the `cadcode dev` viewer's Section (S:
cut across X, Y or Z and drag the plane) and Measure (M: click two points). `cadcode png` has no
section, so to see inside a part yourself, cut it in a scratch program (`.intersect` with a box).

```js
console.log(box().bounds()); // { min: [x, y, z], max: [x, y, z] }
console.log(box().volume());
```

`npx cadcode parts model.js` lists parts and runs the program, so it's the quickest syntax and
runtime check. Errors print with the line in the user's file.

When the user is iterating, suggest `npx cadcode dev model.js` (with `--open`) — they get a live
preview that reloads on every save and keeps their camera; shift+drag pans, F fits.

## CLI reference

| Option | For | Meaning |
| --- | --- | --- |
| `-p, --part <name>` | all | Part to use; default is the first |
| `-a, --all` | stl, 3mf, png | Every part, one file each |
| `-s, --set <k=v>` | all | Override a declared param; repeatable; JSON values, else string |
| `-o, --out <path>` | stl, 3mf, png | Output file, or directory with `--all` |
| `--view <name>` | png | View, default `iso` |
| `--size <WxH>` | png | Default `800x600` |
| `--port`, `--host`, `--open` | dev | Default `5173`, `127.0.0.1` |

Default output names are `<file>.stl`, or `<file>-<part>.stl` when the program has several parts
(likewise `.3mf` and `.png`).
