/*---
title: Snowflake
description: A flat ornament grown from one branching arm, with a loop for a thread.
---*/
import { circle, polygon, range, union } from 'cadcode';

// A snowflake ornament. One arm is drawn as a 2D dendrite — a tapering spine with side branches,
// and twigs on the longer branches — mirrored about its own axis, repeated around the centre and
// extruded. The top arm ends in a loop for a thread. Prints flat, no supports.
export const params = {
  arms: 6,
  radius: 45, // centre to the tip of an arm
  thickness: 2.4,
  spine: 3.2, // width of an arm at the centre; it tapers to half at the tip

  // Side branches, from the inner one outwards; each is shorter than the one before it.
  branches: 4,
  branchLength: 15,
  branchAngle: 55, // off the spine, towards the tip
  branchWidth: 2,
  shrink: 0.65, // length of the last branch as a share of the first

  // Twigs on each branch, turned back by the branch angle so they run alongside the spine.
  twigs: 2,
  twigLength: 5,

  hub: 9, // radius of the hexagonal plate in the middle
  loop: 4, // hole of the hanging loop, diameter
};

export default (p) => {
  const rad = (a) => (a * Math.PI) / 180;

  // A bar from the origin along +X with a pointed end, `w0` wide at the root and `w1` at the end.
  const bar = (length, w0, w1) =>
    polygon([
      [0, -w0 / 2],
      [length, -w1 / 2],
      [length + w1, 0],
      [length, w1 / 2],
      [0, w0 / 2],
    ]);

  const branch = (length) => {
    const twigs = range(1, p.twigs).map((j) => {
      const at = (length * j) / (p.twigs + 1);
      const len = p.twigLength * (1 - (0.4 * (j - 1)) / Math.max(1, p.twigs));
      return bar(len, p.branchWidth * 0.8, p.branchWidth * 0.5)
        .rotate(-p.branchAngle)
        .translate([at, 0]);
    });
    return union(bar(length, p.branchWidth, p.branchWidth * 0.6), p.twigs > 0 && twigs);
  };

  // Branches are spread over the middle of the arm, clear of the hub and of the tip.
  const halfArm = () => {
    const first = p.hub + 0.15 * p.radius;
    const last = 0.82 * p.radius;
    const branches = range(0, p.branches - 1).map((i) => {
      const t = p.branches > 1 ? i / (p.branches - 1) : 0;
      return branch(p.branchLength * (1 - (1 - p.shrink) * t))
        .rotate(p.branchAngle)
        .translate([first + (last - first) * t, 0]);
    });
    return union(branches);
  };

  const arm = () => {
    const tip = p.spine * 0.9;
    const spine = bar(p.radius - tip, p.spine, p.spine / 2);
    const side = halfArm();
    return union(spine, side, side.mirror([0, 1]));
  };

  const flake2d = () => {
    const arms = range(0, p.arms - 1).map((i) => arm().rotate(90 + (360 * i) / p.arms));
    const hub = circle({ r: p.hub, fn: p.arms }).rotate(90);
    const hole = circle({ r: p.hub * 0.45, fn: p.arms }).rotate(90);
    // The loop overlaps the tip of the top arm.
    const ring = 1.6;
    const loopR = p.loop / 2 + ring;
    const loopAt = [0, p.radius + p.loop / 2];
    const loop = circle({ r: loopR, fn: 40 }).translate(loopAt);
    return union(arms, hub, loop)
      .subtract(hole, circle({ d: p.loop, fn: 32 }).translate(loopAt))
      .offset({ r: 0.4, fn: 12 }) // round the inside corners where branches meet
      .offset({ r: -0.4, fn: 12 });
  };

  const snowflake = () => flake2d().extrude(p.thickness);

  return { snowflake };
};
