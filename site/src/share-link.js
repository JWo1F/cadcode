// A share link carries the playground's code deflated and base64url-encoded in its hash.

export const toBase64Url = (bytes) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join('')).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
export const fromBase64Url = (text) => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));

/** @param {string} code */
export async function pack(code) {
  const stream = new Blob([code]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return toBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()));
}

/** @param {string} packed what pack made; rejects when it is not */
export async function unpack(packed) {
  const stream = new Blob([fromBase64Url(packed)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}
