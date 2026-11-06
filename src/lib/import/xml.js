// A small XML reader for the importers (3MF models, SVG). It keeps elements and their
// attributes and drops text, comments, processing instructions and doctypes: none of
// these formats needs more. It runs in Node and in the browser alike.

/**
 * @typedef {object} XMLElement
 * @property {string} name the tag name as written, prefix included (`p:path`)
 * @property {string} local the name without its namespace prefix
 * @property {Record<string, string>} attributes values with entities decoded
 * @property {XMLElement[]} children
 */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(value) {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (whole, name) => {
    if (name[0] === '#') return String.fromCodePoint(name[1] === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
    return ENTITIES[name] ?? whole;
  });
}

const localName = (name) => name.slice(name.indexOf(':') + 1);

/**
 * Parses a document and returns its root element.
 * @param {string} text
 * @param {string} what names the document in errors
 * @returns {XMLElement}
 */
export function parseXML(text, what) {
  const root = { name: '#document', local: '#document', attributes: {}, children: [] };
  const stack = [root];
  let at = 0;
  while (at < text.length) {
    const open = text.indexOf('<', at);
    if (open === -1) break;
    if (text.startsWith('<!--', open)) {
      at = skipPast(text, '-->', open, what);
    } else if (text.startsWith('<![CDATA[', open)) {
      at = skipPast(text, ']]>', open, what);
    } else if (text.startsWith('<?', open)) {
      at = skipPast(text, '?>', open, what);
    } else if (text.startsWith('<!', open)) {
      // A doctype, possibly with an internal subset in brackets.
      const bracket = text.indexOf('[', open);
      const close = text.indexOf('>', open);
      at = bracket !== -1 && bracket < close ? skipPast(text, ']>', bracket, what) : close + 1;
    } else if (text[open + 1] === '/') {
      const close = text.indexOf('>', open);
      const name = text.slice(open + 2, close).trim();
      const element = stack.pop();
      if (!element || element.name !== name) throw new Error(`${what}: </${name}> does not close <${element?.name}>`);
      at = close + 1;
    } else {
      at = readTag(text, open, stack, what);
    }
  }
  if (stack.length > 1) throw new Error(`${what}: <${stack[stack.length - 1].name}> is never closed`);
  const element = root.children[0];
  if (!element) throw new Error(`${what}: not an XML document`);
  return element;
}

function skipPast(text, end, from, what) {
  const found = text.indexOf(end, from);
  if (found === -1) throw new Error(`${what}: the document ends inside a comment or declaration`);
  return found + end.length;
}

const TAG = /<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
const ATTRIBUTE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function readTag(text, open, stack, what) {
  TAG.lastIndex = open;
  const match = TAG.exec(text);
  if (!match) throw new Error(`${what}: malformed tag at character ${open}`);
  const [whole, name, attributeText, selfClosing] = match;
  const attributes = {};
  for (const [, key, double, single] of attributeText.matchAll(ATTRIBUTE)) attributes[key] = decode(double ?? single);
  const element = { name, local: localName(name), attributes, children: [] };
  stack[stack.length - 1].children.push(element);
  if (!selfClosing) stack.push(element);
  return open + whole.length;
}

/**
 * An attribute by its name without a namespace prefix, e.g. `path` for `p:path`.
 * @param {XMLElement} element
 * @param {string} local
 */
export function attribute(element, local) {
  if (local in element.attributes) return element.attributes[local];
  for (const [key, value] of Object.entries(element.attributes)) if (localName(key) === local) return value;
  return undefined;
}
