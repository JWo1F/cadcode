/*---
title: Icon stamp
description: A clay or cookie stamp with any Material Design icon, fetched by name when the model is built.
---*/
// Icon stamp: a round stamp for clay, dough or wax with an icon in relief. The icon is not in
// this file: the program is async and awaits fetch() of the SVG by name, so changing `icon`
// gives a new stamp. Building it needs a network connection.
//
// Names are those of Material Design Icons, https://pictogrammers.com/library/mdi/
//
// Prints upside down: the knob on the bed, a 45° flare up to the plate, the relief on top.
// The relief is mirrored, so the impression reads the right way round.
//
//   cadcode dev examples/icon-stamp.js
//   cadcode stl examples/icon-stamp.js --set icon=cat
import { cylinder, importSVG, setResolution } from 'cadcode';

setResolution({ fa: 4, fs: 0.4 });

export const params = {
  icon: { value: 'paw', name: 'Icon', description: "Material Design icon name, e.g. 'paw', 'leaf', 'cat', 'heart', 'star', 'rocket-launch'." },
  size: { value: 36, name: 'Icon size', description: "The icon's longer side, in mm." },
  relief: { value: 2, name: 'Relief', description: 'How deep the stamp presses: height of the raised icon, in mm.' },

  // Plate
  margin: { value: 3, name: 'Margin', description: 'Plate border around the icon, in mm.' },
  thick: { value: 3, name: 'Plate thickness', description: 'Thickness of the plate, in mm.' },

  // Handle
  knobD: { value: 18, name: 'Knob diameter', description: 'Diameter of the handle knob, in mm.' },
  knobH: { value: 22, name: 'Knob height', description: 'Height of the handle knob, in mm.' },
};

// A pinned version: a stamp should not change because the icon set did.
const iconURL = (name) => `https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/${name}.svg`;

export default async (p) => {
  const response = await fetch(iconURL(p.icon));
  if (!response.ok) throw new Error(`No icon "${p.icon}" (${response.status}): see https://pictogrammers.com/library/mdi/`);
  const art = importSVG(await response.text(), { center: true });

  // Icons are drawn in a 24-unit box; scaled so the longer side is `size`.
  const { min, max } = art.bounds();
  const scale = p.size / Math.max(max[0] - min[0], max[1] - min[1]);
  const face = art.scale(scale).mirror([1, 0]);

  // The plate covers the icon's corners too, whatever its proportions.
  const plateR = Math.hypot((max[0] - min[0]) * scale, (max[1] - min[1]) * scale) / 2 + p.margin;
  const knobR = p.knobD / 2;
  const flareH = plateR - knobR; // 45°, no supports

  const knob = cylinder({ r: knobR, h: p.knobH, round: { bottom: 3 } });
  const flare = cylinder({ r1: knobR, r2: plateR, h: flareH }).translate([0, 0, p.knobH]);
  const plate = cylinder({ r: plateR, h: p.thick }).translate([0, 0, p.knobH + flareH]);
  const relief = face.extrude(p.relief).translate([0, 0, p.knobH + flareH + p.thick]);

  return { stamp: () => knob.union(flare, plate, relief) };
};
