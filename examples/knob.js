import { cube, cylinder, polygon, range, setResolution } from 'cadcode';

setResolution({ fn: 96 });

export const params = {
  // Grip
  d: 24,
  height: 16,
  chamfer: 1.5,
  knurls: 18,
  knurlD: 2,

  // Skirt with the pointer
  skirtD: 30,
  skirtH: 3,

  // D-shaft of a 6 mm potentiometer
  shaftD: 6,
  shaftFlat: 4.5, // across the flat
  shaftDepth: 11,
  fit: 0.2, // added to the hole
};

export default (p) => {
  const r = p.d / 2;
  const skirtR = p.skirtD / 2;

  // Half cross-section: X is the radius, Y becomes Z when revolved.
  const body = () =>
    polygon([
      [0, 0],
      [skirtR, 0],
      [skirtR, p.skirtH],
      [r, p.skirtH + 1],
      [r, p.height - p.chamfer],
      [r - p.chamfer, p.height],
      [0, p.height],
    ]).revolve();

  const knurling = () =>
    range(0, p.knurls - 1).map((i) =>
      cylinder({ d: p.knurlD, h: p.height, fn: 16 })
        .translate([r + p.knurlD / 4, 0, p.skirtH + 2])
        .rotate((360 * i) / p.knurls),
    );

  const pointer = () => cube([skirtR, 1.2, 1]).translate([r - 1, -0.6, p.skirtH - 0.8]);
  const topMark = () => cube([r - 3, 1.2, 1]).translate([2, -0.6, p.height - 0.6]);

  const shaftHole = () => {
    const d = p.shaftD + p.fit;
    const flat = p.shaftFlat + p.fit;
    // Round on -Y, flat at `flat` from the round side.
    return cylinder({ d, h: p.shaftDepth + 1 })
      .intersect(cube([d + 2, flat + 1, p.shaftDepth + 3]).translate([-d / 2 - 1, -d / 2 - 1, -1]))
      .translate([0, 0, -1]);
  };

  // Prints as it stands: the skirt is on the bed and the blind end of the D-hole is a short bridge.
  const knob = () => body().subtract(knurling(), pointer(), topMark(), shaftHole());

  return { knob };
};
