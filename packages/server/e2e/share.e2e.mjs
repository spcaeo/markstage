// A share link in a real browser with no account (releases/share.mjs): the link opens the release's preview on the
// share origin, the token leaves the address bar, the page waits while the preview is built and reloads itself, the
// site's own script runs there, and a link turned off says so (410) on the next load. Test users are made up here;
// the browser opened here is closed in `after`.
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { as } from '../test/helpers.mjs';
import { releaseServer } from '../test/release-site.mjs';
import { SHARE_PORT, SHOTS, pw, skip } from './support.mjs';

describe('a share link in a browser', { skip }, () => {
  let srv, shareOrigin, browser, page, ed, link, url;
  const shot = async (name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

  before(async () => {
    ({ srv, shareOrigin } = await releaseServer({ sharePort: SHARE_PORT }));
    ed = await as(srv, 'editor');
    const r = (await ed.post('/releases', { name: 'For the client' })).json;
    const v = (await ed.get('/collections/posts/entries/bob-draft')).json.version;
    assert.equal((await ed.post(`/releases/${r.id}/items`, { kind: 'entry', collection: 'posts', id: 'bob-draft', version: v })).status, 201);
    ({ link, url } = (await ed.post('/share-links', { release: r.id })).json);
    browser = await pw.chromium.launch();
    page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  });
  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  test('the link opens the preview without an account; it is built while the page waits, then shown with the site’s own script', async () => {
    const res = await page.goto(url);
    // the first look builds it: the page says so and reloads itself until it is ready
    assert.equal(res.status(), 503);
    await page.getByRole('heading', { name: 'Preparing this preview' }).waitFor();
    await shot('share-preparing');
    await page.getByText('A draft by Bob').waitFor({ timeout: 30_000 });
    assert.equal(new URL(page.url()).href, `${shareOrigin}/blog/bob-draft/`, 'the token left the address bar');
    assert.equal(await page.title(), 'Bob Draft');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.site), '1', 'the site’s script ran on the share origin');
    const again = await page.reload();
    assert.equal(again.headers()['x-robots-tag'], 'noindex, nofollow, noarchive');
    assert.equal(again.headers()['referrer-policy'], 'no-referrer');
    // the cookie is the link's, out of reach of the page's scripts
    assert.equal(await page.evaluate(() => document.cookie), '');
    await shot('share-preview');
    const views = srv.app.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'share.view' AND target = ?").get(link.id).n;
    assert.ok(views >= 2, `views audited: ${views}`);
  });

  test('turned off, the next load says so (410) and shows nothing of the site', async () => {
    assert.equal((await ed.del(`/share-links/${link.id}`)).json.link.state, 'revoked');
    const res = await page.reload();
    assert.equal(res.status(), 410);
    await page.getByRole('heading', { name: 'This link was turned off' }).waitFor();
    assert.equal(await page.getByText('A draft by Bob').count(), 0);
    await shot('share-revoked');
  });
});
