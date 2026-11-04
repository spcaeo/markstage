// The topic part of a page's settings (docs/API-LINKS.md), under the Page box: the topic the page is in (its group,
// and whether it leads the group or is the topic's main page), put in straight away (it is kept in the topic's file,
// not the page's), then its links: how many pages link to it, the pages it should link to (with "Link these words"
// on the canvas) and the pages that should link to it (Accept changes that page; Skip is remembered). Owners,
// administrators and editors put pages in topics; everyone sees the suggestions. Hidden where the server keeps no
// topics (astro dev).
import { ApiError } from '../api';
import { ic } from '../icons';
import { h } from '../panel-form';
import { viewerRole } from '../runtime';
import { suggestionCard } from '../suggestion-card';
import { onTopicsChanged, placePage, suggestFor, topics, topicsChanged, type PageRow, type Suggestion, type Topic } from '../topics';
import { toast } from '../host';
import '../styles/links.css';
import type { DrawnField } from './fields';

export interface TopicBoxCtx {
  collection: string;
  /** the saved entry's id (null: not saved yet) */
  id: () => string | null;
  /** links the words on the open page's canvas (Markdown pages) */
  linkHere?: (s: Suggestion) => boolean;
}

const EDITORS = ['owner', 'administrator', 'editor'];
let uid = 0;
const t = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text: string) => Object.assign(h(tag, cls), { textContent: text });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function topicBox(ctx: TopicBoxCtx): DrawnField & { recheck: () => void; destroy: () => void } {
  const n = ++uid;
  const el = h('section', 'ms-topicbox');
  el.setAttribute('aria-label', 'Topic and links');
  const may = EDITORS.includes(viewerRole());
  const ref = () => (ctx.id() ? `${ctx.collection}/${ctx.id()}` : null);

  const select = (label: string, id: string) => {
    const f = h('div', 'ms-field');
    const lab = t('label', 'ms-field__label', label);
    const s = h('select', 'ms-input');
    s.id = `ms-topicbox-${id}-${n}`;
    lab.htmlFor = s.id;
    f.append(lab, s);
    return { f, s };
  };
  const topicSel = select('Link topic', 'topic');
  const groupSel = select('Group', 'group');
  const roleSel = select('This page is', 'role');
  const hint = h('div', 'ms-field__hint');
  const links = h('div', 'ms-topicbox__links');
  links.setAttribute('aria-live', 'polite');
  el.append(topicSel.f, groupSel.f, roleSel.f, hint, links);

  let list: Topic[] = [];
  let page: PageRow | null = null;
  let sugg: { in: Suggestion[]; out: Suggestion[] } | null = null;
  let loading = false;
  let failed = '';

  const current = () => list.find((x) => x.id === topicSel.s.value) ?? null;
  const drawPlace = () => {
    topicSel.s.replaceChildren(new Option('No topic', ''), ...list.map((x) => new Option(x.title, x.id)));
    topicSel.s.value = page?.topic ?? '';
    const tp = current();
    groupSel.f.hidden = !tp || !tp.groups.length || page?.role === 'pillar';
    groupSel.s.replaceChildren(new Option('No group', ''), ...(tp?.groups ?? []).map((g) => new Option(g.name, g.id)));
    groupSel.s.value = page?.group ?? '';
    roleSel.f.hidden = !tp;
    roleSel.s.replaceChildren(new Option('A page in the topic', 'member'), new Option('The lead page of its group', 'lead'), new Option('The topic’s main page', 'pillar'));
    roleSel.s.value = page?.role ?? 'member';
    for (const s of [topicSel.s, groupSel.s, roleSel.s]) s.disabled = !may || !ref();
    hint.textContent = !ref() ? 'Save the page first, then put it in a topic.' : may ? 'Kept in the topic’s file and saved straight away. Pages in a topic are suggested to link to each other.' : 'Only an owner, administrator or editor puts pages in topics.';
  };

  const place = async () => {
    const r = ref();
    if (!r) return;
    const role = roleSel.s.value as 'member' | 'lead' | 'pillar';
    if (role === 'lead' && !groupSel.s.value) return void toast('Pick the group this page leads first.', 'info');
    for (const s of [topicSel.s, groupSel.s, roleSel.s]) s.disabled = true;
    try {
      const out = await placePage(r, topicSel.s.value || null, { group: groupSel.s.value || null, role });
      page = out.page;
      topicsChanged();
      toast(out.topic ? `Put in the topic “${out.topic.title}”.` : 'Taken out of its topic.', 'ok');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
      drawPlace();
    }
  };
  topicSel.s.addEventListener('change', () => {
    groupSel.s.value = '';
    roleSel.s.value = 'member';
    void place();
  });
  groupSel.s.addEventListener('change', () => void place());
  roleSel.s.addEventListener('change', () => void place());

  const drawLinks = () => {
    links.replaceChildren();
    if (!ref()) return;
    const head = h('div', 'ms-topicbox__head');
    head.append(t('span', 'ms-field__label', 'Links'));
    const again = h('button', 'ms-btn ms-btn--sm');
    again.type = 'button';
    again.innerHTML = `${ic('refresh', 13)}<span>Look again</span>`;
    again.disabled = loading;
    again.addEventListener('click', () => void load());
    head.append(again);
    links.append(head);
    if (loading && !sugg) return void links.append(t('p', 'ms-field__hint', 'Looking at the site’s links…'));
    if (failed) return void links.append(t('p', 'ms-pagebox__note is-bad', failed));
    if (!page || !sugg) return;
    links.append(t('p', 'ms-topicbox__count', page.in ? `${plural(page.in, 'page links', 'pages link')} here in ${page.in === 1 ? 'its' : 'their'} text.` : 'No page links here in its text yet.'));
    const section = (title: string, empty: string, items: Suggestion[]) => {
      links.append(t('h3', 'ms-topicbox__sub', `${title} (${items.length})`));
      if (!items.length) return void links.append(t('p', 'ms-field__hint', empty));
      const ul = h('div', 'ms-topicbox__cards');
      for (const s of items)
        ul.append(
          suggestionCard(s, {
            linkHere: ctx.linkHere,
            open: (hash) => (location.hash = hash),
            done: (x, what) => {
              if (what === 'undone') return void load();
              sugg = sugg && { in: sugg.in.filter((y) => y.id !== x.id), out: sugg.out.filter((y) => y.id !== x.id) };
              if (what === 'accepted' && page) page = { ...page, in: page.in + 1 };
              drawLinks();
            },
          }),
        );
      links.append(ul);
    };
    section('Pages to link to', page.topic ? 'It links to the pages it should.' : 'Put it in a topic to see the pages it should link to.', sugg.out);
    section('Pages that should link here', 'No other page talks about it without a link.', sugg.in);
    const all = h('a', 'ms-topicbox__all');
    all.href = `#/links?view=page&ref=${encodeURIComponent(ref()!)}`;
    all.textContent = 'All of this page’s links';
    links.append(all);
  };

  async function load(): Promise<void> {
    const r = ref();
    drawPlace();
    if (!r) return drawLinks();
    loading = true;
    failed = '';
    drawLinks();
    try {
      const [ts, s] = await Promise.all([topics(), suggestFor(r)]);
      list = ts.items;
      page = s.page;
      sugg = { in: s.in, out: s.out };
    } catch (e) {
      // no topics on this server (astro dev), or the page is not in a topic collection: the box goes
      if (e instanceof ApiError && e.status === 404) el.hidden = true;
      else failed = `The links could not be read: ${e instanceof Error ? e.message : String(e)}`;
    }
    loading = false;
    drawPlace();
    drawLinks();
  }

  const off = onTopicsChanged(() => void topics().then((ts) => ((list = ts.items), drawPlace())));
  void load();
  return { el, sync: () => {}, focus: () => topicSel.s.focus(), recheck: () => void load(), destroy: off };
}
