/*---
title: Compression spring
description: A coil spring swept along a helix, with closed and ground ends so it stands flat.
---*/
import { circle, cylinder, setResolution } from 'cadcode';

setResolution({ fn: 24 });

export const params = {
  coilD: 20, // centre of the wire, across the coil
  wireD: 2.4,
  activeTurns: 5,
  pitch: 6, // rise per active turn
  closedTurns: 1, // at each end, wound tight so the end sits flat
  gap: 0.4, // between the tight turns: a sweep must not run into itself, and touching turns would print fused
  perTurn: 48, // points along the path per turn
};

export default (p) => {
  const r = p.coilD / 2;
  const turns = p.activeTurns + 2 * p.closedTurns;

  // The rise per turn: tight at the ends, `pitch` in between, eased across a quarter turn
  // so the path has no kink.
  const pitchAt = (t) => {
    const ease = (x) => Math.min(Math.max(x / 0.25, 0), 1);
    const open = Math.min(ease(t - p.closedTurns + 0.125), ease(turns - p.closedTurns + 0.125 - t));
    const tight = p.wireD + p.gap;
    return tight + (p.pitch - tight) * open;
  };

  // helix() keeps one pitch; a varying one is just a path of points built by hand.
  const path = [];
  let z = 0;
  const steps = Math.ceil(turns * p.perTurn);
  for (let i = 0; i <= steps; i++) {
    const t = (turns * i) / steps;
    if (i > 0) z += pitchAt(t) / p.perTurn;
    const a = 2 * Math.PI * t;
    path.push([r * Math.cos(a), r * Math.sin(a), z]);
  }

  const height = z;
  const coil = () => circle(p.wireD / 2).sweep(path).translate([0, 0, p.wireD / 2]);

  // Grinding the ends: cut off half the wire at the bottom and the top.
  const spring = () => {
    const cut = p.wireD / 2;
    return coil()
      .intersect(cylinder({ r: r + p.wireD, h: height + p.wireD - 2 * cut }).translate([0, 0, cut]))
      .translate([0, 0, -cut]);
  };

  console.log(`${(p.coilD + p.wireD).toFixed(1)} mm across, ${height.toFixed(1)} mm tall free length`);

  return { spring, coil };
};
