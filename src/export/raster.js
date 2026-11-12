// A small software renderer for preview images: orthographic camera, flat
// shading, outline edges, back-to-front blending for transparent parts, and 2D
// shapes drawn as sketches.
// No GPU or browser needed, so `cadcode png` runs anywhere Node runs.
//
// A view is drawn into a supersampled buffer in passes — backdrop, opaque faces,
// outlines, transparent faces, sketches — and then downsampled.

import { parseColor } from '../lib/colors.js';
import { vec3 } from '../lib/vec.js';
import { DEFAULT_COLOR as DEFAULT_HEX, EDGE_ANGLE, SKETCH_LINE_WIDTH } from '../../client/render-style.js';

export const DEFAULT_COLOR = parseColor(DEFAULT_HEX);

/** Camera directions (from the model toward the camera) and up vectors. Z is up. */
export const VIEWS = {
  iso: { dir: [1, -1, 1], up: [0, 0, 1] },
  'iso-back': { dir: [-1, 1, 1], up: [0, 0, 1] },
  front: { dir: [0, -1, 0], up: [0, 0, 1] },
  back: { dir: [0, 1, 0], up: [0, 0, 1] },
  left: { dir: [-1, 0, 0], up: [0, 0, 1] },
  right: { dir: [1, 0, 0], up: [0, 0, 1] },
  top: { dir: [0, 0, 1], up: [0, 1, 0] },
  bottom: { dir: [0, 0, -1], up: [0, 1, 0] },
};

/** Views laid out by `view: 'sheet'`, two by two. */
export const SHEET = ['iso', 'front', 'right', 'top'];

const SUPERSAMPLE = 2;
const EDGE_NORMAL_COS = Math.cos((EDGE_ANGLE * Math.PI) / 180);
const EDGE_SHADE = 0.35;
const MARGIN = 0.08; // of the image, around the model
const GUIDE_LINE_WIDTH = 1.75; // output pixels: a sketch's construction lines, dashed
const DASH = 7; // output pixels drawn, then
const GAP = 4; // left out

const { sub, dot, cross } = vec3;
// A degenerate triangle has no normal: it stays a zero vector rather than NaN.
const normalize = (a) => (vec3.length(a) ? vec3.normalize(a) : a);

/**
 * Renders mesh groups to an RGBA pixel buffer.
 * @param {import('../core/mesh.js').MeshGroup[]} groups
 * @param {{ width?: number, height?: number, view?: string }} [options]
 * @returns {{ width: number, height: number, pixels: Uint8Array }}
 */
export function render(groups, { width = 800, height = 600, view = 'iso' } = {}) {
  if (view !== 'sheet') return renderView(groups, width, height, view);

  const tileW = Math.floor(width / 2);
  const tileH = Math.floor(height / 2);
  const pixels = new Uint8Array(width * height * 4).fill(255);
  SHEET.forEach((name, i) => {
    const tile = renderView(groups, tileW, tileH, name);
    const ox = (i % 2) * tileW;
    const oy = Math.floor(i / 2) * tileH;
    for (let y = 0; y < tileH; y++) {
      pixels.set(tile.pixels.subarray(y * tileW * 4, (y + 1) * tileW * 4), ((oy + y) * width + ox) * 4);
    }
  });
  return { width, height, pixels };
}

function renderView(groups, width, height, viewName) {
  const view = VIEWS[viewName];
  if (!view) throw new Error(`Unknown view "${viewName}". Views: ${[...Object.keys(VIEWS), 'sheet'].join(', ')}`);

  const camera = cameraFor(view);
  const canvas = createCanvas(width * SUPERSAMPLE, height * SUPERSAMPLE, fitProjection(groups, camera, width * SUPERSAMPLE, height * SUPERSAMPLE));
  paintBackdrop(canvas);
  const { opaque, transparent } = collectTriangles(groups, canvas, camera);
  drawOpaque(canvas, opaque);
  drawOutlines(canvas);
  drawTransparent(canvas, transparent);
  drawSketches(canvas, groups.filter((g) => g.sketch));
  return downsample(canvas, width, height);
}

/** The camera's frame for a view, and the light, which sits up and to the left of it. */
function cameraFor(view) {
  const toCamera = normalize(view.dir);
  const forward = vec3.scale(toCamera, -1);
  const right = normalize(cross(forward, view.up));
  const up = cross(right, forward);
  const light = normalize(vec3.add(vec3.add(toCamera, vec3.scale(right, -0.4)), vec3.scale(up, 0.8)));
  return { toCamera, forward, right, up, light };
}

