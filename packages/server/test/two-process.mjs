// Two (or more) real server processes on one data dir, for the tests of docs/SCALING.md: each a child process running
// test/cluster-child.mjs on its own odd five-digit port of 127.0.0.1, checked free first. Every process started here
// is stopped when the test file ends, pass or fail (`stopAll`, and a last SIGKILL when this process exits).
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHILD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cluster-child.mjs');
const started = new Set();
process.on('exit', () => {
  for (const p of started) if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL');
});

const isFree = (port) =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });

/** A free odd five-digit port on 127.0.0.1 (41001 to 58999), not one handed out before in this test process. */
const given = new Set();
export async function oddPort() {
  for (let i = 0; i < 200; i++) {
    const port = 41001 + 2 * Math.floor(Math.random() * 9000);
    if (given.has(port)) continue;
    if (await isFree(port)) {
      given.add(port);
      return port;
    }
  }
  throw new Error('no free odd port');
}

/**
 * Start one server process on the fixture's data dir: {port, base, id, role, proc, output(), stop(), kill(),
 * exited}. `seed`: users to create in it first ([{email, role, password, name?, authorSlug?}]); `port`: a port the
 * caller checked (else a free odd one); `realCore`: the real @markstage/core (the browser tests), else the stub.
 */
export async function startProcess(fx, { seed = null, port = null, realCore = false, timeoutMs = 30_000 } = {}) {
  port ??= await oddPort();
  const args = [CHILD, fx.data, String(port), ...(seed ? [JSON.stringify(seed)] : [])];
  const env = { ...process.env, ...(realCore ? { MARKSTAGE_TEST_REAL_CORE: '1' } : {}) };
  const proc = spawn(process.execPath, ['--no-warnings', ...args], { stdio: ['ignore', 'pipe', 'pipe'], env });
  started.add(proc);
  let out = '';
  const exited = new Promise((resolve) => proc.once('exit', (code, signal) => resolve({ code, signal })));
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server process on ${port} did not start:\n${out}`)), timeoutMs);
    const look = (d) => {
      out += d.toString();
      const m = /^ready (\S+) (primary|secondary)$/m.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve({ id: m[1], role: m[2] });
      }
    };
    proc.stdout.on('data', look);
    proc.stderr.on('data', (d) => (out += d.toString()));
    void exited.then(({ code, signal }) => {
      clearTimeout(timer);
      reject(new Error(`server process on ${port} ended (${code ?? signal}) before it was ready:\n${out}`));
    });
  });
  const gone = () => proc.exitCode !== null || proc.signalCode !== null;
  return {
    port,
    base: `http://127.0.0.1:${port}`,
    ...ready,
    proc,
    exited,
    output: () => out,
    /** A clean stop (SIGTERM): it finishes its work and lets its roles go. Killed if it takes over 20 s. */
    async stop() {
      if (gone()) return;
      proc.kill('SIGTERM');
      const t = setTimeout(() => proc.kill('SIGKILL'), 20_000);
      await exited;
      clearTimeout(t);
    },
    /** A crash (SIGKILL): nothing let go, nothing finished. */
    async kill() {
      if (gone()) return;
      proc.kill('SIGKILL');
      await exited;
    },
  };
}

/** Two processes on one data dir: A starts first (it takes the primary role and creates `seed`), then B. */
export async function startPair(fx, { seed = null } = {}) {
  const a = await startProcess(fx, { seed });
  try {
    const b = await startProcess(fx);
    return { a, b };
  } catch (e) {
    await a.stop();
    throw e;
  }
}

/** Stop every process started here that still runs (an `after` hook calls it, pass or fail). */
export async function stopAll() {
  await Promise.all(
    [...started].map(async (p) => {
      if (p.exitCode === null && p.signalCode === null) {
        p.kill('SIGTERM');
        const t = setTimeout(() => p.kill('SIGKILL'), 20_000);
        await new Promise((r) => p.once('exit', r));
        clearTimeout(t);
      }
      started.delete(p);
    }),
  );
}
