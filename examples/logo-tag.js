/*---
title: Logo tag
description: A keyring tag with an SVG logo raised on its face or engraved into it, and the logo as its own part for a color change.
---*/
// Logo tag: a round tag with a keyring hole and a logo from an SVG on its face.
// The logo is scaled to fit the tag, so any SVG works without measuring it.
// Prints face up. For two colors, print `tag` and `logo` as two parts of one object,
// or pause at the height where the logo starts.
//
// The SVG sits in this file so the example also runs in the playground. For your own,
// put the file next to the program and import it instead:
//
//   import logo from './logo.svg';
//
//   cadcode dev examples/logo-tag.js
//   cadcode 3mf examples/logo-tag.js --part assembly
import { cylinder, importSVG, setResolution } from 'cadcode';

setResolution({ fa: 6, fs: 0.5 });

// Mountains under a sun with a ring around it. The ring is one path with
// fill-rule="evenodd", so its inner circle is a hole.
const logo = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="80mm" viewBox="0 0 100 80">
  <path fill-rule="evenodd" d="M58 22a14 14 0 1 0 28 0a14 14 0 1 0 -28 0z M62 22a10 10 0 1 0 20 0a10 10 0 1 0 -20 0z"/>
  <circle cx="72" cy="22" r="6"/>
  <polygon points="2,78 34,30 50,52 62,40 98,78"/>
</svg>`;

export const params = [
  {
    name: 'Tag',
    children: {
      diameter: { value: 40, name: 'Diameter', description: 'Diameter of the round tag, in mm.' },
      thick: { value: 3, name: 'Thickness', description: 'Thickness of the tag, in mm.' },
      logoSize: { value: 26, name: 'Logo size', description: 'Width the logo is scaled to, in mm.' },
      raised: { value: true, name: 'Raised', description: 'Raise the logo above the face; false engraves it instead.' },
      depth: { value: 0.8, name: 'Logo depth', description: 'How far the logo stands above the face, or goes into it, in mm.' },
      hole: { value: 5, name: 'Keyring hole', description: 'Diameter of the keyring hole, in mm.' },
      rim: { value: 2.5, name: 'Rim', description: 'Material around the keyring hole, in mm.' },
    },
  },
];

export default (p) => {
  const r = p.diameter / 2;
  // centered on the origin, scaled to the requested width
  const art = importSVG(logo, { center: true });
  const { min, max } = art.bounds();
  const mark = art.scale(p.logoSize / (max[0] - min[0])).translate([0, -2, 0]);

  // a round body, and a lug at the top for the ring
  const lugY = r + p.hole / 2;
  const body = cylinder({ r, h: p.thick, round: { top: 0.8 } })
    .union(cylinder({ d: p.hole + 2 * p.rim, h: p.thick }).translate([0, lugY, 0]).hull(cylinder({ r: r * 0.5, h: p.thick })))
    .subtract(cylinder({ d: p.hole, h: p.thick + 2 }).translate([0, lugY, -1]));

  const raisedLogo = p.raised ? mark.extrude(p.depth).translate([0, 0, p.thick]) : null;
  const tag = () => (p.raised ? body : body.subtract(mark.extrude(p.depth + 1).translate([0, 0, p.thick - p.depth])));

  return {
    assembly: () => [tag().color('#3a6ea5'), raisedLogo?.color('#f4f1de')],
    tag,
    ...(raisedLogo && { logo: () => raisedLogo }),
  };
};
