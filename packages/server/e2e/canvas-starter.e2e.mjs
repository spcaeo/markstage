// The starter's canvas in its page (examples/starter, canvas.shell on), in a real browser against its `astro dev`:
// the fidelity guard (packages/editor/scripts/canvas-fidelity.mjs) at 1440 and 390, in the editor's light and dark
// themes, with its contrast check (canvas-contrast.mjs). The starter turns dark by itself for a dark reader
// (prefers-color-scheme), so a dark editor draws it dark; its title sits inside a header of the page's
// (header.post__head > time + h1), so the editor's title goes there, between the date and the lead. The example blog
// is the other case (dark colours no reader gets: light in both themes): canvas-shell.e2e.mjs, canvas-server.e2e.mjs.
// Nothing is saved. The browser is closed by the guard, and the dev server is stopped in `after`.
//
// Port: MARKSTAGE_E2E_PORT_BASE (default 18231) + 40, the starter's dev server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { checkFidelity, report } from '../../editor/scripts/canvas-fidelity.mjs';
import { CANVAS_STARTER_PORT, SHOTS, pw, skip } from './support.mjs';

const BASE = `http://127.0.0.1:${CANVAS_STARTER_PORT}`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

async function up(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${url} did not answer within ${ms / 1000} s`);
}

describe("the starter's canvas in its page, light and dark", { skip, timeout: 300_000 }, () => {
  let dev;

  before(async () => {
    dev = spawn(process.execPath, [path.join(root, 'node_modules/astro/bin/astro.mjs'), 'dev', '--host', '127.0.0.1', '--port', String(CANVAS_STARTER_PORT), '--ignore-lock'], { cwd: path.join(root, 'examples/starter'), stdio: 'ignore' });
    await up(`${BASE}/`, 60_000);
  });

  after(() => {
    dev?.kill();
  });

  test('the canvas measures as the page does and every run of text is readable, at 1440 and 390, light and dark', async () => {
    const results = await checkFidelity({
      playwright: pw,
      base: BASE,
      entries: [
        { entry: 'posts/welcome', page: '/posts/welcome/' },
        { entry: 'posts/writing-in-markdown', page: '/posts/writing-in-markdown/' },
      ],
      widths: [1440, 390],
      themes: ['light', 'dark'],
      bodyClass: 'post__body',
      loose: ['pre.astro-code'],
      shots: SHOTS ?? undefined,
    });
    assert.ok(
      results.every((r) => r.ok),
      report(results),
    );
    for (const r of results) assert.ok(r.contrast.count >= 20 && !r.contrast.failures.length, `${r.entry} ${r.width} ${r.theme}: ${r.contrast.failures.join('; ')}`);
  });
});
