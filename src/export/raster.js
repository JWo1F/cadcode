// A small software renderer for preview images: orthographic camera, flat
// shading, outline edges, and back-to-front blending for transparent parts.
// No GPU or browser needed, so `cadcode png` runs anywhere Node runs.

import { parseColor } from '../lib/colors.js';

export const DEFAULT_COLOR = parseColor('#f2c14e');

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
const EDGE_NORMAL_COS = Math.cos((25 * Math.PI) / 180);
const EDGE_SHADE = 0.35;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a) => {
  const len = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / len, a[1] / len, a[2] / len];
};

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

  const W = width * SUPERSAMPLE;
  const H = height * SUPERSAMPLE;
  const toCamera = normalize(view.dir);
  const forward = [-toCamera[0], -toCamera[1], -toCamera[2]];
  const right = normalize(cross(forward, view.up));
  const up = cross(right, forward);
  const light = normalize([toCamera[0] + right[0] * -0.4 + up[0] * 0.8, toCamera[1] + right[1] * -0.4 + up[1] * 0.8, toCamera[2] + right[2] * -0.4 + up[2] * 0.8]);

  // Fit the projected model into the image with a margin.
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
  const margin = 0.08;
  const scale = Math.min((W * (1 - 2 * margin)) / (maxX - minX || 1), (H * (1 - 2 * margin)) / (maxY - minY || 1));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const project = (p) => [(dot(p, right) - cx) * scale + W / 2, H / 2 - (dot(p, up) - cy) * scale, dot(p, forward)];

  const color = new Float32Array(W * H * 3);
  const depth = new Float32Array(W * H).fill(Infinity);
  const normals = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    const t = y / H;
    const shade = 1 - 0.1 * t;
    for (let x = 0; x < W; x++) color.set([shade, shade, shade * 1.01], (y * W + x) * 3);
  }

  const shadeFace = (n, rgb) => {
    const facing = Math.abs(dot(n, toCamera));
    const intensity = 0.28 + 0.52 * Math.max(0, dot(n, light)) + 0.25 * facing;
    return [rgb[0] * intensity, rgb[1] * intensity, rgb[2] * intensity];
  };

  // Collect triangles; opaque ones are drawn first with depth writes.
  const opaque = [];
  const transparent = [];
  for (const group of groups) {
    const rgba = group.color ?? DEFAULT_COLOR;
    const { positions, indices } = group;
    for (let t = 0; t < indices.length; t += 3) {
      const tri = [indices[t], indices[t + 1], indices[t + 2]].map((v) => [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]);
      const n = normalize(cross(sub(tri[1], tri[0]), sub(tri[2], tri[0])));
      const screen = tri.map(project);
      const entry = { screen, n, rgb: shadeFace(n, rgba), alpha: rgba[3] };
      if (rgba[3] >= 0.999) {
        if (dot(n, toCamera) > 0) opaque.push(entry);
      } else {
        entry.depth = (screen[0][2] + screen[1][2] + screen[2][2]) / 3;
        transparent.push(entry);
      }
    }
  }

  for (const { screen, n, rgb } of opaque) {
    rasterize(screen, W, H, (i, z) => {
      if (z >= depth[i]) return;
      depth[i] = z;
      color.set(rgb, i * 3);
      normals.set(n, i * 3);
    });
  }

  // Outlines where depth jumps or the surface turns sharply.
  const edge = new Uint8Array(W * H);
  const depthJump = 6 / scale;
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

  // Transparent faces back to front, tested against opaque depth only.
  transparent.sort((a, b) => b.depth - a.depth);
  for (const { screen, rgb, alpha } of transparent) {
    rasterize(screen, W, H, (i, z) => {
      if (z >= depth[i]) return;
      for (let k = 0; k < 3; k++) color[i * 3 + k] = color[i * 3 + k] * (1 - alpha) + rgb[k] * alpha;
    });
  }

  // Downsample the supersampled buffer.
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
