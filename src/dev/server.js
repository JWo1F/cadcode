import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import * as esbuild from 'esbuild';
import { WebSocketServer } from 'ws';
import { bundleOptions, removeBundle } from '../core/program.js';
import { encodeFrame } from '../../client/frame-codec.js';

const PACKAGE_DIR = fileURLToPath(new URL('../../', import.meta.url));
const CLIENT_DIR = fileURLToPath(new URL('../../client/', import.meta.url));
const WORKER_URL = new URL('./worker.js', import.meta.url);

// Library modules that the viewer's own modules import. The viewer is served
// unbundled, so these are served from where they live, at the URL its imports name.
const SHARED_MODULES = new Set(['src/lib/vec.js']);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

const DOWNLOAD_TYPES = { stl: 'model/stl', '3mf': 'model/3mf' };

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

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const stoppedEarly = (code) => `The program stopped (exit code ${code}) before it returned a model`;

const buildErrorMessage = (errors) => errors.map((e) => `${e.location ? `${e.location.file}:${e.location.line}:${e.location.column}: ` : ''}${e.text}`).join('\n');

function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

/**
 * The overrides a program still takes: those of a param it declares, with a value
 * among its options when it has them.
 * @param {Record<string, unknown>} overrides
 * @param {Record<string, { options?: unknown[] }>} declared
 */
export function pruneOverrides(overrides, declared) {
  return Object.fromEntries(
    Object.entries(overrides).filter(([key, value]) => {
      const spec = declared[key];
      return spec && (!spec.options || spec.options.includes(value));
    }),
  );
}

/**
 * The state of one program being previewed: its bundle, the part and the parameter
 * values it runs with, the last model and error; and what changes it: builds, runs
 * and the browsers' messages. Sends to browsers through `broadcast`.
 */
function createPreview({ displayName, baseName, part, overrides: cliOverrides, broadcast }) {
  // lastError is replayed to browsers that connect while the program is broken.
  // overrides are the parameter values set with --set and in the browser; they
  // outlive edits to the program, and lose a key once the program stops declaring it.
  // The first browser to connect hands over the values it remembers for this file
  // (restored), under the ones from --set; after that the server's values are the truth.
  // bundle is null until the program builds, and again while it fails to: runs,
  // downloads and parameter changes must not use the code of an older build.
  const state = { part, overrides: { ...cliOverrides }, restored: false, lastFrame: null, lastError: null, buildError: null, worker: null, bundle: null, memo: [] };

  const sendStatus = (status) => broadcast(JSON.stringify({ type: 'status', status }));
  const sendError = (error) => {
    console.error(`✗ ${error.message}`);
    state.lastError = JSON.stringify({ type: 'error', ...error });
    broadcast(state.lastError);
  };

  function stopRun() {
    const worker = state.worker;
    state.worker = null; // first, so its exit is not taken for a crash
    worker?.terminate();
  }

  function showResult(result) {
    state.part = result.part;
    state.lastError = null;
    // memo() results this run used or made; the next run reuses them. A failed run leaves the old ones.
    state.memo = result.memo;
    state.overrides = pruneOverrides(state.overrides, result.declared);
    const header = {
      type: 'model',
      file: displayName,
      part: result.part,
      partNames: result.partNames,
      params: result.declared,
      sections: result.sections,
      overrides: state.overrides,
      restored: state.restored,
      logs: result.logs,
      ms: result.ms,
    };
    state.lastFrame = encodeFrame(header, result.groups);
    broadcast(state.lastFrame);
    const triangles = result.groups.reduce((n, g) => n + g.indices.length / 3, 0);
    console.log(`✓ ${result.part}: ${triangles} triangles in ${result.ms} ms`);
  }

  function evaluate() {
    // While the program does not build, its error stays on screen.
    if (!state.bundle) return;
    stopRun();
    sendStatus('evaluating');
    const worker = new Worker(WORKER_URL, { workerData: { bundle: state.bundle, part: state.part, overrides: state.overrides, memo: state.memo } });
    state.worker = worker;
    const current = () => state.worker === worker;
    worker.once('message', (result) => {
      if (!current()) return;
      stopRun();
      if (result.ok) showResult(result);
      else sendError({ message: result.message, stack: result.stack, logs: result.logs });
    });
    worker.once('error', (error) => {
      if (!current()) return;
      state.worker = null;
      sendError({ message: error.message, stack: error.stack });
    });
    // A worker that ends without a result or an error: the program called process.exit(),
    // or WASM aborted. A worker that answered, failed or was replaced is no longer state.worker.
    worker.once('exit', (code) => {
      if (!current()) return;
      state.worker = null;
      sendError({ message: stoppedEarly(code) });
    });
  }

  /** The end of a build: the bundle to run, or the errors that replace it. */
  function built(bundle, errors) {
    if (errors.length > 0) {
      state.bundle = null;
      state.buildError = buildErrorMessage(errors);
      stopRun(); // a run of the older build would otherwise replace the error with its model
      return sendError({ message: state.buildError });
    }
    state.bundle = bundle;
    state.buildError = null;
    evaluate();
  }

  // A download evaluates in its own worker, so it never cancels or waits for the preview.
  function download(res, format, part) {
    const fail = (status, message) => {
      if (!res.headersSent && !res.destroyed) res.writeHead(status, { 'Content-Type': 'text/plain' }).end(message);
    };
    if (state.buildError) return fail(500, state.buildError);
    if (!state.bundle) return fail(503, 'The program has not built yet');
    const worker = new Worker(WORKER_URL, { workerData: { bundle: state.bundle, part, overrides: state.overrides, output: format, memo: state.memo } });
    // A browser that gave up on the download: the run is no longer wanted.
    res.once('close', () => {
      if (!res.writableEnded) worker.terminate();
    });
    worker.once('message', (result) => {
      worker.terminate();
      if (!result.ok) return fail(500, result.message);
      const name = result.partNames.length > 1 ? `${baseName}-${result.part}.${format}` : `${baseName}.${format}`;
      res.writeHead(200, { 'Content-Type': DOWNLOAD_TYPES[format], 'Content-Disposition': `attachment; filename="${name}"` });
      res.end(Buffer.from(result.file.buffer, result.file.byteOffset, result.file.byteLength));
      console.log(`↓ ${name}`);
    });
    worker.once('error', (error) => fail(500, error.message));
    worker.once('exit', (code) => fail(500, stoppedEarly(code)));
  }

  function receive(message) {
    if (message.type === 'part' && message.name !== state.part) {
      state.part = message.name;
      evaluate();
    }
    if (message.type === 'params' && isPlainObject(message.overrides)) {
      state.overrides = message.overrides;
      state.restored = true;
      evaluate();
    }
    // Only the first browser restores; later ones get the server's values in the next frame.
    if (message.type === 'restore' && isPlainObject(message.overrides) && !state.restored) {
      state.restored = true;
      state.overrides = { ...message.overrides, ...cliOverrides };
      if (Object.keys(message.overrides).length > 0) evaluate();
    }
  }

  /** What a browser that has just connected is sent: the model on screen, and its error. */
  const greeting = () => [state.lastFrame, state.lastError].filter(Boolean);

  return { state, sendStatus, built, download, receive, greeting, stopRun };
}

