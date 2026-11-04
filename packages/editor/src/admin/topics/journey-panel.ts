// The Journey view's side panel (journey.ts): what the URL opens next to the map.
//   link=<pair id>            every link from one page to another: the heading above it, the sentence with the words
//                             marked, "Open at the sentence"; and the links back, if any
//   link=<missing id>         a link the topic expects: why, and the suggestion that adds it (Accept, Skip), or how to
//                             write one when no sentence fits
//   page=<ref>&details=1      every link of one page, out and in, and its missing ones
import type { ScreenCtx } from '../../host';
import { suggestionCard } from '../../suggestion-card';
import { marked, type JourneyEdge, type JourneyMap, type JourneyMissing, type JourneyPage } from '../../topics';
import { button, drawer, el, link, value } from '../ui';
import { PROBLEM_WORDS, day } from './journey-card';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const PLACE_WORDS: Record<string, string> = { member: 'Article or guide', lead: 'Group lead', pillar: 'Main page', money: 'Service page', outside: 'Another topic' };
const STATUS_WORDS: Record<string, string> = { redirect: 'This link goes through a redirect.', noindex: 'This link goes to a page search engines are told not to show.', missing: 'This link goes to no page.' };

export function journeyPanel(split: HTMLElement, ctx: ScreenCtx, d: JourneyMap, o: { reload: () => void }): void {
  const q = ctx.params();
  const byRef = new Map(d.pages.map((p) => [p.ref, p]));
  const title = (ref: string) => byRef.get(ref)?.title ?? ref;
  const close = () => ctx.go({ params: { link: null, details: null } }, true);
  const id = q.get('link');
  if (id) {
    const missing = d.missing.find((m) => m.id === id);
    const links = d.edges.filter((e) => e.pair === id);
    if (missing) return missingPanel(missing);
    if (links.length) return pairPanel(links);
    const dr = drawer(split, 'Link not found', close);
    dr.body.append(el('p', 'This link is not on the page any more, or it was fixed. Look at the map again.'));
    return;
  }
  const ref = q.get('page');
  if (ref && q.get('details') && byRef.has(ref)) pagePanel(byRef.get(ref)!);

  /** The two pages of a connection, with their addresses. */
  function ends(from: string, to: string): HTMLElement {
    const one = (ref: string) => el('dd', el('strong', title(ref)), byRef.get(ref)?.url ? link(byRef.get(ref)!.url!, 'page address') : '');
    return el('dl.ms-jr-ends', el('dt', 'From'), one(from), el('dt', 'To'), one(to));
  }

  function pairPanel(links: JourneyEdge[]): void {
    const { from, to } = links[0];
    if (!to) {
      const dr = drawer(split, plural(links.length, 'link to no page', 'links to no page'), close);
      dr.body.append(el('p.ms-jr-panel__lead', `On “${title(from)}”, to ${links[0].address}, which is not a page of the site.`), ...links.map((e) => linkItem(ctx, e)));
      return dr.el.focus();
    }
    const dr = drawer(split, `${plural(links.length, 'link', 'links')} between two pages`, close);
    dr.body.append(ends(from, to), ...links.map((e) => linkItem(ctx, e)));
    const back = d.edges.filter((e) => e.from === to && e.to === from);
    if (back.length) dr.body.append(el('h3.ms-jr-panel__h', `And ${plural(back.length, 'link', 'links')} back`), ...back.map((e) => linkItem(ctx, e)));
    dr.el.focus();
  }

  function missingPanel(m: JourneyMissing): void {
    const dr = drawer(split, 'Missing link', close);
    const what = m.kind === 'no-lead-link' ? 'its group lead' : m.kind === 'no-money-link' ? 'the service page' : 'the main page';
    dr.body.append(el('p.ms-jr-panel__lead', `“${title(m.from)}” does not link to ${what}, “${title(m.to)}”, yet. Readers of the first page have no way on to the next.`), ends(m.from, m.to));
    dr.body.append(...missingBody(ctx, m, { done: () => (ctx.go({ params: { link: null } }, true), o.reload()) }));
    dr.el.focus();
  }

  function pagePanel(p: JourneyPage): void {
    const dr = drawer(split, p.title, close);
    const out = d.edges.filter((e) => e.from === p.ref);
    const inn = d.edges.filter((e) => e.to === p.ref);
    const mine = d.missing.filter((m) => m.from === p.ref);
    dr.body.append(...pageFacts(ctx, d, p));
    if (mine.length) {
      dr.body.append(el('h3.ms-jr-panel__h', `Missing (${mine.length})`));
      for (const m of mine) dr.body.append(button(`Add the link to “${title(m.to)}”`, () => ctx.go({ params: { link: m.id, details: null } }, true), { icon: 'plus', small: true }));
    }
    const broken = out.filter((e) => !e.to);
    if (broken.length) dr.body.append(el('section.ms-jr-panel__group', el('h3.ms-jr-panel__h', `To no page (${broken.length})`), ...broken.map((e) => linkItem(ctx, e))));
    dr.body.append(group(`Links out (${out.length - broken.length})`, out.filter((e) => e.to), (e) => e.to!, 'It links to no page of the site in its text.'));
    dr.body.append(group(`Links in (${inn.length})`, inn, (e) => e.from, 'No page links here in its text.'));
    dr.el.focus();
  }

  /** Links grouped by the page at their other end, the topic's own pages first. */
  function group(head: string, list: JourneyEdge[], other: (e: JourneyEdge) => string, empty: string): HTMLElement {
    const box = el('section.ms-jr-panel__group', el('h3.ms-jr-panel__h', head));
    if (!list.length) return (box.append(el('p.ms-adm-none', empty)), box);
    const by = new Map<string, JourneyEdge[]>();
    for (const e of list) by.set(other(e), [...(by.get(other(e)) ?? []), e]);
    const rank = (r: string) => (byRef.get(r)?.place === 'outside' ? 1 : 0);
    for (const [r, items] of [...by].sort((a, b) => rank(a[0]) - rank(b[0]) || title(a[0]).localeCompare(title(b[0])))) {
      const pick = el('button.ms-jr-panel__page', { type: 'button', title: 'Pick this page on the map' }, title(r));
      pick.addEventListener('click', () => ctx.go({ params: { page: r, details: '1', link: null } }, true));
      box.append(el('div.ms-jr-panel__other', pick, el('span.ms-jr-panel__where', PLACE_WORDS[byRef.get(r)?.place ?? 'outside'])), ...items.map((e) => linkItem(ctx, e)));
    }
    return box;
  }
}

