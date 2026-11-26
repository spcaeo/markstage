// The head kit's screens (src/site-settings/head/): an ID is checked as typed with the pattern the server sends (the one
// the build uses), the server's refusals are found by the path of the setting, and ⌘K finds the two parts only on a
// site that uses the head settings and only for a manager.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { trackerOk, issuesOf, isStale } = await import('../src/site-settings/head/check.ts');
const { screenIndex, searchScreens } = await import('../src/palette-screens.ts');
const { TRACKERS } = await import('@markstage/core/head');

// as the server sends them: the pattern as the source of a regular expression
const trackers = Object.entries(TRACKERS).map(([id, t]: [string, any]) => ({ id, label: t.label, hint: t.hint, example: t.example, pattern: t.pattern.source }));
const by = Object.fromEntries(trackers.map((t) => [t.id, t]));

test('an ID is fine when empty or of the tool’s shape, and refused otherwise, as typed', () => {
  assert.equal(trackerOk(by.gtm, ''), true, 'empty: the tool is off');
  assert.equal(trackerOk(by.gtm, '  '), true);
  assert.equal(trackerOk(by.gtm, 'GTM-ABC1234'), true);
  assert.equal(trackerOk(by.gtm, ' GTM-ABC1234 '), true, 'spaces around it do not count');
  assert.equal(trackerOk(by.gtm, 'gtm-abc1234'), false);
  assert.equal(trackerOk(by.gtm, 'UA-12345-1'), false);
  assert.equal(trackerOk(by.ga4, 'G-ABC123DEF4'), true);
  assert.equal(trackerOk(by.ga4, 'GTM-ABC1234'), false, 'the wrong tool’s ID');
  assert.equal(trackerOk(by.plausible, 'example.com'), true);
  assert.equal(trackerOk(by.plausible, 'https://example.com'), false, 'a domain, not an address');
  assert.equal(trackerOk(by.skald, 'www.example.com'), true);
  assert.equal(trackerOk(by.ahrefs, 'a1B2c3D4e5F6g7H8i9J0kL'), true);
  assert.equal(trackerOk(by.ahrefs, '<script>'), false);
});

test('the server’s refusal gives its messages by the path of the setting; a stale version is told apart', () => {
  // what the editor's ApiError carries: the status and the whole answer
  const refusal = Object.assign(new Error('Fix it'), { status: 422, data: { issues: [{ path: 'feeds.1.path', message: 'A feed’s address ends in .xml.' }, { path: 'tracking.gtm', message: 'Not an ID.' }] } });
  assert.deepEqual([...issuesOf(refusal)], [['feeds.1.path', 'A feed’s address ends in .xml.'], ['tracking.gtm', 'Not an ID.']]);
  assert.deepEqual([...issuesOf(new Error('x'))], []);
  assert.equal(isStale(Object.assign(new Error('Reload'), { status: 409 })), true);
  assert.equal(isStale(refusal), false);
});

test('⌘K finds Search & AI and Tracking by their plain words, for a manager on a site that uses them', () => {
  const on = screenIndex('administrator', [], { head: true });
  assert.deepEqual(searchScreens('llms', 'administrator', on).map((s) => s.href), ['#/settings/search-ai']);
  assert.deepEqual(searchScreens('rss feed', 'administrator', on).map((s) => s.href), ['#/settings/search-ai']);
  assert.deepEqual(searchScreens('analytics', 'administrator', on).map((s) => s.href), ['#/settings/tracking']);
  assert.deepEqual(searchScreens('tag manager', 'owner', screenIndex('owner', [], { head: true })).map((s) => s.href), ['#/settings/tracking']);
  assert.equal(on.some((s) => s.href === '#/settings/search-ai'), true);
  assert.equal(screenIndex('administrator', []).some((s) => s.href.includes('search-ai') || s.href.includes('tracking')), false, 'a site without head has neither');
  assert.equal(screenIndex('editor', [], { head: true }).some((s) => s.href.includes('search-ai') || s.href.includes('tracking')), false, 'an editor does not');
});
