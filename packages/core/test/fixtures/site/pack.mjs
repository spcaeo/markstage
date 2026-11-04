// An example site's block pack, Markdown side: the HTML shapes of the article boxes (takeaways, side note, call to
// action, facts, steps, case study, stat figures, layout cards, form demo, FAQ, pros and cons) as Markstage block
// codecs. A site keeps its pack in its own repo, with an editor side (node views, settings, inserter drawings) next to
// it. Plain ESM: the server, the dev integration and the browser all load such a file.
import { decodeHtml, definePack, escAttr, escHtml, hasTags, htmlToInline, inlineToHtml, linkFromTag, linkOpenTag, paragraph, parseTag } from '@markstage/core';

// ---------- one-line boxes ----------

/** The label a side note prints when its `label` is null. */
export const DEFAULT_LABEL = { tip: 'Our tip', stat: 'Key stat', def: 'Definition' };

const SIDENOTE = /^<aside class="sidenote sidenote--(\w+)"><p class="sidenote__label">(.*?)<\/p><p>(?:<span class="sidenote__big">([^<]*)<\/span> )?(.*)<\/p><\/aside>$/;
const CALLOUT = /^<div class="callout"><p class="callout-heading">(<strong>)?(.*?)(?:<\/strong>)?<\/p>(?:<p>(.*?)<\/p>)?<p class="callout-action">(<a class="button"[^>]*>)(<strong>)?(.*?)(?:<\/strong>)?<\/a><\/p><\/div>$/;
const STATS = /^<div class="stats">((?:<p class="stat">.*?<\/p>)+)<\/div>$/;
const STAT = /<p class="stat"><span class="stat__num" data-count="(\d+)">([^<]*)<\/span> <span class="stat__label">([^<]*)<\/span><\/p>/g;
const CARDS = /^<ul class="layout-cards">((?:<li>.*?<\/li>)+)<\/ul>$/;
const CARD = /<li><a class="layout-card" data-art="([\w-]+)" href="([^"]*)"><span aria-hidden="true"><\/span><strong>([^<]*)<\/strong> <span>([^<]*)<\/span><\/a><\/li>/g;
const FORM_DEMO = '<div class="form-demo" data-form-demo></div>';

const inlineOf = (node) => node.content?.[0]?.content ?? [];

/** The data-count of a stat figure: its digits ("91%" -> 91, "1,200" -> 1200). */
export const statCount = (num) => num.replace(/\D/g, '');

const sideNote = {
  name: 'sideNote',
  kind: 'line',
  parse(line) {
    const m = SIDENOTE.exec(line);
    if (!m) return null;
    const [, kind, label, big, text] = m;
    if (!DEFAULT_LABEL[kind] || hasTags(label)) return null;
    const lab = decodeHtml(label);
    return {
      type: 'sideNote',
      attrs: { kind, label: lab === DEFAULT_LABEL[kind] ? null : lab, big: big === undefined ? null : decodeHtml(big) },
      content: [paragraph(htmlToInline(text))],
    };
  },
  print(node) {
    const a = node.attrs ?? {};
    const kind = DEFAULT_LABEL[a.kind] ? a.kind : 'tip';
    const label = a.label ?? DEFAULT_LABEL[kind];
    const big = a.big != null && a.big !== '' ? `<span class="sidenote__big">${escHtml(a.big)}</span> ` : '';
    return `<aside class="sidenote sidenote--${kind}"><p class="sidenote__label">${escHtml(label)}</p><p>${big}${inlineToHtml(inlineOf(node))}</p></aside>`;
  },
};

const callout = {
  name: 'callout',
  kind: 'line',
  parse(line) {
    const m = CALLOUT.exec(line);
    if (!m) return null;
    const [, hStrong, heading, text, aTag, bStrong, button] = m;
    const tag = parseTag(aTag.slice(0, -1).replace(/^<a class="button"/, '<a') + '>');
    const link = tag && linkFromTag(tag);
    if (!link || hasTags(heading) || hasTags(button) || (link.attrs.target !== null) !== (link.attrs.rel !== null)) return null;
    if (link.attrs.target !== null && link.attrs.target !== '_blank') return null;
    const form = {};
    if (!hStrong) form.headingStrong = false;
    if (bStrong) form.buttonStrong = true;
    if (link.attrs.order) form.relFirst = true;
    return {
      type: 'callout',
      attrs: {
        heading: decodeHtml(heading),
        button: decodeHtml(button),
        href: link.attrs.href,
        rel: link.attrs.rel,
        form: Object.keys(form).length ? form : null,
      },
      content: [paragraph(text === undefined || text === '' ? [] : htmlToInline(text))],
    };
  },
  print(node) {
    const a = node.attrs ?? {};
    const form = a.form ?? {};
    const heading = form.headingStrong === false ? escHtml(a.heading ?? '') : `<strong>${escHtml(a.heading ?? '')}</strong>`;
    const inline = inlineOf(node);
    const text = inline.length ? `<p>${inlineToHtml(inline)}</p>` : '';
    const rel = a.rel ?? null;
    const link = { href: a.href ?? '', target: rel === null ? null : '_blank', rel, order: form.relFirst ? 'rel-first' : undefined };
    const button = form.buttonStrong ? `<strong>${escHtml(a.button ?? '')}</strong>` : escHtml(a.button ?? '');
    return `<div class="callout"><p class="callout-heading">${heading}</p>${text}<p class="callout-action">${linkOpenTag(link, ' class="button"')}${button}</a></p></div>`;
  },
};

