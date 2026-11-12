// A TypeScript program using the package by name, checked against the typings in types/.
import { color, cube, cylinder, difference, hull, intersection, mirror, offset, range, rotate, scale, spline, square, text, translate, union, type Path, type Shape2, type Solid } from 'cadcode';

const box: Solid = cube([20, 10, 5], { round: 1 })
  .translate([1, 0, 0])
  .rotate(90)
  .subtract(cylinder({ d: 3, h: 10 }));
const volume: number = box.volume();
const holes = range(0, 3).map((i) => cylinder({ r: 1, h: 6 }).translate([i * 4, 5, -1]));
export const part = difference(box, holes, volume > 0 && cube(1));
export const plate: Solid = color('orange', 0.5, offset(1, square(10)).extrude(2));
const empty: boolean = plate.isEmpty();
export const label: Solid = text('A1', { size: 5, halign: 'center' }).extrude(1);
// @ts-expect-error halign is left, center or right
text('A1', { halign: 'middle' });

// @ts-expect-error no such method
box.notAMethod();
// @ts-expect-error a size is a number or a vector
cube('big');

// The functional forms give back what they were given, so 2D results extrude without a cast.
const outline: Shape2 = union(square(4), translate([5, 0], square(2)));
export const slab: Solid = difference(outline, rotate(45, { around: [2, 2] }, square(1))).extrude(2);
export const turned: Solid = rotate([0, 0, 30], cube(2), [cube(1), null]);
export const shrunk: Shape2 = scale(0.5, mirror([1, 0], hull(square(1), square(1).translate([3, 0]))));
export const lens: Solid = intersection(cube(2), cube(2).translate([1, 1, 1]));
export const curve: Path = spline([[0, 0], [5, 5], [10, 0]]);
export const blob: Shape2 = spline([[0, 0], [5, 5], [10, 0]], { closed: true });
// @ts-expect-error solids and 2D shapes do not mix
union(cube(1), square(1));
