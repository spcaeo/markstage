// The Journey view's parts that are not the lines (journey.ts): a page as a card, the topic's gaps in plain
// sentences, the key to the map, and the row that shows one group at a time.
import type { ScreenCtx } from '../../host';
import type { JourneyEdge, JourneyMap, JourneyPage } from '../../topics';
import { el, icon, link } from '../ui';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** What a card says is wrong, in plain words (Health's kinds). */
export const PROBLEM_WORDS: Record<string, string> = {
  'no-links-in': 'No links in',
  weak: 'Only one link in',
  'no-pillar-link': 'No link up to the main page',
  'no-lead-link': 'No link up to its group lead',
};
/** one way to write a day everywhere on the Topic map: 23 Feb 2026 (three letters a month, whatever the browser) */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STATUS: Record<string, string> = { published: 'Published', draft: 'Draft', scheduled: 'Scheduled' };

/** A date as people read it ("12 Oct 2026"), the value as it is when it is no date. */
export function day(v: string): string {
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return v;
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export interface CardOpts {
  /** the site has form messages: show this page's count */
  leads: boolean;
  /** its links that end on no page of the site */
  broken: JourneyEdge[];
  /** columns further on that link back to it with no line drawn (they are not next to it) */
  backFrom: string[];
  pick: () => void;
  details: () => void;
}

/** A page as a card: title, address (copy, open), status and last change, links in and out, what is wrong, "+". */
export function pageCard(p: JourneyPage, o: CardOpts): HTMLElement {
  const c = el('article.ms-jr-card', { 'data-ref': p.ref, 'data-key': `card:${p.ref}`, tabindex: '0', 'aria-label': p.title });
  c.classList.toggle('is-problem', p.problems.length > 0 || o.broken.length > 0);
  const plus = el('button.ms-jr-plus', { type: 'button', 'aria-label': `Show every link of “${p.title}”`, title: 'Show every link of this page', 'data-key': `plus:${p.ref}` }, icon('plus', 14));
  plus.addEventListener('click', (e) => {
    e.stopPropagation();
    o.details();
  });
  c.append(el('div.ms-jr-card__head', plus, el('h5.ms-jr-card__title', p.title)));
  if (p.url) {
    const url = link(p.url, 'page address', 'ms-jr-card__url');
    // whole, with a place to break after each slash and hyphen; copy and open stay on the line of its last part
    const parts = p.url.split(/(?<=[/-])/);
    const end = el('span.ms-jr-url__end', parts.pop() ?? '', url.querySelector('.ms-copyable__tools') ?? '');
    url.querySelector('.ms-copyable__text')?.replaceChildren(...parts.flatMap((part) => [part, el('wbr')]), end);
    c.append(url);
  }
  const state = el('p.ms-jr-card__state', el('span', { class: `ms-jr-state ms-jr-state--${p.live ? 'live' : 'draft'}` }, STATUS[p.status] ?? p.status));
  if (p.updated) state.append(' · ', el('span', { title: p.updated }, `Updated ${day(p.updated)}`));
  c.append(state);
  const nums = el('dl.ms-jr-card__nums', el('div', el('dt', 'Links in'), el('dd.ms-num', String(p.in))), el('div', el('dt', 'Links out'), el('dd.ms-num', String(p.out))));
  if (o.leads) nums.append(el('div', { title: 'Contact form messages from visits that began on this page' }, el('dt', 'Form messages'), el('dd.ms-num', String(p.leads ?? 0))));
  // the numbers Markstage does not have are said, not left blank
  const off = ['No visit counts: Markstage keeps none.', o.leads ? '' : 'No form messages: this site has none yet.'].filter(Boolean).join(' ');
  nums.title = off;
  nums.setAttribute('aria-description', off);
  c.append(nums);
  const tags = el('div.ms-jr-card__tags');
  for (const k of p.problems) if (PROBLEM_WORDS[k]) tags.append(el('span.ms-jr-tag.ms-jr-tag--warn', PROBLEM_WORDS[k]));
  const dead = o.broken.filter((e) => e.status === 'missing').length;
  const away = o.broken.length - dead;
  if (dead) tags.append(el('span.ms-jr-tag.ms-jr-tag--bad', plural(dead, 'broken link', 'broken links')));
  if (away) tags.append(el('span.ms-jr-tag.ms-jr-tag--warn', plural(away, 'link redirects off the site’s pages', 'links redirect off the site’s pages')));
  for (const w of o.backFrom) tags.append(el('span.ms-jr-tag', `Linked back from the ${w.toLowerCase()}`));
  if (tags.childElementCount) c.append(tags);
  c.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('a, button')) return;
    o.pick();
  });
  c.addEventListener('keydown', (e) => {
    if (e.target !== c || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    o.pick();
  });
  return c;
}

/**
 * What the topic (or the group shown) lacks, in plain sentences, worst first: the links that should be there, pages
 * nobody links to, link words to change, broken and redirected links. `shown`: the pages on the map now.
 */
