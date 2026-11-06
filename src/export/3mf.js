import { zipSync, strToU8 } from 'fflate';
import { colorOfId } from '../lib/shapes.js';
import { DEFAULT_COLOR } from './raster.js';

/**
 * A 3MF package of the part's solids, one object each, in millimeters. Unlike STL the
 * solids stay apart, and their colors go along as the core spec's base materials, per
 * triangle, so a union of colored pieces keeps its colors. Faces with no color take the
 * color the viewer draws them in, when the same solid has colored faces too.
 *
 * Only the core spec: slicers read the bodies, but whether they map the colors to
 * filaments is up to each of them.
 * @param {import('../lib/shapes.js').Solid[]} solids
 * @param {{ name?: string }} [options] `name` names the objects: the part's name, numbered when there are several.
 * Plain typed arrays rather than a Buffer, so it also runs in the browser.
 * @returns {Uint8Array}
 */
export function to3MF(solids, { name = 'part' } = {}) {
  if (solids.length === 0) throw new Error('Nothing to export to 3MF: the part has no solids (2D shapes are not exported)');

  /** @type {Map<string, number>} hex color → index in the base materials */
  const materials = new Map();
  const materialOf = (rgba) => {
    const hex = hexColor(rgba);
    if (!materials.has(hex)) materials.set(hex, materials.size);
    return materials.get(hex);
  };

  const objects = solids.map((solid, i) => {
    const objectName = solids.length > 1 ? `${name}-${i + 1}` : name;
    return objectXML(i + 2, objectName, solid.manifold.getMesh(), materialOf);
  });

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    ' <metadata name="Application">cadcode</metadata>',
    ' <resources>',
  ];
  if (materials.size > 0) {
    lines.push('  <basematerials id="1">');
    for (const hex of materials.keys()) lines.push(`   <base name="${hex}" displaycolor="${hex}"/>`);
    lines.push('  </basematerials>');
  }
  lines.push(...objects, ' </resources>', ' <build>');
  solids.forEach((_, i) => lines.push(`  <item objectid="${i + 2}"/>`));
  lines.push(' </build>', '</model>', '');

  // A fixed date, so the same model packs to the same bytes.
  return zipSync(
    {
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      '_rels/.rels': strToU8(RELATIONSHIPS),
      '3D/3dmodel.model': strToU8(lines.join('\n')),
    },
    { level: 6, mtime: new Date(1980, 0, 1) },
  );
}

/**
 * One `<object>`: the mesh as manifold indexes it, with a material on every triangle when any
 * of them has a color. The commonest one is the object's own; triangles only name a different one.
 */
function objectXML(id, name, { numProp, vertProperties, triVerts, runIndex, runOriginalID }, materialOf) {
  const out = [];
  const vertexCount = vertProperties.length / numProp;
  for (let v = 0; v < vertexCount; v++) {
    const o = v * numProp;
    out.push(`<vertex x="${num(vertProperties[o])}" y="${num(vertProperties[o + 1])}" z="${num(vertProperties[o + 2])}"/>`);
  }
  const vertices = out.join('');

  // The material of each run of triangles, or null for a solid with no color at all.
  const runColors = Array.from(runOriginalID, (id) => colorOfId(id) ?? null);
  const colored = runColors.some(Boolean);
  const runMaterials = colored ? runColors.map((color) => materialOf(color ?? DEFAULT_COLOR)) : [];
  let own = -1;
  if (colored) {
    const area = new Map();
    runMaterials.forEach((m, run) => area.set(m, (area.get(m) ?? 0) + runIndex[run + 1] - runIndex[run]));
    own = [...area].sort((a, b) => b[1] - a[1])[0][0];
  }

  out.length = 0;
  for (let run = 0; run < runOriginalID.length; run++) {
    const extra = colored && runMaterials[run] !== own ? ` pid="1" p1="${runMaterials[run]}"` : '';
    for (let i = runIndex[run]; i < runIndex[run + 1]; i += 3) {
      out.push(`<triangle v1="${triVerts[i]}" v2="${triVerts[i + 1]}" v3="${triVerts[i + 2]}"${extra}/>`);
    }
  }
  const triangles = out.join('');

  const material = colored ? ` pid="1" pindex="${own}"` : '';
  return `  <object id="${id}" type="model" name="${escapeXML(name)}"${material}><mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object>`;
}

/** The shortest decimal that reads back as the same 32-bit float, as the mesh holds them. */
function num(value) {
  for (let digits = 6; digits < 9; digits++) {
    const short = Number(value.toPrecision(digits));
    if (Math.fround(short) === value) return String(short);
  }
  return String(Number(value.toPrecision(9)));
}

/** `#RRGGBB`, or `#RRGGBBAA` when see-through, as 3MF's displaycolor takes it. */
function hexColor([r, g, b, a]) {
  const byte = (c) => Math.round(Math.min(Math.max(c, 0), 1) * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${byte(r)}${byte(g)}${byte(b)}${a < 1 ? byte(a) : ''}`;
}

const escapeXML = (s) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`;

const RELATIONSHIPS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`;
