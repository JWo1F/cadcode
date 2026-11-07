/*---
title: Sensor case
description: A box and lid for a Pro Micro board, a Li-ion cell and a climate sensor.
---*/
// Sensor case: nRF52840 Pro Micro + Li-ion 12x30 + 15x15 T/H/P sensor.
// FDM print, 0.4 nozzle, 0.12 layer. Box prints bottom down, lid prints top down.
//
//   cadcode dev examples/sensor-case.js
//   cadcode stl examples/sensor-case.js --part box
//   cadcode png examples/sensor-case.js --part assembly --view sheet
import { cube, cylinder, square, union, difference, intersection, setResolution, range, product } from 'cadcode';

setResolution({ fn: 40 });

export const params = [
  {
    name: 'Print',
    children: {
      wall: { value: 2.0, name: 'Wall', description: 'Wall thickness, in mm.' },
      floorT: { value: 1.6, name: 'Floor', description: 'Floor thickness, in mm.' },
      lidT: { value: 1.6, name: 'Lid', description: 'Lid thickness, in mm.' },
      fit: { value: 0.15, name: 'Lid fit', description: 'Gap between the lid skirt and the wall, per side, in mm.' },
      cornerR: { value: 2.0, name: 'Corner radius', description: 'Outer corner radius of the case, in mm.' },
    },
  },
  {
    name: 'Pro Micro board',
    children: {
      boardL: { value: 34, name: 'Board length', description: 'Length of the Pro Micro board, in mm.' },
      boardW: { value: 17, name: 'Board width', description: 'Width of the Pro Micro board, in mm.' },
      boardT: { value: 1.6, name: 'Board thickness', description: 'Thickness of the Pro Micro board, in mm.' },
      boardStandoff: { value: 2.0, name: 'Board standoff', description: 'Height of the rails the board sits on, leaving room for wires and pads underneath, in mm.' },
      boardX0: { value: 0.3, name: 'USB wall gap', description: 'Gap between the board and the USB wall, in mm.' },
      boardY0: { value: 0.5, name: 'Side wall gap', description: 'Gap between the board and the side wall, in mm.' },
    },
  },
  {
    name: 'USB-C',
    children: {
      usbW: { value: 9.0, name: 'USB width', description: 'Width of the USB-C connector body, in mm.' },
      usbH: { value: 3.3, name: 'USB height', description: 'Height of the USB-C connector body, in mm.' },
      usbSlotExtra: { value: 0.8, name: 'USB hole allowance', description: 'Added to the connector size for the USB-C window, in mm.' },
      plugW: { value: 12.5, name: 'Plug recess width', description: 'Width of the outside recess for the plug overmold, in mm.' },
      plugH: { value: 7.5, name: 'Plug recess height', description: 'Height of the outside recess for the plug overmold, in mm.' },
      plugDepth: { value: 1.2, name: 'Plug recess depth', description: 'Depth of the plug recess into the wall, in mm.' },
    },
  },
  {
    name: 'Battery',
    children: {
      batD: { value: 12, name: 'Battery diameter', description: 'Diameter of the Li-ion cell, in mm.' },
      batL: { value: 30, name: 'Battery length', description: 'Length of the Li-ion cell, in mm.' },
      batClr: { value: 0.5, name: 'Battery clearance', description: 'Clearance added to the battery diameter in its cradles, in mm.' },
    },
  },
  {
    name: 'Sensor',
    children: {
      sensorS: { value: 15, name: 'Sensor size', description: 'Side of the square sensor board, in mm.' },
      sensorPadH: { value: 3, name: 'Sensor pad', description: 'Height of the tape pad under the sensor, raised so air flows underneath, in mm.' },
      sensL: { value: 17, name: 'Sensor compartment', description: 'Length of the sensor compartment along X, in mm.' },
    },
  },
  {
    name: 'Snap fit',
    children: {
      lipD: { value: 4.0, name: 'Skirt depth', description: 'Depth of the lid skirt, in mm.' },
      lipT: { value: 1.2, name: 'Skirt thickness', description: 'Thickness of the lid skirt, in mm.' },
      bumpR: { value: 0.6, name: 'Snap bump', description: 'Radius of the bump on the skirt and of the groove in the wall, in mm.' },
      bumpLen: { value: 12, name: 'Snap length', description: 'Length of each snap bump, in mm.' },
    },
  },
  {
    name: 'Pores',
    children: {
      poreD: { value: 1.6, name: 'Pore diameter', description: 'Diameter of the vent pores round the sensor compartment, in mm.' },
      porePitch: { value: 3.2, name: 'Pore pitch', description: 'Distance between neighbouring vent pores, in mm.' },
    },
  },
];

