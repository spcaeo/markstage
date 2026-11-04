// Locks on site-shaped files (fixtures/site: an example site's pages, an article and its block pack): the owner's rules
// (pages: hero, credentials, contact can't be moved or deleted; cluster-list, page-list can't be deleted; articles:
// the FAQ can't be moved or deleted, the key takeaways can't be moved), an editor's own `_lock` and heading locks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createConverter } from '../src/index.mjs';
import { checkLocks, lockChanges, lockOf, lockRulesText, markOf, normalizeLockRules } from '../src/locks.mjs';
import pack from './fixtures/site/pack.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'site');
const RULES = {
  pages: { hero: { move: true, remove: true }, credentials: { move: true, remove: true }, contact: { move: true, remove: true }, 'cluster-list': { remove: true }, 'page-list': { remove: true } },
  articles: { faq: { move: true, remove: true }, takeaways: { move: true } },
};
const page = (name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'));
const types = (d) => d.sections.map((s) => s.discriminant);
const check = (b, a) => checkLocks({ data: b }, { data: a }, RULES).map((v) => [v.what, v.type ?? v.path, v.by]);
const reorder = (d, order) => ({ ...d, sections: order.map((i) => d.sections[i]) });

test('lockOf: flags as stored, or as data-lock writes them', () => {
  assert.deepEqual(lockOf({ move: true, remove: false, edit: true, by: 'x' }), { move: true, edit: true });
  assert.deepEqual(lockOf('move remove'), { move: true, remove: true });
  assert.deepEqual(lockOf(['remove', 'move', 'nothing']), { move: true, remove: true });
  // the rules exactly as markstage.config writes them work as well as site-config's normalized form
  const p = page('about-us');
  const raw = { pages: { hero: ['move', 'remove'] } };
  assert.deepEqual(checkLocks({ data: p }, { data: { ...p, sections: p.sections.slice(1) } }, raw).map((v) => v.what), ['remove']);
  assert.equal(lockOf({}), null);
  assert.equal(lockOf('nothing'), null);
});

test('a page: the hero and the credentials stay; other sections move past them; text in them may change', () => {
  const p = page('about-us');
  assert.deepEqual(types(p), ['hero', 'prose', 'credentials', 'cta']);
  assert.deepEqual(check(p, p), []);
  assert.deepEqual(check(p, { ...p, sections: p.sections.slice(1) }), [['remove', 'hero', 'the site']]);
  assert.deepEqual(check(p, reorder(p, [0, 1, 3])), [['remove', 'credentials', 'the site']]);
  // the prose dragged below the credentials, the call to action above the hero: allowed
  assert.deepEqual(check(p, reorder(p, [0, 2, 1, 3])), []);
  assert.deepEqual(check(p, reorder(p, [3, 0, 1, 2])), []);
  // the hero and the credentials changing places: one of them moved
  assert.deepEqual(check(p, reorder(p, [2, 1, 0, 3])), [['move', 'credentials', 'the site']]);
  // the site does not lock their text
  const edited = structuredClone(p);
  edited.sections[0].value.title = 'About Example Co (new)';
  assert.deepEqual(check(p, edited), []);
  // a section that is not locked may go
  assert.deepEqual(check(p, reorder(p, [0, 2, 3])), []);
});

test('a page: the contact section, and lists that can be moved but not deleted', () => {
  const c = page('contact-us');
  assert.deepEqual(check(c, { ...c, sections: c.sections.filter((s) => s.discriminant !== 'contact') }), [['remove', 'contact', 'the site']]);
  const m = page('data-migration');
  const at = (t) => types(m).indexOf(t);
  const without = (t) => ({ ...m, sections: m.sections.filter((s) => s.discriminant !== t) });
  assert.deepEqual(check(m, without('page-list')), [['remove', 'page-list', 'the site']]);
  assert.deepEqual(check(m, without('cluster-list')), [['remove', 'cluster-list', 'the site']]);
  // the cluster list moved to the top: allowed (only deleting is locked)
  const order = m.sections.map((_, i) => i).filter((i) => i !== at('cluster-list'));
  assert.deepEqual(check(m, reorder(m, [order[0], at('cluster-list'), ...order.slice(1)])), []);
});

test("an editor's own lock: on a list item, on a section's text; taking it off in the same save; markers reported", () => {
  const m = page('data-migration');
  const b = structuredClone(m);
  const cards = b.sections[5].value.items;
  cards[1]._lock = { remove: true };
  // another card deleted, and the locked one edited (only deleting is locked): allowed
  const a = structuredClone(b);
  a.sections[5].value.items.splice(0, 1);
  a.sections[5].value.items[0].title = `${a.sections[5].value.items[0].title} (edited)`;
  assert.deepEqual(check(b, a), []);
  const gone = structuredClone(b);
  gone.sections[5].value.items.splice(1, 1);
  const v = checkLocks({ data: b }, { data: gone }, RULES);
  assert.deepEqual(v.map((x) => [x.what, x.path, x.by]), [['remove', 'sections[5].value.items[1]', 'an editor']]);
  assert.match(v[0].message, /is locked by an editor: it can't be deleted\.$/);
  // a section locked against edits
  const ro = structuredClone(m);
  ro.sections[2]._lock = { edit: true };
  const typed = structuredClone(ro);
  typed.sections[2].value.items[0].title = 'Changed';
  assert.deepEqual(check(ro, typed), [['edit', 'feature', 'an editor']]);
  // the marker taken off in the same save: no longer binding, and reported as an unlock
  const off = structuredClone(typed);
  delete off.sections[2]._lock;
  assert.deepEqual(check(ro, off), []);
  assert.deepEqual(lockChanges({ data: ro }, { data: off }, RULES).map((c) => [c.change, c.path, c.from]), [['unlock', 'sections[2]', { edit: true }]]);
  assert.deepEqual(lockChanges({ data: m }, { data: ro }, RULES).map((c) => [c.change, c.to]), [['lock', { edit: true }]]);
  assert.deepEqual(lockChanges({ data: m }, { data: m }, RULES), []);
});

test('a lock inside a section\'s value (where the site\'s schema and the editor keep it) binds like one on the section', () => {
  // a site's legal pages (privacy-policy, terms-and-conditions) may carry sections[1].value._lock: {edit: true}
  const m = page('data-migration');
  const ro = structuredClone(m);
  ro.sections[2].value._lock = { edit: true };
  const typed = structuredClone(ro);
  typed.sections[2].value.items[0].title = 'Changed';
  assert.deepEqual(check(ro, typed), [['edit', 'feature', 'an editor']]);
  const gone = structuredClone(ro);
  gone.sections[2].value._lock = { remove: true };
  const cut = structuredClone(gone);
  cut.sections.splice(2, 1);
  assert.deepEqual(check(gone, cut), [['remove', 'feature', 'an editor']]);
  // taken off in the same save: an unlock, not an edit of the text
  const off = structuredClone(typed);
  delete off.sections[2].value._lock;
  assert.deepEqual(check(ro, off), []);
  assert.deepEqual(lockChanges({ data: ro }, { data: off }, RULES).map((c) => [c.change, c.path, c.from]), [['unlock', 'sections[2]', { edit: true }]]);
  assert.deepEqual(lockChanges({ data: m }, { data: ro }, RULES).map((c) => [c.change, c.to]), [['lock', { edit: true }]]);
  // both places: the section's own marker wins action by action
  const both = structuredClone(m);
  both.sections[2]._lock = { edit: false };
  both.sections[2].value._lock = { edit: true, remove: true };
  const both2 = structuredClone(both);
  both2.sections[2].value.items[0].title = 'Changed';
  assert.deepEqual(check(both, both2), []);
  const both3 = structuredClone(both);
  both3.sections.splice(2, 1);
  assert.deepEqual(check(both, both3), [['remove', 'feature', 'an editor']]);
});

test("the page's own lock: layout (nothing added, deleted or reordered), read-only", () => {
  const p = { ...page('about-us'), _lock: { layout: true } };
  assert.deepEqual(check(p, reorder(p, [0, 2, 1, 3])), [['layout', 'sections', 'an editor']]);
  assert.deepEqual(check(p, reorder(p, [0, 1, 2])), [['layout', 'sections', 'an editor']]);
  const text = structuredClone(p);
  text.sections[1].value.title = 'New words';
  assert.deepEqual(check(p, text), [], 'the text may change');
  const ro = { ...page('about-us'), _lock: { edit: true } };
  const t2 = structuredClone(ro);
  t2.title = 'x';
  assert.deepEqual(check(ro, t2), [['edit', '', 'an editor']]);
});

test('an article: the FAQ stays (questions may change), the key takeaways keep their place, heading locks', () => {
  const text = fs.readFileSync(path.join(dir, 'planning-tools-compared.md'), 'utf8');
  const conv = createConverter({ packs: [pack] });
  const art = conv.mdToDoc(text);
  const blocks = art.doc.content;
  const faqAt = blocks.findIndex((n) => n.type === 'faq');
  assert.equal(blocks.filter((n) => n.type === 'faq').length, 6);
  const with_ = (content, fm = art.frontmatter) => ({ frontmatter: fm, doc: { ...art.doc, content } });
  const chk = (a, b = art) => checkLocks(b, a, RULES).map((v) => [v.what, v.type, v.by]);
  assert.deepEqual(chk(art), []);
  // every question deleted: the FAQ is gone
  assert.deepEqual(chk(with_(blocks.filter((n) => n.type !== 'faq'))), [['remove', 'faq', 'the site']]);
  // one question deleted: the FAQ is still there
  assert.deepEqual(chk(with_(blocks.filter((_, i) => i !== faqAt + 2))), []);
  // the takeaways moved below the FAQ: they changed places with it
  const tk = blocks[0];
  const swapped = chk(with_([...blocks.slice(1), tk]));
  assert.equal(swapped.length, 1);
  assert.equal(swapped[0][0], 'move');
  assert.ok(['takeaways', 'faq'].includes(swapped[0][1]), 'one of the two moved (they changed places)');
  // a paragraph moved above the takeaways: allowed
  const para = blocks.findIndex((n) => n.type === 'paragraph');
  assert.deepEqual(chk(with_([blocks[para], ...blocks.filter((_, i) => i !== para)])), []);
  // a section under a heading, locked in the frontmatter
  const fm = { ...art.frontmatter, locks: [{ heading: 'Quick Comparison: 7 Hearth Alternatives', remove: true, edit: true }] };
  const locked = with_(blocks, fm);
  const h = blocks.findIndex((n) => n.type === 'heading' && n.content?.[0]?.text?.startsWith('Quick Comparison'));
  const next = blocks.findIndex((n, i) => i > h && n.type === 'heading' && n.attrs.level <= 2);
  const changed = structuredClone(blocks);
  changed[h + 1] = { type: 'paragraph', content: [{ type: 'text', text: 'Changed.' }] };
  assert.deepEqual(chk(with_(changed, fm), locked), [['edit', 'heading:Quick Comparison: 7 Hearth Alternatives', 'an editor']]);
  assert.deepEqual(chk(with_([...blocks.slice(0, h), ...blocks.slice(next)], fm), locked), [['remove', 'heading:Quick Comparison: 7 Hearth Alternatives', 'an editor']]);
  assert.deepEqual(chk(with_(changed, art.frontmatter), locked), [], 'unlocked in the same save');
  assert.deepEqual(lockChanges(art, locked, RULES).map((c) => [c.change, c.label]), [['lock', 'The section “Quick Comparison: 7 Hearth Alternatives”']]);
});

test('"Unlock on this page": a false in the entry\'s own marker lifts the site\'s rule there, and only there', () => {
  const p = page('about-us');
  assert.deepEqual(markOf({ move: false, remove: false, by: 'Olive Owner', at: '2026-10-28T10:00:00Z' }), { move: false, remove: false });
  const lifted = structuredClone(p);
  lifted.sections[0]._lock = { move: false, remove: false, by: 'Olive Owner', at: '2026-10-28T10:00:00Z' };
  // the override itself is an unlock of a site rule
  assert.deepEqual(lockChanges({ data: p }, { data: lifted }, RULES).map((c) => [c.change, c.path, c.rule, c.to]), [['unlock', 'sections[0]', 'site', { move: false, remove: false }]]);
  // with it stored, the hero may go, and may change places with the credentials (whose rule still holds alone)
  assert.deepEqual(check(lifted, { ...lifted, sections: lifted.sections.slice(1) }), []);
  assert.deepEqual(check(lifted, reorder(lifted, [2, 1, 0, 3])), []);
  // lifted and deleted in one save: the marker leaves with the section, so it reads as a plain delete (lift, then delete)
  assert.deepEqual(check(p, { ...lifted, sections: lifted.sections.slice(1) }), [['remove', 'hero', 'the site']]);
  // only what it lifts: the hero lifted for moving still can't be deleted
  const moveOnly = structuredClone(p);
  moveOnly.sections[0]._lock = { move: false };
  assert.deepEqual(check(moveOnly, { ...moveOnly, sections: moveOnly.sections.slice(1) }), [['remove', 'hero', 'the site']]);
  // the override taken off again: the rule is back (a lock of a site rule); the other pages never had it lifted
  const back = structuredClone(lifted);
  delete back.sections[0]._lock;
  assert.deepEqual(lockChanges({ data: lifted }, { data: back }, RULES).map((c) => [c.change, c.rule]), [['lock', 'site']]);
  assert.deepEqual(check(back, { ...back, sections: back.sections.slice(1) }), [['remove', 'hero', 'the site']]);
  // a marker that both lifts the rule and locks something else is a change
  const both = structuredClone(p);
  both.sections[0]._lock = { remove: false, edit: true };
  assert.equal(lockChanges({ data: p }, { data: both }, RULES)[0].change, 'change');
});

test('an article: box locks in the frontmatter, for every run of that box: lifting a site rule, or a lock of its own', () => {
  const text = fs.readFileSync(path.join(dir, 'planning-tools-compared.md'), 'utf8');
  const art = createConverter({ packs: [pack] }).mdToDoc(text);
  const blocks = art.doc.content;
  const as = (content, locks) => ({ frontmatter: { ...art.frontmatter, ...(locks ? { locks } : {}) }, doc: { ...art.doc, content } });
  const noFaq = blocks.filter((n) => n.type !== 'faq');
  const chk = (b, a) => checkLocks(b, a, RULES).map((v) => [v.what, v.type, v.by]);
  const lift = [{ box: 'faq', move: false, remove: false, by: 'Olive Owner', at: '2026-10-28T10:00:00Z' }];
  // stored lifted: the FAQ may go
  assert.deepEqual(chk(as(blocks, lift), as(noFaq, lift)), []);
  assert.deepEqual(chk(as(blocks), as(noFaq, lift)), [], 'lifted in the same save');
  assert.deepEqual(lockChanges(as(blocks), as(noFaq, lift), RULES).map((c) => [c.change, c.box, c.rule, c.path]), [['unlock', 'faq', 'site', 'locks']]);
  // not lifted: the site's rule
  assert.deepEqual(chk(as(blocks), as(noFaq)), [['remove', 'faq', 'the site']]);
  // a lock of its own on a box the site leaves free (takeaways: only moving is locked by the site)
  const own = [{ box: 'takeaways', remove: true }];
  const noTk = blocks.filter((n) => n.type !== 'takeaways');
  assert.deepEqual(chk(as(blocks, own), as(noTk, own)), [['remove', 'takeaways', 'an editor']]);
  assert.deepEqual(lockChanges(as(blocks), as(blocks, own), RULES).map((c) => [c.change, c.box, c.rule]), [['lock', 'takeaways', undefined]]);
  // unchanged locks: no change reported, whatever by and at say
  assert.deepEqual(lockChanges(as(blocks, lift), as(blocks, [{ ...lift[0], by: 'Someone Else' }]), RULES), []);
});

test('an article: every box of a run counts, and a box locked in itself stays locked where the frontmatter lifts its kind', () => {
  const text = fs.readFileSync(path.join(dir, 'planning-tools-compared.md'), 'utf8');
  const art = createConverter({ packs: [pack] }).mdToDoc(text);
  const blocks = art.doc.content;
  const faqAt = blocks.findIndex((n) => n.type === 'faq');
  assert.ok(blocks[faqAt + 1].type === 'faq', 'the fixture has a run of FAQs');
  const as = (content, locks) => ({ frontmatter: { ...art.frontmatter, ...(locks ? { locks } : {}) }, doc: { ...art.doc, content } });
  /** The blocks with the 2nd FAQ of the run carrying this lock attribute. */
  const second = (lock) => blocks.map((n, i) => (i === faqAt + 1 ? { ...n, attrs: { ...n.attrs, lock } } : n));
  const noFaq = blocks.filter((n) => n.type !== 'faq');
  const tk = blocks.findIndex((n) => n.type === 'takeaways');
  const chk = (b, a) => checkLocks(b, a, RULES).map((v) => [v.what, v.type, v.by]);
  const lift = [{ box: 'faq', move: false, remove: false }];
  // (1) the frontmatter lifts the site's rule for FAQs, but one FAQ an editor locked keeps its own lock
  const locked = second({ remove: true });
  assert.deepEqual(chk(as(locked, lift), as(noFaq, lift)), [['remove', 'faq', 'an editor']]);
  assert.deepEqual(chk(as(blocks, lift), as(noFaq, lift)), [], 'without it the lifted run may go');
  // its lock taken off in the same save is an unlock an editor must make, reported even though the frontmatter names faq
  assert.deepEqual(lockChanges(as(locked, lift), as(blocks, lift), RULES).map((c) => [c.change, c.type]), [['unlock', 'faq']]);
  assert.deepEqual(lockChanges(as(blocks, lift), as(locked, lift), RULES).map((c) => [c.change, c.type]), [['lock', 'faq']]);
  // (2) a lock on the 2nd box of a run binds the run, with no rule and no frontmatter at all
  const free = {};
  const runMoved = (content) => [...content.slice(faqAt), ...content.slice(0, faqAt)];
  assert.deepEqual(checkLocks(as(second({ move: true })), as(runMoved(second({ move: true }))), free).length, 0, 'moving past an unlocked block is not a move of the run');
  const tkLocked = blocks.map((n, i) => (i === tk ? { ...n, attrs: { ...n.attrs, lock: { move: true } } } : n));
  const both2 = tkLocked.map((n, i) => (i === faqAt + 1 ? { ...n, attrs: { ...n.attrs, lock: { move: true } } } : n));
  assert.deepEqual(
    checkLocks(as(both2), as(runMoved(both2)), free).map((v) => [v.what, v.type]),
    [['move', 'faq']],
    'two move-locked units changed places (the run went far): one of them moved',
  );
  assert.deepEqual(checkLocks(as(second({ remove: true })), as(noFaq), free).map((v) => [v.what, v.type, v.by]), [['remove', 'faq', 'an editor']]);
  assert.deepEqual(lockChanges(as(blocks), as(second({ remove: true })), free).map((c) => [c.change, c.type]), [['lock', 'faq']]);
  // a contributor-style save that only drops the 2nd box's lock is seen as an unlock, not a silent edit
  assert.deepEqual(lockChanges(as(second({ remove: true })), as(blocks), free).map((c) => [c.change, c.type]), [['unlock', 'faq']]);
});

test('the rules as a file: either form in, the list form out (sorted), a wrong shape refused in words', () => {
  assert.deepEqual(normalizeLockRules({ pages: { hero: ['remove', 'move'], cta: { move: true, remove: false } } }), { pages: { hero: { move: true, remove: true }, cta: { move: true } }, articles: {} });
  assert.equal(lockRulesText({ articles: { faq: { remove: true, move: true } }, pages: { 'page-list': ['remove'], hero: ['move'] } }), '{\n  "pages": {\n    "hero": [\n      "move"\n    ],\n    "page-list": [\n      "remove"\n    ]\n  },\n  "articles": {\n    "faq": [\n      "move",\n      "remove"\n    ]\n  }\n}\n');
  assert.deepEqual(normalizeLockRules(JSON.parse(lockRulesText(RULES))), normalizeLockRules(RULES), 'round trip');
  for (const bad of [[], { posts: {} }, { pages: { hero: ['fly'] } }, { pages: { '../x': ['move'] } }, { pages: { hero: 'move' } }]) assert.throws(() => normalizeLockRules(bad), /^Error: Lock rules: /);
  // a type with nothing locked is left out
  assert.deepEqual(normalizeLockRules({ pages: { hero: [] } }), { pages: {}, articles: {} });
});
