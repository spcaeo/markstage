// The writing help on the page, in a real browser at 1440, against real servers whose AI is the stub provider (no
// API call leaves the machine): select words, "Improve with AI" in the format bar, pick a choice, and the suggestion
// shows beside the selection as a diff. Accept is one change on the canvas (⌘Z, ⇧⌘Z), saved by ⌘S through the one
// save path, which writes only the changed words; Reject changes nothing. Every state is at its URL (Back and
// Forward walk them). The keyboard reaches it (Alt+F10, the arrows, Enter, Esc). With AI off the button is not
// there, and a link that asks anyway says why, naming the variable to set.
//
//   npm run test:e2e -w packages/server        (part of `npm test`; e2e/run.mjs)
//
// Ports: ai-suggest.e2e.mjs's (support.mjs AI_SUGGEST_PORTS): the files run one at a time.
// Screenshots (light and dark) go to MARKSTAGE_E2E_SHOTS when it is set.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { addUser, fakeCodec, makeFixture } from '../test/helpers.mjs';
import { buildEditor } from './build-editor.mjs';
import { AI_SUGGEST_PORTS, SHOTS, blank, pw, skip } from './support.mjs';

const [PORT, OFF_PORT] = AI_SUGGEST_PORTS;
// no key from the shell reaches these servers: the one with no `ai` must be off, and nothing may call out
delete process.env.MARKSTAGE_AI_KEY;

const FIRST = 'I recieve alot of letters from teh harbour master.';
const SECOND = 'We really just walked down in order to see the boats.';
const POST = `---\ntitle: Letters from the harbour\nauthor: alice\ndate: '2026-03-02T10:00:00.000Z'\nmodified: '2026-03-03T10:00:00.000Z'\n---\n\n${FIRST}\n\n${SECOND}\n\nThe **boats** came in.\n`;
const SITE_CONFIG = `export default { collections: [{ id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/' }] };\n`;
const EDITOR = {
  api: '/markstage/api/',
  siteName: 'Test site',
  collections: [{ id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasUrl: true, titleKey: 'title', settings: [] }],
  compat: null,
  canvas: { articleClass: '', bodyClass: '' },
};

async function siteServer(port, ai) {
  const fx = makeFixture({ checks: false });
  fs.writeFileSync(path.join(fx.site, 'src/content/blog/letters.md'), POST);
  fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), SITE_CONFIG);
  fx.git('add', '-A');
  fx.git('commit', '-q', '-m', 'Letters');
  if (ai) {
    const cfgPath = path.join(fx.data, 'config.json');
    fs.writeFileSync(cfgPath, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')), ai }, null, 2));
  }
  const editorDir = await buildEditor(path.join(fx.run, 'editor'), EDITOR);
  const config = loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' }, overrides: { port, editorDir, collections: [] } });
  const app = await createMarkstage(config, { codec: fakeCodec });
  await app.listen(port, '127.0.0.1');
  app.backup.stop();
  const owner = await addUser(app, { email: 'owner@example.test', name: 'Olive Owner', role: 'owner' });
  return { fx, app, owner, base: `http://127.0.0.1:${port}` };
}

