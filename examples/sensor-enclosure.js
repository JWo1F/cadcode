import { cube, cylinder, hull, product, range, setResolution } from 'cadcode';

setResolution({ fn: 48 });

export const params = {
  // Contents
  boardL: 34, // nice!nano
  boardW: 17,
  batteryD: 12,
  batteryL: 30,
  sensorS: 15, // temperature / humidity / pressure board, taped to the floor
  gap: 0.5, // clearance around every component

  // Shell
  wall: 2,
  floor: 2,
  innerH: 14,
  divider: 1.6,
  corner: 3,

  // USB-C
  usbW: 9.6,
  usbH: 3.8,
  usbZ: 2.8, // connector centre above the floor: board 1.2 + half of the 3.2 connector
  plugW: 12.6, // plug overmould recess on the outside
  plugH: 7,
  plugWall: 0.8, // wall left where the recess is

  // Snap lid
  lidT: 2,
  lipH: 3.5,
  lipWall: 1.2,
  lipGap: 0.2,
  snapD: 1.2, // bump on the lip
  snapIn: 0.45, // how far the bump stands out of the lip
  snapLen: 10,

  // Vents
  ventW: 1.5,
  ventPitch: 3,
};

export default (p) => {
  const wiresW = 6;

  // Interior, X along the length: [main compartment | divider | sensor chamber]
  const mainX = p.boardL + 2 * p.gap;
  const chamberX = p.sensorS + 2 * p.gap;
  const innerY = p.gap + p.boardW + p.gap + 1.2 + p.gap + p.batteryD + p.gap;
  const innerX = mainX + p.divider + chamberX;

  const L = innerX + 2 * p.wall;
  const W = innerY + 2 * p.wall;
  const H = p.floor + p.innerH;

  const x0 = p.wall; // interior starts here
  const y0 = p.wall;
  const z0 = p.floor;
  const chamberX0 = x0 + mainX + p.divider;

  const boardY = y0 + p.gap;
  const ribY = boardY + p.boardW + p.gap;
  const batteryY = ribY + 1.2 + p.gap + p.batteryD / 2;
  const batteryZ = z0 + 0.5 + p.batteryD / 2;
  const batteryX = x0 + (mainX - p.batteryL) / 2;

  const roundedBox = (l, w, h, r) =>
    hull(product([r, l - r], [r, w - r]).map(([x, y]) => cylinder({ r, h }).translate([x, y, 0])));

  // Snap: a bump on the lip clicks into a groove on the inside of each long wall.
  const snapZ = H - p.lipH / 2;
  const snapXs = [x0 + mainX / 2 - p.snapLen / 2, chamberX0 + chamberX / 2 - p.snapLen / 2];
  const snapRod = (d, len) => cylinder({ d, h: len }).rotate([0, 90, 0]);

  const lipOuterY = (side) => (side === 0 ? y0 + p.lipGap : y0 + innerY - p.lipGap);
  const snapCut = (d, len, standOut) =>
    [0, 1].flatMap((side) =>
      snapXs.map((x) => {
        const face = side === 0 ? y0 : y0 + innerY;
        const y = side === 0 ? face + d / 2 - standOut : face - d / 2 + standOut;
        return snapRod(d, len).translate([x, y, snapZ]);
      }),
    );

  const usbCut = () => {
    const y = boardY + p.boardW / 2;
    const z = z0 + p.usbZ;
    const opening = hull(
      [-1, 1].map((s) =>
        cylinder({ d: p.usbH, h: p.wall + 2 })
          .rotate([0, 90, 0])
          .translate([-1, y + s * (p.usbW - p.usbH) / 2, z]),
      ),
    );
    const recessDepth = p.wall - p.plugWall;
    const recess = hull(
      [-1, 1].map((s) =>
        cylinder({ d: p.plugH, h: recessDepth + 1 })
          .rotate([0, 90, 0])
          .translate([-1, y + s * (p.plugW - p.plugH) / 2, z]),
      ),
    );
    return [opening, recess];
  };

  const wallVents = () => {
    const zBottom = z0 + 2;
    const zTop = H - p.lipH - 1;
    const h = zTop - zBottom;
    const across = (from, span) => {
      const n = Math.floor((span - p.ventW) / p.ventPitch);
      const start = from + (span - n * p.ventPitch) / 2;
      return range(0, n - 1).map((i) => start + i * p.ventPitch + p.ventPitch / 2);
    };
    const end = across(y0, innerY).map((y) =>
      cube([p.wall + 2, p.ventW, h]).translate([L - p.wall - 1, y - p.ventW / 2, zBottom]),
    );
    const sides = across(chamberX0, chamberX).map((x) =>
      cube([p.ventW, W + 2, h]).translate([x - p.ventW / 2, -1, zBottom]),
    );
    return [end, sides];
  };

  const batteryCradle = () =>
    [batteryX + 5, batteryX + p.batteryL - 5 - 3].map((x) =>
      cube([3, p.batteryD + 2 * p.gap + 2, p.batteryD / 2])
        .translate([x, batteryY - p.batteryD / 2 - p.gap - 1, z0])
        .subtract(
          cylinder({ d: p.batteryD + 2 * p.gap, h: 5 })
            .rotate([0, 90, 0])
            .translate([x - 1, batteryY, batteryZ]),
        ),
    );

  const box = () => {
    const shell = roundedBox(L, W, H, p.corner).subtract(cube([innerX, innerY, H]).translate([x0, y0, z0]));

    // Keeps the board's edge off the battery.
    const rib = cube([mainX, 1.2, 3]).translate([x0, ribY, z0]);

    // Divider: shorter at the walls so the lip passes, notched in the middle for the sensor wires.
    const lipZone = cube([innerX, innerY, p.lipH + 1])
      .translate([x0, y0, H - p.lipH])
      .subtract(
        cube([innerX - 2 * (p.lipGap + p.lipWall), innerY - 2 * (p.lipGap + p.lipWall), p.lipH + 3]).translate([
          x0 + p.lipGap + p.lipWall,
          y0 + p.lipGap + p.lipWall,
          H - p.lipH - 1,
        ]),
      );
    const divider = cube([p.divider, innerY, p.innerH - p.lipGap])
      .translate([x0 + mainX, y0, z0])
      .subtract(
        lipZone,
        cube([p.divider + 2, wiresW, 3]).translate([x0 + mainX - 1, y0 + innerY / 2 - wiresW / 2, H - 3]),
      );

    const pryNotch = cube([8, 2, 1.2]).translate([x0 + mainX / 2 - 4, -1, H - 1.2]);
    const grooves = snapCut(p.snapD + 0.2, p.snapLen + 1, p.snapIn + 0.1).map((g) => g.translate([-0.5, 0, 0]));

    return shell
      .union(rib, divider, batteryCradle())
      .subtract(usbCut(), wallVents(), pryNotch, grooves);
  };

  // Lid as installed: plate on top of the box, lip hanging down inside the walls.
  const lidInPlace = () => {
    const plate = roundedBox(L, W, p.lidT, p.corner).translate([0, 0, H]);
    const lipOuter = [innerX - 2 * p.lipGap, innerY - 2 * p.lipGap];
    const lip = cube([...lipOuter, p.lipH])
      .subtract(cube([lipOuter[0] - 2 * p.lipWall, lipOuter[1] - 2 * p.lipWall, p.lipH + 2]).translate([p.lipWall, p.lipWall, -1]))
      .translate([x0 + p.lipGap, y0 + p.lipGap, H - p.lipH]);
    const bumps = [0, 1].flatMap((side) =>
      snapXs.map((x) => {
        const face = lipOuterY(side);
        const y = side === 0 ? face + p.snapD / 2 - p.snapIn : face - p.snapD / 2 + p.snapIn;
        return snapRod(p.snapD, p.snapLen).translate([x, y, snapZ]);
      }),
    );
    const ventSpan = chamberX - 2 * p.lipWall;
    const n = Math.floor(ventSpan / p.ventPitch);
    const lidVents = range(0, n - 1).map((i) =>
      cube([p.ventW, innerY - 2 * (p.lipGap + p.lipWall) - 2, p.lidT + 2]).translate([
        chamberX0 + (chamberX - n * p.ventPitch) / 2 + i * p.ventPitch + (p.ventPitch - p.ventW) / 2,
        y0 + p.lipGap + p.lipWall + 1,
        H - 1,
      ]),
    );

    return plate.union(lip, bumps).subtract(lidVents);
  };

  const lid = () => lidInPlace().rotate([180, 0, 0]).translate([0, W, H + p.lidT]);

  const contents = () => [
    cube([p.boardL, p.boardW, 1.2]).translate([x0 + p.gap, boardY, z0]).color('#2b6cb0'),
    cube([7.4, 9, 3.2]).translate([x0 + p.gap - 0.4, boardY + p.boardW / 2 - 4.5, z0 + 1.2]).color('silver'),
    cylinder({ d: p.batteryD, h: p.batteryL }).rotate([0, 90, 0]).translate([batteryX, batteryY, batteryZ]).color('#c53030'),
    cube([p.sensorS, p.sensorS, 1.6])
      .translate([chamberX0 + p.gap, y0 + (innerY - p.sensorS) / 2, z0])
      .color('#2f855a'),
  ];

  console.log(`outer ${L.toFixed(1)} × ${W.toFixed(1)} × ${(H + p.lidT).toFixed(1)} mm`);

  return {
    assembly: () => [box().color('lightgray', 0.45), lidInPlace().color('white', 0.35), contents()],
    box,
    lid,
    print: () => [box(), lid().translate([0, W + 6, 0])],
  };
};
