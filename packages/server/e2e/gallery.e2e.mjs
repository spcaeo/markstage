// The section gallery (#/gallery/<collection>, editor src/gallery/) in a real browser, against a real server on
// 127.0.0.1 with its preview: linked from the Library; every section type and variation the pages use, each drawn
// alone (the preview agent hides the page around it) at 1440 and 390 px, light and dark; the width, the colours,
// the type, the open sample and "Whole page" in the URL (a reload keeps them); the source page's address with its
// copy and open icons; and the content repo untouched after it all.
//
//   npm run test:e2e -w packages/server        (part of `npm test`; e2e/run.mjs)
//
// Ports: MARKSTAGE_E2E_PORT_BASE (default 18231, odd) +88 the server, +90 its preview; the dev server takes a free
// odd port from +60 to +68 (the e2e files run one after another). Screenshots go to MARKSTAGE_E2E_SHOTS when set.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { addUser, fakeCodec, makeFixture } from '../test/helpers.mjs';
import { buildEditor } from './build-editor.mjs';
import { PORT_BASE, SHOTS, pw, skip, blank } from './support.mjs';

const PORT = PORT_BASE + 88;
const PREVIEW_PORT = PORT_BASE + 90;
const BASE = `http://127.0.0.1:${PORT}`;
const THEMES = { dark: { attr: 'data-theme', value: 'dark' } };

