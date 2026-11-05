// Unit tests for the security building blocks and config validation (no HTTP).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { hashPassword, passwordProblem, verifyPassword } from '../src/auth/passwords.mjs';
import { base32Decode, base32Encode, hashRecoveryCode, newRecoveryCodes, totpAt, verifyTotp } from '../src/auth/totp.mjs';
import { ConfigError, loadConfig } from '../src/config.mjs';
import { addedRawHtml, applyJsonChangesFallback, countChangedBlocks, createConverter } from '../src/content/converter.mjs';
import { statusOf } from '../src/content/store.mjs';
import { isSafeUrl, schemeOf, unsafeUrls } from '../src/content/urls.mjs';
import { dimensions, sniff } from '../src/media/sniff.mjs';
import { canManageUser, entryCan } from '../src/roles.mjs';
import { newSetupCode, normalizeCode, safeEqual, slugify } from '../src/util.mjs';
import { as, client, makeFixture, makePng, startServer } from './helpers.mjs';

describe('passwords (scrypt)', () => {
  test('hash format, verify, wrong password, and unknown-user path', async () => {
    const h = await hashPassword('correct horse battery staple');
    assert.match(h, /^scrypt\$32768\$8\$3\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    assert.equal(await verifyPassword('correct horse battery staple', h), true);
    assert.equal(await verifyPassword('correct horse battery stapl3', h), false);
    assert.equal(await verifyPassword('anything at all', null), false);
    assert.notEqual(await hashPassword('same input here'), await hashPassword('same input here'), 'salted');
  });
  test('policy', () => {
    assert.match(passwordProblem('short'), /12/);
    assert.match(passwordProblem('password1234'), /common/);
    assert.match(passwordProblem('aaaaaaaaaaaaaaa'), /common/);
    assert.match(passwordProblem('me@example.test', 'me@example.test'), /email/);
    assert.match(passwordProblem('x'.repeat(257)), /256/);
    assert.equal(passwordProblem('a long and unusual passphrase'), null);
  });
});

describe('TOTP (RFC 6238) and recovery codes', () => {
  // RFC 6238 appendix B, SHA-1 secret "12345678901234567890"; the 8-digit codes truncated to 6 digits
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  test('RFC test vectors', () => {
    // the known base32 of the RFC secret, built from short pieces so no key-shaped literal sits in the repo
    const rfcBase32 = ['GEZDGNBV', 'GY3TQOJQ'].join('').repeat(2);
    assert.equal(secret, rfcBase32);
    for (const [t, code] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037']]) {
      assert.equal(totpAt(secret, Math.floor(t / 30)), code, `T=${t}`);
    }
  });
  test('base32 round trip', () => {
    const buf = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 7]);
    assert.deepEqual(base32Decode(base32Encode(buf)), buf);
  });
  test('accepts +-1 step, refuses replays and junk', () => {
    const now = 1111111111 * 1000;
    const step = Math.floor(now / 30000);
    assert.equal(verifyTotp(secret, totpAt(secret, step), { now }), step);
    assert.equal(verifyTotp(secret, totpAt(secret, step - 1), { now }), step - 1);
    assert.equal(verifyTotp(secret, totpAt(secret, step - 2), { now }), 0);
    assert.equal(verifyTotp(secret, totpAt(secret, step), { now, lastStep: step }), 0, 'replay');
    for (const junk of ['', '12345', '1234567', 'abcdef', null, undefined]) assert.equal(verifyTotp(secret, junk, { now }), 0);
  });
  test('recovery codes are unique, formatted, and hashed case-insensitively', () => {
    const codes = newRecoveryCodes();
    assert.equal(new Set(codes).size, 10);
    for (const c of codes) assert.match(c, /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    assert.equal(hashRecoveryCode(codes[0]), hashRecoveryCode(codes[0].toUpperCase().replace(/-/g, ' ')));
  });
});