/** Projects world points to the supersampled image, the model fitted into it with a margin: [x, y, depth]. */
function fitProjection(groups, { right, up, forward }, W, H) {
  let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const { positions } of groups) {
    for (let i = 0; i < positions.length; i += 3) {
      const p = [positions[i], positions[i + 1], positions[i + 2]];
      const x = dot(p, right);
      const y = dot(p, up);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const scale = Math.min((W * (1 - 2 * MARGIN)) / (maxX - minX || 1), (H * (1 - 2 * MARGIN)) / (maxY - minY || 1));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const project = (p) => [(dot(p, right) - cx) * scale + W / 2, H / 2 - (dot(p, up) - cy) * scale, dot(p, forward)];
  return { project, scale };
}

/** The buffers a view is drawn into: linear RGB, depth and the normal of the nearest opaque face, per sample. */
function createCanvas(W, H, { project, scale }) {
  return {
    W,
    H,
    project,
    // How far apart in depth two neighbouring samples must be to outline them, and how
    // far behind a face a sketch may lie and still be seen: a few pixels' worth.
    depthJump: 6 / scale,
    color: new Float32Array(W * H * 3),
    depth: new Float32Array(W * H).fill(Infinity),
    normals: new Float32Array(W * H * 3),
  };
}

/** A pale vertical sweep, darker towards the bottom. */
function paintBackdrop({ W, H, color }) {
  for (let y = 0; y < H; y++) {
    const shade = 1 - 0.1 * (y / H);
    for (let x = 0; x < W; x++) color.set([shade, shade, shade * 1.01], (y * W + x) * 3);
  }
}

/** The solids' triangles, shaded and projected: opaque ones facing the camera, and transparent ones with their depth. */
function collectTriangles(groups, { project }, { toCamera, light }) {
  const shadeFace = (n, rgb) => {
    const facing = Math.abs(dot(n, toCamera));
    const intensity = 0.28 + 0.52 * Math.max(0, dot(n, light)) + 0.25 * facing;
    return [rgb[0] * intensity, rgb[1] * intensity, rgb[2] * intensity];
  };
  const opaque = [];
  const transparent = [];
  for (const group of groups) {
    if (group.sketch) continue;
    const rgba = group.color ?? DEFAULT_COLOR;
    const { positions, indices } = group;
    for (let t = 0; t < indices.length; t += 3) {
      const tri = [indices[t], indices[t + 1], indices[t + 2]].map((v) => [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]);
      const n = normalize(cross(sub(tri[1], tri[0]), sub(tri[2], tri[0])));
      const screen = tri.map(project);
      const entry = { screen, n, rgb: shadeFace(n, rgba), alpha: rgba[3], depth: 0 };
      if (rgba[3] >= 0.999) {
        if (dot(n, toCamera) > 0) opaque.push(entry);
      } else {
        entry.depth = (screen[0][2] + screen[1][2] + screen[2][2]) / 3;
        transparent.push(entry);
      }
    }
  }
  return { opaque, transparent };
}

/** Opaque faces, nearest wins. */
function drawOpaque({ W, H, color, depth, normals }, triangles) {
  for (const { screen, n, rgb } of triangles) {
    rasterize(screen, W, H, (i, z) => {
      if (z >= depth[i]) return;
      depth[i] = z;
      color.set(rgb, i * 3);
      normals.set(n, i * 3);
    });
  }
}

/** Outlines where depth jumps or the surface turns sharply: darker on the model, a grey line off it. */
function drawOutlines({ W, H, color, depth, normals, depthJump }) {
  const edge = new Uint8Array(W * H);
  const isEdge = (a, b) => {
    const fa = depth[a] !== Infinity;
    const fb = depth[b] !== Infinity;
    if (fa !== fb) return true;
    if (!fa) return false;
    if (Math.abs(depth[a] - depth[b]) > depthJump) return true;
    return normals[a * 3] * normals[b * 3] + normals[a * 3 + 1] * normals[b * 3 + 1] + normals[a * 3 + 2] * normals[b * 3 + 2] < EDGE_NORMAL_COS;
  };
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const i = y * W + x;
      if (isEdge(i, i + 1)) edge[i] = edge[i + 1] = 1;
      if (isEdge(i, i + W)) edge[i] = edge[i + W] = 1;
    }
  }
  for (let i = 0; i < W * H; i++) {
    if (edge[i] && depth[i] !== Infinity) for (let k = 0; k < 3; k++) color[i * 3 + k] *= EDGE_SHADE;
    else if (edge[i]) for (let k = 0; k < 3; k++) color[i * 3 + k] = color[i * 3 + k] * 0.4 + 0.12;
  }
}

