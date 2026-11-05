// "Suggest a fix" in the SEO check (seo/index.ts): an AI fix for one problem it found, shown as a diff in a card under
// that problem, with Accept, Edit then accept and Reject. Each fix has its URL (side=seo&suggest=fix&fix=<id>):
//   title, description         the search title or description (the `seo` kind with its problem: too long, too
//                              short, missing); accepting sets the SEO field, one step of Post settings' history
//   heading-<block>            the heading at that top-level block, out of order, a second H1 or empty (`fix`,
//                              problem heading): its level, and words when it had none
//   link-<block>-<n>           the nth link of that block, with vague words such as "click here" (`fix`, problem
//                              link-text): its sentence again, the link on words that name the page
//   alt-<n>                    the nth image of the text, with no alt text (the `alt` kind)
// A change on the canvas is one transaction: ⌘Z takes it back, ⌘S saves it through the one save path (the surgical
// save writes only what changed). Nothing changes until the writer accepts; a fix asked about text that has changed
// since is refused in plain words.
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { toast } from '../host';
import { figureParts } from '../images';
import { headings, linksOf, vagueLink } from '../seo/text';
import type { SeoProblem, SuggestBody } from './api';
import type { CardSpec } from './card';
import { LEVEL, blockAt, imageAt, sentenceOf } from './fix-text';

export { fixKind } from './fix-text';

export type FixSpec = Omit<CardSpec, 'close'>;

/** What the SEO check knows of the search result now (unsaved too), and where an accepted fix goes. */
export interface SeoNow {
  title: string;
  description: string;
  keys: { title?: string; description?: string };
  titleProblem: SeoProblem | null;
  descriptionProblem: SeoProblem | null;
  /** the page shows its title as its H1 (seo/h1.ts; null: not known yet) */
  titleIsH1: boolean | null;
}

export interface FixDeps {
  getEditor(): Editor | null;
  where(): { collection: string; id: string } | null;
  /** the page's title as the writer sees it */
  title(): string;
  /** why `keys` can't be changed here ("body" for the text), or null */
  readOnly(keys: string[]): string | null;
  /** settings accepted: one step of Post settings' history, a toast to undo */
  acceptEdits(pairs: [string, string][], words: string): string | null;
  seo(): SeoNow;
}

/** The text after a top-level block (what an empty heading is about), at most 2,000 characters. */
function textAfter(doc: PMNode, index: number): string {
  let out = '';
  for (let i = index + 1; i < doc.childCount && out.length < 2000; i++) {
    const n = doc.child(i);
    if (n.type.name === 'heading') break;
    out += `${n.textContent}\n`;
  }
  return out.trim().slice(0, 2000);
}

const done = (ed: Editor, words: string) => toast(`${words} ⌘Z takes it back; ⌘S saves it.`, 'ok', { action: { label: 'Undo', run: () => void ed.chain().focus().undo().run() } });