export function gaps(d: JourneyMap, shown: Set<string>, members: JourneyPage[], pillar: JourneyPage | null): HTMLElement {
  const byRef = new Map(d.pages.map((p) => [p.ref, p]));
  const placeOf = (ref: string) => byRef.get(ref)?.place;
  const missing = d.missing.filter((m) => shown.has(m.from));
  const count = (kind: string, place?: string) => missing.filter((m) => m.kind === kind && (!place || placeOf(m.from) === place)).length;
  const mine = d.edges.filter((e) => shown.has(e.from));
  const words = mine.filter((e) => e.warn.some((w) => w.kind === 'generic-anchor' || w.kind === 'anchor-clash')).length;
  const broken = mine.filter((e) => e.status === 'missing').length;
  const redirects = mine.filter((e) => e.status === 'redirect').length;
  const unlinked = [...shown].filter((r) => byRef.get(r)?.problems.includes('no-links-in')).length;
  const up = pillar ? members.filter((p) => d.edges.some((e) => e.from === p.ref && e.to === pillar.ref)).length : 0;
  const items: [string, string][] = [];
  const add = (n: number, one: string, many: string, level = 'warn') => n && items.push([level, plural(n, one, many)]);
  add(broken, 'link is broken: it goes to no page', 'links are broken: they go to no page', 'bad');
  add(count('no-lead-link'), 'article does not link up to its group page', 'articles do not link up to their group page');
  add(count('no-pillar-link', 'member'), 'article does not link up to the main page', 'articles do not link up to the main page');
  add(count('no-pillar-link', 'lead'), 'group page does not link up to the main page', 'group pages do not link up to the main page');
  add(count('no-money-link', 'lead'), 'group page does not link to the service page', 'group pages do not link to the service page');
  if (count('no-money-link', 'pillar')) items.push(['warn', 'The main page does not link to the service page']);
  add(unlinked, 'page has no links in from other pages', 'pages have no links in from other pages');
  add(words, 'link has vague words or words used for another page too', 'links have vague words or words used for another page too');
  add(redirects, 'link goes through a redirect', 'links go through a redirect');
  const head = el('p', el('strong.ms-num', String(members.length)), members.length === 1 ? ' article or guide' : ' articles and guides');
  if (pillar && members.length) head.append(', ', el('strong.ms-num', `${up} of ${members.length}`), ' link up to the main page.');
  else head.append('.');
  const box = el('div.ms-jr-summary', head);
  if (!items.length) box.append(el('p', 'No gaps: every link the topic expects is there.'));
  else box.append(el('ul.ms-jr-gaps', { 'aria-label': 'Gaps' }, ...items.map(([level, text]) => el('li', { class: `ms-jr-gap ms-jr-gap--${level}` }, `${text}.`))));
  return box;
}

/** The key to the map, and which numbers there are not (never made up). */
export function legend(numbers: JourneyMap['numbers']): HTMLElement {
  const svg = 'http://www.w3.org/2000/svg';
  const sample = (cls: string) => {
    const s = document.createElementNS(svg, 'svg');
    s.setAttribute('width', '34');
    s.setAttribute('height', '10');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = `<path class="ms-jr-line ${cls}" d="M1 5H33"/>`;
    return s;
  };
  const off = [!numbers.visits ? 'visits (Markstage keeps no visit counts)' : '', !numbers.leads ? 'form messages (this site has none yet)' : ''].filter(Boolean);
  return el(
    'div.ms-jr-key',
    el(
      'ul.ms-jr-legend',
      { 'aria-label': 'How to read the map' },
      el('li', sample(''), 'A link that moves a reader on'),
      el('li', sample('is-back'), 'A link back'),
      el('li', sample('is-missing'), 'A link the topic expects, still missing'),
      el('li', sample('is-redirect'), 'Goes through a redirect'),
      el('li', el('span.ms-jr-chip.is-sample', 'link words'), 'Click the words to see where the link is. Click a card to see every page it links with.'),
    ),
    off.length ? el('p.ms-jr-off', `Not shown: ${off.join(', and ')}.`) : null,
  );
}

/** One group at a time, or all (URL `group`; a click is a history entry). */
export function groupRow(ctx: ScreenCtx, groups: { key: string; name: string; n: number }[], active: string | null): HTMLElement {
  const row = el('div.ms-adm-chips.ms-jr-groups', { role: 'group', 'aria-label': 'Show one group' });
  const chip = (key: string | null, name: string, n: number) => {
    const b = el('button.ms-adm-chip', { type: 'button', 'aria-pressed': String(active === key) }, name, el('span.ms-links-count.ms-num', String(n)));
    b.addEventListener('click', () => ctx.go({ params: { group: key, page: null, link: null, details: null } }, true));
    row.append(b);
  };
  chip(null, 'All groups', groups.reduce((a, g) => a + g.n, 0));
  for (const g of groups) chip(g.key, g.name, g.n);
  return row;
}