/**
 * The viewer's scene runs in a worker, where an import map cannot resolve 'three';
 * it is bundled once, three.js included, and served from memory.
 */
async function bundleRenderWorker() {
  const result = await esbuild.build({ entryPoints: [path.join(CLIENT_DIR, 'render-worker.js')], bundle: true, format: 'esm', write: false, logLevel: 'warning' });
  return result.outputFiles[0].contents;
}

/** Bundles the program now and on every change to it or a file it imports, telling `preview`. */
async function watchProgram(file, preview) {
  const options = bundleOptions(file);
  const ctx = await esbuild.context({
    ...options,
    plugins: [
      ...options.plugins,
      {
        name: 'cadcode-dev',
        setup(build) {
          build.onStart(() => preview.sendStatus('building'));
          build.onEnd((result) => preview.built(options.outfile, result.errors));
        },
      },
    ],
  });
  return { ctx, outfile: options.outfile };
}

function createHttpServer(preview, renderWorker) {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const relative = url.pathname.slice(1);
    if (url.pathname === '/') return serveFile(res, CLIENT_DIR, 'index.html');
    if (relative in DOWNLOAD_TYPES) return preview.download(res, relative, url.searchParams.get('part') ?? preview.state.part);
    if (url.pathname === '/render-worker.js') return void res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-cache' }).end(renderWorker);
    if (SHARED_MODULES.has(relative)) return serveFile(res, PACKAGE_DIR, relative);
    serveFile(res, CLIENT_DIR, relative);
  });
}

/** Browsers get the model and status over a WebSocket, and send the part and params they want. */
function acceptBrowsers(server, preview, sockets) {
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
      preview.receive(message);
    });
    for (const data of preview.greeting()) ws.send(data);
  });
  return wss;
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', (error) => reject(error.code === 'EADDRINUSE' ? new Error(`Port ${port} is in use; pass --port`) : error));
    server.listen(port, host, () => resolve(/** @type {import('node:net').AddressInfo} */ (server.address()).port));
  });
}

/**
 * Watches a program, re-evaluates it on every save, and pushes the meshes to
 * connected browsers over a WebSocket. Port 0 takes any free port.
 * @param {{ file: string, port: number, host: string, part?: string, overrides?: Record<string, unknown>, open?: boolean, exitOnSignal?: boolean }} options
 *   exitOnSignal (default true) stops the server and the process on Ctrl-C.
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export async function startDevServer({ file, port, host, part, overrides = {}, open = false, exitOnSignal = true }) {
  const relative = path.relative(process.cwd(), path.resolve(file));
  const displayName = relative.startsWith('..') ? path.resolve(file) : relative;
  const baseName = path.basename(file).replace(/\.[^.]+$/, '');

  const sockets = new Set();
  const broadcast = (data) => {
    for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.send(data);
  };
  const preview = createPreview({ displayName, baseName, part, overrides, broadcast });

  const renderWorker = await bundleRenderWorker();
  const { ctx, outfile } = await watchProgram(file, preview);
  const server = createHttpServer(preview, renderWorker);
  const wss = acceptBrowsers(server, preview, sockets);

  const boundPort = await listen(server, port, host);
  const url = `http://${host.includes(':') ? `[${host}]` : host}:${boundPort}/`;
  console.log(`cadcode dev: ${displayName} → ${url}`);
  if (open) openBrowser(url);

  await ctx.watch();

  const close = async () => {
    preview.stopRun();
    await ctx.dispose();
    removeBundle(outfile);
    for (const ws of sockets) ws.terminate();
    wss.close();
    server.closeAllConnections(); // keep-alive ones would hold the close open
    await new Promise((resolve) => server.close(resolve));
  };
  if (exitOnSignal) {
    const shutdown = async () => {
      await close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
  return { url, close };
}
