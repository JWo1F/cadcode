// Renders site/reference/content.js into the Reference page's index and body,
// after checking that every library export and every Solid / Shape2 method has an entry.
import * as lib from '../../src/lib/index.js';
import { sections } from './content.js';

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// `code` spans in prose; everything else escaped.
const prose = (text) => escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>');

// The part of a param name the signature links: `options` for `options.center`,
// the whole name for a rest param like `...shapes`.
const rootOf = (name) => (name.startsWith('...') ? name : name.split('.')[0]);

const methodsOf = (cls) => Object.getOwnPropertyNames(cls.prototype).filter((name) => name !== 'constructor');

/** Throws, naming every export or method the page does not describe. */
export function checkCoverage() {
  const entries = sections.flatMap((section) => section.entries);
  const documented = new Set(entries.map((entry) => (entry.owner ? `${entry.owner}.${entry.name}` : entry.name)));
  const required = [
    ...Object.keys(lib),
    ...methodsOf(lib.Solid).map((name) => `Solid.${name}`),
    ...methodsOf(lib.Shape2).map((name) => `Shape2.${name}`),
  ];
  const missing = required.filter((name) => !documented.has(name));
  if (missing.length) throw new Error(`site/reference/content.js does not describe: ${missing.join(', ')}`);

  const ids = entries.map((entry) => entry.id);
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicate) throw new Error(`site/reference/content.js has two entries with id "${duplicate}"`);
}

// Wraps each parameter in the signature so it links to its row. A dotted name
// (`options.center`) links through its first segment; the first occurrence wins.
function signatureHtml(entry) {
  const roots = [...new Set((entry.params ?? []).map((param) => rootOf(param.name)))];
  let html = escapeHtml(entry.signature);
  for (const root of roots) {
    const pattern = new RegExp(`(^|[^\\w.-])(${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\w-])`);
    html = html.replace(pattern, `$1<a class="arg" href="#${entry.id}--${slug(root)}" data-arg="${slug(root)}">$2</a>`);
  }
  return html;
}

const slug = (name) => name.replace(/^[.-]+/, '').replace(/[^\w-]+/g, '-');

// The first row of each parameter (or of each dotted group, like `options.*`) is the
// signature link's target.
function paramHtml(entry, param, anchor) {
  const root = slug(rootOf(param.name));
  const id = anchor ? ` id="${entry.id}--${root}"` : '';
  const fallback = param.default ? `<span class="default">= ${escapeHtml(param.default)}</span>` : '';
  return `<div class="param"${id} data-arg="${root}">
  <dt><code class="name">${escapeHtml(param.name)}</code><code class="type">${escapeHtml(param.type)}</code>${fallback}</dt>
  <dd>${prose(param.text)}</dd>
</div>`;
}

function entryHtml(entry) {
  const seen = new Set();
  const rows = (entry.params ?? []).map((param) => {
    const root = rootOf(param.name);
    const anchor = !seen.has(root);
    seen.add(root);
    return paramHtml(entry, param, anchor);
  });
  const owner = entry.owner ? `<span class="owner">${entry.owner}</span>` : '';
  const returns = entry.returns ? `<span class="returns">: ${escapeHtml(entry.returns)}</span>` : '';
  const search = [entry.owner, entry.name, entry.summary].filter(Boolean).join(' ').toLowerCase();
  return `<article class="entry" id="${entry.id}" data-search="${escapeHtml(search)}">
  <h3><a class="self" href="#${entry.id}">${owner}<code class="signature">${signatureHtml(entry)}</code>${returns}</a></h3>
  <p class="summary">${prose(entry.summary)}</p>
  ${rows.length ? `<dl class="params">${rows.join('\n')}</dl>` : ''}
  ${(entry.notes ?? []).map((note) => `<p class="note">${prose(note)}</p>`).join('\n')}
  ${entry.example ? `<pre class="example"><code>${escapeHtml(entry.example)}</code></pre>` : ''}
</article>`;
}

export function renderReference() {
  checkCoverage();
  const index = sections
    .map(
      (section) => `<li data-section="${section.id}"><a class="group" href="#${section.id}">${escapeHtml(section.title)}</a>
  <ul>${section.entries
    .map((entry) => `<li data-entry="${entry.id}"><a href="#${entry.id}">${entry.owner ? '.' : ''}${escapeHtml(entry.name)}</a></li>`)
    .join('')}</ul>
</li>`,
    )
    .join('\n');
  const body = sections
    .map(
      (section) => `<section class="group" id="${section.id}" data-section="${section.id}">
  <h2>${escapeHtml(section.title)}</h2>
  ${section.intro ? `<p class="intro">${prose(section.intro)}</p>` : ''}
  ${section.entries.map(entryHtml).join('\n')}
</section>`,
    )
    .join('\n');
  return { index, body };
}
