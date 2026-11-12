/**
 * A length in millimetres as the pages show it: in the reader's locale, with up to
 * two decimals and no trailing zeros (12, 12.5, 12.35). The readout, the section and
 * the measurement all use it, so the same length reads the same everywhere.
 * @param {number} n
 */
export function formatMm(n) {
  // + 0 turns a rounded -0 into 0, which would otherwise read "-0".
  return (Math.round(n * 100) / 100 + 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}
