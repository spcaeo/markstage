// `npm test`'s browser half: runs every end-to-end file in this folder (the admin screens, the Library, …) and never
// lets a skip pass for a green run. When they cannot run (no Playwright), a loud "SKIPPED: e2e" line says so and why;
// with MARKSTAGE_E2E_REQUIRED=1 a skip fails the run. A port in use fails it (support.mjs; MARKSTAGE_E2E_PORT_BASE
// picks other ports). Before the tests: the editor's preview agent is built when it is missing (a fresh clone has
// none: `npm ci` does not build it), and a missing Chromium stops the run with the command that installs it.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// the preview agent the browser tests copy (packages/editor dist/preview-agent.js)
const editorDir = path.resolve(here, '../../editor');
const agent = path.join(editorDir, 'dist/preview-agent.js');
if (!fs.existsSync(agent)) {
  console.log('e2e: the editor\'s preview agent is not built yet; building it (npm run build:agent -w packages/editor)…');
  const b = spawnSync(process.execPath, [path.join(editorDir, 'scripts/build-agent.mjs')], { cwd: editorDir, stdio: 'inherit' });
  if (b.status !== 0 || !fs.existsSync(agent)) {
    console.error('\ne2e: building the preview agent failed (see above). Run `npm run build:agent -w packages/editor` at the repo root.');
    process.exit(1);
  }
}

// Chromium for Playwright: when Playwright is there but its browser is not, say how to get it instead of failing
// every test with a launch error. (No Playwright at all is the loud skip below.)
async function chromiumMissing() {
  let pw;
  try {
    pw = process.env.MARKSTAGE_PLAYWRIGHT
      ? createRequire(path.join(process.env.MARKSTAGE_PLAYWRIGHT, 'package.json'))(process.env.MARKSTAGE_PLAYWRIGHT)
      : await import('playwright');
  } catch {
    return false;
  }
  try {
    const exe = pw.chromium.executablePath();
    return !exe || !fs.existsSync(exe);
  } catch {
    return true;
  }
}
if (await chromiumMissing()) {
  console.error('\ne2e: Playwright\'s Chromium is not installed, so the browser tests cannot run.\n'
    + 'Install it once, at the repo root:  npx playwright install chromium\n'
    + '(on Linux:  npx playwright install --with-deps chromium)\n');
  process.exit(1);
}
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