/** The card for one fix, or why there is none (the problem is not on the page any more). */
export function fixSpec(id: string, d: FixDeps): FixSpec | string {
  const ed = d.getEditor();
  if (!ed) return 'The page is not open.';
  const where = () => d.where()!;
  if (id === 'title' || id === 'description') {
    const key = d.seo().keys[id];
    if (!key) return id === 'title' ? 'This page has no search title field to set.' : 'This page has no description field to set.';
    const label = id === 'title' ? 'Search title' : 'Search description';
    return {
      title: `Suggested fix: ${label.toLowerCase()}`,
      diff: true,
      fields: [{ name: id, label, now: () => d.seo()[id], multiline: id === 'description', empty: 'Empty' }],
      body: (): SuggestBody => {
        const s = d.seo();
        const problem = (id === 'title' ? s.titleProblem : s.descriptionProblem) ?? (id === 'title' ? 'title-long' : 'description-missing');
        return { kind: 'seo', ...where(), title: d.title().slice(0, 1000), text: ed.getText({ blockSeparator: '\n\n' }).slice(0, 20_000), problem, searchTitle: s.title.slice(0, 1000), description: s.description.slice(0, 1000) };
      },
      accept: (v) => d.acceptEdits([[key, v[id]]], `${label} set from the fix.`),
    };
  }

  const alt = /^alt-(\d+)$/.exec(id);
  if (alt) {
    const n = Number(alt[1]);
    if (!imageAt(ed.state.doc, n)) return `There is no image ${n} in the text any more.`;
    return {
      title: 'Suggested fix: alt text',
      diff: true,
      fields: [{ name: 'alt', label: 'Alt text', now: () => String(imageAt(ed.state.doc, n)?.node.attrs.alt ?? ''), multiline: true, empty: 'Empty' }],
      body: (): SuggestBody => ({ kind: 'alt', image: String(imageAt(ed.state.doc, n)?.node.attrs.src ?? ''), ...where() }),
      accept: (v) => {
        const no = d.readOnly(['body']);
        if (no) return no;
        const img = imageAt(ed.state.doc, n);
        if (!img) return 'The image is not in the text any more.';
        if (figureParts(img.node.attrs.figure).decorative) return 'This image is marked decorative, so it needs no alt text.';
        if (!v.alt.trim()) return 'Write the alt text first.';
        const before = ed.state.doc;
        ed.view.dispatch(ed.state.tr.setNodeMarkup(img.pos, undefined, { ...img.node.attrs, alt: v.alt.trim() }));
        if (ed.state.doc.eq(before)) return 'This block is locked, so its image can’t be changed here.';
        done(ed, 'Alt text set from the fix.');
        return null;
      },
      refocus: () => ed.view.focus(),
    };
  }

  const heading = /^heading-(\d+)$/.exec(id);
  if (heading) {
    const b = Number(heading[1]);
    const at = blockAt(ed.state.doc, b);
    if (at?.node.type.name !== 'heading') return 'That heading is not in the text any more.';
    // what was asked about: accepting checks the heading is still that
    let asked = { level: Number(at.node.attrs.level), text: at.node.textContent };
    return {
      title: 'Suggested fix: heading',
      diff: true,
      fields: [
        { name: 'level', label: 'Level', now: () => `H${blockAt(ed.state.doc, b)?.node.attrs.level ?? ''}` },
        { name: 'text', label: 'Heading', now: () => blockAt(ed.state.doc, b)?.node.textContent ?? '', empty: 'Empty' },
      ],
      shape: (raw) => ({ level: `H${raw.level}`, text: String(raw.text ?? '') }),
      body: (): SuggestBody => {
        const doc = ed.state.doc;
        const node = blockAt(doc, b)!.node;
        asked = { level: Number(node.attrs.level), text: node.textContent };
        const list = headings(doc, { text: d.title(), h1: d.seo().titleIsH1 }).list;
        return { kind: 'fix', ...where(), problem: 'heading', headings: list.map((h) => ({ level: h.level, text: h.text.slice(0, 1000) })), index: Math.max(0, list.findIndex((h) => h.block === b)), after: textAfter(doc, b) };
      },
      accept: (v) => {
        const m = LEVEL.exec(v.level.trim());
        if (!m) return 'Write the level as H1 to H6.';
        const text = v.text.replace(/\s+/g, ' ').trim();
        if (!text) return 'Write the heading’s words first.';
        const no = d.readOnly(['body']);
        if (no) return no;
        const now = blockAt(ed.state.doc, b);
        if (now?.node.type.name !== 'heading' || Number(now.node.attrs.level) !== asked.level || now.node.textContent !== asked.text) return 'The heading changed since you asked. Suggest again.';
        const before = ed.state.doc;
        const tr = ed.state.tr.setNodeMarkup(now.pos, undefined, { ...now.node.attrs, level: Number(m[1]) });
        if (text !== now.node.textContent) tr.replaceWith(now.pos + 1, now.pos + 1 + now.node.content.size, ed.schema.text(text));
        ed.view.dispatch(tr.scrollIntoView());
        if (ed.state.doc.eq(before)) return 'This block is locked, so its heading can’t be changed here.';
        done(ed, 'Heading changed with the fix.');
        return null;
      },
      refocus: () => ed.view.focus(),
    };
  }

  const link = /^link-(\d+)-(\d+)$/.exec(id);
  if (link) {
    const [b, k] = [Number(link[1]), Number(link[2])];
    const find = () => {
      const l = linksOf(ed.state.doc).find((x) => x.block === b && x.n === k);
      const s = l && sentenceOf(ed.state.doc, l);
      return l && s ? { l, s } : null;
    };
    const first = find();
    if (!first) return 'That link is not in the text any more, or its sentence is too long to fix here.';
    let asked = { words: first.l.text, href: first.l.href, sentence: first.s.text };
    return {
      title: 'Suggested fix: link words',
      diff: true,
      fields: [
        { name: 'sentence', label: 'Sentence', now: () => find()?.s.text ?? '', multiline: true },
        { name: 'words', label: 'Link words', now: () => find()?.l.text ?? '' },
      ],
      note: first.s.others ? 'The sentence has other formatting or links: accepting keeps this link, not those.' : undefined,
      body: (): SuggestBody => {
        const f = find();
        if (f) asked = { words: f.l.text, href: f.l.href, sentence: f.s.text };
        return { kind: 'fix', ...where(), problem: 'link-text', sentence: asked.sentence, words: asked.words, href: asked.href };
      },
      accept: (v) => {
        const sentence = v.sentence.replace(/\s+/g, ' ').trim();
        const words = v.words.replace(/\s+/g, ' ').trim();
        if (!sentence || !words) return 'Write the sentence and its link words first.';
        const at = sentence.indexOf(words);
        if (at < 0) return 'The link words must be in the sentence, written the same.';
        if (vagueLink(words)) return 'Those link words are vague too: use words that name the page.';
        const no = d.readOnly(['body']);
        if (no) return no;
        const f = find();
        if (!f || f.l.text !== asked.words || f.l.href !== asked.href || f.s.text !== asked.sentence) return 'The sentence changed since you asked. Suggest again.';
        const before = ed.state.doc;
        const tr = ed.state.tr.replaceWith(f.s.from, f.s.to, ed.schema.text(sentence));
        tr.addMark(f.s.from + at, f.s.from + at + words.length, f.s.mark);
        ed.view.dispatch(tr.scrollIntoView());
        if (ed.state.doc.eq(before)) return 'This block is locked, so its words can’t be changed here.';
        done(ed, 'Link words changed with the fix.');
        return null;
      },
      refocus: () => ed.view.focus(),
    };
  }
  return 'There is no such fix.';
}
