// The admin screens in a real browser, against a real server on 127.0.0.1 (the editor built with build-editor.mjs
// and served as its editorDir), with test users made up here. Every screen is driven the way a person would, and
// every state is checked to be in the URL: reload and Back give it back.
//
//   npm run test:e2e -w packages/server        (part of `npm test`; e2e/run.mjs)
//
// Playwright comes from the repo's root devDependencies (or MARKSTAGE_PLAYWRIGHT=/path/to/node_modules/playwright).
// Without it, the tests are skipped and run.mjs prints a loud "SKIPPED: e2e" line.
// Ports: MARKSTAGE_E2E_PORT_BASE (default 18231) is the server; the others are offsets from it (the preview +4, the
// stock stand-in +6, the redirects server +8, its live site +10, the preview's dev servers +16 to +68). Two runs at
// once need two bases. A port in use fails the run, naming it; it never skips.
// Screenshots go to MARKSTAGE_E2E_SHOTS when it is set.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { base32Decode, stepAt, totpAt } from '../src/auth/totp.mjs';
import { loadSharpCodec } from '../src/media/codec.mjs';
import { STOCK_KEY, colorPng, fakeUnsplash } from '../test/fake-stock.mjs';
import { addUser, client, fakeCodec, makeFixture } from '../test/helpers.mjs';
import { localeSite } from '../test/locale-site.mjs';
import { readMessage, smtpSink } from '../test/smtp-sink.mjs';
import { buildEditor } from './build-editor.mjs';
import { BASE, DEV_PORTS, FAKE_DEV, HEALTH_HOOK, LIVE_PORT, PORT, PREVIEW_PORT, REDIR_PORT, SHOTS, STOCK_PORT, pw, skip } from './support.mjs';


