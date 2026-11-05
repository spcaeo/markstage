// Small helpers the demo scripts share (scripts/demo/*): ports, waiting for a server, starting and stopping one by
// its own process (never by name), and a static file server for a built demo folder.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Something listens on this port (lsof). */
export function listening(port) {
  try {
    return execFileSync('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() !== '';
  } catch {
    return false;
  }
}

/** Waits until `url` answers below 500. */
export async function up(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (r.status < 500) return;
    } catch {
      /* not yet */
    }
    await sleep(300);
  }
  throw new Error(`${url} did not answer within ${ms / 1000} s`);
}

/** A child process with its last output kept (child.log()). */
export function start(argv, opts) {
  const child = spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  child.log = () => log.slice(-3000);
  return child;
}

/** Stops a process we started, and waits until its port is free again. */
export async function stop(child, port) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  for (let i = 0; i < 40 && listening(port); i++) await sleep(250);
  if (listening(port)) child.kill('SIGKILL');
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

/**
 * A static server for a built demo, as GitHub Pages serves it: `dir` at `base` (e.g. /markstage/demo/), a folder's
 * index.html for its address, 404 for anything else. Listens on 127.0.0.1 only. Returns the http.Server.
 */
export function serveStatic(dir, base, port) {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let p = decodeURIComponent(url.pathname);
    if (!p.startsWith(base)) return res.writeHead(404).end('not found');
    p = path.join(root, p.slice(base.length));
    if (!p.startsWith(root)) return res.writeHead(404).end('not found');
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      if (!url.pathname.endsWith('/')) return res.writeHead(301, { Location: `${url.pathname}/` }).end();
      p = path.join(p, 'index.html');
    }
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
