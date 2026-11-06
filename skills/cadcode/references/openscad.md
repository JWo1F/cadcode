# Porting OpenSCAD to cadcode

Port line by line, keeping the original's names (in camelCase), comments and structure, so the
user can diff the two mentally. Then render both parts and compare: `openscad -o x.png` if it's
installed, otherwise reason from the source.

## Mapping

| OpenSCAD | cadcode |
| --- | --- |
| `$fn = 40;` | `setResolution({ fn: 40 });` at the top of the module |
| `$fa = 6; $fs = 0.5;` | `setResolution({ fa: 6, fs: 0.5 });` |
| `wall = 2.0;  // comment` (top-level tunable) | an entry in `export const params = { wall: 2.0 }`, keeping the comment |
| derived values (`iL = main_l + div_t + sens_l;`) | `const` inside the default-export function, after destructuring `p` |
| `module box() { ... }` | `const box = () => ...` inside the default-export function |
| `module grid(a, b) { ... }` | `const grid = (a, b) => ...` returning a shape (use `union(...)` for many) |
| several top-level children in a module | `union(a, b, c)`: a module's children union implicitly |
| `part = "box"; if (part == "box") box(); else if ...` | `return { box, lid: () => ..., assembly: () => [...] }`; choose with `--part` |
| `-D wall=2.4` | `--set wall=2.4` |
| `echo(str("Size: ", x));` | `console.log(\`Size: ${x}\`)` |
| `cube([a, b, c]);` | `cube([a, b, c])` |
| `cube(s, center = true);` | `cube(s, { center: true })` |
| `cylinder(r = 2, h = 5);` | `cylinder({ r: 2, h: 5 })` |
| `cylinder(d1 = 4, d2 = 2, h = 3, $fn = 8);` | `cylinder({ d1: 4, d2: 2, h: 3, fn: 8 })` |
| `sphere(5);` | `sphere(5)` |
| `square([a, b], center = true);` | `square([a, b], { center: true })` |
| `circle(d = 3);` | `circle({ d: 3 })` |
| `polygon(pts, paths);` | `polygon(pts, paths)` |
| `translate(t) rotate(r) mirror(m) child();` | `child().mirror(m).rotate(r).translate(t)`: **reverse the order** |
| `rotate(90) child();` | `child().rotate(90)` (around Z) |
| `rotate(a, v) child();` | `child().rotate(a, v)` |
| `difference() { a(); b(); c(); }` | `difference(a(), b(), c())` or `a().subtract(b(), c())` |
| `union() { ... }` | `union(...)` |
| `intersection() { a(); b(); }` | `intersection(a(), b())` |
| `hull() { ... }` | `hull(...)` |
| `hull() for (x = xs, y = ys) translate([x, y, 0]) c();` | `hull(product(xs, ys).map(([x, y]) => c().translate([x, y, 0])))` |
| `minkowski() { a(); sphere(r); }` | `minkowski(a(), sphere(r))` or `a().minkowski(sphere(r))` |
| `minkowski() { cube(s - 2 * r, center = true); sphere(r); }` (rounded box) | `cube(s, { center: true, round: r })`: exact size, much faster |
| `for (x = xs) translate([x, 0, 0]) c();` | `xs.map((x) => c().translate([x, 0, 0]))` (an array works anywhere shapes do) |
| `for (i = [0 : n - 1])` | `range(0, n - 1).map((i) => ...)` |
| `for (i = [0 : 2 : 10])` | `range(0, 10, 2)` |
| `for (x = xs, y = ys)` | `product(xs, ys).map(([x, y]) => ...)` |
| `linear_extrude(h) shape2d;` | `shape2d.extrude(h)` |
| `linear_extrude(h, center = true, twist = t, scale = s)` | `.extrude(h, { center: true, twist: t, scale: s })` |
| `rotate_extrude(angle = 180) shape2d;` | `shape2d.revolve({ angle: 180 })` |
| `offset(r = 1) shape2d;` | `shape2d.offset(1)` |
| `text("A1", size = 10, halign = "center", valign = "center");` | `text('A1', { size: 9.55, halign: 'center', valign: 'center' })`: cadcode's `size` is the capital height, 0.955 of OpenSCAD's `size` in Liberation Sans |
| `text(t, font = "Roboto:style=Bold");` | `import font from './Roboto-Bold.ttf';` then `text(t, { font })`: fonts are files, not system names |
| `text(t, spacing = 1.2, direction = "rtl")` | `spacing` works the same; `direction`, `language` and `script` are not supported |
| `offset(delta = 1) shape2d;` | `shape2d.offset({ delta: 1 })` |
| `offset(delta = 1, chamfer = true)` | `shape2d.offset({ delta: 1, chamfer: true })` |
| `color("orange", 0.35) lid();` | `lid().color('orange', 0.35)` |
| `color("green") translate(t) cube(s);` | `cube(s).translate(t).color('green')` |
| `projection() child();` | `child().project()` |
| `projection(cut = true) child();` | `child().slice(0)` |
| `scale([1, 1, 2])`, `mirror([1, 0, 0])` | `.scale([1, 1, 2])`, `.mirror([1, 0, 0])` |
| `%`, `#`, `!`, `*` modifiers | none; comment out, or add a debug part |
| `floor`, `ceil`, `sqrt`, `sin(deg)` | `Math.floor`, `Math.ceil`, `Math.sqrt`, `Math.sin(deg * Math.PI / 180)`: **JS trig is radians** |
| `len(v)`, `concat(a, b)`, `str(...)` | `v.length`, `[...a, ...b]`, template literals |
| `let (x = 1) ...`, `c ? a : b` | `const x = 1;`, `c ? a : b` |

## Checklist

- Every `translate(...) rotate(...) X` chain is reversed into `X.rotate(...).translate(...)`.
- Trig calls convert degrees to radians.
- `for` ranges: OpenSCAD's `[a : b]` includes `b`, and so does `range(a, b)`.
- Variables a module reads from the top level must exist inside the default-export function, which
  is where you compute them.
- The `part` switch becomes the returned object; the original default part goes first. For print
  layouts (`rotate([180, 0, 0])` lids), keep the same transforms in the same reversed order.
- Run `npx cadcode parts file.js` to confirm it evaluates, log the same values the `.scad` echoed
  and compare them, then render `--view sheet` for each part and look.

## Worked example

```scad
module snap_line(len) { rotate([0, 90, 0]) cylinder(r = bump_r, h = len, center = true); }
for (x = bump_xs, y = [0, iW]) translate([x, y, iH - lip_d / 2]) snap_line(bump_len + 1);
```

```js
const snapLine = (len) => cylinder({ r: bumpR, h: len, center: true }).rotate([0, 90, 0]);
product(bumpXs, [0, iW]).map(([x, y]) => snapLine(bumpLen + 1).translate([x, y, iH - lipD / 2]));
```

The repository's `examples/sensor-case.js` is a full port of a 175-line `.scad` enclosure.
