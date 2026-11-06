// A TypeScript program using the package by name, checked against the typings in types/.
import { color, cube, cylinder, difference, offset, range, square, type Solid } from 'cadcode';

const box: Solid = cube([20, 10, 5], { round: 1 })
  .translate([1, 0, 0])
  .rotate(90)
  .subtract(cylinder({ d: 3, h: 10 }));
const volume: number = box.volume();
const holes = range(0, 3).map((i) => cylinder({ r: 1, h: 6 }).translate([i * 4, 5, -1]));
export const part = difference(box, holes, volume > 0 && cube(1));
export const plate: Solid = color('orange', 0.5, offset(1, square(10)).extrude(2));
const empty: boolean = plate.isEmpty();

// @ts-expect-error no such method
box.notAMethod();
// @ts-expect-error a size is a number or a vector
cube('big');
