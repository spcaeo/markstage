// The search help's AI kinds (docs/API-AI.md "links", "fix" and seo's `problem`): internal links for the open article,
// picked from the site's own link index, and a fix for one problem the SEO check found (a search title too long or
// short; a description missing, too long or too short; a heading out of order; vague link words). Like every kind, a
// suggestion writes nothing: the writer accepts it in the editor, through the normal change path.
//
// Nothing the model says is taken on trust. A link's page must be one of the pages it was offered (from the index,
// never an address it made up), live or a draft this person may see, not linked from the article already, and its
// words must stand in the article as written. A fix must fix what it was asked to: a heading's level in order, link
// words that are not vague and are in their sentence, a title that is shorter when it was too long.
import { isGeneric } from '@markstage/core/link-map';
import { CAPS, DATA, NOT_FORM, bodyOf, capped, failed, jsonAnswer, jsonOf, unprocessable } from './shared.mjs';

/** The most links one ask returns; the pages the model may pick from; the editor's links sent; an outline's size. */
export const LINKS_MAX = 10;
const CANDIDATES = 60;
const LINKED_MAX = 500;
const HEADINGS_MAX = 300;
/** Link words, at most (characters). */
const WORDS_MAX = 120;

const wordsOf = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .match(/[\p{L}\p{N}]+/gu) ?? [];
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Where `phrase` stands in `text` as whole words (any case; a run of spaces as one): the words as the text has them, or null. */
export function findWords(text, phrase) {
  const parts = String(phrase).trim().split(/\s+/).filter(Boolean).map(escape);
  if (!parts.length) return null;
  const m = new RegExp(`(?<![\\p{L}\\p{N}])${parts.join('[ \\u00a0]+')}(?![\\p{L}\\p{N}])`, 'iu').exec(text);
  return m ? m[0] : null;
}

