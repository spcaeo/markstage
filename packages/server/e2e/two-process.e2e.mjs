// Two server processes on one data dir (docs/SCALING.md), in a real browser at 1440: a person signs in on process A,
// then the editor is opened on process B (as a load balancer may send their next request there). B knows the
// session, shows the entry, takes the edit lock, and the save is one clean commit; A reads the saved words at once.
// The test person is made up here, with a generated password. The browser and both processes are stopped in `after`,
// pass or fail.
//
//   npm run test:e2e -w packages/server        (part of `npm test`; e2e/run.mjs)
//
// Ports: its own (support.mjs TWO_PROCESS_PORTS). Screenshots go to MARKSTAGE_E2E_SHOTS when it is set.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { makeFixture, testPassword } from '../test/helpers.mjs';
import { startProcess, stopAll } from '../test/two-process.mjs';
import { buildEditor } from './build-editor.mjs';
import { SHOTS, TWO_PROCESS_PORTS, pw, skip } from './support.mjs';

describe('two server processes: signed in on A, editing on B', { skip, timeout: 180_000 }, () => {
  let fx, a, b, browser, page, head0;
  const owner = { email: 'owner@example.test', name: 'Olive Owner', role: 'owner', password: testPassword() };
  const file = () => fs.readFileSync(path.join(fx.site, 'src/content/blog/hello-world.md'), 'utf8');
  const shot = async (name) => {
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `two-process-${name}.png`) });
  };

  before(async () => {
    fx = makeFixture({ checks: false });
    head0 = fx.git('rev-parse', 'HEAD').trim();
    const editorDir = await buildEditor(path.join(fx.run, 'editor'), {
      api: '/markstage/api/',
      siteName: 'Test site',
      collections: [
        { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasUrl: true, titleKey: 'title', hasStatus: true },
        { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', hasUrl: true, addressKey: 'uri' },
      ],
      compat: null,
      canvas: { articleClass: '', bodyClass: '' },
    });
    const cfgPath = path.join(fx.data, 'config.json');
    fs.writeFileSync(cfgPath, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')), editorDir }, null, 2));
    a = await startProcess(fx, { seed: [owner], port: TWO_PROCESS_PORTS[0], realCore: true });
    b = await startProcess(fx, { port: TWO_PROCESS_PORTS[1], realCore: true });
    browser = await pw.chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
  });
  after(async () => {
    await browser?.close();
    await stopAll();
  });

  test('signed in on A; on B the session holds, the entry opens for editing, and the save is one clean commit A reads', async () => {
    assert.deepEqual([a.role, b.role], ['primary', 'secondary']);
    await page.goto(`${a.base}/markstage/#/sign-in?next=${encodeURIComponent('#/e/posts/with-html')}`);
    await page.getByLabel('Email').fill(owner.email);
    await page.getByLabel('Password', { exact: true }).fill(owner.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => u.hash.startsWith('#/e/posts/with-html'));
    await page.locator('.ProseMirror').waitFor();
    // the next request lands on B (cookies are per host, not per port, as behind one address and a load balancer)
    await page.goto(`${b.base}/markstage/#/e/posts/hello-world`);
    const pm = page.locator('.ProseMirror');
    await pm.waitFor();
    assert.equal(page.url().includes('sign-in'), false, 'B knows the session made on A');
    const first = pm.locator('p').first();
    await first.click();
    await first.click({ position: { x: 2, y: 8 } });
    await page.keyboard.press('Home');
    await page.keyboard.type('Edited on B. ');
    await page.keyboard.press('ControlOrMeta+s');
    await page.locator('.ms-status[data-status="saved"]').waitFor();
    await shot('saved-on-b');
    assert.match(file(), /^Edited on B\. First paragraph\.$/m);
    const commits = fx.git('rev-list', `${head0}..HEAD`).trim().split('\n');
    assert.equal(commits.length, 1, 'one commit');
    assert.equal(fx.git('show', '--name-only', '--format=%an', commits[0]).trim().split('\n').filter(Boolean).join('|'), 'Olive Owner|src/content/blog/hello-world.md');
    assert.equal(fx.git('status', '--porcelain', '--', 'src').trim(), '');
    // the edit lock B gave this tab is what A sees
    const onA = await page.context().request.get(`${a.base}/markstage/api/presence`);
    assert.equal(onA.status(), 200);
    assert.equal((await onA.json()).entries.find((e) => e.id === 'hello-world')?.editing?.name, owner.name);
    // A reads the saved words (a fresh request, signed in with the same cookie)
    const read = await page.context().request.get(`${a.base}/markstage/api/collections/posts/entries/hello-world`);
    assert.equal(read.status(), 200);
    assert.match(JSON.stringify(await read.json()), /Edited on B\. First paragraph\./);
  });
});
