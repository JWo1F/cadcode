// Every example opens with a frontmatter block — `key: value` lines between /*--- and ---*/ —
// that names it for the gallery. The playground gets the code without it.
const FRONTMATTER = /^\/\*---\n([\s\S]*?)\n---\*\/\n/;

/**
 * Splits an example into its frontmatter and its code. Throws, naming `name`, when the
 * block is missing, a line is not `key: value`, or the title or description is missing.
 * @param {string} source
 * @param {string} name how errors name the file, e.g. examples/knob.js
 * @returns {{ meta: Record<string, string>, code: string }}
 */
export function readFrontmatter(source, name) {
  const match = source.match(FRONTMATTER);
  if (!match) throw new Error(`${name} has no frontmatter`);
  const meta = {};
  for (const line of match[1].split('\n')) {
    if (!line.trim()) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) throw new Error(`${name}: the frontmatter line "${line}" is not \`key: value\``);
    meta[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  for (const key of ['title', 'description']) if (!meta[key]) throw new Error(`${name} has no ${key} in its frontmatter`);
  return { meta, code: source.slice(match[0].length) };
}