/** Transparent faces back to front, tested against opaque depth only. */
function drawTransparent({ W, H, color, depth }, triangles) {
  triangles.sort((a, b) => b.depth - a.depth);
  for (const { screen, rgb, alpha } of triangles) {
    rasterize(screen, W, H, (i, z) => {
      if (z >= depth[i]) return;
      for (let k = 0; k < 3; k++) color[i * 3 + k] = color[i * 3 + k] * (1 - alpha) + rgb[k] * alpha;
    });
  }
}

/**
 * Sketches last: an unlit see-through fill, then a bold outline (dashed for guides),
 * both hidden only behind opaque faces. A tolerance keeps them visible where a solid
 * stands on Z=0.
 */
function drawSketches({ W, H, color, depth, depthJump, project }, sketches) {
  const visible = (i, z) => z <= depth[i] + depthJump;
  for (const { positions, indices, color: rgba } of sketches) {
    const covered = new Uint8Array(W * H); // overlapping fill triangles must not blend twice
    for (let t = 0; t < indices.length; t += 3) {
      const screen = [indices[t], indices[t + 1], indices[t + 2]].map((v) => project([positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]));
      rasterize(screen, W, H, (i, z) => {
        if (covered[i] || !visible(i, z)) return;
        covered[i] = 1;
        for (let k = 0; k < 3; k++) color[i * 3 + k] = color[i * 3 + k] * (1 - rgba[3]) + rgba[k] * rgba[3];
      });
    }
  }
  for (const { lines, color: rgba, guide } of sketches) {
    const radius = ((guide ? GUIDE_LINE_WIDTH : SKETCH_LINE_WIDTH) * SUPERSAMPLE) / 2;
    const plot = (i, z) => {
      if (visible(i, z)) color.set(rgba.slice(0, 3), i * 3);
    };
    for (let s = 0; s < lines.length; s += 6) {
      const a = project([lines[s], lines[s + 1], lines[s + 2]]);
      const b = project([lines[s + 3], lines[s + 4], lines[s + 5]]);
      if (!guide) strokeSegment(a, b, radius, W, H, plot);
      else for (const [p, q] of dashes(a, b, DASH * SUPERSAMPLE, GAP * SUPERSAMPLE)) strokeSegment(p, q, radius, W, H, plot);
    }
  }
}

/** Averages each SUPERSAMPLE × SUPERSAMPLE block into one opaque RGBA pixel. */
function downsample({ W, color }, width, height) {
  const pixels = new Uint8Array(width * height * 4);
  const area = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const i = ((y * SUPERSAMPLE + sy) * W + x * SUPERSAMPLE + sx) * 3;
          sum[0] += color[i];
          sum[1] += color[i + 1];
          sum[2] += color[i + 2];
        }
      }
      const o = (y * width + x) * 4;
      for (let k = 0; k < 3; k++) pixels[o + k] = Math.max(0, Math.min(255, Math.round((sum[k] / area) * 255)));
      pixels[o + 3] = 255;
    }
  }
  return { width, height, pixels };
}

/** A screen-space segment cut into dashes, starting with one at `a`. */
function dashes(a, b, dash, gap) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const at = (t) => a.map((v, k) => v + ((b[k] - v) * t) / length);
  const out = [];
  for (let t = 0; t < length; t += dash + gap) out.push([at(t), at(Math.min(t + dash, length))]);
  return out;
}

/** Calls `plot(pixelIndex, depth)` for every pixel center within `radius` of the screen-space segment. */
function strokeSegment(a, b, radius, W, H, plot) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy || 1e-12;
  const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - radius));
  const x1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0]) + radius));
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - radius));
  const y1 = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1]) + radius));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5 - a[0];
      const py = y + 0.5 - a[1];
      const t = Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSq));
      if ((px - t * dx) ** 2 + (py - t * dy) ** 2 > radius * radius) continue;
      plot(y * W + x, a[2] + t * (b[2] - a[2]));
    }
  }
}

/** Calls `plot(pixelIndex, depth)` for every pixel center inside the screen-space triangle. */
function rasterize([a, b, c], W, H, plot) {
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(area) < 1e-12) return;
  const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const x1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const y1 = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5;
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
      const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      plot(y * W + x, w0 * a[2] + w1 * b[2] + w2 * c[2]);
    }
  }
}
