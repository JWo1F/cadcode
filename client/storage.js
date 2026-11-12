// localStorage that never throws: a private window, or a browser with storage off,
// refuses it, and then nothing is remembered rather than the page breaking.

export const storage = {
  /** The JSON value under `key`, or null when there is none or it does not parse. */
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage unavailable: the value just isn't remembered.
    }
  },
  /** The text under `key` as stored, or null. */
  getText(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setText(key, text) {
    try {
      localStorage.setItem(key, text);
    } catch {
      // Storage unavailable: the value just isn't remembered.
    }
  },
};
