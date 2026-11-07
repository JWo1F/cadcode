/*---
title: Nameplate
description: A desk or door sign with a name and a second line, engraved or raised, and the letters as their own part for a color change.
---*/
// Nameplate: a rounded plate with a border and two centered lines of text.
// The text is either engraved into the face or raised above it. The plate grows to fit the name,
// so a longer name needs no other change.
// Prints face up. For two colors, print `plate` and `letters` as two parts of one object
// in the slicer, or pause at the height where the letters start.
//
//   cadcode dev examples/nameplate.js
//   cadcode stl examples/nameplate.js --set 'name="Ada Lovelace"' --all
import { cube, text } from 'cadcode';

export const params = {
  name: { value: 'Grace Hopper', name: 'Name', description: 'First line of text; the plate grows to fit it.' },
  subtitle: { value: 'Rear Admiral', name: 'Subtitle', description: 'Second, smaller line of text; empty for none.' },
  raised: { value: true, name: 'Raised', description: 'Raise the text above the face; false engraves it instead.' },

  nameSize: { value: 9, name: 'Name size', description: 'Height of a capital letter in the name, in mm.' },
  subtitleSize: { value: 4.5, name: 'Subtitle size', description: 'Height of a capital letter in the subtitle, in mm.' },
  gap: { value: 4, name: 'Line gap', description: 'Space between the two lines, in mm.' },
  margin: { value: 8, name: 'Margin', description: 'Space from the text to the border, in mm.' },

  thick: { value: 3, name: 'Thickness', description: 'Thickness of the plate, in mm.' },
  depth: { value: 0.8, name: 'Letter depth', description: 'How far the letters stand above the face, or go into it, in mm.' },
  border: { value: 1.6, name: 'Border', description: 'Width of the frame around the edge, in mm; 0 for none.' },
  round: { value: 3, name: 'Corner radius', description: 'Radius of the plate corners, in mm.' },
};

export default (p) => {
  // Both lines centered on x = 0; the name's baseline sits on y = 0.
  const name = text(p.name, { size: p.nameSize, halign: 'center' });
  const subtitle = text(p.subtitle, { size: p.subtitleSize, halign: 'center' }).translate([0, -p.subtitleSize - p.gap]);
  const lettering = p.subtitle ? name.union(subtitle) : name;

  // The plate fits around the text's bounds.
  const { min, max } = lettering.bounds();
  const width = max[0] - min[0] + 2 * p.margin;
  const height = max[1] - min[1] + 2 * p.margin;
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
  const atCenter = (shape) => shape.translate([center[0] - width / 2, center[1] - height / 2, 0]);

  const slab = atCenter(cube([width, height, p.thick], { round: { z: p.round } }));
  const frame =
    p.border > 0 &&
    atCenter(
      cube([width, height, p.depth], { round: { z: p.round } })
        .subtract(cube([width - 2 * p.border, height - 2 * p.border, p.depth + 2], { round: { z: Math.max(p.round - p.border, 0.01) } }).translate([p.border, p.border, -1]))
        .translate([0, 0, p.thick]),
    );

  // Raised letters stand on the face; engraved ones are cut from it, starting a little above.
  const letters = p.raised ? lettering.extrude(p.depth).translate([0, 0, p.thick]) : null;
  const plate = () => {
    const body = frame ? slab.union(frame) : slab;
    return p.raised ? body : body.subtract(lettering.extrude(p.depth + 1).translate([0, 0, p.thick - p.depth]));
  };

  return {
    assembly: () => [plate().color('#2b3a55'), letters?.color('#f2c14e')],
    plate,
    ...(letters && { letters: () => letters }),
  };
};