const stats = {
  name: 'stats',
  kind: 'line',
  parse(line) {
    const m = STATS.exec(line);
    if (!m) return null;
    const rows = [...m[1].matchAll(STAT)].map(([, , num, label]) => ({ num: decodeHtml(num), label: decodeHtml(label) }));
    return rows.length ? { type: 'stats', attrs: { stats: rows } } : null;
  },
  print(node) {
    const row = (s) =>
      `<p class="stat"><span class="stat__num" data-count="${statCount(s.num ?? '')}">${escHtml(s.num ?? '')}</span> <span class="stat__label">${escHtml(s.label ?? '')}</span></p>`;
    return `<div class="stats">${(node.attrs?.stats ?? []).map(row).join('')}</div>`;
  },
};

const layoutCards = {
  name: 'layoutCards',
  kind: 'line',
  parse(line) {
    const m = CARDS.exec(line);
    if (!m) return null;
    const cards = [...m[1].matchAll(CARD)].map(([, art, href, title, text]) => ({
      art,
      href: decodeHtml(href),
      title: decodeHtml(title),
      text: decodeHtml(text),
    }));
    return cards.length ? { type: 'layoutCards', attrs: { cards } } : null;
  },
  print(node) {
    const card = (c) =>
      `<li><a class="layout-card" data-art="${escAttr(c.art ?? '')}" href="${escAttr(c.href ?? '')}"><span aria-hidden="true"></span><strong>${escHtml(c.title ?? '')}</strong> <span>${escHtml(c.text ?? '')}</span></a></li>`;
    return `<ul class="layout-cards">${(node.attrs?.cards ?? []).map(card).join('')}</ul>`;
  },
};

const formDemo = {
  name: 'formDemo',
  kind: 'line',
  parse: (line) => (line === FORM_DEMO ? { type: 'formDemo' } : null),
  print: () => FORM_DEMO,
};

// ---------- wrap boxes: an opening line, Markdown, a closing line ----------

const TAKEAWAYS_OPEN = '<aside class="takeaways" aria-label="Key takeaways">';
const TAKEAWAYS_TITLE = '**Key takeaways**';
// The pros/cons parts open with a fixed icon (the same two files in all 37 boxes); the printer writes it.
const PROS_ICON = '![pros](../../assets/uploads/2024/10/Pros.svg)';
const CONS_ICON = '![cons](../../assets/uploads/2024/10/Cons.svg)';
const FAQ_OPEN = /^<details>\n<summary><h3>(.*)<\/h3><\/summary>$/;

/** A wrap that is one fixed opening line (+ an optional fixed title) and a fixed closing line. */
const fixedWrap = (name, openLine, closeLine, title, extra = {}) => ({
  name,
  kind: 'wrap',
  open: (html) => (html === openLine ? { close: closeLine, ...(title ? { title } : {}) } : null),
  printOpen: () => (title ? `${openLine}\n\n${title}` : openLine),
  printClose: () => closeLine,
  ...extra,
});

const faq = {
  name: 'faq',
  kind: 'wrap',
  open(html) {
    const f = FAQ_OPEN.exec(html);
    return f && !hasTags(f[1]) ? { attrs: { question: decodeHtml(f[1]) }, close: '</details>' } : null;
  },
  printOpen: (node) => `<details>\n<summary><h3>${escHtml(node.attrs?.question ?? '')}</h3></summary>`,
  printClose: () => '</details>',
};

export default definePack({
  name: 'example',
  blocks: [
    sideNote,
    callout,
    stats,
    layoutCards,
    formDemo,
    fixedWrap('takeaways', TAKEAWAYS_OPEN, '</aside>', TAKEAWAYS_TITLE),
    fixedWrap('prosCons', '<div class="pros-cons">', '</div>', null, { children: ['pros', 'cons'] }),
    fixedWrap('pros', '<div class="pros">', '</div>', PROS_ICON, { parent: 'prosCons' }),
    fixedWrap('cons', '<div class="cons">', '</div>', CONS_ICON, { parent: 'prosCons' }),
    fixedWrap('facts', '<div class="facts">', '</div>'),
    fixedWrap('steps', '<div class="steps">', '</div>'),
    fixedWrap('caseStudy', '<div class="case">', '</div>'),
    faq,
  ],
});
