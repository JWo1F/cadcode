// The parameters panel's reasoning about values, apart from its DOM (client/params.js),
// so it can be tested without a browser.

export const HEX = /^#[0-9a-f]{6}$/i;

/** Key-order-independent JSON, to compare sets of values. */
export const stable = (value) =>
  JSON.stringify(value, (_key, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));

export const same = (a, b) => stable(a) === stable(b);

/** What a param is edited as: its options, or by the kind of its value. */
export function kindOf({ value, options }) {
  if (options) return 'choice';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return HEX.test(value) ? 'color' : 'text';
  return 'json';
}

/** The arrow-key step of a number field: 1 for whole numbers, else one unit of its last decimal. */
export function stepOf(value) {
  const decimals = String(value).split('.')[1]?.length ?? 0;
  return 1 / 10 ** Math.min(decimals, 4); // not 10 ** -4, which is 0.0000999…
}

/** JSON on one line with a space after each comma and colon: [4, 6, 8]. */
export const formatJSON = (value) =>
  JSON.stringify(value, null, 1)
    .replace(/\n\s*/g, ' ')
    .replace(/([[{]) /g, '$1')
    .replace(/ ([\]}])/g, '$1');

/**
 * The overrides the panel shows after a frame from the server. The server is the
 * truth, except while what the panel sent (`sent`) has not come back yet: until the
 * server has run with it, its overrides are older than the panel's. Either way only
 * declared params are kept.
 * @param {{ sent: Record<string, unknown> | null, overrides: Record<string, unknown>, serverOverrides: Record<string, unknown>, declared: Record<string, unknown> }} state
 * @returns {{ sent: Record<string, unknown> | null, overrides: Record<string, unknown> }}
 */
export function followServer({ sent, overrides, serverOverrides, declared }) {
  let waiting = sent;
  if (waiting) {
    const pending = Object.fromEntries(Object.entries(waiting).filter(([name]) => name in declared));
    if (same(pending, serverOverrides)) waiting = null;
  }
  const next = Object.fromEntries(Object.entries(waiting ? overrides : serverOverrides).filter(([name]) => name in declared));
  return { sent: waiting, overrides: next };
}