describe('the writing help on the page', { skip }, () => {
  let on, off, browser, ctx, page;
  const read = () => fs.readFileSync(path.join(on.fx.site, 'src/content/blog/letters.md'), 'utf8');
  const params = () => Object.fromEntries(new URLSearchParams(decodeURIComponent(new URL(page.url()).hash).split('?')[1] ?? ''));
  const card = () => page.locator('.ms-ai-rw');
  const para = (n) => page.locator('.ProseMirror p').nth(n);
  const settled = async () => {
    await page.locator('.ms-ai-rw[data-ai-state]:not([data-ai-state="loading"])').waitFor();
    return card().getAttribute('data-ai-state');
  };
  /** Select a whole paragraph's words (each is one line), as a writer does: click in it, to the line's start, then Shift to its end. */
  async function select(n) {
    const mac = process.platform === 'darwin';
    await para(n).click();
    await page.keyboard.press(mac ? 'Meta+ArrowLeft' : 'Home');
    await page.keyboard.press(mac ? 'Meta+Shift+ArrowRight' : 'Shift+End');
    assert.equal(await page.evaluate(() => getSelection()?.toString()), await para(n).textContent());
    // the canvas has taken it in: its block is the one in the URL, and the bar is over it
    await page.waitForFunction((b) => new URLSearchParams(location.hash.split('?')[1]).get('b') === String(b), n);
    await page.locator('.ms-bar:not([hidden])').waitFor();
    await page.locator('.ms-bar:not([hidden])').waitFor();
  }
  async function signIn(base, who, to) {
    await page.goto(`${base}/markstage/#/sign-in?next=${encodeURIComponent(to)}`);
    await page.getByLabel('Email').fill(who.email);
    await page.getByLabel('Password', { exact: true }).fill(who.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => u.hash.startsWith(to.split('?')[0]));
    await page.locator('.ProseMirror p').first().waitFor();
  }
  const shot = async (name) => {
    if (!SHOTS) return;
    for (const s of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: s });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(SHOTS, `ai-${name}-${s}.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  };

  before(async () => {
    on = await siteServer(PORT, { provider: 'stub', perMinute: 60 });
    off = await siteServer(OFF_PORT, null);
    browser = await pw.chromium.launch();
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    for (const b of [on.base, off.base]) await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: b });
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
  });
  after(async () => {
    await ctx?.close();
    await browser?.close();
    await on?.app.close();
    await off?.app.close();
  });

  test('select, Improve with AI, Fix: the diff beside the words; Accept is one change, ⌘Z, ⌘S saves only those words', async () => {
    await signIn(on.base, on.owner, '#/e/posts/letters');
    await select(0);
    const improve = page.getByRole('button', { name: /^Improve with AI/ });
    await improve.waitFor();
    await improve.click();
    assert.equal(params().suggest, 'rewrite');
    assert.match(params().sel, /^\d+-\d+$/);
    assert.equal(params().how, undefined);
    // the choices, and the words marked on the canvas
    await card().locator('[data-how="fix"]').waitFor();
    assert.equal(await card().getAttribute('data-ai-state'), 'choose');
    assert.equal((await page.locator('.ProseMirror .ms-ai-mark').allTextContents()).join(''), FIRST);
    await card().getByRole('button', { name: /Fix spelling and grammar/ }).click();
    assert.equal(params().how, 'fix');
    assert.equal(await settled(), 'ready');
    // beside the selection: just under it
    const [selBox, cardBox] = [await para(0).boundingBox(), await card().boundingBox()];
    assert.ok(cardBox.y >= selBox.y + selBox.height - 2 && cardBox.y - (selBox.y + selBox.height) < 40, 'the card sits under the selected words');
    assert.deepEqual(await card().locator('del').allTextContents(), ['recieve alot', 'teh']);
    assert.deepEqual(await card().locator('ins').allTextContents(), ['receive a lot', 'the']);
    assert.match(await card().locator('.ms-ai-rw__what').textContent(), /^Fix spelling and grammar · /);
    // its copy icon gives the new words, plain
    await card().locator('.ms-ai-rw__diffwrap').hover();
    await card().getByRole('button', { name: 'Copy the suggested words' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'I receive a lot of letters from the harbour master.');
    await shot('rewrite');
    // nothing changed yet
    assert.equal(await para(0).textContent(), FIRST);
    assert.notEqual(await page.locator('.ms-status').getAttribute('data-status'), 'dirty');

    // Back: the choices again; Forward: the suggestion (asked again)
    await page.goBack();
    await page.waitForFunction(() => !location.hash.includes('how='));
    await card().locator('[data-how="fix"]').waitFor();
    await page.goForward();
    await page.waitForFunction(() => location.hash.includes('how=fix'));
    assert.equal(await settled(), 'ready');

    await card().locator('[data-ai-accept]').click();
    assert.equal(params().suggest, undefined, 'accepted: the card is gone from the URL');
    assert.equal(await card().count(), 0);
    assert.equal(await para(0).textContent(), 'I receive a lot of letters from the harbour master.');
    assert.equal(await page.locator('.ProseMirror .ms-ai-mark').count(), 0);
    assert.equal(await page.locator('.ms-status').getAttribute('data-status'), 'dirty');
    // one change: ⌘Z takes it all back, ⇧⌘Z puts it back
    await page.keyboard.press('ControlOrMeta+z');
    assert.equal(await para(0).textContent(), FIRST);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    assert.equal(await para(0).textContent(), 'I receive a lot of letters from the harbour master.');
    const before0 = read();
    await page.keyboard.press('ControlOrMeta+s');
    await page.locator('.ms-status[data-status="saved"]').waitFor();
    // the file: only those words changed, the rest byte for byte
    assert.equal(read(), before0.replace(FIRST, 'I receive a lot of letters from the harbour master.'));
  });

  test('the keyboard: Alt+F10 to the bar, the arrows to Improve with AI, Enter, Tab to Shorten; Edit then accept; Esc rejects', async () => {
    await select(1);
    await page.keyboard.press('Alt+F10');
    assert.equal(await page.evaluate(() => document.activeElement?.closest('.ms-bar') !== null), true, 'the bar has the focus');
    await page.keyboard.press('ArrowLeft');
    assert.match(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? ''), /^Improve with AI/);
    await page.keyboard.press('Enter');
    await card().locator('[data-how="rewrite"]').waitFor();
    await page.waitForFunction(() => document.activeElement?.matches('[data-how="rewrite"]'));
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    assert.equal(params().how, 'shorten');
    assert.equal(await settled(), 'ready');
    assert.deepEqual(await card().locator('del').allTextContents(), ['really just ', 'in order ']);
    // Esc: rejected, nothing changed, the words selected again
    await page.keyboard.press('Escape');
    assert.equal(params().suggest, undefined);
    assert.equal(await para(1).textContent(), SECOND);
    assert.equal(await page.evaluate(() => getSelection()?.toString()), SECOND);

    // Edit then accept: the writer's own words go in
    await page.getByRole('button', { name: /^Improve with AI/ }).click();
    await card().getByRole('button', { name: /^Shorten/ }).click();
    assert.equal(await settled(), 'ready');
    await card().getByRole('button', { name: 'Edit then accept' }).click();
    await card().getByLabel('Yours').fill('We walked down to see the boats.');
    await card().locator('[data-ai-accept]').click();
    assert.equal(await para(1).textContent(), 'We walked down to see the boats.');
    await page.keyboard.press('ControlOrMeta+z');
    assert.equal(await para(1).textContent(), SECOND);
  });

  test('a tone, from a link; Reject; a selection over two paragraphs is refused in words', async () => {
    await select(1);
    await page.getByRole('button', { name: /^Improve with AI/ }).click();
    const sel = params().sel;
    await card().getByRole('button', { name: 'Close the writing help' }).click();
    // the link, opened afresh (as from a message)
    await blank(page);
    await page.goto(`${on.base}/markstage/#/e/posts/letters?suggest=rewrite&sel=${sel}&how=tone:formal`);
    assert.equal(await settled(), 'ready');
    assert.match(await card().locator('.ms-ai__title').textContent(), /Formal tone/);
    await card().getByRole('button', { name: 'Reject' }).click();
    assert.equal(params().suggest, undefined);
    assert.equal(await para(1).textContent(), SECOND);
    // across two paragraphs: said, no card
    await para(0).click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    await page.getByRole('button', { name: /^Improve with AI/ }).click();
    await page.locator('.ms-toast', { hasText: 'Select words inside one paragraph' }).waitFor();
    assert.equal(params().suggest, undefined);
  });

  test('AI off: no Improve with AI in the bar; a link that asks anyway says why and names the variable', async () => {
    await signIn(off.base, off.owner, '#/e/posts/letters');
    await select(0);
    await page.waitForTimeout(300);
    assert.equal(await page.getByRole('button', { name: /^Improve with AI/ }).isVisible(), false);
    await blank(page);
    await page.goto(`${off.base}/markstage/#/e/posts/letters?suggest=rewrite&sel=1-5&how=fix`);
    assert.equal(await settled(), 'off');
    assert.match(await card().locator('.ms-ai__state').textContent(), /AI suggestions are off on this server\. To turn them on, set MARKSTAGE_AI_KEY/);
    assert.equal(await card().locator('.ms-ai__env .ms-copyable__text').textContent(), 'MARKSTAGE_AI_KEY');
    await shot('rewrite-off');
    await card().getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(params().suggest, undefined);
  });
});
