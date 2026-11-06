import { unzipSync, strFromU8 } from 'fflate';
import { parseColor } from '../colors.js';
import { reserveColorIds } from '../shapes.js';
import { toBytes, solidFromMesh } from './common.js';
import { parseXML, attribute } from './xml.js';

/** @typedef {import('../colors.js').RGBA} RGBA */
/** @typedef {import('./xml.js').XMLElement} XMLElement */

/** Millimeters per unit of a model's `unit` attribute. */
const UNITS = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * The solids of a 3MF file, one per object on its build plate, in millimeters and placed
 * where the file puts them. Colors from the core spec's base materials and the materials
 * extension's color groups come along, per triangle; slicers' own painting and filament
 * settings do not. `import model from './model.3mf'` next to the program gives the bytes.
 * @param {Uint8Array | ArrayBuffer} bytes
 * @returns {import('../shapes.js').Solid[]}
 */
export function import3MF(bytes) {
  const data = toBytes(bytes, 'import3MF');
  let files;
  try {
    files = unzipSync(data);
  } catch {
    throw new Error('import3MF(): not a 3MF file: it is not a zip archive');
  }
  const reader = new PackageReader(files);
  const rootPath = reader.rootModelPath();
  const root = reader.model(rootPath);
  const unit = root.element.attributes.unit ?? 'millimeter';
  if (!(unit in UNITS)) throw new Error(`import3MF(): unknown unit "${unit}"`);
  const toMillimeters = scaling(UNITS[unit]);

  const build = root.element.children.find((c) => c.local === 'build');
  const items = build?.children.filter((c) => c.local === 'item') ?? [];
  if (items.length === 0) throw new Error('import3MF(): the file has nothing on its build plate');

  const solids = [];
  for (const item of items) {
    const path = resolvePath(attribute(item, 'path'), rootPath);
    const key = `${path}#${item.attributes.objectid}`;
    const object = reader.object(key);
    if (object.type !== 'model') continue;
    const mesh = { positions: [], triangles: [], colors: [] };
    reader.collect(key, multiply(toMillimeters, parseTransform(item.attributes.transform)), mesh, new Set());
    solids.push(toSolid(mesh, object.name ?? `object ${item.attributes.objectid}`));
  }
  if (solids.length === 0) throw new Error('import3MF(): the build plate holds only support or other non-model objects');
  return solids;
}

/** Reads the models of a package, and the objects and materials they define, each once. */
class PackageReader {
  constructor(files) {
    this.files = files;
    /** @type {Map<string, { element: XMLElement }>} */
    this.models = new Map();
    /** @type {Map<string, any>} objects by `path#id` */
    this.objects = new Map();
    /** @type {Map<string, (RGBA | null)[]>} material and color groups by `path#id` */
    this.materials = new Map();
  }

  /** The model the package's relationships point at, or the usual 3D/3dmodel.model. */
  rootModelPath() {
    const rels = this.files['_rels/.rels'];
    if (rels) {
      const root = parseXML(strFromU8(rels), 'import3MF(): _rels/.rels');
      const model = root.children.find((r) => r.local === 'Relationship' && /\/3dmodel$/.test(r.attributes.Type ?? ''));
      if (model) return resolvePath(model.attributes.Target, '/');
    }
    if (this.files['3D/3dmodel.model']) return '/3D/3dmodel.model';
    throw new Error('import3MF(): not a 3MF file: it has no 3D model');
  }

  model(path) {
    if (!this.models.has(path)) {
      const bytes = this.files[path.slice(1)];
      if (!bytes) throw new Error(`import3MF(): the file refers to ${path}, which it does not contain`);
      const element = parseXML(strFromU8(bytes), `import3MF(): ${path}`);
      if (element.local !== 'model') throw new Error(`import3MF(): ${path} is not a 3MF model`);
      this.models.set(path, { element });
      const resources = element.children.find((c) => c.local === 'resources')?.children ?? [];
      for (const resource of resources) this.addResource(path, resource);
    }
    return this.models.get(path);
  }

  addResource(path, resource) {
    const key = `${path}#${resource.attributes.id}`;
    if (resource.local === 'basematerials') {
      this.materials.set(key, children(resource, 'base').map((base) => color(base.attributes.displaycolor)));
    } else if (resource.local === 'colorgroup') {
      this.materials.set(key, children(resource, 'color').map((c) => color(c.attributes.color)));
    } else if (resource.local === 'object') {
      const mesh = children(resource, 'mesh')[0];
      const components = children(resource, 'components')[0];
      this.objects.set(key, {
        path,
        type: resource.attributes.type ?? 'model',
        name: resource.attributes.name,
        pid: resource.attributes.pid,
        pindex: resource.attributes.pindex,
        mesh,
        components: components ? children(components, 'component') : [],
      });
    }
  }