describe('admin screens in a browser', { skip }, () => {
  let fx, app, browser, ctx, page, owner, stock, editorDir, mail;
  const pass = () => `t-${crypto.randomBytes(12).toString('base64url')}`;
  const hash = () => decodeURIComponent(new URL(page.url()).hash);
  const shot = async (name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
  const code = (secret) => totpAt(secret, stepAt(Date.now()));

  before(async () => {
    fx = makeFixture({ checks: false });
    editorDir = await buildEditor(path.join(fx.run, 'editor'), {
      api: '/markstage/api/',
      siteName: 'Test site',
      collections: [
        { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasUrl: true, titleKey: 'title' },
        { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', hasUrl: true },
      ],
      compat: null,
      canvas: { articleClass: '', bodyClass: '' },
    });
    // the preview agent as the editor build emits it (npm run build:agent -w packages/editor)
    fs.copyFileSync(new URL('../../editor/dist/preview-agent.js', import.meta.url), path.join(editorDir, 'preview-agent.js'));
    const fake = path.join(fx.run, 'fake-dev.mjs');
    fs.writeFileSync(fake, FAKE_DEV);
    // the site's health hook (what the host serves): the build's pages, one redirect chain, one broken address
    const healthHook = path.join(fx.run, 'health-hook.mjs');
    fs.writeFileSync(healthHook, HEALTH_HOOK);
    stock = await fakeUnsplash({ port: STOCK_PORT });
    // alert mail goes to a local SMTP sink (an odd free port from 18301; plain SMTP is allowed to loopback in tests)
    mail = await smtpSink();
    const config = loadConfig({
      env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' },
      overrides: {
        port: PORT,
        editorDir,
        media: { maxBytes: 2 * 1024 * 1024 },
        preview: { origin: `http://127.0.0.1:${PREVIEW_PORT}`, port: PREVIEW_PORT, ports: DEV_PORTS, command: [process.execPath, fake, '{port}'], settleFile: null, settleMs: 50 },
        stock: { provider: 'unsplash', key: STOCK_KEY, apiBase: stock.base, imageHosts: [stock.host] },
        backup: { dir: path.join(fx.run, 'backups'), keep: 3 },
        notify: { email: { host: '127.0.0.1', port: mail.port, security: 'none', from: 'Markstage <cms@example.test>', to: ['ops@example.test'] } },
        health: { command: [process.execPath, healthHook] },
      },
    });
    // real image processing when sharp is installed (the screenshots then show real pictures)
    app = await createMarkstage(config, { codec: (await loadSharpCodec()) ?? fakeCodec });
    await app.listen(PORT, '127.0.0.1');
    // no backup on its own clock (the catch-up one runs 30 s after start): the screens show "None yet" until the
    // backups test runs one with Back up now, however long the tests before it take
    app.backup.stop();
    owner = await addUser(app, { email: 'owner@example.test', name: 'Olive Owner', role: 'owner', password: pass() });
    browser = await pw.chromium.launch();
    ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
  });
  after(async () => {
    await browser?.close();
    await app?.close();
    stock?.close();
    await mail?.close();
  });

  test('sign-in: a page without a session goes to sign-in, a wrong password is refused, then it lands where it was going', async () => {
    await page.goto(`${BASE}/markstage/#/users?role=owner`);
    await page.waitForURL(/#\/sign-in\?next=/);
    assert.equal(new URL(page.url()).hash, `#/sign-in?next=${encodeURIComponent('#/users?role=owner')}`);
    await page.getByLabel('Email').fill(owner.email);
    await page.getByLabel('Password', { exact: true }).fill('not-the-password-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByText('Wrong email or password.').waitFor();
    await shot('01-sign-in-wrong');
    await page.getByLabel('Password', { exact: true }).fill(owner.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/#\/users\?role=owner$/);
    await page.getByRole('cell', { name: /Olive Owner/ }).waitFor();
    await shot('02-users');
  });

  let invited;
  test('users: invite (one-time code), filters and the open person are all in the URL; reload and Back keep them', async () => {
    // the owner alone: a second administrator is recommended, one click to invite one
    await page.getByText('Only you can manage users here.').waitFor();
    await shot('02b-users-alone');
    await page.getByRole('button', { name: 'Invite an administrator' }).click();
    await page.waitForURL(/action=invite&as=administrator/);
    assert.equal(await page.locator('.ms-adm-drawer').getByLabel('Role', { exact: true }).inputValue(), 'administrator');
    await page.keyboard.press('Escape');
    await page.waitForURL((u) => !u.hash.includes('action='));
    await page.getByRole('button', { name: 'Invite someone' }).click();
    await page.waitForURL(/action=invite/);
    const d = page.locator('.ms-adm-drawer');
    await d.getByLabel('Name', { exact: true }).fill('Arun Author');
    await d.getByLabel('Email', { exact: true }).fill('arun@example.test');
    await d.getByLabel('Role', { exact: true }).selectOption('author');
    await d.getByLabel('Author (optional)').fill('arun');
    await d.getByRole('button', { name: 'Create the invitation' }).click();
    const secret = page.locator('.ms-adm-secret');
    await secret.waitFor();
    const setupCode = (await secret.locator('.ms-copyable__text').first().textContent()).trim();
    assert.match(setupCode, /\S{8,}/);
    assert.ok(!page.url().includes(setupCode), 'the code is never in the URL');
    await shot('03-invite-code');
    // the copy button on the code: green tick, clipboard holds the code
    await secret.locator('.ms-copyable').first().hover();
    await secret.getByRole('button', { name: 'Copy setup code' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), setupCode);
    invited = { email: 'arun@example.test', setupCode };

    await page.getByRole('button', { name: 'Open their profile' }).click();
    await page.waitForURL(/user=u_/);
    const uid = new URL(page.url()).hash.match(/user=(u_[^&]+)/)[1];
    await page.getByRole('button', { name: 'Clear filters' }).isVisible().catch(() => false);
    await page.getByRole('group', { name: 'Role' }).getByRole('button', { name: 'Author' }).click();
    await page.waitForURL(/role=author/);
    assert.equal(await page.locator('tbody tr').count(), 1);
    await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Invited' }).click();
    await page.waitForURL(/status=invited/);
    // the whole state survives a reload
    await page.reload();
    await page.locator('.ms-adm-drawer h2', { hasText: 'Arun Author' }).waitFor();
    assert.match(hash(), /role=author/);
    assert.match(hash(), /status=invited/);
    assert.match(hash(), new RegExp(`user=${uid}`));
    await shot('04-user-drawer');
    // Back undoes the last filter
    await page.goBack();
    await page.waitForURL((u) => !/status=invited/.test(u.hash));
    // Escape closes the drawer and takes the person out of the URL
    await page.locator('.ms-adm-drawer').focus();
    await page.keyboard.press('Escape');
    await page.waitForURL((u) => !/user=/.test(u.hash));
  });

  test('accept-invite: the invited person sets a password and is signed in; their role cannot open Users', async () => {
    const other = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const p2 = await other.newPage();
    await p2.goto(`${BASE}/markstage/#/accept-invite`);
    await p2.getByLabel('Email').fill(invited.email);
    await p2.getByLabel('Setup code').fill(invited.setupCode);
    await p2.getByLabel('New password').fill('short');
    await p2.getByLabel('Confirm password').fill('short');
    await p2.getByRole('button', { name: 'Set password and sign in' }).click();
    assert.match(await p2.locator('[data-err="password"]').textContent(), /\S/);
    invited.password = pass();
    await p2.getByLabel('New password').fill(invited.password);
    await p2.getByLabel('Confirm password').fill(invited.password);
    // signing in starts the editor again (a reload): wait for it, so the next goto does not run into it
    await Promise.all([p2.waitForEvent('load'), p2.getByRole('button', { name: 'Set password and sign in' }).click()]);
    await p2.waitForURL(/#\/$/);
    await p2.goto(`${BASE}/markstage/#/users`);
    await p2.getByText('Not available to you').waitFor();
    // a filter in the address does not draw the list over it (it did, once the page had loaded)
    await p2.goto(`${BASE}/markstage/#/users?role=owner`);
    await p2.getByText('Not available to you').waitFor();
    assert.equal(await p2.getByText('Nobody matches').count(), 0);
    assert.equal(await p2.locator('table').count(), 0);
    if (SHOTS) await p2.screenshot({ path: path.join(SHOTS, '05-author-denied.png') });
    await other.close();
  });

  let recovery;
  test('account: two-step sign-in with a QR the app can read; recovery codes shown once; sign-in then asks for a code', async () => {
    await page.goto(`${BASE}/markstage/#/account?tab=2fa`);
    await page.getByText('Off.').waitFor();
    await page.getByLabel('Password', { exact: true }).fill(owner.password);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForURL(/step=scan/);
    await page.locator('.ms-adm-qr svg').waitFor();
    const key = (await page.locator('.ms-adm-2fa .ms-copyable__text').textContent()).replace(/\s/g, '');
    assert.equal(base32Decode(key).length, 20);
    assert.ok(!page.url().includes(key));
    await shot('06-2fa-qr');
    await page.getByLabel('The code your app shows').fill(code(key));
    await page.getByRole('button', { name: 'Turn on' }).click();
    await page.getByText('Two-step sign-in is on.').waitFor();
    recovery = (await page.locator('.ms-adm-secret .ms-copyable__text').allTextContents()).map((s) => s.trim());
    assert.equal(recovery.length, 10);
    await shot('07-recovery-codes');

    // sessions: this browser is marked
    await page.goto(`${BASE}/markstage/#/account?tab=sessions`);
    await page.getByText('This browser').waitFor();

    await page.goto(`${BASE}/markstage/#/account`);
    // what the server runs, copyable: the release line (docs/RELEASES.md), and the same line in the footer
    await page.getByText(/^v\d+\.\d+\.\d+ · build \d+ · \w{3} \d{1,2}, \d{4} \d{1,2}:\d{2} [AP]M \S+ \([0-9a-f]{12}\)$/).waitFor();
    // the footer line, once: the drawer's foot beside an open drawer, else the screen's own (import.e2e.mjs walks them)
    await page.locator('.ms-release:visible').filter({ hasText: /^v\d+\.\d+\.\d+ · build \d+ · / }).waitFor();
    assert.equal(await page.locator('.ms-release:visible').count(), 1);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL(/#\/sign-in/);
    await page.getByLabel('Email').fill(owner.email);
    await page.getByLabel('Password', { exact: true }).fill(owner.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/step=code/);
    await page.getByRole('button', { name: 'Use a recovery code' }).click();
    await page.waitForURL(/with=recovery/);
    await page.getByLabel('Recovery code').fill(recovery[0]);
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Verify' }).click()]);
    await page.waitForURL(/#\/$/);
    owner.totp = key;
  });

  test('audit log: filtered by kind, the record opens in the drawer with its values copyable; paging and filters are URLs', async () => {
    await page.goto(`${BASE}/markstage/#/audit?action=auth.`);
    await page.getByRole('cell', { name: 'Signed in' }).first().waitFor();
    // a user id in "On" reads as the person's name
    await page.getByRole('cell', { name: 'Olive Owner' }).first().waitFor();
    assert.equal(await page.getByRole('cell', { name: /^u_/ }).count(), 0);
    await page.getByRole('link', { name: 'Turned on two-step sign-in' }).click();
    await page.waitForURL(/item=\d+/);
    await page.locator('.ms-adm-drawer').getByRole('button', { name: 'Copy IP address' }).waitFor({ state: 'attached' });
    await shot('08-audit');
    await page.reload();
    await page.locator('.ms-adm-drawer h2', { hasText: 'Turned on two-step sign-in' }).waitFor();
    // a refused request shows as refused
    await page.goto(`${BASE}/markstage/#/audit?action=auth.login.fail`);
    await page.getByRole('cell', { name: /Sign-in failed/ }).first().waitFor();
  });

  test('media: upload, alt text, where it is used, filters, delete', async () => {
    await page.goto(`${BASE}/markstage/#/media`);
    await page.getByText('No images yet').waitFor();
    const file = path.join(fx.run, 'tiny.png');
    fs.writeFileSync(file, colorPng(360, 240));
    await page.locator('.ms-adm input[type=file]').setInputFiles(file);
    await page.waitForURL(/item=m_/);
    await page.locator('.ms-adm-drawer h2', { hasText: 'tiny' }).waitFor();
    await page.locator('.ms-adm-drawer').getByLabel('Alt text', { exact: true }).fill('A tiny test square');
    await page.getByRole('button', { name: 'Save alt text' }).click();
    await page.getByText('Alt text saved.').waitFor();
    assert.equal(await page.locator('.ms-adm-grid .ms-adm-badge').count(), 0, 'the tile drops its "No alt text" badge');
    await page.getByText('Not used in any entry.').waitFor();
    await shot('09-media');
    await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Without alt text' }).click();
    await page.waitForURL(/show=no-alt/);
    await page.getByText('Nothing matches').waitFor();
    await page.goBack();
    await page.locator('.ms-adm-drawer').getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await page.getByText(/^Deleted tiny/).waitFor();
    await page.waitForURL((u) => !/item=/.test(u.hash));

    // a PDF: a document tile, a Download in place of the picture, no alt text or crop
    const pdf = path.join(fx.run, 'price-list.pdf');
    fs.writeFileSync(pdf, '%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
    await page.locator('.ms-adm input[type=file]').first().setInputFiles(pdf);
    await page.waitForURL(/item=m_/);
    const d = page.locator('.ms-adm-drawer');
    await d.getByRole('link', { name: 'Download' }).waitFor();
    assert.equal(await d.getByLabel('Alt text', { exact: true }).count(), 0);
    assert.equal(await d.getByRole('button', { name: 'Edit image' }).count(), 0);
    await page.locator('.ms-adm-tile', { hasText: 'price-list.pdf' }).getByText('PDF', { exact: true }).waitFor();
    await shot('09b-media-pdf');
    await d.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await page.getByText(/^Deleted price-list/).waitFor();
  });

  // the API client signs in like the browser: password, then (2FA is on now) a recovery code
  let api;
  const signedInApi = async () => {
    if (api) return api;
    api = client(BASE);
    const first = await api.post('/auth/login', { email: owner.email, password: owner.password });
    assert.equal((await api.post('/auth/login/2fa', { challenge: first.json.challenge, recoveryCode: recovery[1] })).status, 200);
    return api;
  };
  const source = async (id) => (await api.get(`/collections/posts/entries/${id}/source`)).json;

  test('publish sheet: where, what changes, checks (alt text, links, the phone), now or later; the job runs in place and ends with the live address', async () => {
    await signedInApi();
    // an image without alt text and a link to someone else's draft
    const s = await source('bob-draft');
    const text = `${s.source.trimEnd()}\n\n<p><img src="/uploads/team.png"> See also <a href="/blog/carol-draft/">Carol's notes</a>.</p>\n`;
    assert.equal((await api.put('/collections/posts/entries/bob-draft/source', { version: s.version, source: text })).status, 200);
    // a saved change to another live page: this publish takes it live too, and the sheet says so (the images
    // uploaded and deleted again above change nothing live, so they are not counted)
    const w = await source('with-html');
    assert.equal((await api.put('/collections/posts/entries/with-html/source', { version: w.version, source: w.source.replace('Intro.', 'Intro, updated.') })).status, 200);

    await page.goto(`${BASE}/markstage/#/publish/posts/bob-draft`);
    await page.getByText('Draft', { exact: true }).waitFor();
    await page.getByText('First publish from Markstage.').waitFor();
    await page.locator('.ms-adm-also').getByRole('link', { name: '“With HTML”' }).waitFor();
    assert.match(await page.locator('section[aria-label="What changes"]').textContent(), /It also puts live 1 other saved change saved here and not published yet:“With HTML” · Olive Owner, just now$/);
    await page.getByText('1 image without a description: blocks publishing').waitFor();
    await page.locator('.ms-adm-pf', { hasText: 'Links' }).getByRole('link', { name: '“Carol Draft”' }).waitFor();
    // the phone: the real preview, framed at 390 px and measured by the preview agent
    const phoneRow = page.locator('.ms-adm-pf', { hasText: 'On a phone' });
    await phoneRow.getByText(/problems? at 390 px/).waitFor({ timeout: 60_000 });
    await phoneRow.getByText(/Wider than the screen/).first().waitFor();
    assert.equal(await page.locator('.ms-adm-phone iframe').getAttribute('width'), '390');
    // the address's copy and open show without hovering (owner rule, and prominent here)
    await page.locator('.ms-adm-addresses').getByRole('button', { name: 'Copy the page address' }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('.ms-adm-addresses .ms-copyable__tools').first().evaluate((x) => getComputedStyle(x).opacity), '1');
    // no engine words for writers: the post-build checks are named, not configured keys
    assert.doesNotMatch(await page.locator('.ms-adm-pflist').textContent(), /preview\.origin|MARKSTAGE_/);
    await shot('11-publish-sheet');
    // the publish rules (docs/SEO.md): a missing description and a link to a draft stop the publish, here and on the server
    assert.equal(await page.getByRole('button', { name: 'Publish now' }).isDisabled(), true);
    await page.getByText('A check above blocks publishing.').waitFor();
    assert.equal((await api.post('/collections/posts/entries/bob-draft/publish', { version: (await source('bob-draft')).version })).status, 422);
    // fixed in the text, then checked again: the button comes back
    const b = await source('bob-draft');
    const fixed = b.source.replace('<img src="/uploads/team.png">', '<img src="/uploads/team.png" alt="The team">').replace('/blog/carol-draft/', '/blog/hello-world/');
    assert.equal((await api.put('/collections/posts/entries/bob-draft/source', { version: b.version, source: fixed })).status, 200);
    await page.getByRole('button', { name: 'Run again' }).click();
    await page.getByText('Every image is described').waitFor();
    await page.getByText('Every link inside the site goes to a live page').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Publish now' }).isDisabled(), false);

    // later: a time in the writer's zone; the choice is in the URL
    await page.getByRole('group', { name: 'When' }).getByRole('button', { name: 'Later' }).click();
    await page.waitForURL(/when=later/);
    await page.getByLabel('Publish at').waitFor();
    await page.goBack();
    await page.getByRole('button', { name: 'Publish now' }).click();
    await page.waitForURL(/job=j_/);
    await page.getByRole('heading', { name: 'It is live' }).waitFor({ timeout: 30_000 });
    // the steps are what writers see; the engine's log is folded away, and no second "Done" bar
    assert.equal(await page.locator('.ms-adm-outcome').isVisible(), false);
    const details = page.locator('details.ms-adm-details');
    assert.equal(await details.evaluate((d) => d.open), false);
    assert.equal(await page.locator('.ms-adm-log').isVisible(), false);
    assert.match(await page.locator('.ms-adm-log').textContent(), /deployed/);
    // the live address: copy and open
    const live = page.locator('.ms-adm-live');
    await live.getByRole('button', { name: 'Copy the page address' }).click();
    // the fixture site has no address of its own: the path is copied, and opens on this host
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '/blog/bob-draft/');
    // ...with the publish job's id as a cache-buster, so the first click never shows a cached copy
    const jobId = new URL(page.url()).hash.match(/job=(j_[\w-]+)/)[1];
    assert.equal(await live.getByRole('link', { name: /Open the page address/ }).getAttribute('href'), `${BASE}/blog/bob-draft/?v=${jobId}`);
    await shot('12-publish-live');
    await details.locator('summary').click();
    await page.getByRole('button', { name: 'Copy the log' }).click();
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /== deploy ==[\s\S]*deployed/);
    const jid = new URL(page.url()).hash.match(/job=(j_[\w-]+)/)[1];
    // a reload keeps the finished job on the sheet
    await page.reload();
    await page.getByRole('heading', { name: 'It is live' }).waitFor();
    // a notice for the owner, as the scheduler leaves one when a scheduled entry is held back (the owner's earlier ones,
    // sign-ins from new browsers and invites, are marked seen: this step is about this one)
    app.db.prepare("UPDATE notices SET seen_at = ? WHERE user_id = ? AND seen_at IS NULL").run(new Date().toISOString(), owner.id);
    app.notices.tell({ kind: 'schedule.held', level: 'warn', text: '“Carol Draft” was due at 09:00 but is held: 1 image without a description. It stays scheduled and goes live on the next run once that is fixed; an editor can also publish it anyway.', link: '#/publish/posts/carol-draft', to: [owner.id] });
    await page.getByRole('button', { name: 'All publishing' }).click();
    await page.getByRole('link', { name: 'Publish' }).first().waitFor();
    const forYou = page.locator('section[aria-label="For you"]');
    await forYou.getByText('“Carol Draft” was due at 09:00').waitFor();
    assert.equal(await forYou.getByRole('link', { name: 'Open' }).getAttribute('href'), '#/publish/posts/carol-draft');
    await shot('13-jobs');
    await forYou.getByRole('button', { name: 'Seen' }).click();
    await forYou.waitFor({ state: 'detached' });
    await page.reload();
    await page.getByRole('link', { name: 'Publish' }).first().waitFor();
    assert.equal(await page.locator('section[aria-label="For you"]').count(), 0, 'seen stays seen');
    // one job on its own: named by the entry's title, and where it is live
    await page.goto(`${BASE}/markstage/#/jobs/${jid}`);
    await page.locator('h1.ms-adm-title', { hasText: 'Publish “Bob Draft”' }).waitFor();
    await page.locator('.ms-adm-live').getByRole('button', { name: 'Copy the page address' }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('.ms-adm-log').isVisible(), false);
    // no public address (the fixture has no siteUrl): no outside testers, they could not reach it
    assert.equal(await page.locator('.ms-adm-testers').count(), 0);
    await shot('13b-job');
    // with the site's public address: Google's and the social debuggers, for that address, in a new tab
    const pub = 'https://site.example.test/blog/bob-draft/';
    await page.route('**/entries/bob-draft/addresses', async (r) => {
      const res = await r.fetch();
      const body = await res.json();
      await r.fulfill({ response: res, json: { ...body, addresses: body.addresses.map((a) => ({ ...a, url: pub })) } });
    });
    await page.reload();
    const t = page.locator('.ms-adm-testers');
    await t.waitFor();
    assert.equal(await t.getByRole('link', { name: 'Test in Google' }).getAttribute('href'), `https://search.google.com/test/rich-results?url=${encodeURIComponent(pub)}`);
    assert.equal(await t.getByRole('link', { name: 'Refresh on LinkedIn' }).getAttribute('href'), `https://www.linkedin.com/post-inspector/inspect/${encodeURIComponent(pub)}`);
    assert.equal(await t.getByRole('link', { name: 'Refresh on Facebook' }).getAttribute('target'), '_blank');
    await shot('13c-job-testers');
    await page.unroute('**/entries/bob-draft/addresses');
  });

  test('held: a scheduled entry the publish rules stop when due stays scheduled, says why, alerts by mail; an editor publishes it anyway', async () => {
    await signedInApi();
    const c = await source('carol-draft');
    const sched = await api.post('/collections/posts/entries/carol-draft/schedule', { version: c.version, publishAt: new Date(Date.now() + 3_600_000).toISOString() });
    assert.equal(sched.status, 200, sched.text);
    const c2 = await source('carol-draft');
    const clean = c2.source;
    assert.equal((await api.put('/collections/posts/entries/carol-draft/source', { version: c2.version, source: `${clean.trimEnd()}\n\n<p><img src="/uploads/held.png"></p>\n` })).status, 200);
    // the scheduler's run when it falls due (its clock moved on two hours)
    const mails = mail.messages.length;
    assert.ok(app.scheduler.tick(Date.now() + 2 * 3_600_000));
    await app.jobs.idle();
    await page.goto(`${BASE}/markstage/#/publish/posts/carol-draft`);
    await page.getByText('Scheduled, held', { exact: true }).waitFor();
    await page.getByText(/held: 1 image without a description\. It goes live on the next scheduler run once that is fixed, or publish it anyway below\./).waitFor();
    for (let i = 0; i < 100 && mail.messages.length === mails; i++) await new Promise((r) => setTimeout(r, 50));
    assert.match(readMessage(mail.messages.at(-1).data).headers.subject, /^Markstage: “Carol Draft” was due at .* but is held: 1 image without a description\.$/);
    await page.getByRole('button', { name: 'Publish anyway…' }).waitFor();
    await shot('12b-publish-held');
    await page.getByRole('button', { name: 'Publish anyway…' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Publish anyway' }).click();
    await page.getByRole('heading', { name: 'It is live' }).waitFor();
    const e = (await api.get('/collections/posts/entries/carol-draft')).json;
    assert.equal(e.status, 'published');
    assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'entry.publish.anyway'").get().n, 1);
    // back as it was for the tests after: a draft without that image
    assert.equal((await api.post('/collections/posts/entries/carol-draft/unpublish', { version: e.version })).status, 202);
    await app.jobs.idle();
    const c3 = await source('carol-draft');
    assert.equal((await api.put('/collections/posts/entries/carol-draft/source', { version: c3.version, source: c3.source.replace('\n\n<p><img src="/uploads/held.png"></p>', '') })).status, 200);
    assert.equal((await api.post('/notices/seen', {})).status, 200, 'its notice is read: later screens start clean');
  });

  test('history: live, your autosaves and saved versions; side by side as the site draws it; one block or one setting put back on its own', async () => {
    let s = await source('hello-world');
    // a saved edit: one sentence rewritten, one paragraph added, the excerpt changed
    const edited = s.source
      .replace('The first post.', 'The very first post.')
      .replace('Second paragraph.', 'Second paragraph, rewritten with care.')
      .concat('\nA new closing line.\n');
    assert.equal((await api.put('/collections/posts/entries/hello-world/source', { version: s.version, source: edited })).status, 200);
    s = await source('hello-world');
    // and an autosave on top (never saved)
    assert.equal((await api.put('/collections/posts/entries/hello-world/autosave', { baseVersion: s.version, source: s.source.replace('First paragraph.', 'First paragraph, still a draft.') })).status, 200);

    await page.goto(`${BASE}/markstage/#/revisions/posts/hello-world`);
    await page.locator('.ms-adm-sbs').waitFor();
    await page.getByRole('heading', { name: 'Your autosaves' }).waitFor();
    await page.locator('del.ms-adm-sbs__w', { hasText: 'Second' }).or(page.locator('ins.ms-adm-sbs__w', { hasText: 'rewritten' })).first().waitFor();
    await page.locator('ins.ms-adm-sbs__w', { hasText: 'rewritten' }).waitFor();
    await page.locator('.ms-adm-sbs__cell--b.is-ins', { hasText: 'A new closing line.' }).waitFor();
    // settings by their names, not their keys; versions by who did what, the commit in the details
    await page.locator('.ms-adm-fields th', { hasText: /^Excerpt$/ }).waitFor();
    await page.locator('.ms-adm-revside').getByText(/edited Hello World$/).first().waitFor();
    assert.doesNotMatch(await page.locator('.ms-adm-revside').textContent(), /Update posts\/|Fixture site/);
    assert.equal(await page.locator('.ms-adm-revdetails').evaluate((d) => d.open), false);
    await shot('14-history-side-by-side');

    // put back only the rewritten sentence: the added line and the new excerpt stay
    await page.getByRole('button', { name: /^Restore this block \(changed block/ }).click();
    await page.getByText(/Restore this block: done/).waitFor();
    let now = (await source('hello-world')).source;
    assert.match(now, /\nSecond paragraph\.\n/);
    assert.match(now, /A new closing line\./);
    assert.match(now, /The very first post\./);
    // then only the excerpt
    await page.locator('.ms-adm-fields tr', { hasText: 'Excerpt' }).getByRole('button', { name: 'Restore' }).click();
    await page.getByText(/Restore Excerpt: done/).waitFor();
    now = (await source('hello-world')).source;
    assert.match(now, /excerpt: The first post\./);
    assert.match(now, /A new closing line\./);

    // the autosave: only its author sees it, and it can be restored whole
    await page.locator('.ms-adm-revside').getByRole('link', { name: /Autosave,/ }).click();
    await page.waitForURL((u) => decodeURIComponent(u.hash).includes('sha=autosave:as_'));
    // the autosave is on the left: what only it has shows as taken out on the way to now
    await page.locator('.ms-adm-sbs__cell--a del.ms-adm-sbs__w', { hasText: 'draft' }).waitFor();
    await shot('15-history-autosave');
    await page.getByRole('group', { name: 'How to show it' }).getByRole('button', { name: 'Text changes' }).click();
    await page.waitForURL(/view=text/);
    await page.locator('.ms-adm-cmp del', { hasText: 'draft' }).waitFor();
    await page.goBack();
    await page.locator('.ms-adm-sbs').waitFor();
    await page.getByRole('button', { name: 'Restore this autosave' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Restore' }).click();
    await page.getByText('Restored. It is a new revision now.').waitFor();
    assert.match((await source('hello-world')).source, /First paragraph, still a draft\./);

    // what is live: the version the last publish built
    await page.goto(`${BASE}/markstage/#/revisions/posts/hello-world?sha=live`);
    await page.getByRole('heading', { name: 'Live on the site' }).waitFor();
    await page.locator('.ms-adm-sbs__cell--b.is-ins', { hasText: 'A new closing line.' }).waitFor();
    await shot('16-history-live');
  });

  test('media: an edit (rotate) is saved as a new image and the original stays; stock photos are searched and added with their credit', async () => {
    await page.goto(`${BASE}/markstage/#/media`);
    const file = path.join(fx.run, 'harbour.png');
    fs.writeFileSync(file, colorPng(480, 300, [30, 80, 140], [230, 200, 120]));
    await page.locator('.ms-adm input[type=file]').setInputFiles(file);
    await page.waitForURL(/item=m_/);
    const orig = new URL(page.url()).hash.match(/item=(m_[^&]+)/)[1];
    await page.locator('.ms-adm-drawer').getByLabel('Alt text', { exact: true }).fill('A harbour at dusk');
    await page.getByRole('button', { name: 'Save alt text' }).click();
    await page.getByText('Alt text saved.').waitFor();
    await page.locator('.ms-adm-drawer').getByRole('button', { name: 'Edit image' }).click();
    const dialog = page.getByRole('dialog', { name: 'Crop and rotate' });
    await dialog.getByRole('button', { name: 'Rotate right' }).click();
    await dialog.getByRole('button', { name: 'Save as a new image' }).click();
    await page.getByText('Saved as a new image. The original is kept.').waitFor();
    await page.waitForURL((u) => /item=m_/.test(u.hash) && !u.hash.includes(orig));
    const drawer = page.locator('.ms-adm-drawer');
    await drawer.getByRole('link', { name: 'the original image' }).waitFor();
    assert.equal(await drawer.getByLabel('Alt text', { exact: true }).inputValue(), 'A harbour at dusk', 'the alt text comes along');
    const rotated = await drawer.locator('figure img').evaluate((img) => [img.naturalWidth, img.naturalHeight]);
    assert.deepEqual(rotated, [300, 480], 'turned a quarter');
    await shot('17-media-edited');
    await drawer.getByRole('link', { name: 'the original image' }).click();
    await page.waitForURL(new RegExp(`item=${orig}`));
    await drawer.getByText('Edits (1)').waitFor();
    assert.deepEqual(await drawer.locator('figure img').evaluate((img) => [img.naturalWidth, img.naturalHeight]), [480, 300], 'the original is untouched');

    // stock photos: a filter of the library, searched through the server
    await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Unsplash photos' }).click();
    await page.waitForURL(/show=stock/);
    await page.getByText('Search Unsplash', { exact: true }).waitFor();
    await page.getByRole('searchbox', { name: 'Search Unsplash' }).fill('harbour');
    await page.waitForURL(/q=harbour/);
    await page.getByText('3 photos on Unsplash for “harbour”').waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.ms-adm-grid--stock img')].every((i) => i.complete && i.naturalWidth > 0));
    assert.ok(!(await page.content()).includes(STOCK_KEY), 'the key stays on the server');
    await shot('18-stock-search');
    await page.locator('.ms-adm-grid--stock li').nth(1).getByRole('button', { name: 'Add to the library' }).click();
    await page.getByText('Added, with the credit to Ada Lens.').waitFor();
    await page.waitForURL((u) => /item=m_/.test(u.hash) && !/show=stock/.test(u.hash));
    await drawer.getByText('Ada Lens on Unsplash').waitFor();
    assert.equal(await drawer.getByLabel('Alt text', { exact: true }).inputValue(), 'photo p2');
    await shot('19-stock-added');
    assert.equal(stock.seen.tracked, 1, 'the download was counted for the photographer');

    // replace everywhere: the original goes into a draft, then a new upload takes its place in every entry
    await signedInApi();
    const o = (await api.get(`/media/${orig}`)).json;
    const c = await source('carol-draft');
    assert.equal((await api.put('/collections/posts/entries/carol-draft/source', { version: c.version, source: `${c.source.trimEnd()}\n\n<p><img src="${o.url}" alt="Harbour"></p>\n` })).status, 200);
    await page.goto(`${BASE}/markstage/#/media?item=${orig}`);
    await drawer.getByText('Used in 1 entry').waitFor();
    const fresh = path.join(fx.run, 'harbour-2026.png');
    fs.writeFileSync(fresh, colorPng(480, 300));
    await drawer.getByLabel('The new image').setInputFiles(fresh);
    // the plan has its own URL: each entry with its title (copyable), how many uses, its address (copy and open)
    await page.waitForURL(new RegExp(`item=${orig}&replace=m_`));
    const plan = drawer.locator('tr', { hasText: 'Carol Draft' });
    await plan.getByRole('button', { name: 'Copy title' }).waitFor({ state: 'attached' });
    await plan.getByText('/blog/carol-draft/').waitFor();
    await plan.getByRole('link', { name: 'Open address in a new tab' }).waitFor({ state: 'attached' });
    assert.equal(await plan.locator('td').nth(1).textContent(), '1');
    await drawer.getByText(/^1 use in 1 entry\. The old image stays in the library/).waitFor();
    await shot('19b-replace-everywhere');
    await page.reload();
    await drawer.locator('tr', { hasText: 'Carol Draft' }).waitFor();
    await drawer.getByRole('button', { name: 'Replace everywhere' }).click();
    const toast = page.locator('.ms-toast', { hasText: 'Replaced in 1 entry.' });
    await toast.waitFor();
    await page.locator('.ms-adm-drawer h2', { hasText: 'harbour-2026' }).waitFor();
    await drawer.getByText('Used in 1 entry').waitFor();
    assert.ok(!(await source('carol-draft')).source.includes(o.url), 'the old address is gone from the entry');
    // Undo on the toast puts the old image back in that one commit
    await toast.getByRole('button', { name: 'Undo' }).click();
    await page.locator('.ms-toast', { hasText: 'Undone in 1 entry.' }).waitFor();
    await shot('19c-replace-undone');
    assert.ok((await source('carol-draft')).source.includes(o.url), 'the old image is back');
  });

  test('site health: what needs a look per live page, filters in the URL, the last deploy, speed off without a key, CSV downloads', async () => {
    await signedInApi();
    // a live page with an image without alt text, saved straight in the repo (as a developer would)
    const s = await source('with-html');
    assert.equal((await api.put('/collections/posts/entries/with-html/source', { version: s.version, source: `${s.source.trimEnd()}\n\n<p><img src="/uploads/plain.png"></p>\n` })).status, 200);
    await page.goto(`${BASE}/markstage/#/health`);
    await page.locator('h1.ms-adm-title', { hasText: 'Site check-up' }).waitFor();
    // needs a look (the default): the page with the image, with its address copyable
    const row = page.locator('tr', { hasText: 'With HTML' });
    await row.getByText('1 image without alt').waitFor();
    await row.getByRole('button', { name: 'Copy the page address' }).waitFor({ state: 'attached' });
    // speed off without a key: plain words for the writer, the key's name kept for the administrator on hover
    const speedOff = page.locator('.ms-adm-plain', { hasText: 'Not set up on this server yet. Ask whoever runs the server.' });
    await speedOff.waitFor();
    assert.match(await speedOff.getAttribute('title'), /Chrome UX Report key/);
    // addresses: the site's health hook answered (it runs after each deploy, once the queue is idle)
    await app.addresses.refresh();
    await page.reload();
    await page.locator('dd', { hasText: '2 pages, 2 redirects' }).getByText('1 broken, 1 chain').waitFor();
    // backups are set up here and none has run yet (the backups test below runs one)
    await page.locator('dd', { hasText: 'None yet' }).waitFor();
    await shot('20-site-health');
    // every live page: a filter in the URL; Back returns
    await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: /^All live pages/ }).click();
    await page.waitForURL(/show=all/);
    await page.locator('tr', { hasText: 'Bob Draft' }).waitFor();
    await page.goBack();
    await page.waitForURL((u) => !/show=/.test(u.hash));
    // a broken address with the page that links to it (open its entry to fix it); a chain hop by hop
    await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Broken addresses (1)' }).click();
    await page.waitForURL(/show=broken/);
    const broken = page.locator('section[aria-label="Addresses"] tr', { hasText: '/blog/gone/' });
    assert.equal(await broken.getByRole('link', { name: 'With HTML' }).getAttribute('href'), '#/e/posts/with-html');
    await broken.getByRole('button', { name: 'Copy broken address' }).waitFor({ state: 'attached' });
    await shot('20d-site-health-broken');
    await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Redirect chains (1)' }).click();
    await page.waitForURL(/show=chains/);
    await page.locator('section[aria-label="Addresses"] tr', { hasText: '/old-post/' }).getByText('/older-post/').waitFor();
    await page.reload();
    await page.locator('section[aria-label="Addresses"] tr', { hasText: '/old-post/' }).waitFor();
    await page.locator('dd', { hasText: '2 pages, 2 redirects' }).getByRole('button', { name: 'Check again' }).click();
    await page.getByText('Checked every address again.').waitFor();
    await page.goto(`${BASE}/markstage/#/health`);
    // the images CSV: a download with the session, the missing alt as an empty cell
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Images', exact: true }).click()]);
    assert.equal(dl.suggestedFilename(), 'site-images.csv');
    const text = fs.readFileSync(await dl.path(), 'utf8');
    assert.match(text, /^\ufeffpage,image,alt text,where\r\n/);
    assert.match(text, /\/blog\/with-html\/,\/uploads\/plain\.png,,block \d+/);

    // with a key: how the speed reads (Google's answer stood in for; the server side is in test/health.test.mjs)
    const v = (lcp, inp, cls) => ({ lcp: { p75: lcp, rating: lcp <= 2500 ? 'good' : lcp <= 4000 ? 'needs-work' : 'poor' }, inp: { p75: inp, rating: inp <= 200 ? 'good' : inp <= 500 ? 'needs-work' : 'poor' }, cls: { p75: cls, rating: cls <= 0.1 ? 'good' : 'poor' } });
    await page.route('**/api/site/health', async (r) => {
      const res = await r.fetch();
      const h = await res.json();
      h.speed = { on: true, why: null, site: { fetchedAt: new Date().toISOString(), phone: v(3100, 620, 0.05), desktop: v(1800, 90, 0.02) } };
      h.pages[0].speed = { fetchedAt: new Date().toISOString(), phone: v(2300, 150, 0.3), desktop: v(1200, 60, 0.01) };
      await r.fulfill({ response: res, json: h });
    });
    await page.reload();
    await page.getByRole('button', { name: 'Ask Google again' }).waitFor();
    assert.match(await page.locator('section[aria-label="Speed for real visitors"]').textContent(), /On phonesLoading 3\.1 s Needs workResponse 620 ms PoorLayout shift 0\.05 Good/);
    await shot('21-site-health-speed');
    await page.unroute('**/api/site/health');
  });

  test('trash: a deleted entry is listed; Restore brings it back as a draft; an owner can delete it for good', async () => {
    await signedInApi();
    const del = async (id) => {
      const e = (await api.get(`/collections/posts/entries/${id}`)).json;
      assert.equal((await api.del(`/collections/posts/entries/${id}?version=${e.version}`)).status, 200);
    };
    await del('carol-draft');
    await page.goto(`${BASE}/markstage/#/trash`);
    const row = page.locator('tr', { hasText: 'Carol Draft' });
    await row.waitFor();
    await row.getByText('Olive Owner').waitFor();
    await shot('22-trash');
    await row.getByRole('button', { name: 'Restore' }).click();
    await page.waitForURL(/#\/e\/posts\/carol-draft/);
    assert.equal((await api.get('/collections/posts/entries/carol-draft')).json.status, 'draft');
    await del('carol-draft');
    // another entry still links to it: "Delete for good" says so first, in the drawer (item= in the URL)
    const b = (await api.get('/collections/posts/entries/bob-draft/source')).json;
    assert.equal((await api.put('/collections/posts/entries/bob-draft/source', { version: b.version, source: `${b.source.trimEnd()}\n\nSee [Carol](/blog/carol-draft/).\n` })).status, 200);
    await page.goto(`${BASE}/markstage/#/trash`);
    await row.getByText('/blog/carol-draft/').waitFor();
    await row.getByRole('button', { name: 'Delete for good…' }).click();
    await page.waitForURL(/#\/trash\?item=/);
    const d = page.getByRole('complementary', { name: 'Delete for good' });
    await d.getByText('1 page still links to it.').waitFor();
    await d.getByRole('link', { name: 'Bob Draft' }).waitFor();
    await shot('22b-trash-delete-for-good');
    await page.reload();
    await d.getByText('1 page still links to it.').waitFor();
    await d.getByRole('button', { name: 'Delete for good' }).click();
    await page.getByText('The trash is empty').waitFor();
    assert.doesNotMatch(new URL(page.url()).hash, /item=/);
  });

  test('find and replace, then change many entries: every place first, addresses apart, one change, the summary before applying', async () => {
    await signedInApi();
    for (const [id, more] of [['hello-world', ''], ['with-html', ' See [the Contoso docs](https://contoso.example/docs) or ask CONTOSO.']]) {
      const s = (await api.get(`/collections/posts/entries/${id}/source`)).json;
      assert.equal((await api.put(`/collections/posts/entries/${id}/source`, { version: s.version, source: `${s.source.trimEnd()}\n\nContoso builds things.${more}\n` })).status, 200);
    }
    await page.goto(`${BASE}/markstage/#/replace`);
    const form = page.locator('form.ms-adm-findform');
    await form.getByLabel('Find', { exact: true }).fill('Contoso');
    await form.getByLabel('Replace with').fill('Fabrikam');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.waitForURL(/#\/replace\?find=Contoso&with=Fabrikam/);
    const text = page.getByRole('region', { name: 'In the text' });
    const hit = text.locator('.ms-adm-findhit', { hasText: 'With HTML' });
    await hit.locator('del', { hasText: 'Contoso' }).first().waitFor();
    await hit.locator('ins', { hasText: 'Fabrikam' }).first().waitFor();
    await hit.locator('.ms-adm-sample__where', { hasText: /^Body/ }).first().waitFor();
    await hit.getByRole('button', { name: 'Copy title' }).waitFor({ state: 'attached' });
    // plain text as it reads: the link is a chip with its words (the match in them) and its address to copy or open
    const chip = hit.locator('.ms-adm-sample__chip', { has: page.locator('del', { hasText: 'Contoso' }) });
    await chip.locator('ins', { hasText: 'Fabrikam' }).waitFor();
    await chip.getByRole('button', { name: 'Copy link address' }).waitFor({ state: 'attached' });
    assert.equal(await chip.getByRole('link', { name: 'Open link address in a new tab' }).getAttribute('href'), 'https://contoso.example/docs');
    await chip.hover();
    await shot('23a-find-replace-link-chip');
    assert.equal(await hit.locator('.ms-adm-sample__text--read', { hasText: '](' }).count(), 0, 'no Markdown in the plain-text group');
    // the case of each match is kept (on by default): CONTOSO becomes FABRIKAM
    assert.equal(await page.getByLabel('Keep the case of each match').isChecked(), true);
    await hit.locator('ins', { hasText: /^FABRIKAM$/ }).waitFor();
    await page.getByLabel('Keep the case of each match').uncheck();
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.waitForURL(/keep=0/);
    assert.equal(await hit.locator('ins', { hasText: /^FABRIKAM$/ }).count(), 0, 'as typed when off');
    await page.getByLabel('Keep the case of each match').check();
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.waitForURL((u) => !u.hash.includes('keep='));
    await hit.locator('ins', { hasText: /^FABRIKAM$/ }).waitFor();
    // the link address is its own group, unticked; Select all / none tick it on purpose (kept in the URL)
    const links = page.getByRole('region', { name: 'Inside a link address' });
    assert.equal(await links.getByRole('checkbox').isChecked(), false, 'an address is never ticked by default');
    await links.locator('code.ms-adm-sample__text', { hasText: 'https://' }).waitFor(); // the address group, as written
    await links.getByRole('button', { name: 'Select all' }).click();
    await page.waitForURL(/flip=link%3Aposts%2Fwith-html/);
    assert.equal(await links.getByRole('checkbox').isChecked(), true);
    await links.getByRole('button', { name: 'Select none' }).click();
    await page.waitForURL((u) => !u.hash.includes('flip='));
    // un-ticking an entry is kept in the URL
    await hit.getByRole('checkbox').uncheck();
    await page.waitForURL(/flip=text%3Aposts%2Fwith-html/);
    await shot('23-find-replace');
    await page.getByRole('button', { name: 'Replace 1 place in 1 entry' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Replace' }).click();
    await page.getByRole('heading', { name: 'Changed 1 entry' }).waitFor();
    await page.locator('.ms-toast', { hasText: 'Changed 1 entry.' }).getByRole('button', { name: 'Undo' }).waitFor();
    assert.match((await api.get('/collections/posts/entries/hello-world/source')).json.source, /Fabrikam builds things/);
    assert.match((await api.get('/collections/posts/entries/with-html/source')).json.source, /Contoso builds things\. See \[the Contoso docs\]\(https:\/\/contoso\.example\/docs\) or ask CONTOSO\./);

    // what is left is handed to Change many entries: add a tag, with the summary first
    await page.getByRole('link', { name: 'Change these entries…' }).click();
    await page.waitForURL(/#\/bulk\?items=posts%2Fwith-html$/);
    await page.getByLabel('What to do').selectOption('add');
    await page.getByLabel('Field').selectOption('tags');
    await page.locator('input[name="value"]').fill('guides');
    await page.getByRole('button', { name: 'Show the summary' }).click();
    await page.waitForURL(/action=add&field=tags&value=guides/);
    await page.locator('tr', { hasText: 'With HTML' }).getByText('guides').waitFor();
    await shot('24-bulk-summary');
    await page.getByRole('button', { name: 'Add to a list: 1 entry' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();
    await page.getByRole('heading', { name: 'Changed 1 entry' }).waitFor();
    assert.deepEqual((await api.get('/collections/posts/entries/with-html')).json.frontmatter.tags, ['guides']);
  });

  test('presence: the publish sheet says when someone else is editing the entry now', async () => {
    const ed = await addUser(app, { email: 'edna@example.test', name: 'Edna Editor', role: 'editor', password: pass() });
    const other = client(BASE);
    await other.login(ed.email, ed.password);
    assert.equal((await other.post('/collections/posts/entries/bob-draft/presence', { tab: 'e2e-tab-edna', mode: 'editing' })).json.mode, 'editing');
    await page.goto(`${BASE}/markstage/#/publish/posts/bob-draft`);
    await page.getByText('Edna Editor is editing this now').waitFor();
    await shot('25-publish-someone-editing');
    await other.del('/collections/posts/entries/bob-draft/presence?tab=e2e-tab-edna');
  });

  test('backups: Site health shows the last one; Back up now runs it as a job and the line updates', async () => {
    await page.goto(`${BASE}/markstage/#/health`);
    const line = page.locator('dd', { has: page.getByRole('button', { name: 'Back up now' }) });
    await line.waitFor();
    await line.getByRole('button', { name: 'Back up now' }).click();
    await page.waitForURL(/#\/jobs\/j_/);
    await app.jobs.idle();
    const [name] = fs.readdirSync(path.join(fx.run, 'backups')).filter((f) => f.startsWith('markstage-backup-'));
    assert.ok(name, 'a backup folder');
    await page.goto(`${BASE}/markstage/#/health`);
    await line.getByText(/ago|just now/).waitFor();
    await line.getByText(/every day, newest 3 kept/).waitFor();
    await shot('20b-site-health-backup');
  });

  test('alerts: Site health says where failures are told; Send a test alert reaches the mail and says so per channel', async () => {
    await page.goto(`${BASE}/markstage/#/health`);
    const line = page.locator('dd', { has: page.getByRole('button', { name: 'Send a test alert' }) });
    await line.getByText('In the editor, and by Email').waitFor();
    const before = mail.messages.length;
    await line.getByRole('button', { name: 'Send a test alert' }).click();
    await line.getByText('Email: sent').waitFor();
    assert.equal(mail.messages.length, before + 1);
    const m = readMessage(mail.messages.at(-1).data);
    assert.match(m.headers.subject, /^Markstage: A test alert from Markstage, sent by Olive Owner from Site health\.$/);
    assert.ok(m.body.includes(`Open it in Markstage: ${BASE}/markstage/#/health`), m.body);
    await shot('20c-site-health-alerts');
  });

  test('redirects: what moves left behind, a chain flagged and pointed at its end, a loop refused, a test hop by hop', async () => {
    const fx2 = localeSite(makeFixture({ checks: false }), { siteUrl: `http://127.0.0.1:${LIVE_PORT}` });
    // the live site: the last build's files, as a static host serves them
    const live = http.createServer((req, res) => {
      const f = path.join(fx2.site, 'dist', decodeURIComponent(new URL(req.url, 'http://x').pathname), 'index.html');
      if (!f.startsWith(path.join(fx2.site, 'dist') + path.sep) || !fs.existsSync(f)) return res.writeHead(404).end('not found');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(fs.readFileSync(f));
    });
    await new Promise((r) => live.listen(LIVE_PORT, '127.0.0.1', r));
    const BASE2 = `http://127.0.0.1:${REDIR_PORT}`;
    const config = loadConfig({
      env: { MARKSTAGE_DATA_DIR: fx2.data, NODE_ENV: 'test' },
      overrides: { port: REDIR_PORT, editorDir, collections: [], commands: { build: [process.execPath, 'scripts/build-locales.mjs'] }, verify: { public: 'dist' } },
    });
    const app2 = await createMarkstage(config, { codec: fakeCodec });
    await app2.listen(REDIR_PORT, '127.0.0.1');
    const ctx2 = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    await ctx2.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE2 });
    const p2 = await ctx2.newPage();
    p2.on('pageerror', (e) => console.error('page error:', e.message));
    const shot2 = async (name) => SHOTS && p2.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
    try {
      // an owner, so the server is set up; the work is done as an editor
      await addUser(app2, { email: 'owner2@example.test', name: 'Otto Owner', role: 'owner', password: pass() });
      const ed = await addUser(app2, { email: 'edith@example.test', name: 'Edith Editor', role: 'editor', authorSlug: 'edith', password: pass() });
      const c = client(BASE2);
      await c.login(ed.email, ed.password);
      // a move leaves a redirect per locale; then one by hand, and a second one onto it (a chain)
      const e = (await c.get('/collections/posts/entries/hello-world')).json;
      assert.equal((await c.post('/collections/posts/entries/hello-world/move', { version: e.version, newId: 'hello-there' })).status, 202);
      await app2.jobs.idle();
      assert.equal((await c.post('/site/redirects', { from: '/old-page/', to: '/blog/hello-there/' })).status, 202);
      await app2.jobs.idle();
      assert.equal((await c.post('/site/redirects', { from: '/older/', to: '/old-page/' })).status, 202);
      await app2.jobs.idle();

      await p2.goto(`${BASE2}/markstage/#/redirects`);
      await p2.waitForURL(/#\/sign-in\?next=/);
      await p2.getByLabel('Email').fill(ed.email);
      await p2.getByLabel('Password', { exact: true }).fill(ed.password);
      await p2.getByRole('button', { name: 'Sign in' }).click();
      await p2.waitForURL(/#\/redirects$/);
      const row = p2.locator('tr', { hasText: '/older/' });
      await row.getByText('Chain').waitFor();
      assert.equal(await p2.locator('tbody tr').count(), 4);
      await shot2('26-redirects');
      await p2.getByRole('button', { name: 'With problems (1)' }).click();
      await p2.waitForURL(/#\/redirects\?show=problems$/);
      assert.equal(await p2.locator('tbody tr').count(), 1);

      // the drawer: what is wrong and the fix; its state is in the URL (reload keeps it)
      await row.getByRole('link', { name: 'Details' }).click();
      await p2.waitForURL(/item=%2Folder%2F/);
      await p2.reload();
      const fix = p2.getByRole('button', { name: 'Point it at /blog/hello-there/' });
      await fix.waitFor();
      await shot2('26b-redirect-chain');
      await fix.click();
      await p2.getByText('/older/ now goes straight to /blog/hello-there/.').waitFor();
      await app2.jobs.idle();
      assert.deepEqual((await c.get('/site/redirects')).json.redirects.flatMap((r) => r.flags), [], 'no problems left');

      // a loop is refused under the field
      await p2.goto(`${BASE2}/markstage/#/redirects?action=add`);
      await p2.getByRole('textbox', { name: 'Old address' }).fill('/blog/hello-there-again/');
      await p2.getByRole('textbox', { name: 'Goes to' }).fill('/old-page/');
      await p2.getByRole('button', { name: 'Add the redirect' }).click();
      await p2.waitForURL(/item=%2Fblog%2Fhello-there-again%2F/);
      await app2.jobs.idle();
      await p2.goto(`${BASE2}/markstage/#/redirects?item=%2Fold-page%2F&action=edit`);
      await p2.getByRole('textbox', { name: 'Goes to' }).fill('/blog/hello-there-again/');
      await p2.getByRole('button', { name: 'Save' }).click();
      await p2.getByText('That makes a loop: /old-page/ → /blog/hello-there-again/ → /old-page/.').waitFor();
      await shot2('26c-redirect-loop');

      // a test: the build has a redirect page there; the live site answers hop by hop
      await p2.goto(`${BASE2}/markstage/#/redirects?item=%2Fold-page%2F`);
      await p2.getByRole('button', { name: 'Test it' }).click();
      await p2.waitForURL(/action=test&path=%2Fold-page%2F|path=%2Fold-page%2F&action=test/);
      await p2.getByText('Works: it ends at a page.').waitFor();
      const hops = p2.locator('.ms-adm-hops li');
      assert.equal(await hops.count(), 2);
      assert.match(await hops.nth(0).innerText(), /\/old-page\/[\s\S]*200[\s\S]*a page that redirects/);
      assert.match(await hops.nth(1).innerText(), /\/blog\/hello-there\/[\s\S]*200/);
      await shot2('26d-redirect-test');
      await p2.goBack();
      await p2.waitForURL(/#\/redirects\?item=%2Fold-page%2F$/);
    } finally {
      await ctx2.close();
      await app2.close();
      await new Promise((r) => live.close(r));
    }
  });

  test('media: tick several unused files on "Not used", delete them in one go; Undo brings them back', async () => {
    const files = ['spare-one.png', 'spare-two.png'].map((n, i) => {
      const f = path.join(fx.run, n);
      fs.writeFileSync(f, colorPng(200 + i * 40, 120));
      return f;
    });
    await page.goto(`${BASE}/markstage/#/media`);
    await page.locator('.ms-adm input[type=file]').first().setInputFiles(files);
    await page.waitForURL(/item=m_/);
    await page.goto(`${BASE}/markstage/#/media?show=unused`);
    await page.getByLabel('Select spare-one.png').check();
    await page.waitForURL(/sel=m_/);
    // the selection is in the URL: a reload keeps it
    await page.reload();
    assert.ok(await page.getByLabel('Select spare-one.png').isChecked());
    await page.getByLabel('Select spare-two.png').check();
    await page.getByText('2 selected').waitFor();
    assert.ok(await page.getByLabel('Select spare-two.png').evaluate((x) => x === document.activeElement), 'the tick box keeps the focus');
    await shot('09c-media-many');
    await page.getByRole('toolbar', { name: 'Selected files' }).getByRole('button', { name: 'Delete 2 files' }).click();
    const toast = page.locator('.ms-toast', { hasText: 'Deleted 2 files.' });
    await toast.waitFor();
    await page.waitForURL((u) => !/sel=/.test(u.hash));
    assert.equal(await page.locator('.ms-adm-tile', { hasText: /spare-(one|two)/ }).count(), 0);
    await toast.getByRole('button', { name: 'Undo' }).click();
    await page.locator('.ms-toast', { hasText: 'Brought back 2 files.' }).waitFor();
    await page.locator('.ms-adm-tile', { hasText: 'spare-two.png' }).waitFor();
    assert.equal((await (await signedInApi()).get('/media?q=spare')).json.total, 2, 'both are in the library again');
  });

  test('categories and tags: a value merged into another everywhere, the summary first, in the URL; Undo puts it back', async () => {
    const c = await signedInApi();
    const count = async (v) => (await c.get('/site/taxonomy?field=tags')).json.values.find((x) => x.value === v)?.entries ?? 0;
    const n = await count('news');
    assert.ok(n > 0 && (await count('guides')) > 0, 'both tags are in use');
    await page.goto(`${BASE}/markstage/#/taxonomy?field=tags`);
    await page.locator('tr', { hasText: 'news' }).getByRole('button', { name: 'Rename…' }).click();
    await page.waitForURL(/item=news&action=rename/);
    const d = page.locator('.ms-adm-drawer');
    await d.getByLabel('New name').fill('guides');
    await d.getByRole('button', { name: 'See the change' }).click();
    await page.waitForURL(/to=guides/);
    // the summary is a URL: a reload shows it again
    await page.reload();
    const go = d.getByRole('button', { name: `Merge into “guides”: ${n} entries` });
    await go.waitFor();
    await d.locator('tr', { hasText: 'Hello World' }).getByText('intro, guides').waitFor();
    await shot('27-taxonomy-merge');
    await go.click();
    const toast = page.locator('.ms-toast', { hasText: `Merged “news” into “guides” in ${n} entries.` });
    await toast.waitFor();
    await page.waitForURL((u) => !/item=/.test(u.hash));
    assert.equal(await count('news'), 0);
    await app.jobs.idle();
    await toast.getByRole('button', { name: 'Undo' }).click();
    await page.locator('.ms-toast', { hasText: `Undone in ${n} entries.` }).waitFor();
    await app.jobs.idle();
    assert.equal(await count('news'), n, 'every entry has it again');
  });
});
