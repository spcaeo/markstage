// The Releases screens' words (src/releases/words.ts): what a release holds, when it goes live, its preview, and
// whether it can be published now, in the words the screens show.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// the editor's sources import each other without the extension (Vite resolves them): so does this test
registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx);
    } catch (e) {
      if (spec.startsWith('.') && !/\.\w+$/.test(spec)) return next(`${spec}.ts`, ctx);
      throw e;
    }
  },
});
const { countWords, currentApprovals, fromLocal, previewWords, publishable, toLocal, whenWords } = await import('../src/releases/words.ts');

const counts = (entries: number, library: number, media: number) => ({ items: entries + library + media, entries, library, media });
const allow = { effect: 'allow' as const, rule: null, words: 'Allowed.', missing: [] };

test('what a release holds, in words', () => {
  assert.equal(countWords(counts(0, 0, 0)), 'Nothing yet');
  assert.equal(countWords(counts(1, 0, 0)), '1 page');
  assert.equal(countWords(counts(3, 0, 2)), '3 pages and 2 pictures');
  assert.equal(countWords(counts(3, 1, 2)), '3 pages, 1 Library item and 2 pictures');
});

test('when it goes live: scheduled, blocked, live, going live; nothing for an open one', () => {
  const at = '2026-11-02T09:00:00.000Z';
  assert.match(whenWords({ status: 'scheduled', publishAt: at, publishedAt: null, blocked: null }), /^Goes live Nov\.? 2, 2026, /);
  assert.match(whenWords({ status: 'scheduled', publishAt: at, publishedAt: null, blocked: { words: 'A freeze is set.', rule: null, code: 'rule', at } }), /^Was due Nov\.? 2, 2026, .*: blocked$/);
  assert.match(whenWords({ status: 'published', publishAt: null, publishedAt: at, blocked: null }), /^Live since Nov\.? 2, 2026/);
  assert.equal(whenWords({ status: 'publishing', publishAt: null, publishedAt: null, blocked: null }), 'Going live now');
  assert.equal(whenWords({ status: 'open', publishAt: null, publishedAt: null, blocked: null }), '');
});

test('the preview in words: none, building, failed, stale in the server’s words, up to date', () => {
  const p = (x: object) => ({ status: 'ready', fresh: true, builtAt: null, buildTime: null, job: null, error: null, key: 'k', head: null, content: null, stale: false, words: null, ...x }) as never;
  assert.equal(previewWords(undefined, false).build, 'Build the preview');
  assert.equal(previewWords(p({ status: 'building' }), true).text, 'Building the preview, as of the time it goes live…');
  assert.deepEqual(previewWords(p({ status: 'failed', error: 'astro build failed' }), false), { tone: 'bad', text: 'The preview did not build: astro build failed', build: 'Build it again' });
  const stale = previewWords(p({ fresh: false, stale: true, words: 'The site changed since this preview was built.' }), false);
  assert.deepEqual(stale, { tone: 'warn', text: 'The site changed since this preview was built.', build: 'Build it again' });
  assert.equal(previewWords(p({ fresh: false, stale: true }), false).text, 'This preview is out of date: build it again.');
  assert.equal(previewWords(p({}), false).tone, 'ok');
});

test('approvals count only for what the release holds now', () => {
  const a = (sha: string) => ({ userId: 'u', name: 'Sam', role: 'editor', sha, at: '' });
  assert.equal(currentApprovals({ key: 'k2', approvals: [a('k1'), a('k2')] }).length, 1);
});

test('publish: open, with items, none changed on the site, and the rules allow (a typed reason meets that need)', () => {
  const r = (x: object) => ({ status: 'open' as const, counts: counts(1, 0, 0), items: [], decision: allow, ...x }) as never;
  assert.equal(publishable(r({}), '').ok, true);
  assert.deepEqual(publishable(r({ status: 'published' }), ''), { ok: false, why: 'The release is live.' });
  assert.match(publishable(r({ counts: counts(0, 0, 0) }), '').why, /^Put something in it first/);
  const changed = [{ title: 'Pricing', changedSince: true }, { title: 'Home', changedSince: true }];
  assert.equal(publishable(r({ items: changed }), '').why, '“Pricing” and “Home” changed on the site since they were added. Add them again to take the latest.');
  const needs = { effect: 'needs' as const, rule: null, words: '', missing: [{ kind: 'approval', words: '1 more approval' }, { kind: 'reason', words: 'a reason' }] };
  assert.equal(publishable(r({ decision: needs }), '').why, 'Still needs 1 more approval and a reason.');
  assert.equal(publishable(r({ decision: needs }), 'Launch').why, 'Still needs 1 more approval.');
  assert.equal(publishable(r({ decision: { ...needs, missing: [needs.missing[1]] } }), 'Launch').ok, true);
  assert.deepEqual(publishable(r({ decision: { effect: 'deny', rule: null, words: 'Nobody may publish a release during a freeze.', missing: [] } }), ''), { ok: false, why: 'Nobody may publish a release during a freeze.' });
});

test('a datetime-local value goes to ISO and back', () => {
  assert.equal(fromLocal(''), '');
  assert.equal(fromLocal('nonsense'), '');
  const iso = fromLocal('2026-11-02T09:30');
  assert.equal(toLocal(iso), '2026-11-02T09:30');
  assert.equal(toLocal(null), '');
});
