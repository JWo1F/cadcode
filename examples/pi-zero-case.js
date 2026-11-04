// Raspberry Pi Zero / Zero 2 W case with a sliding lid that clicks shut.
// Board dimensions from the official mechanical drawing. Both parts print as they sit in use.
//
//   cadcode dev examples/pi-zero-case.js
//   cadcode stl examples/pi-zero-case.js --part print
import { cube, cylinder, hull, product, range, setResolution, square } from 'cadcode';

setResolution({ fn: 48 });

export const params = {
  // Print
  wall: 2,
  floor: 1.6,
  corner: 3,
  gap: 0.5, // board to wall

  // Board
  boardL: 65,
  boardW: 30,
  boardT: 1.4,
  holeInset: 3.5,
  standoff: 3,
  screwHole: 2.2, // M2.5 self-tapping
  headroom: 6, // above the board, under the lid; keeps the plug recesses below the lid groove

  // Ports on the long side, centres from the board's left edge
  hdmiX: 12.4,
  otgX: 41.4,
  pwrX: 54,
  sdY: 16.9, // SD card centre from the port side
  cameraSlot: true,
  gpioSlot: true,

  // Sliding lid
  lidT: 3, // flush with the walls
  tongueT: 1.2, // the part that runs in the grooves
  groove: 1, // groove depth in the walls
  slide: 0.2, // clearance in the grooves
  detent: 0.5, // how far the click bumps stand out of the tongue's edges
};