describe('small helpers', () => {
  test('safeEqual', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'abcd'), false);
    assert.equal(safeEqual('', ''), true);
    assert.equal(safeEqual(undefined, 'x'), false);
  });
  test('setup codes', () => {
    const c = newSetupCode();
    assert.match(c, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    assert.equal(normalizeCode(c.toLowerCase().replace(/-/g, ' ')), c.replace(/-/g, ''));
  });
  test('slugify', () => {
    assert.equal(slugify('Héllo, Wörld!  2026'), 'hello-world-2026');
    assert.equal(slugify('../../etc/passwd'), 'etc-passwd');
    assert.equal(slugify('   '), '', 'nothing to make a slug from: empty, the caller names it (datedId)');
    assert.equal(slugify('مرحبا بالعالم'), '');
    assert.ok(slugify('x'.repeat(300)).length <= 100);
  });
  test('status from fields', () => {
    const now = Date.UTC(2026, 9, 28);
    assert.equal(statusOf({ draft: true }, now), 'draft');
    assert.equal(statusOf({ draft: true, publishAt: '2020-01-01' }, now), 'draft');
    assert.equal(statusOf({ publishAt: '2027-01-01T00:00:00Z' }, now), 'scheduled');
    assert.equal(statusOf({ publishAt: '2026-01-01T00:00:00Z' }, now), 'published');
    assert.equal(statusOf({}, now), 'published');
  });
});

describe('converter fallbacks', () => {
  test("frontmatter writes are core's: without core they refuse with 503 instead of guessing", () => {
    assert.throws(() => createConverter(null).setFrontmatter('---\n---\n', { title: 'T' }), (e) => e.status === 503);
    assert.throws(() => createConverter({ mdToDoc() {}, docToMd() {} }).setFrontmatter('', {}), (e) => e.status === 503);
  });
  test('JSON changes keep the indent and refuse prototype paths', () => {
    const text = '{\n    "a": {\n        "b": 1\n    }\n}\n';
    assert.equal(applyJsonChangesFallback(text, [{ path: 'a.b', value: 2 }]), '{\n    "a": {\n        "b": 2\n    }\n}\n');
    assert.throws(() => applyJsonChangesFallback(text, [{ path: '__proto__.x', value: 1 }]), /Bad field path/);
    assert.throws(() => applyJsonChangesFallback(text, [{ path: 'a.missing.deep', value: 1 }]), /No field/);
  });
  test('raw HTML added (multiset) and changed blocks', () => {
    assert.deepEqual(addedRawHtml(['<a>', '<b>'], ['<b>', '<a>']), []);
    assert.deepEqual(addedRawHtml(['<a>'], ['<a>', '<a>']), ['<a>']);
    assert.deepEqual(addedRawHtml(['<a>'], ['<a x>']), ['<a x>']);
    assert.equal(countChangedBlocks('---\na: 1\n---\n\nx\n\ny\n', '---\na: 1\n---\n\nx\n\nz\n'), 1);
    assert.equal(countChangedBlocks('---\na: 1\n---\n\nx\n', '---\na: 2\n---\n\nx\n'), 1);
  });
});

describe('URL-scheme rule', () => {
  test('http(s), mailto, tel and relative pass; everything else is refused', () => {
    for (const ok of ['https://x.test/a', 'http://x.test', 'mailto:a@b.test', 'tel:+15551234', '/blog/x/', 'x/y.png', '#top', '?q=1', '//cdn.test/a.png', '2026/03/a.jpg', ''])
      assert.equal(isSafeUrl(ok), true, ok);
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' java\tscript:alert(1)', 'java\nscript:x', 'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:msgbox', 'file:///etc/passwd', 'blob:https://x.test/1'])
      assert.equal(isSafeUrl(bad), false, bad);
    assert.equal(schemeOf('\u0000javascript:x'), 'javascript');
  });
  test('the walk finds href, src and url at any depth, link marks included', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:a()' } }] }] },
        { type: 'image', attrs: { src: 'data:image/svg+xml,<svg onload=x>', alt: 'javascript:not-a-url-key' } },
        { type: 'layoutCards', attrs: { cards: [{ title: 'ok', href: 'https://fine.test' }, { URL: 'vbscript:x' }] } },
        { type: 'callout', attrs: { href: '/relative/ok' } },
      ],
    };
    assert.deepEqual(unsafeUrls(doc), ['javascript:a()', 'data:image/svg+xml,<svg onload=x>', 'vbscript:x']);
  });
});

