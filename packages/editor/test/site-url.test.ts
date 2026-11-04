// The "open" icon beside a site path (src/site-url.ts, used by copy.ts siteUrl): on the production editor a site path opens on the
// site's public address (the site's siteUrl), never on the editor's own host, where it is 404 by design; without a
// siteUrl, or when the editor runs on the site's own origin (astro dev), the editor's origin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSiteUrl } from '../src/site-url.ts';

test('siteUrl set and another origin: the site path opens on the site', () => {
  assert.equal(resolveSiteUrl('/services/setup/', 'https://www.example.com', 'https://cms.example.com'), 'https://www.example.com/services/setup/');
  assert.equal(resolveSiteUrl('/en-us/about/', 'https://www.example.com/', 'https://cms.example.com'), 'https://www.example.com/en-us/about/');
});

test('no siteUrl, or the same origin (astro dev): the editor\'s origin', () => {
  assert.equal(resolveSiteUrl('/about/', undefined, 'http://localhost:4321'), 'http://localhost:4321/about/');
  assert.equal(resolveSiteUrl('/about/', null, 'http://localhost:4321'), 'http://localhost:4321/about/');
  assert.equal(resolveSiteUrl('/about/', 'http://localhost:4321', 'http://localhost:4321'), 'http://localhost:4321/about/');
});

test('a full address stays as it is; a bad siteUrl falls back to the origin', () => {
  assert.equal(resolveSiteUrl('https://other.example/x', 'https://www.example.com', 'https://cms.example.com'), 'https://other.example/x');
  assert.equal(resolveSiteUrl('/x/', 'not a url', 'https://cms.example.com'), 'https://cms.example.com/x/');
});