export default (p) => {
  const iL = p.gap + p.boardL + p.gap;
  const iW = p.gap + p.boardW + p.gap;
  const boardZ = p.standoff; // underside of the board, from the inside floor
  const boardTop = boardZ + p.boardT;
  const lidZ = boardTop + p.headroom; // underside of the lid
  const H = lidZ + p.lidT; // top, from the inside floor
  const detentX = iL + p.wall - 1.5; // click bumps, just inside the open end

  // Board coordinates to case coordinates
  const bx = (x) => p.gap + x;
  const by = (y) => p.gap + y;

  const roundedBox = (l, w, h, r) =>
    hull(product([r, l - r], [r, w - r]).map(([x, y]) => cylinder({ r, h }).translate([x, y, 0])));

  // A rounded window through a wall facing -Y, with an optional recess for the plug's overmould.
  const sideWindow = (x, z, w, h, recess) => {
    const window = (ww, hh, depth) =>
      square([ww - 2, hh - 2], { center: true })
        .offset(1)
        .extrude(depth)
        .rotate([90, 0, 0])
        .translate([x, 0, z]);
    return [
      window(w, h, p.wall + 2).translate([0, 1, 0]),
      recess && window(recess[0], recess[1], p.wall / 2 + 1).translate([0, -p.wall / 2, 0]),
    ];
  };

  const holes = product([p.holeInset, p.boardL - p.holeInset], [p.holeInset, p.boardW - p.holeInset]);

  const base = () => {
    const shell = roundedBox(iL + 2 * p.wall, iW + 2 * p.wall, p.floor + H, p.corner).translate([-p.wall, -p.wall, -p.floor]);

    const portZ = (h) => boardTop + h / 2;
    const ports = [
      sideWindow(bx(p.hdmiX), portZ(3.3), 12.4, 4.6, [14, 6.5]),
      sideWindow(bx(p.otgX), portZ(2.6), 9, 4.2, [11.5, 7]),
      sideWindow(bx(p.pwrX), portZ(2.6), 9, 4.2, [11.5, 7]),
    ];

    // SD card in the left end, with a scoop to get a fingernail on the card
    const sd = [
      cube([p.wall + 2, 13, 3]).translate([-p.wall - 1, by(p.sdY) - 6.5, boardTop - 0.5]),
      cylinder({ d: 12, h: 0.9 + 1 }) // stops short of the lid groove behind it
        .rotate([0, 90, 0])
        .translate([-p.wall - 1, by(p.sdY), boardTop + 1])
        .intersect(cube([3, 20, 10]).translate([-p.wall - 1, by(p.sdY) - 10, boardTop - 0.5])),
    ];

    // Ribbon cable out of the right end
    const camera = p.cameraSlot && cube([p.wall + 2, 17, 2.2]).translate([iL - 1, by(15) - 8.5, boardTop]);

    // The lid runs in grooves along both long walls and into the left end; the right end is open above the lid line.
    const grooves = cube([iL + p.groove + p.wall + 1, iW + 2 * p.groove, p.tongueT + p.slide]).translate([
      -p.groove,
      -p.groove,
      lidZ,
    ]);
    const entry = cube([p.wall + 2, iW, p.lidT + 1]).translate([iL - 1, 0, lidZ]);
    // Pockets in the back of each groove for the lid's click bumps
    const notches = [-1, 1].map((s) => {
      // 0.05 deeper than the bump reaches
      const reach = p.groove - p.slide + p.detent + 0.05;
      const y = s < 0 ? -reach + 0.7 : iW + reach - 0.7;
      return cylinder({ r: 0.7, h: p.tongueT + p.slide }).translate([detentX, y, lidZ]);
    });

    const standoffs = holes.map(([x, y]) =>
      cylinder({ d: 5.5, h: p.standoff })
        .subtract(cylinder({ d: p.screwHole, h: p.standoff + 1 }).translate([0, 0, 0.6]))
        .translate([bx(x), by(y), 0]),
    );

    return shell
      .subtract(cube([iL, iW, H + 1]), ports, sd, camera, grooves, entry, notches)
      .union(standoffs);
  };

  // In place: the underside of the lid at z = lidZ, its outer end flush with the right end of the base.
  const lid = () => {
    const body = cube([iL + p.wall - p.slide, iW - 2 * p.slide, p.lidT]).translate([p.slide, p.slide, lidZ]);
    const tongue = cube([iL + p.groove + p.wall - p.slide, iW + 2 * (p.groove - p.slide), p.tongueT]).translate([
      -p.groove + p.slide,
      -p.groove + p.slide,
      lidZ,
    ]);
    // Click bumps on both edges of the tongue, near the outer end: they only enter the grooves
    // in the last couple of millimetres and drop into the pockets there. The underside stays flat.
    const bumps = [-1, 1].map((s) => {
      const edge = s < 0 ? -p.groove + p.slide : iW + p.groove - p.slide;
      return cylinder({ r: 0.6, h: p.tongueT }).translate([detentX, edge - s * 0.6 + s * p.detent, lidZ]);
    });

    // GPIO header: 2×20 pins centred along the far edge
    const gpio = p.gpioSlot && cube([52, 6.5, p.lidT + 2]).translate([bx(p.boardL / 2) - 26, by(p.boardW - 3.5) - 3.25, lidZ - 1]);
    const vents = range(0, 9).map((i) => cube([1.5, 14, p.lidT + 2]).translate([bx(20) + i * 3, by(4), lidZ - 1]));

    return body.union(tongue, bumps).subtract(gpio, vents);
  };

  const board = () => {
    const pcb = roundedBox(p.boardL, p.boardW, p.boardT, 3)
      .subtract(holes.map(([x, y]) => cylinder({ d: 2.75, h: 5, center: true }).translate([x, y, 0])))
      .color('#1f7a3a');
    const parts = [
      cube([11.2, 7.5, 3.3]).translate([p.hdmiX - 5.6, -0.5, p.boardT]),
      cube([8, 5.6, 2.6]).translate([p.otgX - 4, -0.5, p.boardT]),
      cube([8, 5.6, 2.6]).translate([p.pwrX - 4, -0.5, p.boardT]),
      cube([12, 11.5, 1.3]).translate([-1.5, p.sdY - 5.75, p.boardT]),
      cube([5, 17, 1.2]).translate([p.boardL - 4, 15 - 8.5, p.boardT]),
    ].map((s) => s.color('silver'));
    const soc = cube([14, 14, 1.2]).translate([25, 8, p.boardT]).color('#333');
    return [pcb, parts, soc].flat().map((s) => s.translate([bx(0), by(0), boardZ]));
  };

  console.log(`outer ${(iL + 2 * p.wall).toFixed(1)} × ${(iW + 2 * p.wall).toFixed(1)} × ${(p.floor + H).toFixed(1)} mm`);

  // As it sits in the case, tongue on the bed: the wide part prints first, the narrower body on top.
  const lidForPrint = () => lid().translate([p.groove, p.groove + p.detent, -lidZ]);

  return {
    assembly: () => [base().color('lightgray', 0.6), lid().translate([12, 0, 0]).color('orange', 0.5), board()],
    base: () => base().translate([p.wall, p.wall, p.floor]),
    lid: lidForPrint,
    print: () => [base().translate([p.wall, p.wall, p.floor]), lidForPrint().translate([0, iW + 2 * p.wall + 8, 0])],
  };
};
