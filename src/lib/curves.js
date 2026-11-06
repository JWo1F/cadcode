// Turning Bézier curves into straight segments, for text() and the SVG importer.
import { resolution } from './shapes.js';

/** How far the direction turns along a curve's control polygon, in degrees. */
function turning(points) {
  let total = 0;
  let previous;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    if (Math.hypot(dx, dy) < 1e-12) continue;
    const angle = Math.atan2(dy, dx);
    if (previous !== undefined) {
      let delta = Math.abs(angle - previous);
      if (delta > Math.PI) delta = 2 * Math.PI - delta;
      total += delta;
    }
    previous = angle;
  }
  return (total * 180) / Math.PI;
}

/**
 * Segments for one curve. Like a circle: `fn` per full turn when set, otherwise one per `fa` degrees.
 * `fs` is left out: letters and logo details are small, and their curves would come out as straight lines.
 */
function segmentsFor(points, fn) {
  const f = fn ?? resolution.fn;
  const degrees = turning(points);
  return Math.max(1, Math.ceil(f > 0 ? (f * degrees) / 360 : degrees / resolution.fa));
}

/** Point on a Bézier curve of any degree at t, by de Casteljau. */
function bezier(points, t) {
  let row = points;
  while (row.length > 1) row = row.slice(1).map((p, i) => [row[i][0] + (p[0] - row[i][0]) * t, row[i][1] + (p[1] - row[i][1]) * t]);
  return row[0];
}

/**
 * The points along a Bézier curve after its start, up to and including its end.
 * @param {number[][]} controls the start, the control points and the end
 * @param {number} [fn]
 * @returns {number[][]}
 */
export function flattenBezier(controls, fn) {
  const n = segmentsFor(controls, fn);
  const points = [];
  for (let i = 1; i <= n; i++) points.push(bezier(controls, i / n));
  return points;
}
