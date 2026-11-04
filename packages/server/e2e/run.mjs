// `npm test`'s browser half: runs every end-to-end file in this folder (the admin screens, the Library, …) and never
// lets a skip pass for a green run. When they cannot run (no Playwright), a loud "SKIPPED: e2e" line says so and why;
// with MARKSTAGE_E2E_REQUIRED=1 a skip fails the run. A port in use fails it (support.mjs; MARKSTAGE_E2E_PORT_BASE
// picks other ports).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// a process left running (a dev server nobody stopped) keeps the test alive after the last test: give up after
// 15 minutes and say so, rather than wait for ever with nothing printed
const LIMIT_MS = 15 * 60_000;
// every *.e2e.mjs here (admin, library, entries, …), one after the other: each has its own server and ports
const files = fs.readdirSync(here).filter((f) => f.endsWith('.e2e.mjs')).sort().map((f) => path.join(here, f));
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: LIMIT_MS, killSignal: 'SIGKILL' });
process.stdout.write(r.stdout ?? '');
process.stderr.write(r.stderr ?? '');
if (r.error?.code === 'ETIMEDOUT') {
  console.error(`\ne2e: did not finish within ${LIMIT_MS / 60_000} minutes. If every test above passed, something it started is still running (a child process, a timer): look for it.`);
  process.exit(1);
}
const skipped = Number(/^ℹ skipped (\d+)/m.exec(r.stdout ?? '')?.[1] ?? 0);
if (r.status !== 0) process.exit(r.status ?? 1);
if (skipped) {
  const why = /# SKIP (.+)$/m.exec(r.stdout ?? '')?.[1] ?? 'see above';
  const line = `SKIPPED: e2e (screens in a browser): ${why}`;
  console.error(`\n${'!'.repeat(line.length + 8)}\n!!! ${line} !!!\n${'!'.repeat(line.length + 8)}\n`);
  process.exit(process.env.MARKSTAGE_E2E_REQUIRED === '1' ? 1 : 0);
}
process.exit(r.status ?? 1);