describe('upload sniffing', () => {
  test('types come from bytes; SVG and HTML are flagged', () => {
    assert.equal(sniff(makePng()).type, 'image/png');
    assert.equal(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1])).type, 'image/jpeg');
    assert.equal(sniff(Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00', 'latin1')).type, 'image/gif');
    assert.equal(sniff(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1')).type, 'image/webp');
    assert.equal(sniff(Buffer.from('\x00\x00\x00\x1cftypavif\x00\x00\x00\x00', 'latin1')).type, 'image/avif');
    assert.equal(sniff(Buffer.from('﻿  <svg xmlns="http://www.w3.org/2000/svg"></svg>')).svg, true);
    assert.equal(sniff(Buffer.from('<?xml version="1.0"?>\n<!DOCTYPE svg><svg/>')).svg, true);
    assert.equal(sniff(Buffer.from('<!DOCTYPE html><html></html>')).markup, true);
    assert.equal(sniff(Buffer.from('MZ\x90\x00 executable bytes', 'latin1')).type, null);
    assert.deepEqual(dimensions(makePng(), 'image/png'), { width: 2, height: 2 });
  });
});

describe('roles', () => {
  const posts = { hasStatus: true };
  const pages = { hasStatus: false };
  const u = (role, authorSlug = 'me') => ({ id: role, role, authorSlug });
  const own = (status) => ({ author: 'me', status });
  test('entry permissions per role', () => {
    assert.deepEqual(entryCan(u('editor'), pages, own('published')), { edit: true, publish: true, delete: true, rawHtml: true });
    assert.deepEqual(entryCan(u('author'), pages, own('published')), { edit: false, publish: false, delete: false, rawHtml: false });
    assert.deepEqual(entryCan(u('author'), posts, own('published')), { edit: true, publish: true, delete: true, rawHtml: true });
    assert.deepEqual(entryCan(u('author'), posts, { author: 'other', status: 'draft' }).edit, false);
    assert.deepEqual(entryCan(u('contributor'), posts, own('draft')), { edit: true, publish: false, delete: true, rawHtml: false });
    assert.deepEqual(entryCan(u('contributor'), posts, own('published')), { edit: false, publish: false, delete: false, rawHtml: false });
    assert.equal(entryCan(u('author', null), posts, { author: null, status: 'draft' }).edit, false, 'no authorSlug owns nothing');
  });
  test('user management', () => {
    const owner = u('owner');
    const admin = u('administrator');
    assert.equal(canManageUser(owner, u('administrator'), 'editor'), true);
    assert.equal(canManageUser(admin, u('editor'), 'author'), true);
    assert.equal(canManageUser(admin, u('owner')), false);
    assert.equal(canManageUser(admin, u('editor'), 'administrator'), false);
    assert.equal(canManageUser(admin, admin, 'owner'), false);
    assert.equal(canManageUser(u('editor'), u('author')), false);
  });
});

describe('the deploy recipes', () => {
  const root = path.resolve(import.meta.dirname, '../../..');
  test('the site nginx recipes serve PDFs as downloads with nosniff (uploads are stored as they are)', () => {
    for (const f of ['deploy/nginx/site.conf', 'deploy/nginx/production.conf']) {
      const text = fs.readFileSync(path.join(root, f), 'utf8');
      const block = /location ~\* \\\.pdf\$ \{([^}]*)\}/.exec(text);
      assert.ok(block, `${f}: a location for .pdf`);
      assert.match(block[1], /add_header Content-Disposition "attachment" always;/, f);
      assert.match(block[1], /add_header X-Content-Type-Options "nosniff" always;/, f);
      assert.match(block[1], /try_files \$uri =404;/, f);
    }
  });
  test('deploy/config.example.json loads with a real repo path, holds no secret, and names each secret\'s environment variable', () => {
    const fx = makeFixture({ checks: false });
    const text = fs.readFileSync(path.join(root, 'deploy/config.example.json'), 'utf8');
    assert.ok([...text.matchAll(/https?:\/\/([^"/:]+)/g)].every(([, host]) => host === 'example.com' || host.endsWith('.example.com')), 'example.com addresses only');
    assert.doesNotMatch(text, /"(password|secret|token|key)"\s*:/i, 'no secret key in the file');
    for (const v of ['MARKSTAGE_SMTP_PASSWORD', 'MARKSTAGE_SLACK_WEBHOOK']) assert.ok(text.includes(v), v);
    const example = JSON.parse(text);
    // every secret is a placeholder that says where it comes from, never a value
    const { $comment, ...secrets } = example.$secrets;
    assert.ok($comment && Object.keys(secrets).length >= 8);
    for (const [what, where] of Object.entries(secrets)) assert.match(where, /^<.*\bfrom env\b.*>$/, what);
    fs.writeFileSync(path.join(fx.data, 'config.json'), JSON.stringify({ ...example, contentRoot: fx.site, collections: undefined }));
    const c = loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'production', MARKSTAGE_SMTP_USER: 'u', MARKSTAGE_SMTP_PASSWORD: 'p' }, overrides: {} });
    assert.equal(c.publicOrigin, 'https://cms.example.com');
    assert.equal(c.trustProxy, true);
  });
});

describe('config validation', () => {
  const base = () => makeFixture({ checks: false });
  const load = (fx, env = {}, overrides = {}) => loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test', ...env }, overrides });

  test('dev mode (no sign-in) refuses production and any address but 127.0.0.1', () => {
    const fx = base();
    assert.throws(() => load(fx, { MARKSTAGE_DEV_NO_AUTH: '1', NODE_ENV: 'production', MARKSTAGE_PUBLIC_ORIGIN: 'https://cms.example.com' }), /NODE_ENV=production/);
    assert.throws(() => load(fx, { MARKSTAGE_DEV_NO_AUTH: '1', MARKSTAGE_HOST: '0.0.0.0' }), /127\.0\.0\.1/);
    assert.throws(() => load(fx, { MARKSTAGE_DEV_NO_AUTH: '1', MARKSTAGE_HOST: 'localhost' }), /127\.0\.0\.1/);
    assert.equal(load(fx, { MARKSTAGE_DEV_NO_AUTH: '1' }).devNoAuth, true);
  });
  test('dev mode (no sign-in) refuses a public publicOrigin even without NODE_ENV; loopback origins and the test switch pass', () => {
    const fx = base();
    const dev = { MARKSTAGE_DEV_NO_AUTH: '1', NODE_ENV: undefined };
    assert.throws(() => load(fx, { ...dev, MARKSTAGE_PUBLIC_ORIGIN: 'https://cms.example.com' }), /loopback publicOrigin.*not https:\/\/cms\.example\.com/);
    assert.throws(() => loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, MARKSTAGE_DEV_NO_AUTH: '1', MARKSTAGE_PUBLIC_ORIGIN: 'https://cms.example.com' }, overrides: {} }), /loopback publicOrigin/, 'the same with no NODE_ENV at all');
    assert.throws(() => load(fx, { ...dev }, { devNoAuth: true, publicOrigin: 'https://cms.example.com' }), /loopback publicOrigin/, 'from the config file too');
    assert.equal(load(fx, { ...dev, MARKSTAGE_PUBLIC_ORIGIN: 'http://127.0.0.1:18323' }).devNoAuth, true);
    assert.equal(load(fx, { ...dev, MARKSTAGE_PUBLIC_ORIGIN: 'http://localhost:18323' }).devNoAuth, true);
    assert.equal(load(fx, { ...dev, MARKSTAGE_PUBLIC_ORIGIN: 'https://cms.example.com', MARKSTAGE_I_KNOW_DEV_NO_AUTH: '1' }).devNoAuth, true, 'the explicit switch for test suites');
    assert.throws(() => load(fx, { ...dev, NODE_ENV: 'production', MARKSTAGE_PUBLIC_ORIGIN: 'https://cms.example.com', MARKSTAGE_I_KNOW_DEV_NO_AUTH: '1' }), /NODE_ENV=production/, 'the switch never beats production');
  });
  test('production needs an https publicOrigin; non-loopback http is refused', () => {
    const fx = base();
    assert.throws(() => load(fx, { NODE_ENV: 'production' }), /publicOrigin is required/);
    assert.throws(() => load(fx, { MARKSTAGE_PUBLIC_ORIGIN: 'http://cms.example.com' }), /https/);
    assert.throws(() => load(fx, { MARKSTAGE_PUBLIC_ORIGIN: 'https://cms.example.com/path' }), /origin only/);
    const ok = load(fx, { NODE_ENV: 'production', MARKSTAGE_PUBLIC_ORIGIN: 'https://cms.example.com' });
    assert.equal(ok.secure, true);
  });
  test('MARKSTAGE_EDITOR_DIR names the built editor (the Docker image sets it)', () => {
    const fx = base();
    assert.equal(load(fx, {}).editorDir, null);
    assert.equal(load(fx, { MARKSTAGE_EDITOR_DIR: '/srv/editor' }).editorDir, '/srv/editor');
  });
  test('the data dir must be outside the content repo; collection dirs inside it', () => {
    const fx = base();
    const inside = path.join(fx.site, '.markstage-data');
    fs.mkdirSync(inside);
    fs.copyFileSync(path.join(fx.data, 'config.json'), path.join(inside, 'config.json'));
    assert.throws(() => loadConfig({ env: { MARKSTAGE_DATA_DIR: inside } }), /outside the content repo/);
    assert.throws(() => load(fx, {}, { collections: [{ id: 'x', dir: '../data', format: 'md' }] }), /inside the content repo/);
    assert.throws(() => load(fx, {}, { collections: [{ id: 'x', dir: '.git', format: 'md' }] }), /\.git/);
    assert.throws(() => load(fx, {}, { collections: [{ id: 'x', dir: '/etc', format: 'md' }] }), /repo-relative/);
    assert.throws(() => load(fx, {}, { commands: { build: 'npm run build && rm -rf /' } }), /argv array/);
    assert.throws(() => loadConfig({ env: {} }), ConfigError);
  });
});

