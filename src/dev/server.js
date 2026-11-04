import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import * as esbuild from 'esbuild';
import { WebSocketServer } from 'ws';
import { bundleOptions } from '../core/program.js';

const CLIENT_DIR = fileURLToPath(new URL('../../client/', import.meta.url));
const WORKER_URL = new URL('./worker.js', import.meta.url);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

/** Serves a file from `root`, refusing paths that escape it. */
function serveFile(res, root, relative) {
  const file = path.resolve(root, `.${path.posix.normalize(`/${relative}`)}`);
  if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

/**
 * Model frames are binary: a little-endian u32 header length, a JSON header
 * padded to 4 bytes, then each group's positions (f32) and indices (u32).
 */
function encodeModel(result, file) {
  const header = {
    type: 'model',
    file,
    part: result.part,
    partNames: result.partNames,
    logs: result.logs,
    ms: result.ms,
    groups: result.groups.map((g) => ({ body: g.body, color: g.color, vertices: g.positions.length / 3, indices: g.indices.length })),
  };
  let json = Buffer.from(JSON.stringify(header));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(json.length);
  const buffers = result.groups.flatMap((g) => [
    Buffer.from(g.positions.buffer, g.positions.byteOffset, g.positions.byteLength),
    Buffer.from(g.indices.buffer, g.indices.byteOffset, g.indices.byteLength),
  ]);
  return Buffer.concat([length, json, ...buffers]);
}

function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

/**
 * Watches a program, re-evaluates it on every save, and pushes the meshes to
 * connected browsers over a WebSocket.
 */
export async function startDevServer({ file, port, host, part, overrides, open }) {
  const relative = path.relative(process.cwd(), path.resolve(file));
  const displayName = relative.startsWith('..') ? path.resolve(file) : relative;
  const baseName = path.basename(file).replace(/\.[^.]+$/, '');
  // lastError is replayed to browsers that connect while the program is broken.
  const state = { part, lastFrame: null, lastError: null, worker: null, bundle: null };
  const sockets = new Set();

  const broadcast = (data) => {
    for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.send(data);
  };
  const sendStatus = (status, extra = {}) => broadcast(JSON.stringify({ type: 'status', status, ...extra }));
  const sendError = (error) => {
    console.error(`✗ ${error.message}`);
    state.lastError = JSON.stringify({ type: 'error', ...error });
    broadcast(state.lastError);
  };

  function evaluate() {
    if (!state.bundle) return;
    state.worker?.terminate();
    sendStatus('evaluating');
    const worker = new Worker(WORKER_URL, { workerData: { bundle: state.bundle, part: state.part, overrides } });
    state.worker = worker;
    worker.once('message', (result) => {
      if (state.worker !== worker) return;
      state.worker = null;
      worker.terminate();
      if (!result.ok) return sendError({ message: result.message, stack: result.stack, logs: result.logs });
      state.part = result.part;
      state.lastError = null;
      state.lastFrame = encodeModel(result, displayName);
      broadcast(state.lastFrame);
      const triangles = result.groups.reduce((n, g) => n + g.indices.length / 3, 0);
      console.log(`✓ ${result.part}: ${triangles} triangles in ${result.ms} ms`);
    });
    worker.once('error', (error) => {
      if (state.worker !== worker) return;
      state.worker = null;
      sendError({ message: error.message, stack: error.stack });
    });
  }

  // A download evaluates in its own worker, so it never cancels or waits for the preview.
  function downloadSTL(res, part) {
    if (!state.bundle) return void res.writeHead(503, { 'Content-Type': 'text/plain' }).end('The program has not built yet');
    const worker = new Worker(WORKER_URL, { workerData: { bundle: state.bundle, part, overrides, output: 'stl' } });
    const fail = (message) => res.writeHead(500, { 'Content-Type': 'text/plain' }).end(message);
    worker.once('message', (result) => {
      worker.terminate();
      if (!result.ok) return fail(result.message);
      const name = result.partNames.length > 1 ? `${baseName}-${result.part}.stl` : `${baseName}.stl`;
      res.writeHead(200, { 'Content-Type': 'model/stl', 'Content-Disposition': `attachment; filename="${name}"` });
      res.end(Buffer.from(result.stl.buffer, result.stl.byteOffset, result.stl.byteLength));
      console.log(`↓ ${name}`);
    });
    worker.once('error', (error) => fail(error.message));
  }

  // The viewer's scene runs in a worker, where an import map cannot resolve 'three';
  // it is bundled once, three.js included, and served from memory.
  const renderWorker = (
    await esbuild.build({ entryPoints: [path.join(CLIENT_DIR, 'render-worker.js')], bundle: true, format: 'esm', write: false, logLevel: 'warning' })
  ).outputFiles[0].contents;

  const options = bundleOptions(file);
  const ctx = await esbuild.context({
    ...options,
    plugins: [
      ...options.plugins,
      {
        name: 'cadcode-dev',
        setup(build) {
          build.onStart(() => sendStatus('building'));
          build.onEnd((result) => {
            if (result.errors.length > 0) {
              const message = result.errors.map((e) => `${e.location ? `${e.location.file}:${e.location.line}:${e.location.column}: ` : ''}${e.text}`).join('\n');
              return sendError({ message });
            }
            state.bundle = options.outfile;
            evaluate();
          });
        },
      },
    ],
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/') return serveFile(res, CLIENT_DIR, 'index.html');
    if (url.pathname === '/stl') return downloadSTL(res, url.searchParams.get('part') ?? state.part);
    if (url.pathname === '/render-worker.js') return void res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-cache' }).end(renderWorker);
    serveFile(res, CLIENT_DIR, url.pathname.slice(1));
  });

  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => {
    sockets.add(ws);
    ws.on('close', () => sockets.delete(ws));
    ws.on('message', (data) => {
      let message;
      try {
        message = JSON.parse(String(data));
      } catch {
        return;
      }
      if (message.type === 'part' && message.name !== state.part) {
        state.part = message.name;
        evaluate();
      }
    });
    if (state.lastFrame) ws.send(state.lastFrame);
    if (state.lastError) ws.send(state.lastError);
  });

  await new Promise((resolve, reject) => {
    server.once('error', (error) => reject(error.code === 'EADDRINUSE' ? new Error(`Port ${port} is in use; pass --port`) : error));
    server.listen(port, host, resolve);
  });
  const url = `http://${host.includes(':') ? `[${host}]` : host}:${port}/`;
  console.log(`cadcode dev: ${displayName} → ${url}`);
  if (open) openBrowser(url);

  await ctx.watch();

  const shutdown = async () => {
    state.worker?.terminate();
    await ctx.dispose();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
