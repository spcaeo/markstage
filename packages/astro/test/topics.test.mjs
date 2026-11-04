// Topics for the site's own layout (@markstage/astro/topics, docs/API-LINKS.md), on a throwaway project: the topic
// files read and normalized (an unreadable one left out), where a page sits, and the "More on this topic" list (its
// group first, then the topic's main page, then the rest; never the page itself).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { normalizeConfig } from '../src/config.mjs';
import { readTopics, topicsOf } from '../src/topics.mjs';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'markstage-topics-')));
const dir = path.join(root, 'markstage/topics');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'editing.json'), JSON.stringify({ title: 'Editing', pillar: 'posts/guide', members: ['posts/loose'], groups: [{ id: 'modes', name: 'Modes', lead: 'posts/canvas', members: ['posts/source', 'posts/keys'] }, { id: 'other', name: 'Other', lead: null, members: ['posts/far'] }] }));
fs.writeFileSync(path.join(dir, 'broken.json'), '{ not json');
const cfg = normalizeConfig({ collections: [{ id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/posts', url: '/posts/{slug}/' }], topics: true }, root);

test('topic files are read and normalized; a broken one is left out', () => {
  const list = readTopics(cfg);
  assert.deepEqual(list.map((t) => t.id), ['editing']);
  assert.deepEqual(list[0].groups.map((g) => g.name), ['Modes', 'Other']);
  assert.deepEqual(readTopics(normalizeConfig({ collections: [] }, root)), []);
});

test('where a page sits, and More on this topic: its group first, the main page, then the rest', () => {
  const t = topicsOf(cfg);
  assert.deepEqual(t.placeOf('posts', 'source'), { topic: 'editing', group: 'modes', role: 'member' });
  assert.equal(t.placeOf('posts', 'nowhere'), null);
  assert.deepEqual(t.moreOnTopic('posts', 'source').map((m) => m.id), ['canvas', 'keys', 'guide', 'loose', 'far']);
  assert.deepEqual(t.moreOnTopic('posts', 'source', { limit: 2 }).map((m) => `${m.collection}/${m.id}:${m.role}`), ['posts/canvas:lead', 'posts/keys:member']);
  assert.deepEqual(t.moreOnTopic('posts', 'guide').map((m) => m.id), ['loose', 'canvas', 'source', 'keys', 'far']);
  assert.deepEqual(t.moreOnTopic('posts', 'nowhere'), []);
});