describe('dev mode server', () => {
  test('no sign-in needed, but Origin and Host checks still apply', async () => {
    const fx = makeFixture({ checks: false });
    const srv = await startServer(fx, { env: { MARKSTAGE_DEV_NO_AUTH: '1' } });
    try {
      const c = client(srv.base);
      const me = await c.get('/auth/me');
      assert.equal(me.json.devMode, true);
      assert.equal(me.json.user.role, 'owner');
      assert.equal((await c.get('/collections')).status, 200);
      const cur = await c.get('/studio-api/article?slug=bob-draft');
      assert.equal(cur.status, 200);
      const evil = client(srv.base, { origin: 'https://evil.example' });
      assert.equal((await evil.post('/studio-api/article?slug=bob-draft', { doc: cur.json.doc, version: cur.json.version })).status, 403);
      const local = client(srv.base.replace('127.0.0.1', 'localhost'));
      assert.equal((await local.post('/snippets', { name: 's', doc: { type: 'doc', content: [] } })).status, 201, 'localhost alias of the same port is fine');
    } finally {
      await srv.close();
    }
  });

  test('a normal server refuses requests without a session even for read routes', async () => {
    const fx = makeFixture({ checks: false });
    const srv = await startServer(fx);
    try {
      const anon = client(srv.base);
      for (const p of ['/collections', '/collections/posts/entries', '/media', '/jobs', '/users', '/audit', '/snippets', '/checks']) {
        assert.equal((await anon.get(p)).status, 401, p);
      }
      const ed = await as(srv, 'editor');
      assert.equal((await ed.get('/checks')).status, 200);
    } finally {
      await srv.close();
    }
  });
});