export default (p) => {
  const { wall, floorT, lidT, fit, cornerR, boardL, boardW, boardT, boardStandoff, boardX0, boardY0 } = p;
  const { usbW, usbH, usbSlotExtra, plugW, plugH, plugDepth, batD, batL, batClr, sensorS, sensorPadH, sensL } = p;
  const { lipD, lipT, bumpR, bumpLen, poreD, porePitch } = p;

  // Interior
  const mainL = boardX0 + boardL + 0.7; // main compartment
  const divT = 1.6; // divider between compartments
  const batY0 = boardY0 + boardW + 1.5;
  const iL = mainL + divT + sensL;
  const iW = batY0 + batD + batClr + 1.0; // +1 mm: battery clears the lid skirt
  const iH = batD + batClr + 0.5;
  const wireHole = [6, 2.5]; // I2C wires through the divider

  const sx0 = mainL + divT; // sensor compartment start
  const usbCz = boardStandoff + boardT + usbH / 2;
  const usbCy = boardY0 + boardW / 2;

  // Pore zone in the walls: below the lid skirt
  const poreZ0 = 1.0;
  const poreZ1 = iH - lipD - 0.8;

  // Snap grooves on the long walls, in both compartments
  const bumpXs = [mainL / 2, sx0 + sensL / 2];

  const roundedBox = (l, w, h, r) => cube([l, w, h], { round: { z: r } });

  // Grid of holes in the XY plane over an a x b rectangle
  const poreGrid = (a, b) => {
    const na = Math.floor((a - poreD) / porePitch) + 1;
    const nb = Math.floor((b - poreD) / porePitch) + 1;
    const oa = (a - (na - 1) * porePitch) / 2;
    const ob = (b - (nb - 1) * porePitch) / 2;
    return union(
      product(range(0, na - 1), range(0, nb - 1)).map(([i, j]) =>
        cylinder({ d: poreD, h: 10, center: true }).translate([oa + i * porePitch, ob + j * porePitch, 0]),
      ),
    );
  };

  const snapLine = (len) => cylinder({ r: bumpR, h: len, center: true }).rotate([0, 90, 0]);

  const box = () =>
    union(
      difference(
        roundedBox(iL + 2 * wall, iW + 2 * wall, iH + floorT, cornerR).translate([-wall, -wall, -floorT]),
        cube([iL, iW, iH + 1]),

        // USB-C: through window + recess for the plug outside
        square([usbH + usbSlotExtra - 2, usbW + usbSlotExtra - 2], { center: true })
          .offset(1)
          .extrude(wall + 2)
          .rotate([0, 90, 0])
          .translate([-wall - 1, usbCy, usbCz]),
        square([plugH - 3, plugW - 3], { center: true })
          .offset(1.5)
          .extrude(plugDepth + 1)
          .rotate([0, 90, 0])
          .translate([-wall - 1, usbCy, usbCz]),

        // Fingernail notch in the long side, clear of the snap groove: a gap to pry the lid up from,
        // 0.6 mm of wall left inside
        cube([8, wall - 0.6 + 1, 1.2 + 1]).translate([2, -wall - 1, iH - 1.2]),

        // Snap grooves
        product(bumpXs, [0, iW]).map(([x, y]) => snapLine(bumpLen + 1).translate([x, y, iH - lipD / 2])),

        // Sensor compartment pores: end wall, side walls, floor
        poreGrid(poreZ1 - poreZ0, iW).mirror([1, 0, 0]).rotate([0, 90, 0]).translate([iL + wall / 2, 0, poreZ0]),
        [-wall / 2, iW + wall / 2].map((y) =>
          poreGrid(sensL, poreZ1 - poreZ0).mirror([0, 1, 0]).rotate([-90, 0, 0]).translate([sx0, y, poreZ0]),
        ),
        poreGrid(sensL, iW).translate([sx0, 0, -floorT / 2]),
      ),

      // Divider with a hole for the wires
      difference(
        cube([divT, iW, iH]).translate([mainL, 0, 0]),
        cube([divT + 2, wireHole[0], wireHole[1]]).translate([mainL - 1, usbCy - wireHole[0] / 2, boardStandoff + boardT + 1]),
      ),

      // Board rails + side stops
      [boardY0, boardY0 + boardW - 1.5].map((y) => cube([boardL - 4, 1.5, boardStandoff]).translate([boardX0 + 2, y, 0])),
      cube([boardL - 12, 1.2, boardStandoff + boardT]).translate([boardX0 + 6, boardY0 + boardW + 0.25, 0]),
      cube([mainL - boardX0 - boardL - 0.2, boardW - 6, boardStandoff + boardT]).translate([boardX0 + boardL + 0.2, boardY0 + 3, 0]),

      // Battery cradles
      [mainL / 2 - batL / 3, mainL / 2 + batL / 3].map((x) =>
        difference(
          cube([2, batD + batClr + 0.5, batD * 0.4]).translate([x - 1, batY0 - 0.5, 0]),
          cylinder({ d: batD + batClr, h: 4 }).rotate([0, 90, 0]).translate([x - 2, batY0 + (batD + batClr) / 2, (batD + batClr) / 2]),
        ),
      ),

      // Sensor pad
      cube([sensorS - 4, sensorS - 4, sensorPadH]).translate([sx0 + (sensL - sensorS) / 2 + 2, (iW - sensorS) / 2 + 2, 0]),
    );

  // In assembly coordinates: the lid's underside is at z = iH
  const lid = () => {
    const batTop = (batD + batClr) / 2 + batD / 2;
    return union(
      difference(
        roundedBox(iL + 2 * wall, iW + 2 * wall, lidT, cornerR),
        poreGrid(sensL - fit - lipT, iW - 2 * (fit + lipT)).translate([sx0 + wall, wall + fit + lipT, 0]), // inside the skirt
      ).translate([-wall, -wall, iH]),

      // Skirt with snap bumps
      difference(
        cube([iL - 2 * fit, iW - 2 * fit, lipD]).translate([fit, fit, iH - lipD]),
        cube([iL - 2 * fit - 2 * lipT, iW - 2 * fit - 2 * lipT, lipD + 1]).translate([fit + lipT, fit + lipT, iH - lipD - 1]),
        cube([divT + 0.6, iW + 2, lipD + 1]).translate([mainL - 0.3, -1, iH - lipD - 1]), // slot for the divider
        // Slits beside the snaps, so the tabs flex more easily
        product(bumpXs, [-1, 1]).map(([x, s]) =>
          cube([1, iW + 2, lipD + 1 - 0.5]).translate([x + s * (bumpLen / 2 + 0.75) - 0.5, -1, iH - lipD - 1]),
        ),
      ),
      product(bumpXs, [fit, iW - fit]).map(([x, y]) =>
        intersection(
          snapLine(bumpLen).translate([x, y, iH - lipD / 2]),
          cube([iL, iW - 2 * fit + 2 * bumpR, iH]).translate([0, fit - bumpR, 0]),
        ),
      ),

      // Board hold-downs: on the USB-C body and on the far edge of the board
      cylinder({ d: 3, h: iH - (boardStandoff + boardT + usbH + 0.2) }).translate([boardX0 + 4, usbCy, boardStandoff + boardT + usbH + 0.2]),
      [boardY0 + 1.2, boardY0 + boardW - 1.2].map((y) =>
        cylinder({ d: 2, h: iH - (boardStandoff + boardT + 0.2) }).translate([boardX0 + boardL - 1.5, y, boardStandoff + boardT + 0.2]),
      ),

      // Battery hold-down
      cube([2, 4, iH - batTop - 0.2]).translate([mainL / 2 - 1, batY0 + (batD + batClr) / 2 - 2, batTop + 0.2]),
    );
  };

  const dummies = () => [
    cube([boardL, boardW, boardT]).translate([boardX0, boardY0, boardStandoff]).color('green'),
    cube([7.5, usbW, usbH]).translate([boardX0 - 0.5, usbCy - usbW / 2, boardStandoff + boardT]).color('silver'),
    cylinder({ d: batD, h: batL })
      .rotate([0, 90, 0])
      .translate([mainL / 2 - batL / 2, batY0 + (batD + batClr) / 2, (batD + batClr) / 2])
      .color('royalblue'),
    cube([sensorS, sensorS, 1.2]).translate([sx0 + (sensL - sensorS) / 2, (iW - sensorS) / 2, sensorPadH]).color('purple'),
  ];

  // Lid flipped top-down for printing
  const lidForPrint = () => lid().translate([0, -iW, 0]).rotate([180, 0, 0]);

  console.log(`Outer size: ${iL + 2 * wall} x ${iW + 2 * wall} x ${iH + floorT + lidT} mm`);

  return {
    assembly: () => [box().color('lightgray', 0.5), lid().translate([0, 0, 8]).color('orange', 0.35), dummies()],
    box,
    lid: () => lidForPrint().translate([0, 0, iH + lidT]),
    print: () => [box(), lidForPrint().translate([0, iW + 2 * wall + 6, iH + lidT])],
  };
};
