// The Import screen's plain words (src/admin/import/words.ts): the dry run's one line, what it would do, what it did.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { planSentence, planLines, resultLines, reviewKind, count } = await import('../src/admin/import/words.ts');

const counts = (over = {}) => ({ types: { post: 142, page: 18 }, entries: { create: 160 }, media: { fetch: 1204 }, authors: { create: 2, existing: 1 }, redirects: 200, ids: 180, collisions: 6, needsAlt: 31, notConverted: 4, embeds: 3, published: 150, left: {}, unusedMedia: 0, other: {}, ...over });
const media = (n: number, pdf = 0) => [...Array.from({ length: n }, (_, i) => ({ url: `https://old.example.com/a${i}.jpg` })), ...Array.from({ length: pdf }, (_, i) => ({ url: `https://old.example.com/f${i}.pdf` }))];

test('the dry run in one line, as the owner asked for it', () => {
  const plan = { counts: counts(), mapping: { onCollision: 'both' }, media: media(1204) };
  assert.equal(planSentence(plan as never), '142 posts, 18 pages, 1,204 images; 6 slugs already exist (kept both); 31 images need alt text; 4 blocks we could not convert');
  const one = { counts: counts({ types: { post: 1 }, collisions: 1, needsAlt: 1, notConverted: 0 }), mapping: { onCollision: 'skip' }, media: media(1, 2) };
  assert.equal(planSentence(one as never), '1 post, 1 image, 2 files; 1 slug already exists (skip); 1 image needs alt text');
  assert.equal(planSentence({ counts: counts({ types: { blog_post: 3 }, collisions: 0, needsAlt: 0, notConverted: 0 }), mapping: { onCollision: 'both' }, media: [] } as never), '3 blog posts, 0 images');
});

test('what it would do, and what it did, line by line', () => {
  const lines = planLines({ counts: counts({ left: { product: 4 }, other: { nav_menu_item: 7 } }), product: 'wordpress', media: media(3) } as never);
  assert.match(lines[0], /^160 entries to create, 0 to update, 0 unchanged, 0 left out\.$/);
  assert.match(lines[1], /^1,204 images and files to bring in\.$/);
  assert.ok(lines.some((l) => /Everything comes in as a draft: 150 entries that were published on WordPress are ready/.test(l)));
  assert.ok(lines.some((l) => /4 products left out/.test(l)));
  assert.ok(lines.some((l) => /7 nav menu items not brought over/.test(l)));
  const done = resultLines({ counts: { entries: { create: 3, unchanged: 1 }, media: { fetch: 2 }, authors: { create: 1 }, review: {}, redirects: 4, ids: 2, commits: 4 } } as never, 'ghost');
  assert.deepEqual(done, ['3 entries created, 0 updated, 1 unchanged, 0 left out.', '2 images and files brought in.', '1 author added.', '6 old addresses now point to the new pages; they go live with the next publish.', '4 changes in the site’s history, by you, from Ghost.']);
  assert.equal(reviewKind('alt'), 'Needs alt text');
  assert.equal(reviewKind('something-new'), 'Check this');
  assert.equal(count(1, 'entry', 'entries'), '1 entry');
});
