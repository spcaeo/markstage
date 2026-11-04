// Links (docs/API-LINKS.md): the site's internal links, so old pages learn about new ones. Every state is in the URL:
//   #/links?view=inbox&topic=<id>&s=<suggestion>     Link inbox: every suggestion one click can apply (s: the open one)
//   #/links?view=health&topic=&kind=&f=<finding>     Health: what to fix, worst first, with one-click fixes
//   #/links?view=pages&topic=&q=                     every page with its links in, out and outside
//   #/links?view=page&ref=<collection/id>            one page: the pages it should link to, those that should link
//                                                    to it, and what to fix on it
//   #/links?view=skipped                             suggestions someone skipped, to bring back
// Accept changes the other page as a normal save would (one commit, Undo on the toast); Skip is remembered for all.
import type { ScreenCtx } from '../../host';
import { config } from '../../runtime';
import '../../styles/links.css';
import { suggestionCard } from '../../suggestion-card';
import { linkHealth, linkInbox, linkPages, listSkips, suggestFor, unskip, type PageRow, type Suggestion } from '../../topics';
import { button, el, failure, link, message, page, searchBox, state } from '../ui';
import { healthView } from './health';

const VIEWS: [string, string][] = [
  ['inbox', 'Link inbox'],
  ['health', 'Health'],
  ['pages', 'Pages'],
  ['skipped', 'Skipped'],
];
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
// params a view keeps to itself: changing only these does not fetch again
const QUIET = ['s', 'f', 'q'];

