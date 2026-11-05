// The live demo's stand-in for the server (src/demo/standin.ts), on the recorded answers (scripts/demo/recorded):
// reads replay what the server said, a save writes the Markdown with core's surgical converter and keeps it in the
// tab, a stale version is a conflict, and every other change is the one friendly refusal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createConverter, readFrontmatter, setFrontmatter } from '@markstage/core';
import { createStandIn, NOT_IN_DEMO, versionOf, type Recorded } from '../src/demo/standin.ts';
import { DemoStore, STORAGE_KEY } from '../src/demo/store.ts';

const recorded = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../../scripts/demo/recorded/api.json'), 'utf8')) as Recorded;
const md = createConverter({ packs: [] });

class Memory {
  map = new Map<string, string>();
  getItem = (k: string) => this.map.get(k) ?? null;
  setItem = (k: string, v: string) => void this.map.set(k, v);
  removeItem = (k: string) => void this.map.delete(k);
}

function standIn(storage = new Memory()) {
  const store = new DemoStore(storage);
  const answer = createStandIn({
    recorded,
    collections: [{ id: 'posts', format: 'md', dir: 'src/content/posts', titleKey: 'title' }],
    site: '/demo/blog/',
    md: () => md as never,
    readFrontmatter,
    setFrontmatter,
    store,
    now: () => new Date('2026-11-04T12:00:00Z'),
  });
  return { answer, store, storage };
}

const ID = 'hello-markstage';
const E = `collections/posts/entries/${ID}`;

test('reads are the recorded answers; an unknown query of a known path gets that path', () => {
  const { answer } = standIn();
  assert.deepEqual(answer('GET', 'auth/me').body, recorded['auth/me'].body);
  assert.equal(answer('GET', 'collections/posts/entries?sort=title&perPage=20').status, 200);
  assert.equal(answer('GET', 'no/such/route').status, 501);
  assert.equal((answer('GET', 'no/such/route').body as { message: string }).message, NOT_IN_DEMO);
});

test('a preview is the demo blog’s own page, under its base path', () => {
  const { answer } = standIn();
  assert.deepEqual(answer('GET', `preview/posts/${ID}`).body, { url: `/demo/blog/posts/${ID}/`, devServer: true });
});

test('a save writes only the changed heading, with core’s converter, and later reads see it', () => {
  const { answer, store, storage } = standIn();
  const entry = answer('GET', E).body as { version: string; doc: { content: { type: string; content?: { text: string }[] }[] } };
  const source = (answer('GET', `${E}/source`).body as { source: string }).source;
  const doc = structuredClone(entry.doc);
  const h2 = doc.content.find((n) => n.type === 'heading')!;
  h2.content![0].text += ' (edited)';
  const r = answer('PUT', E, JSON.stringify({ doc, version: entry.version }));
  assert.equal(r.status, 200);
  const body = r.body as { ok: boolean; version: string; changedBlocks: number };
  assert.equal(body.changedBlocks, 1);
  assert.ok(r.saved);
  assert.equal(r.saved!.file, `src/content/posts/${ID}.md`);
  assert.equal(r.saved!.before, source);
  // byte for byte the same file, but for that one heading
  const was = h2.content![0].text.replace(' (edited)', '');
  assert.equal(r.saved!.after, source.replace(`## ${was}\n`, `## ${was} (edited)\n`));
  assert.equal(body.version, versionOf(r.saved!.after));
  // the entry, its source and the tab's storage follow the save
  assert.equal((answer('GET', `${E}/source`).body as { source: string }).source, r.saved!.after);
  assert.equal((answer('GET', E).body as { version: string }).version, body.version);
  assert.ok(storage.getItem(STORAGE_KEY)!.includes('(edited)'));
  assert.equal(store.changedFiles().length, 1);
  // a refresh: a new stand-in on the same storage keeps the save
  assert.equal((standIn(storage).answer('GET', `${E}/source`).body as { source: string }).source, r.saved!.after);
  // the old version is a conflict now
  assert.equal(answer('PUT', E, JSON.stringify({ doc, version: entry.version })).status, 409);
});

test('a settings change goes through the surgical frontmatter writer; status keys are refused', () => {
  const { answer } = standIn();
  const entry = answer('GET', E).body as { version: string; title: string };
  const r = answer('PUT', E, JSON.stringify({ version: entry.version, frontmatter: { title: 'Hello again' } }));
  assert.equal(r.status, 200);
  assert.match(r.saved!.after, /^title: Hello again$/m);
  assert.equal((answer('GET', E).body as { title: string }).title, 'Hello again');
  const index = answer('GET', 'index').body as { items: { id: string; title: string }[] };
  assert.equal(index.items.find((i) => i.id === ID)!.title, 'Hello again');
  const v = (answer('GET', E).body as { version: string }).version;
  assert.equal(answer('PUT', E, JSON.stringify({ version: v, frontmatter: { draft: true } })).status, 422);
});

test('the same text again is no change; Source mode saves the text as given', () => {
  const { answer } = standIn();
  const src = answer('GET', `${E}/source`).body as { source: string; version: string };
  const same = answer('PUT', `${E}/source`, JSON.stringify({ source: src.source, version: src.version }));
  assert.equal((same.body as { changedBlocks: number }).changedBlocks, 0);
  assert.equal(same.saved, undefined);
  const next = answer('PUT', `${E}/source`, JSON.stringify({ source: `${src.source}\nA new line.\n`, version: src.version }));
  assert.equal(next.saved!.after, `${src.source}\nA new line.\n`);
});

test('presence is answered quietly; every other change is the one friendly refusal', () => {
  const { answer } = standIn();
  assert.equal(answer('POST', `${E}/presence`, JSON.stringify({ tab: 't', mode: 'editing' })).status, 200);
  assert.equal(answer('DELETE', `${E}/presence?tab=t`).status, 200);
  for (const [m, p] of [
    ['POST', `${E}/publish`],
    ['POST', 'releases'],
    ['POST', 'users'],
    ['PUT', 'site/locks'],
    ['POST', 'media?filename=a.png'],
    ['POST', 'ai/suggest'],
    ['POST', 'env/fetch'],
    ['POST', 'auth/login'],
    ['POST', 'auth/logout'],
    ['DELETE', `${E}?version=x`],
  ]) {
    const r = answer(m, p, '{}');
    assert.equal(r.refused, true, `${m} ${p}`);
    assert.equal(r.status, 501);
    assert.deepEqual(r.body, { error: 'not-in-demo', message: NOT_IN_DEMO });
  }
});