  object(key) {
    this.model(key.slice(0, key.indexOf('#')));
    const object = this.objects.get(key);
    if (!object) throw new Error(`import3MF(): the file refers to object ${key}, which it does not define`);
    return object;
  }

  /** The color of a property reference, or null for none. */
  colorOf(path, pid, index) {
    if (pid === undefined) return null;
    this.model(path);
    const group = this.materials.get(`${path}#${pid}`);
    return group?.[Number(index ?? 0)] ?? null;
  }

  /** Appends an object's triangles, in world coordinates, to `out`; components recursively. */
  collect(key, matrix, out, visiting) {
    if (visiting.has(key)) throw new Error(`import3MF(): object ${key} contains itself`);
    visiting.add(key);
    const object = this.object(key);
    if (object.mesh) addMesh(object, matrix, out, this);
    for (const component of object.components) {
      const path = resolvePath(attribute(component, 'path'), object.path);
      this.collect(`${path}#${component.attributes.objectid}`, multiply(matrix, parseTransform(component.attributes.transform)), out, visiting);
    }
    visiting.delete(key);
  }
}

function addMesh(object, m, out, reader) {
  const vertices = children(children(object.mesh, 'vertices')[0], 'vertex');
  const triangles = children(children(object.mesh, 'triangles')[0], 'triangle');
  const first = out.positions.length / 3;
  for (const { attributes: a } of vertices) {
    const [x, y, z] = [Number(a.x), Number(a.y), Number(a.z)];
    out.positions.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
  }
  // A mirroring transform turns triangles inside out; swapping two corners turns them back.
  const mirrored = determinant(m) < 0;
  const fallback = reader.colorOf(object.path, object.pid, object.pindex);
  for (const { attributes: a } of triangles) {
    const [v1, v2, v3] = [Number(a.v1), Number(a.v2), Number(a.v3)];
    out.triangles.push(first + v1, first + (mirrored ? v3 : v2), first + (mirrored ? v2 : v3));
    out.colors.push(a.pid !== undefined || a.p1 !== undefined ? reader.colorOf(object.path, a.pid ?? object.pid, a.p1 ?? object.pindex) : fallback);
  }
}

/** One solid from collected triangles, sorted into one run per color so the colors survive. */
function toSolid({ positions, triangles, colors }, name) {
  const what = `import3MF(): object "${name}"`;
  const keys = colors.map((c) => (c ? c.join(',') : ''));
  const distinct = [...new Set(keys)];
  if (distinct.length === 1 && distinct[0] === '') return solidFromMesh(new Float32Array(positions), new Uint32Array(triangles), what);

  // Runs start where the triangles of the previous colors end.
  const runOf = keys.map((key) => distinct.indexOf(key));
  const index = new Uint32Array(distinct.length + 1);
  for (const run of runOf) index[run + 1] += 3;
  for (let run = 0; run < distinct.length; run++) index[run + 1] += index[run];

  const sorted = new Uint32Array(triangles.length);
  const next = index.slice(0, distinct.length);
  runOf.forEach((run, t) => {
    sorted.set(triangles.slice(t * 3, t * 3 + 3), next[run]);
    next[run] += 3;
  });
  const ids = reserveColorIds(distinct.map((key) => colors[keys.indexOf(key)]));
  return solidFromMesh(new Float32Array(positions), sorted, what, { index, ids: new Uint32Array(ids) });
}

const children = (element, local) => element?.children.filter((c) => c.local === local) ?? [];

/** `#RRGGBB` or `#RRGGBBAA`, as 3MF writes colors. */
function color(value) {
  if (!value) return null;
  const hex = value.trim();
  if (/^#[0-9a-fA-F]{8}$/.test(hex)) return parseColor(hex.slice(0, 7), parseInt(hex.slice(7), 16) / 255);
  return parseColor(hex);
}

/** A part name relative to the model that mentions it, as a path from the package root. */
function resolvePath(target, base) {
  if (!target) return base;
  if (target.startsWith('/')) return target;
  return `${base.slice(0, base.lastIndexOf('/') + 1)}${target}`;
}

/**
 * 3MF's "m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32": rows of a matrix that
 * multiplies row vectors. As a column-major 4×4 for column vectors, the same twelve
 * numbers in the same order, with 0, 0, 0, 1 between them.
 */
function parseTransform(value) {
  if (!value) return IDENTITY;
  const m = value.trim().split(/\s+/).map(Number);
  if (m.length !== 12 || m.some((n) => !Number.isFinite(n))) throw new Error(`import3MF(): bad transform "${value}"`);
  return [m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, m[9], m[10], m[11], 1];
}

const scaling = (s) => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];

/** a × b, both column-major 4×4. */
function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
    }
  }
  return out;
}

function determinant(m) {
  return m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
}
