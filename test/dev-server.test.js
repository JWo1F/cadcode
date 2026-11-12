import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';
import { startDevServer, pruneOverrides } from '../src/dev/server.js';
import { decodeFrame } from '../client/frame-codec.js';

test('pruneOverrides drops undeclared params and values gone from their options', () => {
  const declared = { size: { value: 1 }, finish: { value: 'matte', options: ['matte', 'gloss'] } };
  assert.deepEqual(pruneOverrides({ size: 3, gone: 1, finish: 'gloss' }, declared), { size: 3, finish: 'gloss' });
  assert.deepEqual(pruneOverrides({ finish: 'satin' }, declared), {});
});

const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cadcode-dev-')));
const program = path.join(dir, 'box.js');
const marker = path.join(dir, 'slow-marker');

// `slow` never returns: it writes the time to a file every 20 ms, so the test can tell whether it is still running.
const source = (size) => `import fs from 'node:fs';
import { cube } from 'cadcode';
export const params = {
  size: { value: ${size}, name: 'Size', description: 'Edge' },
  height: { value: 1, name: 'Height', description: 'Height' },
};
export default {
  box: ({ size, height }) => cube([size, size, height]),
  slow: () => {
    const pause = new Int32Array(new SharedArrayBuffer(4));
    for (;;) {
      fs.writeFileSync(${JSON.stringify(marker)}, String(Date.now()));
      Atomics.wait(pause, 0, 0, 20);
    }
  },
};
`;

let server;
before(async () => {
  fs.writeFileSync(program, source(2));
  server = await startDevServer({ file: program, port: 0, host: '127.0.0.1', overrides: { height: 5 }, exitOnSignal: false });
});
after(async () => {
  await server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A browser's socket, with its messages queued: frames decoded, the rest parsed. */
async function connect() {
  const ws = new WebSocket(server.url.replace('http', 'ws'));
  ws.binaryType = 'arraybuffer';
  const queue = [];
  const waiters = [];
  ws.on('message', (data, isBinary) => {
    queue.push(isBinary ? { type: 'frame', ...decodeFrame(data) } : JSON.parse(String(data)));
    for (const waiter of waiters.splice(0)) waiter();
  });
  await new Promise((resolve, reject) => ws.once('open', resolve).once('error', reject));
  /** The next message of a type, waiting for it; older ones are dropped. */
  const next = async (type, ms = 20000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const index = queue.findIndex((m) => m.type === type);
      if (index >= 0) return queue.splice(0, index + 1).pop();
      if (Date.now() > deadline) throw new Error(`no ${type} message within ${ms} ms`);
      await Promise.race([new Promise((resolve) => waiters.push(resolve)), sleep(100)]);
    }
  };
  return { ws, next, queue, send: (message) => ws.send(JSON.stringify(message)) };
}

test('the dev server sends the model, runs params changes and keeps a build error', async () => {
  const browser = await connect();

  // A browser that connects gets the model.
  const first = await browser.next('frame');
  assert.equal(first.header.part, 'box');
  assert.ok(first.groups.length > 0);
  assert.deepEqual(first.header.overrides, { height: 5 });

  // The first browser's remembered values come under the ones from --set.
  browser.send({ type: 'restore', overrides: { size: 4, height: 9 } });
  const restored = await browser.next('frame');
  assert.deepEqual(restored.header.overrides, { size: 4, height: 5 });
  assert.equal(restored.header.restored, true);

  // A params change runs the program again.
  browser.send({ type: 'params', overrides: { size: 3 } });
  const changed = await browser.next('frame');
  assert.deepEqual(changed.header.overrides, { size: 3 });

  // A syntax error is reported, and a params change after it neither runs the last
  // good build nor clears the error.
  fs.writeFileSync(program, `${source(2)}\nexport const broken = ;\n`);
  const error = await browser.next('error');
  assert.match(error.message, /box\.js/);
  browser.queue.length = 0;
  browser.send({ type: 'params', overrides: { size: 6 } });
  browser.send({ type: 'part', name: 'slow' });
  await sleep(1500);
  assert.deepEqual(browser.queue.filter((m) => m.type === 'frame' || m.status === 'evaluating'), []);
  // A download reports the build error rather than exporting the last good build.
  const response = await fetch(`${server.url}stl?part=box`);
  assert.equal(response.status, 500);
  assert.match(await response.text(), /box\.js/);

  // Fixed, the program runs with the values set while it was broken.
  browser.send({ type: 'part', name: 'box' });
  fs.writeFileSync(program, source(2));
  const fixed = await browser.next('frame');
  assert.deepEqual(fixed.header.overrides, { size: 6 });
  browser.ws.close();
});

test('a download the browser abandons stops its run', async () => {
  const browser = await connect();
  await browser.next('frame'); // built
  browser.ws.close();
  const controller = new AbortController();
  const response = fetch(`${server.url}stl?part=slow`, { signal: controller.signal }).catch(() => null);
  const deadline = Date.now() + 20000;
  while (!fs.existsSync(marker)) {
    if (Date.now() > deadline) throw new Error('the slow part never ran');
    await sleep(50);
  }
  controller.abort();
  await response;
  await sleep(500);
  const stopped = fs.readFileSync(marker, 'utf8');
  await sleep(500);
  assert.equal(fs.readFileSync(marker, 'utf8'), stopped, 'the slow part is still running');
});