export function mountLinks(host: HTMLElement, ctx: ScreenCtx) {
  const p = page(host, 'Links between pages', 'Links between the site’s own pages, so old pages point to new ones. Accept a suggestion and that page gets the link.');
  let alive = true;
  let drawnKey = '';
  let counts = { inbox: null as number | null, health: null as number | null };
  let topics: { id: string; title: string }[] = [];
  let pagesCache: PageRow[] | null = null;
  const view = () => ctx.params().get('view') || 'inbox';
  const key = () => {
    const params = new URLSearchParams(ctx.params());
    for (const k of QUIET) params.delete(k);
    return params.toString();
  };

  /** The tabs (a click is a history entry) and the topic filter. */
  function bar(): void {
    const tabs = el('div.ms-adm-chips.ms-links-tabs', { role: 'tablist', 'aria-label': 'Links views' });
    for (const [v, label] of VIEWS) {
      const n = v === 'inbox' ? counts.inbox : v === 'health' ? counts.health : null;
      const b = el('button.ms-adm-chip', { type: 'button', role: 'tab', 'aria-selected': String(v === view()), 'aria-pressed': String(v === view()) }, label, n !== null ? el('span.ms-links-count.ms-num', String(n)) : null);
      b.addEventListener('click', () => ctx.go({ params: { view: v === 'inbox' ? null : v, s: null, f: null, kind: null, ref: null, q: null } }, true));
      tabs.append(b);
    }
    const sel = el('select.ms-input.ms-links-topic', { 'aria-label': 'Topic' });
    sel.append(new Option('Every topic', ''), ...topics.map((t) => new Option(t.title, t.id)));
    sel.value = ctx.params().get('topic') ?? '';
    sel.addEventListener('change', () => ctx.go({ params: { topic: sel.value || null, s: null, f: null } }, true));
    p.bar.replaceChildren(tabs, view() === 'skipped' || view() === 'page' ? '' : sel);
    p.bar.hidden = false;
    p.actions.replaceChildren(button('Topic map', () => ctx.open('#/topic-map', true), { icon: 'layers' }));
  }

  const done = (s: Suggestion, what: string) => {
    if (what === 'linked') return;
    const card = p.body.querySelector<HTMLElement>(`[data-suggestion="${CSS.escape(s.id)}"]`);
    card?.remove();
    if (counts.inbox !== null && what !== 'undone') counts.inbox = Math.max(0, counts.inbox - 1);
    bar();
    if (what === 'undone') void load();
  };
  const cards = (items: Suggestion[], showTarget: boolean) => {
    const box = el('div.ms-links-cards');
    for (const s of items) box.append(suggestionCard(s, { done, open: (hash) => ctx.open(hash, true), showTarget }));
    // the card someone is on is in the URL (s), so the link to it can be shared
    box.addEventListener('focusin', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-suggestion]')?.dataset.suggestion;
      if (id && ctx.params().get('s') !== id) ctx.go({ params: { s: id } });
    });
    return box;
  };

  async function inbox(): Promise<HTMLElement> {
    const r = await linkInbox(ctx.params().get('topic'));
    counts.inbox = r.counts.total;
    if (!r.items.length) return state('empty', 'No suggestions open', r.skipped ? `Every page has the links it needs. ${plural(r.skipped, 'suggestion was', 'suggestions were')} skipped (see Skipped).` : 'Every page has the links it needs, or no other page talks about it yet.');
    // grouped by the page the links go to: “Links to X”
    const by = new Map<string, Suggestion[]>();
    for (const s of r.items) by.set(s.to, [...(by.get(s.to) ?? []), s]);
    const wrap = el('div.ms-links-inbox', el('p.ms-links-lead', `${plural(r.counts.total, 'suggestion', 'suggestions')}: ${r.counts.in} for pages with few links in, ${r.counts.out} links up to a main page.`));
    for (const [to, items] of by) {
      const t = items[0];
      wrap.append(el('section.ms-links-group', el('h2.ms-links-to', 'Links to ', el('a', { href: `#/links?view=page&ref=${encodeURIComponent(to)}` }, t.toTitle)), t.toUrl ? link(t.toUrl, 'page address', 'ms-links-tourl') : '', cards(items, false)));
    }
    return wrap;
  }

  async function health(): Promise<HTMLElement> {
    const r = await linkHealth({ topic: ctx.params().get('topic'), kind: ctx.params().get('kind') });
    counts.health = r.total;
    topics = r.topics;
    const kinds = el('div.ms-adm-chips.ms-links-kinds', { role: 'group', 'aria-label': 'Kind' });
    const kindBtn = (k: string, label: string, n: number) => {
      const b = el('button.ms-adm-chip', { type: 'button', 'aria-pressed': String((ctx.params().get('kind') ?? '') === k) }, label, el('span.ms-links-count.ms-num', String(n)));
      b.addEventListener('click', () => ctx.go({ params: { kind: k || null, f: null } }, true));
      kinds.append(b);
    };
    kindBtn('', 'All', r.total);
    for (const [k, label] of Object.entries(r.kinds)) if (r.counts[k]) kindBtn(k, label, r.counts[k]);
    return el('div.ms-links-health', kinds, healthView(ctx, r.items, () => void load()));
  }

  async function pages(): Promise<HTMLElement> {
    const r = await linkPages(ctx.params().get('topic'));
    topics = r.topics;
    pagesCache = r.items;
    const wrap = el('div.ms-links-pages', searchBox(ctx, 'q', 'Find a page'));
    const table = el('table.ms-adm-table.ms-links-table');
    table.append(el('thead', el('tr', el('th', 'Page'), el('th', 'Topic'), el('th.ms-num', { title: 'Pages that link here in their text' }, 'Links in'), el('th.ms-num', { title: 'Links in its text to pages of the site' }, 'Links out'), el('th.ms-num', 'Outside links'))));
    const body = el('tbody');
    table.append(body);
    wrap.append(table);
    const fill = () => {
      const q = (ctx.params().get('q') ?? '').toLowerCase();
      body.replaceChildren();
      const names = new Map(topics.map((t) => [t.id, t.title]));
      for (const x of (pagesCache ?? []).filter((y) => !q || y.title.toLowerCase().includes(q) || String(y.url ?? '').includes(q)).sort((a, b) => a.in - b.in || a.title.localeCompare(b.title))) {
        const name = el('td', el('a', { href: `#/links?view=page&ref=${encodeURIComponent(x.ref)}` }, x.title), x.url ? link(x.url, 'page address', 'ms-links-rowurl') : '', x.live ? '' : el('span.ms-tb-card__draft', 'Draft'));
        const tr = el('tr', { class: x.live && x.in <= 1 ? 'is-weak' : '' }, name, el('td', x.topic ? names.get(x.topic) ?? x.topic : el('span.ms-adm-none', 'None')), el('td.ms-num', String(x.in)), el('td.ms-num', String(x.out)), el('td.ms-num', String(x.external)));
        body.append(tr);
      }
    };
    fill();
    filler = fill;
    return wrap;
  }
  let filler: (() => void) | null = null;

  async function onePage(): Promise<HTMLElement> {
    const ref = ctx.params().get('ref') ?? '';
    const [s, h] = await Promise.all([suggestFor(ref), linkHealth({ ref })]);
    ctx.setTitle(`${s.page.title} · Links`);
    const pg = s.page;
    const head = el('div.ms-links-page', el('h2', el('a', { href: pg.edit }, pg.title)), pg.url ? link(pg.url, 'page address') : '', el('p.ms-links-facts', el('span.ms-num', plural(pg.in, 'page links', 'pages link')), ' here in their text · ', el('span.ms-num', `${pg.out} links out`), ' · ', el('span.ms-num', `${pg.external} outside`)));
    const sec = (title: string, empty: string, items: Suggestion[]) => el('section.ms-links-group', el('h3', `${title} (${items.length})`), items.length ? cards(items, false) : el('p.ms-adm-none', empty));
    return el(
      'div',
      head,
      sec('Pages that should link here', 'No other page talks about it without a link.', s.in),
      sec('Pages it should link to', pg.topic ? 'It links to the pages it should.' : 'Put it in a topic (its Page settings) to see these.', s.out),
      el('section.ms-links-group', el('h3', `To fix on this page (${h.items.length})`), healthView(ctx, h.items, () => void load())),
    );
  }

  async function skipped(): Promise<HTMLElement> {
    const r = await listSkips();
    if (!r.items.length) return state('empty', 'Nothing skipped', 'Suggestions someone skips show here, to bring back.');
    const ul = el('ul.ms-links-skips');
    for (const x of r.items) {
      ul.append(
        el(
          'li',
          el('span', `“${x.anchor ?? ''}” on ${x.from} to ${x.to}`),
          el('span.ms-adm-none', x.by ? ` · skipped by ${x.by}` : ''),
          button('Bring back', async () => {
            try {
              await unskip(x.id);
              ctx.toast('It will be suggested again.', 'ok');
              void load();
            } catch (e) {
              ctx.toast(message(e), 'error');
            }
          }, { small: true, icon: 'undo' }),
        ),
      );
    }
    return ul;
  }

  async function load(): Promise<void> {
    if (!config().topics) return void p.body.replaceChildren(state('empty', 'This site keeps no topics', 'A developer turns them on in the site config (topics). Links are suggested between pages of a topic.'));
    const mine = (drawnKey = key());
    filler = null;
    bar();
    p.body.replaceChildren(state('loading', 'Reading the site’s links…'));
    try {
      const v = view();
      const out = v === 'health' ? await health() : v === 'pages' ? await pages() : v === 'page' ? await onePage() : v === 'skipped' ? await skipped() : await inbox();
      // gone, or the URL moved on while this loaded: the newer load draws
      if (!alive || key() !== mine) return;
      if (v !== 'page') ctx.setTitle(`${VIEWS.find(([x]) => x === v)?.[1] ?? 'Links'} · Links`);
      // the other tab's count, for the tabs
      if (counts.health === null && v !== 'health') void linkHealth({}).then((r) => ((counts.health = r.total), (topics = r.topics), alive && bar()), () => {});
      if (counts.inbox === null && v !== 'inbox') void linkInbox().then((r) => ((counts.inbox = r.counts.total), alive && bar()), () => {});
      bar();
      p.body.replaceChildren(out);
      focusOpen();
    } catch (e) {
      if (alive && key() === mine) p.body.replaceChildren(failure(e, () => void load()));
    }
  }

  /** The open suggestion or finding (s, f in the URL) in view. */
  function focusOpen(): void {
    const s = ctx.params().get('s');
    const f = ctx.params().get('f');
    const node = s ? p.body.querySelector<HTMLElement>(`[data-suggestion="${CSS.escape(s)}"]`) : f ? p.body.querySelector<HTMLElement>(`[data-finding="${CSS.escape(f)}"]`) : null;
    for (const x of p.body.querySelectorAll('.is-open')) x.classList.remove('is-open');
    if (!node) return;
    node.classList.add('is-open');
    node.scrollIntoView({ block: 'nearest' });
  }

  void load();
  return {
    update() {
      if (key() !== drawnKey) return void load();
      filler?.();
      focusOpen();
    },
    destroy() {
      alive = false;
    },
  };
}
