// "Edit this page" on the built site: the config is checked, and the inline script draws the link only for a cookie
// whose address hashes to the one the build knows; a visitor (no cookie) costs one regex and no request.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigError, EDIT_COOKIE, editButtonScript, editLinkOf, normalizeConfig } from '@markstage/core/site-config';

const CMS = 'https://cms.example.com';
const cfg = (editButton) => normalizeConfig({ editButton }, '/tmp/site');

/** Runs the script on a page with `cookie`, as a browser would; resolves with the links it added. */
async function run(script, cookie, { subtle = globalThis.crypto.subtle, body = true } = {}) {
  const added = [];
  const listeners = [];
  const errors = [];
  let digests = 0;
  const document = {
    cookie,
    body: body ? { append: (a) => added.push(a) } : null,
    createElement: () => ({ style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }),
  };
  // what the script does once its hash is known: awaited as such, never a guessed delay (slow under load)
  const pending = [];
  const digest = (...a) => {
    digests++;
    const p = subtle.digest(...a);
    return { then: (ok, no) => (pending.push(p.then(ok, no)), pending.at(-1)) };
  };
  const crypto = subtle ? { subtle: { digest } } : {};
  const fn = new Function('document', 'crypto', 'location', 'addEventListener', 'TextEncoder', script);
  try {
    fn(document, crypto, { pathname: '/about us/' }, (ev, cb) => listeners.push([ev, cb]), TextEncoder);
  } catch (e) {
    errors.push(e);
  }
  await Promise.allSettled(pending);
  return { added, listeners, errors, digests, document };
}

test('editButton: {cms, corner?} checked; off when absent', () => {
  assert.equal(cfg(undefined).editButton, null);
  assert.equal(cfg(false).editButton, null);
  assert.deepEqual(cfg({ cms: `${CMS}/` }).editButton, { cms: CMS, corner: 'bottom-right' });
  assert.deepEqual(cfg({ cms: 'http://127.0.0.1:18301', corner: 'top-left' }).editButton, { cms: 'http://127.0.0.1:18301', corner: 'top-left' });
  const bad = (b, re) => assert.throws(() => cfg(b), (e) => e instanceof ConfigError && re.test(e.message));
  bad('https://cms.example.com', /editButton must be \{cms/);
  bad({ cms: 'cms.example.com' }, /editButton must be \{cms/);
  bad({ cms: `${CMS}/markstage` }, /editButton must be \{cms/);
  bad({ cms: 'ftp://cms.example.com' }, /editButton must be \{cms/);
  bad({ cms: CMS, corner: 'middle' }, /editButton\.corner must be one of bottom-right/);
});

test('the script: none without editButton; the same text for every page; never the CMS address, only its hash', () => {
  assert.equal(editButtonScript(cfg(undefined)), null);
  const s = editButtonScript(cfg({ cms: CMS }));
  assert.ok(!s.includes('cms.example.com') && !s.includes('markstage') && !s.includes('<'), s);
  assert.match(s, new RegExp(`\\(\\?:\\^\\|; \\)${EDIT_COOKIE}=`));
  assert.ok(Buffer.byteLength(s) < 800, `${Buffer.byteLength(s)} bytes`);
});

test('the script draws the link for the right cookie only, and never throws', async () => {
  const s = editButtonScript(cfg({ cms: CMS }));
  const link = editLinkOf(CMS);
  const good = `a=1; ${EDIT_COOKIE}=${encodeURIComponent(link)}; b=2`;
  const yes = await run(s, good);
  assert.equal(yes.added.length, 1);
  assert.equal(yes.added[0].href, `${link}${encodeURIComponent('/about us/')}`);
  assert.equal(yes.added[0].textContent, 'Edit this page');
  assert.equal(yes.added[0].attrs['aria-label'], 'Edit this page in the editor');
  assert.match(yes.added[0].style.cssText, /position:fixed;bottom:16px;right:16px/);
  // a visitor: no cookie, no hashing, nothing drawn
  const visitor = await run(s, 'a=1');
  assert.deepEqual([visitor.added.length, visitor.digests, visitor.errors.length], [0, 0, 0]);
  // a cookie planted with another address (a sibling host): nothing
  const planted = await run(s, `${EDIT_COOKIE}=${encodeURIComponent('https://evil.example/#/edit?to=')}`);
  assert.deepEqual([planted.added.length, planted.digests, planted.errors.length], [0, 1, 0]);
  // a broken cookie, and plain http (no crypto.subtle): nothing, and no error
  assert.deepEqual((await run(s, `${EDIT_COOKIE}=%E0%A4%A`)).errors, []);
  const insecure = await run(s, good, { subtle: null });
  assert.deepEqual([insecure.added.length, insecure.errors.length], [0, 0]);
  // run in the <head>, before <body> exists: the link waits for DOMContentLoaded
  const early = await run(s, good, { body: false });
  assert.equal(early.listeners[0]?.[0], 'DOMContentLoaded');
});

test('gallery: every JSON collection by its sections; field and variant keys checked; false leaves it out', () => {
  const c = (gallery, format = 'json') => normalizeConfig({ collections: [{ id: 'pages', format, dir: 'p', gallery }] }, '/tmp/x').collections[0];
  assert.deepEqual(c(undefined).gallery, { field: 'sections', variant: null });
  assert.deepEqual(c({ variant: 'variant' }).gallery, { field: 'sections', variant: 'variant' });
  assert.deepEqual(c({ field: 'blocks', variant: 'style.name' }).gallery, { field: 'blocks', variant: 'style.name' });
  assert.equal(c(false).gallery, null);
  assert.equal(c(undefined, 'md').gallery, null);
  const bad = (g, re, format) => assert.throws(() => c(g, format), (e) => e instanceof ConfigError && re.test(e.message));
  bad({ variant: 'variant' }, /gallery needs a JSON collection/, 'md');
  bad('variant', /gallery must be \{field\?, variant\?\} or false/);
  bad({ field: 'the sections' }, /gallery\.field must be a key/);
  bad({ variant: 3 }, /gallery\.variant must be a key/);
});