const SITE_CONFIG = `export default {
  siteName: 'Fixture',
  collections: [
    { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/' },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', url: '{uri}', gallery: { variant: 'variant' } },
  ],
  themes: ${JSON.stringify(THEMES)},
};
`;
const sec = (discriminant, value) => ({ discriminant, value });
const PAGES = {
  about: { title: 'About', uri: '/about/', sections: [sec('hero', { heading: 'We move your data', lead: 'Every board, every file.' }), sec('cards', { heading: 'What we do', variant: 'blue', items: [{ title: 'Plan' }, { title: 'Move' }, { title: 'Check' }] }), sec('cta', { heading: 'Talk to us' })] },
  // the badges are lazy images, as sites have them, below the frame's first screen (a long section): they must load
  // in a scaled frame too
  team: { title: 'Team', uri: '/team/', sections: [sec('hero', { heading: 'Our team', variant: 'tall' }), sec('cards', { heading: 'Values', items: [{ title: 'Care' }] }), sec('logos', { heading: 'Badges', images: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'] })] },
};

// stands in for `astro dev`: a header, the sections (each with the outline marker), a footer, in a wrapper at least
// as tall as the screen (as many sites have); dark with data-theme. Its head starts an agent of its own first, for
// another origin, as the Astro integration does in `astro dev`: the preview's agent must still answer the editor
const FAKE_DEV = `import fs from 'node:fs';
import http from 'node:http';
// a real 2x2 PNG for every /img/<name>.png, a little late, as a real server would be
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMAAAA0YAQLcnYJfAAAAAElFTkSuQmCC', 'base64');
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const css = 'body{margin:0;font:16px/1.5 system-ui;color:#14181f;background:#fff}html[data-theme=dark] body{background:#10141b;color:#e8ecf2}' +
  '.shell{min-height:100vh;display:flex;flex-direction:column}main{flex:1}header,footer{padding:18px 32px;background:#eef1f6}html[data-theme=dark] header,html[data-theme=dark] footer{background:#1c2230}' +
  'section{padding:48px 32px}.hero{background:#eef1ff;min-height:320px}.hero.tall{min-height:520px}html[data-theme=dark] .hero{background:#1d2440}' +
  '.cards ul{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px;padding:0;list-style:none}.cards li{padding:16px;border:1px solid #ccd3df;border-radius:8px}' +
  '.cards.blue{background:#0b5cff;color:#fff}.cta{background:#14181f;color:#fff;text-align:center}.badges{display:flex;flex-wrap:wrap;gap:16px;margin-top:1000px}.badges img{background:#ccd3df}';
http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url.startsWith('/img/') && url.endsWith('.png')) return setTimeout(() => res.writeHead(200, { 'Content-Type': 'image/png' }).end(PNG), 150);
  for (const f of fs.readdirSync('src/content/pages')) {
    const d = JSON.parse(fs.readFileSync('src/content/pages/' + f, 'utf8'));
    if (d.uri !== url) continue;
    const body = (d.sections ?? []).map((s, i) => {
      const v = s.value ?? {};
      const items = (v.items ?? []).map((x) => '<li>' + esc(x.title) + '</li>').join('');
      const imgs = (v.images ?? []).map((n) => '<img loading="lazy" width="160" height="80" alt="' + esc(n) + '" src="/img/' + esc(n) + '.png">').join('');
      return '<section data-ms-section="' + i + '" class="' + esc(s.discriminant) + ' ' + esc(v.variant ?? '') + '"><h2>' + esc(v.heading) + '</h2>' + (v.lead ? '<p>' + esc(v.lead) + '</p>' : '') + (items ? '<ul>' + items + '</ul>' : '') + (imgs ? '<div class="badges">' + imgs + '</div>' : '') + '</section>';
    }).join('');
    const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>' + esc(d.title) + '</title><script src="/markstage/preview-agent.js" data-cms="http://127.0.0.1:9"></script><style>' + css + '</style></head><body><div class="shell"><header>Fixture site</header><main>' + body + '</main><footer>Footer</footer></div></body></html>';
    return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
  }
  res.writeHead(404).end('not found');
}).listen(Number(process.argv[2]), '127.0.0.1');
`;

describe('the section gallery in a browser', { skip, timeout: 120_000 }, () => {
  let fx, app, browser, ctx, page, owner;
  const pass = () => `t-${crypto.randomBytes(12).toString('base64url')}`;
  const hash = () => decodeURIComponent(new URL(page.url()).hash);
  const cards = () => page.locator('.ms-gallery__item').evaluateAll((c) => c.map((x) => x.querySelector('h2').textContent));
  const item = (label) => page.locator('.ms-gallery__item', { has: page.locator('h2', { hasText: new RegExp(`^${label}$`) }) });
  const frameOf = (label, w) => item(label).locator(`iframe[width="${w}"]`);
  /** waits until the frame's section has said its height (the agent ran) and returns it */
  const settled = async (label, w) => {
    // frames load lazily: bring it on screen first
    await frameOf(label, w).scrollIntoViewIfNeeded();
    return frameOf(label, w).evaluate((f) => new Promise((r, no) => {
      const t = setInterval(() => f.style.height !== `${f.height}px` && (clearInterval(t), r(parseFloat(f.style.height))), 50);
      setTimeout(() => (clearInterval(t), no(new Error('the frame never said its height'))), 15000);
    }));
  };
  const shots = async (name, widths = [1440, 390]) => {
    if (!SHOTS) return;
    for (const w of widths) {
      await page.setViewportSize({ width: w, height: 1000 });
      for (const scheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(SHOTS, `gallery-${name}-${w}-${scheme}.png`) });
      }
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 1440, height: 1000 });
  };
  const open = async (where) => {
    await blank(page);
    await page.goto(`${BASE}/markstage/${where}`);
  };

  before(async () => {
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), SITE_CONFIG);
    for (const [id, d] of Object.entries(PAGES)) fs.writeFileSync(path.join(fx.site, `src/content/pages/${id}.json`), `${JSON.stringify(d, null, 2)}\n`);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Pages with sections');
    const editorDir = await buildEditor(path.join(fx.run, 'editor'), {
      api: '/markstage/api/',
      siteName: 'Test site',
      collections: [
        { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasUrl: true, titleKey: 'title' },
        { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', hasUrl: true, addressKey: 'uri' },
      ],
      compat: null,
      canvas: { articleClass: '', bodyClass: '' },
      themes: THEMES,
    });
    // the preview agent as the editor build emits it (npm run build:agent -w packages/editor)
    fs.copyFileSync(new URL('../../editor/dist/preview-agent.js', import.meta.url), path.join(editorDir, 'preview-agent.js'));
    const fake = path.join(fx.run, 'fake-dev.mjs');
    fs.writeFileSync(fake, FAKE_DEV);
    const config = loadConfig({
      env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' },
      overrides: {
        port: PORT,
        editorDir,
        collections: [],
        preview: { origin: `http://127.0.0.1:${PREVIEW_PORT}`, port: PREVIEW_PORT, ports: [PORT_BASE + 60, PORT_BASE + 68], command: [process.execPath, fake, '{port}'], settleFile: null, settleMs: 50 },
      },
    });
    app = await createMarkstage(config, { codec: fakeCodec });
    await app.listen(PORT, '127.0.0.1');
    app.backup.stop();
    owner = await addUser(app, { email: 'owner@example.test', name: 'Olive Owner', role: 'owner', password: pass() });
    browser = await pw.chromium.launch();
    ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await open('#/library');
    await page.getByLabel('Email').fill(owner.email);
    await page.getByLabel('Password', { exact: true }).fill(owner.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('searchbox', { name: 'Search the Library' }).waitFor();
  });
  after(async () => {
    await ctx?.close();
    await browser?.close();
    await app?.close();
  });

  test('from the Library: every type and variation, each drawn alone at 1440 and 390', async () => {
    await page.getByRole('link', { name: 'Section gallery' }).click();
    await page.waitForURL(/#\/gallery\/pages/);
    await page.locator('.ms-gallery__item').first().waitFor();
    assert.equal(hash(), '#/gallery/pages');
    assert.deepEqual(await cards(), ['Hero', 'Hero · tall', 'Cards', 'Cards · blue', 'CTA', 'Logos']);
    assert.equal(await page.locator('.ms-gallery__item iframe').count(), 12, 'two widths each');
    // drawn alone: the frame is as tall as its section, the site's header and footer hidden by the agent
    const h1440 = await settled('Cards · blue', 1440);
    const h390 = await settled('Cards · blue', 390);
    assert.ok(h1440 > 100 && h1440 < 900, `1440: ${h1440}`);
    assert.ok(h390 > h1440, `390 is taller (the cards stack): ${h390} vs ${h1440}`);
    const inside = item('Cards · blue').frameLocator('iframe[width="1440"]');
    await inside.locator('section.cards.blue h2', { hasText: 'What we do' }).waitFor();
    assert.equal(await inside.locator('header').isVisible(), false);
    assert.equal(await inside.locator('section').count(), 1, 'one section in the sample page');
    // where it comes from, with copy and open on its address; the page that has it, at that section
    const from = item('Cards · blue').locator('.ms-gallery__from');
    assert.match(await from.innerText(), /From “About”/);
    await from.locator('.ms-copyable').first().hover();
    await from.getByRole('button', { name: /Copy the address of About/ }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '/about/');
    assert.ok(await from.getByRole('link', { name: /Open the address of About/ }).count());
    assert.equal(await from.getByRole('link', { name: 'Edit it there' }).getAttribute('href'), '#/p/pages/about?sec=1');
    await shots('all', [1440]);
  });

  test('every picture in every sample has loaded by the time its frame says its height, lazy ones included', async () => {
    await open('#/gallery/pages');
    await page.locator('.ms-gallery__item').first().waitFor();
    let seen = 0;
    for (const label of await cards()) {
      for (const w of [1440, 390]) {
        await settled(label, w);
        const imgs = await item(label).frameLocator(`iframe[width="${w}"]`).locator('body').evaluate((b) => [...b.ownerDocument.images].map((i) => ({ alt: i.alt, w: i.naturalWidth })));
        assert.deepEqual(imgs.filter((i) => i.w === 0).map((i) => i.alt), [], `${label} at ${w}: pictures not loaded`);
        seen += imgs.length;
      }
    }
    assert.equal(seen, 12, 'the six badges, at both widths');
  });

  test('URL state: the width, the colours, the type, "Whole page"; a reload keeps them', async () => {
    await open('#/gallery/pages');
    await page.locator('.ms-gallery__item').first().waitFor();
    await page.getByRole('group', { name: 'Width' }).getByRole('button', { name: '390 px' }).click();
    await page.waitForURL(/w=390/);
    assert.equal(await page.locator('.ms-gallery__item iframe[width="1440"]').count(), 0);
    await page.getByRole('group', { name: 'Colours' }).getByRole('button', { name: 'Dark' }).click();
    await page.waitForURL(/theme=dark/);
    const hero = page.frameLocator('.ms-gallery__item:first-child iframe');
    await hero.locator('html[data-theme="dark"]').waitFor();
    await page.getByRole('group', { name: 'Type' }).getByRole('button', { name: 'Cards (2)' }).click();
    await page.waitForURL(/kind=cards/);
    assert.deepEqual(await cards(), ['Cards', 'Cards · blue']);
    // the whole page around one sample
    await page.locator('.ms-gallery__item', { hasText: 'Cards · blue' }).getByRole('button', { name: 'Whole page' }).click();
    await page.waitForURL(/whole=/);
    const key = new URLSearchParams(hash().split('?')[1]).get('whole');
    assert.match(key, /^[0-9a-f]{10}$/);
    assert.equal(new URLSearchParams(hash().split('?')[1]).get('s'), key);
    const whole = item('Cards · blue').frameLocator('iframe');
    await whole.locator('header').waitFor({ state: 'visible' });
    await page.reload();
    await page.locator('.ms-gallery__item.is-current').waitFor();
    assert.deepEqual(await cards(), ['Cards', 'Cards · blue']);
    assert.equal(await page.getByRole('group', { name: 'Colours' }).locator('[aria-pressed="true"]').textContent(), 'Dark');
    await item('Cards · blue').frameLocator('iframe').locator('html[data-theme="dark"]').waitFor();
    await item('Cards · blue').frameLocator('iframe').locator('header').waitFor({ state: 'visible' });
    await shots('cards-whole-dark', [1440]);
    await page.goBack();
    await page.waitForURL((u) => !u.hash.includes('whole='));
  });

  test('the content repo is untouched: no gallery page in it or its history; the clone has them', async () => {
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: fx.site, encoding: 'utf8' }), '');
    assert.equal(execFileSync('git', ['log', '--all', '--name-only', '--format='], { cwd: fx.site, encoding: 'utf8' }).includes('markstage-gallery'), false);
    assert.ok(fs.existsSync(path.join(app.preview.site.dir, 'src/content/pages/markstage-gallery-1.json')));
  });
});
