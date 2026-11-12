// The playground runs code from a blob URL, where a bare 'cadcode' cannot resolve.
// Every import of it — `import { cube } from 'cadcode'`, `import 'cadcode'`,
// `export * from 'cadcode'` and `import('cadcode')` — is pointed at `url` instead.
const CADCODE_IMPORT = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])cadcode\2/g;

/**
 * @param {string} code
 * @param {string} url
 */
export function pointCadcodeAt(code, url) {
  return code.replace(CADCODE_IMPORT, `$1"${url}"`);
}