/** One link where it sits: the heading above it, the sentence with its words marked, and the way to it. */
export function linkItem(ctx: ScreenCtx, e: JourneyEdge): HTMLElement {
  const [a, w, z] = marked({ sentence: e.sentence, at: e.at, anchor: e.anchor });
  const quote = el('blockquote.ms-jr-link__sentence', a, w ? el('mark', w) : '', z);
  const go = button('Open at the sentence', () => ctx.open(e.open, true), { icon: 'open', small: true });
  return el(
    'article.ms-jr-link',
    el('p.ms-jr-link__section', e.section ? `Under the heading “${e.section}”` : 'Near the top of the page'),
    quote,
    el('div.ms-jr-link__words', el('span.ms-jr-link__label', 'Link words'), value(e.anchor || '(no words)', 'link words')),
    e.to ? null : el('div.ms-jr-link__words', el('span.ms-jr-link__label', 'Goes to'), value(e.address, 'address')),
    // what Health says about it (its words, where it ends), else the plain words for where it ends
    ...(e.warn.length ? e.warn.map((w) => el(`p.ms-jr-link__warn${w.kind === 'to-missing' ? '.is-bad' : ''}`, w.message)) : STATUS_WORDS[e.status] ? [el(`p.ms-jr-link__warn${e.status === 'missing' ? '.is-bad' : ''}`, STATUS_WORDS[e.status])] : []),
    el('div.ms-jr-link__actions', go),
  );
}

/** A missing link's way to add it: the suggestion with Accept and Skip, or how to write one when it was skipped. */
export function missingBody(ctx: ScreenCtx, m: JourneyMissing, o: { done: () => void }): HTMLElement[] {
  if (!m.suggestion)
    return [el('p', 'A suggestion for it was skipped (see Links, Skipped). Open the page and write a sentence that links there.'), el('div.ms-jr-link__actions', button('Open the page', () => ctx.open(m.open, true), { icon: 'open', small: true }))];
  return [
    el('h3.ms-jr-panel__h', m.suggestion.how === 'link' ? 'These words could carry the link' : 'No sentence fits yet'),
    suggestionCard(m.suggestion, {
      accept: true,
      open: (hash) => ctx.open(hash, true),
      done: (_s, what) => {
        if (what !== 'linked') o.done();
      },
    }),
  ];
}

/** A page's facts: where it sits, its status and last change, its address, its numbers, what is wrong, the ways on. */
export function pageFacts(ctx: ScreenCtx, d: JourneyMap, p: JourneyPage): HTMLElement[] {
  return [
    el('p.ms-jr-panel__place', [PLACE_WORDS[p.place] ?? '', p.live ? 'published' : p.status, p.updated ? `updated ${day(p.updated)}` : ''].filter(Boolean).join(' · ')),
    p.url ? link(p.url, 'page address') : el('span'),
    el('dl.ms-jr-card__nums.ms-jr-panel__nums', el('div', el('dt', 'Links in'), el('dd.ms-num', String(p.in))), el('div', el('dt', 'Links out'), el('dd.ms-num', String(p.out))), el('div', el('dt', 'Outside links'), el('dd.ms-num', String(p.external))), d.numbers.leads ? el('div', el('dt', 'Form messages'), el('dd.ms-num', String(p.leads ?? 0))) : null),
    p.problems.length ? el('ul.ms-jr-panel__problems', ...p.problems.map((k) => el('li', PROBLEM_WORDS[k] ?? k))) : el('span'),
    el('div.ms-jr-link__actions', button('Open the page', () => ctx.open(p.edit, true), { icon: 'open', small: true }), button('Its suggestions', () => ctx.open(`#/links?view=page&ref=${encodeURIComponent(p.ref)}`, true), { icon: 'link', small: true })),
  ];
}