/** The stub's links (no model): for each page in order, the longest run of two or more of its title's words the text has. */
function stubLinks(pages, text, max) {
  const out = [];
  for (const p of pages) {
    const ws = String(p.title).split(/\s+/).filter(Boolean);
    let best = null;
    for (let n = Math.min(ws.length, 6); n >= 2 && !best; n--)
      for (let i = 0; i + n <= ws.length && !best; i++) {
        const phrase = ws.slice(i, i + n).join(' ').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
        if (phrase.length >= 5 && !isGeneric(phrase) && findWords(text, phrase)) best = phrase;
      }
    if (best) out.push({ words: best, to: p.ref, reason: `Stub: the article names “${p.title}”.` });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * `links`: up to `max` internal links for the open article. The pages offered are the link index's (the site keeps
 * topics), each with an address, not hidden from search engines, live or a draft this person may see, and not linked
 * from the article yet (its saved links, and `linked`: the editor's links now, unsaved too). The best matches go
 * first (title words in the text, the same topic), at most CANDIDATES of them.
 */
export function links(body, entry, kit) {
  if (!entry) throw unprocessable('invalid', 'links needs the entry: collection and id.', { field: 'id' });
  const index = kit.linkIndex();
  if (!index) throw unprocessable('no-topics', 'This site keeps no link index (topics in its markstage.config), so there are no pages to pick links from.');
  const max = body.max === undefined ? 5 : body.max;
  if (!Number.isInteger(max) || max < 1 || max > LINKS_MAX) throw unprocessable('invalid', `max is a whole number from 1 to ${LINKS_MAX}.`, { field: 'max' });
  const linked = body.linked ?? [];
  if (!Array.isArray(linked) || linked.length > LINKED_MAX || linked.some((h) => typeof h !== 'string' || h.length > CAPS.field)) throw unprocessable('invalid', `linked is a list of at most ${LINKED_MAX} addresses.`, { field: 'linked' });
  const text = capped(body, 'text', CAPS.text) || bodyOf(entry.c, entry.text).slice(0, CAPS.text);
  if (!text) throw unprocessable('invalid', 'The page has no text to link from yet.', { field: 'text' });
  const self = `${entry.c.id}/${entry.id}`;
  const { map } = index;
  const me = map.pages.get(self);
  const already = new Set(me?.to ?? []);
  for (const h of linked) {
    const ref = index.refOf(h);
    if (ref) already.add(ref);
  }
  const have = new Set(wordsOf(text).filter((w) => w.length > 3));
  const score = (p) => wordsOf(p.title).filter((w) => w.length > 3 && have.has(w)).length + (me?.topic && p.topic === me.topic ? 2 : 0);
  const pages = [...map.pages.values()]
    .filter((p) => p.ref !== self && p.url && !p.noindex && !already.has(p.ref) && kit.canSee(p))
    .map((p) => ({ p, s: score(p) }))
    .sort((a, b) => b.s - a.s || a.p.title.localeCompare(b.p.title))
    .slice(0, CANDIDATES)
    .map((x) => x.p);
  if (!pages.length) throw unprocessable('no-pages', 'There is no page to suggest: this one links to every other page of the site you may link to, or there is none.');
  const offered = new Map(pages.map((p) => [p.ref, p]));
  return {
    target: self,
    system: [
      `You suggest internal links for one article of a website: up to ${max} of the site's pages, from the list given, that a reader of this article would want next.`,
      'For each: the exact words of the article to make into the link (2 to 6 words that name what the linked page is about, copied as they are written; never vague words such as "click here" or "read more"), the page as its ref in the list, and one short reason (at most 120 characters).',
      'Only pages from the list, each at most once, and each words at most once. No page whose subject the article does not mention. Fewer is fine; none is fine.',
      DATA,
      'Answer with JSON only: {"links": [{"words": "…", "to": "<ref>", "reason": "…"}]}',
    ].join('\n'),
    content: [{ type: 'text', text: `<article>\nTitle: ${entry.summary.title ?? ''}\n\n${text}\n</article>\n<pages>\n${pages.map((p) => `${p.ref} | ${p.title} | ${p.url}`).join('\n')}\n</pages>` }],
    stub: () => ({ links: stubLinks(pages, text, max) }),
    answer: (t) => {
      const v = jsonOf(t);
      if (!Array.isArray(v?.links)) throw failed(NOT_FORM);
      const out = [];
      const seen = new Set();
      let dropped = 0;
      for (const x of v.links.slice(0, LINKS_MAX * 3)) {
        if (out.length >= max) break;
        const p = typeof x?.to === 'string' ? offered.get(x.to.trim()) : null;
        const said = typeof x?.words === 'string' ? x.words.trim() : '';
        // a page it was not offered, words not in the article (or vague, or too long), or one it named already
        const found = p && said && said.length <= WORDS_MAX && !isGeneric(said, index.generic) ? findWords(text, said) : null;
        if (!found || seen.has(p.ref) || seen.has(`w:${found.toLowerCase()}`)) {
          dropped++;
          continue;
        }
        seen.add(p.ref).add(`w:${found.toLowerCase()}`);
        const reason = typeof x.reason === 'string' && x.reason.trim() ? x.reason.trim().slice(0, 200) : 'A page on the same subject.';
        out.push({ words: found, to: p.ref, title: p.title, url: p.url, status: p.status === 'draft' ? 'draft' : 'published', reason });
      }
      return { links: out, dropped };
    },
  };
}

/** seo's problems: the one field it fixes, and what the model is told. */
const SEO_PROBLEMS = Object.freeze({
  'title-long': { key: 'title', ask: 'The search title is too long: Google cuts it at about 600 pixels, some 55 to 60 characters. Write a shorter one that keeps what matters most at the start.' },
  'title-short': { key: 'title', ask: 'The search title is short: there is room to say more of what the page offers. Write a fuller one, 45 to 60 characters.' },
  'description-missing': { key: 'description', ask: 'The page has no meta description, so Google picks words from the text. Write one, 120 to 155 characters.' },
  'description-long': { key: 'description', ask: 'The meta description is too long: Google cuts it at about 920 pixels, some 155 characters. Write a shorter one, 120 to 155 characters.' },
  'description-short': { key: 'description', ask: 'The meta description is short, so Google may write its own. Write a fuller one, 120 to 155 characters.' },
});
export const SEO_PROBLEM_NAMES = Object.keys(SEO_PROBLEMS);

/** The stub's fix: shorter or longer, as asked, so a test sees the check pass. */
function stubSeo(problem, now, title) {
  if (problem === 'title-long') return now.slice(0, Math.max(8, Math.min(40, now.length - 2))).replace(/\s+\S*$/, '').trim() || now.slice(0, now.length - 1);
  if (problem === 'title-short') return `${now}: a stub guide to it`;
  if (problem === 'description-missing') return `Stub description of ${title}.`;
  if (problem === 'description-long') return now.slice(0, Math.max(10, Math.min(140, now.length - 2))).replace(/\s+\S*$/, '').trim();
  return `${now} Stub: more about ${title}.`;
}

/**
 * `seo` with `problem`: only the search title or only the description, fixed for that problem. `searchTitle` and
 * `description` are what the editor has now (unsaved too); without them, the saved ones.
 */
export function seoFix(body, entry, { title, text, now }) {
  const name = body.problem;
  if (typeof name !== 'string' || !Object.hasOwn(SEO_PROBLEMS, name)) throw unprocessable('invalid', `problem is one of ${SEO_PROBLEM_NAMES.join(', ')}.`, { field: 'problem' });
  const problem = SEO_PROBLEMS[name];
  const searchTitle = capped(body, 'searchTitle', CAPS.field) || now.title || title;
  const description = capped(body, 'description', CAPS.field) || (name === 'description-missing' ? '' : (now.description ?? ''));
  const cur = problem.key === 'title' ? searchTitle : description;
  if (!cur && name !== 'description-missing') throw unprocessable('invalid', `There is no ${problem.key === 'title' ? 'search title' : 'description'} to change.`, { field: problem.key === 'title' ? 'searchTitle' : 'description' });
  const what = problem.key === 'title' ? 'search title' : 'description';
  return {
    target: `${entry.c.id}/${entry.id}`,
    system: [
      `You fix one search problem of a web page: its ${problem.key === 'title' ? 'search title' : 'meta description'}.`,
      problem.ask,
      'Write in the language and spelling of the page. Say only what the page says: no claims, numbers or names it does not have. No site name, no quotes.',
      DATA,
      `Answer with JSON only: {"${problem.key}": "…"}`,
    ].join('\n'),
    content: [{ type: 'text', text: `<page>\nTitle: ${title}\nSearch title now: ${searchTitle || '(none)'}\nDescription now: ${description || '(none)'}\n\n${text}\n</page>` }],
    stub: () => ({ [problem.key]: stubSeo(name, cur, title) }),
    answer: (t) => {
      const v = jsonAnswer(t, [problem.key])[problem.key];
      if (name.endsWith('-long') && v.length >= cur.length) throw failed(`The suggestion was no shorter than the ${what} now, so it was dropped. Try again.`);
      if (name.endsWith('-short') && v.length <= cur.length) throw failed(`The suggestion was no longer than the ${what} now, so it was dropped. Try again.`);
      return { [problem.key]: v };
    },
  };
}

/** `fix`: one heading out of order, or vague link words. The search title, description and alt text use seo and alt. */
export function fix(body, entry, kit) {
  if (!entry) throw unprocessable('invalid', 'fix needs the entry: collection and id.', { field: 'id' });
  if (body.problem === 'heading') return headingFix(body, entry);
  if (body.problem === 'link-text') return linkTextFix(body, entry, kit);
  throw unprocessable('invalid', 'problem is heading or link-text (a search title or description is the seo kind with its problem; alt text is the alt kind).', { field: 'problem' });
}

/** A heading's level from the model: 3, "3" or "H3". */
const levelOf = (v) => {
  const m = /^h?([1-6])$/i.exec(String(v ?? '').trim());
  return m ? Number(m[1]) : null;
};

/**
 * One heading of the page's outline (`headings`: [{level, text}] as the SEO check reads it, the title first when the
 * page shows it as its H1; `index`: which one), given a level that keeps the outline in order (no level skipped, no
 * second H1) and, when it is empty, words. `after`: the text that follows it (at most 2,000 characters).
 */
function headingFix(body, entry) {
  const list = body.headings;
  if (!Array.isArray(list) || !list.length || list.length > HEADINGS_MAX) throw unprocessable('invalid', `headings is the page's outline: 1 to ${HEADINGS_MAX} of {level, text}.`, { field: 'headings' });
  const outline = list.map((h, i) => {
    if (!h || typeof h !== 'object' || !Number.isInteger(h.level) || h.level < 1 || h.level > 6) throw unprocessable('invalid', `headings[${i}].level is a whole number from 1 to 6.`, { field: `headings.${i}.level` });
    return { level: h.level, text: capped(h, 'text', CAPS.field, `headings.${i}.text`) };
  });
  const i = body.index;
  if (!Number.isInteger(i) || i < 0 || i >= outline.length) throw unprocessable('invalid', 'index is the heading to fix: its place in headings, from 0.', { field: 'index' });
  const after = capped(body, 'after', CAPS.context);
  const h = outline[i];
  const prev = i > 0 ? outline[i - 1].level : 0;
  const h1 = outline.some((x, j) => j !== i && x.level === 1);
  const lo = h1 ? 2 : 1;
  const hi = Math.max(lo, prev + 1);
  if (h.text && h.level >= lo && h.level <= hi) throw unprocessable('in-order', 'This heading is in order already: there is nothing to fix.');
  const what = !h.text ? 'It is empty.' : h.level === 1 && h1 ? 'It is a second main heading (H1); a page has one.' : `It is an H${h.level} right after an H${prev}: a level is skipped.`;
  return {
    target: `${entry.c.id}/${entry.id}`,
    system: [
      'You fix one heading of a web page (marked >> in the outline) so the outline reads in order, as search engines and screen readers read it.',
      what,
      `Give it a level from ${lo} to ${hi}. Keep its words as they are unless it is empty; then write a short heading (at most 8 words) for the text that follows it.`,
      DATA,
      'Answer with JSON only: {"level": 2, "text": "…"}',
    ].join('\n'),
    content: [{ type: 'text', text: `<outline>\n${outline.map((x, j) => `${j === i ? '>> ' : ''}H${x.level} ${x.text || '(empty)'}`).join('\n')}\n</outline>${after ? `\n<after>\n${after}\n</after>` : ''}` }],
    stub: () => ({ level: Math.max(lo, Math.min(hi, h.level)), text: h.text || `Stub heading ${i + 1}` }),
    answer: (t) => {
      const v = jsonOf(t);
      const level = levelOf(v?.level);
      const words = typeof v?.text === 'string' ? v.text.trim().replace(/\s+/g, ' ') : '';
      if (!level || !words || words.length > 200) throw failed(NOT_FORM);
      if (level < lo || level > hi) throw failed('The suggested level would leave the headings out of order, so it was dropped. Try again.');
      return { level, text: words };
    },
  };
}

/**
 * Vague link words ("click here") in one sentence: the sentence again with link words that name the page. `sentence`
 * holds `words`; `href` is the link's address (the index names the page there, when the site keeps one).
 */
function linkTextFix(body, entry, kit) {
  const sentence = capped(body, 'sentence', CAPS.field);
  const said = capped(body, 'words', WORDS_MAX);
  const href = capped(body, 'href', CAPS.field);
  if (!sentence || !said || !sentence.includes(said)) throw unprocessable('invalid', 'Send the sentence and the link words in it.', { field: 'words' });
  const index = kit.linkIndex();
  const ref = index && href ? index.refOf(href) : null;
  const page = ref ? index.map.pages.get(ref) : null;
  const target = page && kit.canSee(page) ? page : null;
  const generic = index?.generic ?? [];
  return {
    target: `${entry.c.id}/${entry.id}`,
    system: [
      'You fix vague link words in one sentence of a web page: words such as "click here" or "read more" that do not say where the link goes.',
      'Write the sentence again so the link sits on 2 to 6 words that name what the linked page is about. Keep the meaning, the facts and about the same length; change as little as you can.',
      'Write in the language and spelling of the sentence. The link words must stand in the new sentence exactly as you give them.',
      DATA,
      'Answer with JSON only: {"sentence": "…", "words": "…"}',
    ].join('\n'),
    content: [{ type: 'text', text: `<sentence>${sentence}</sentence>\n<link-words>${said}</link-words>\n<linked-page>${target ? `${target.title} (${target.url})` : href || '(unknown)'}</linked-page>` }],
    stub: () => {
      const w = target?.title ?? 'the linked page';
      return { sentence: sentence.replace(said, w), words: w };
    },
    answer: (t) => {
      const v = jsonAnswer(t, ['sentence', 'words']);
      if (!v.sentence.includes(v.words)) throw failed('The suggested link words are not in its sentence, so it was dropped. Try again.');
      if (isGeneric(v.words, generic) || v.words.length > WORDS_MAX) throw failed('The suggested link words do not name the page either, so they were dropped. Try again.');
      if (v.sentence.length > Math.max(sentence.length * 2, sentence.length + 200)) throw failed('The suggested sentence is much longer than the one there, so it was dropped. Try again.');
      return v;
    },
  };
}
