// Home (#/, docs/EDITOR-UX.md section 2): a greeting, four cards (Edit a page, Write a new post, Read messages, Go
// live), Recent (the entries this person touched last, with Live/Draft pills) and Your site (last went live, drafts
// not live, last backup, site check-up). Every fact comes from an existing API, or the line is left out. With no
// content yet: one sentence and "Write your first page".
import './styles/home.css';
import type { EntrySummary } from './api';
import { request } from './api';
import { screen as screenDef } from './host';
import { ic } from './icons';
import { readRecent } from './palette';
import { collectionWord, greeting, statusWord } from './shell-words';
import { LOCALE } from './dates';

export interface HomeDeps {
  me: { name: string; role: string };
  siteName: string;
  /** every entry of the editable collections, as the search has them */
  entries: EntrySummary[];
  collections: { id: string; label: string; format: 'md' | 'json' }[];
  newHref: string | null;
  /** the unread messages, when the inbox is on this server and the role may read it (null: no count) */
  unread: () => Promise<number | null>;
}

const MANAGERS = ['owner', 'administrator'];
const enc = encodeURIComponent;

const h = (tag: string, cls: string, html = '') => {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

/** "3 days ago", "Today, 12:30 PM", "Nov 2". */
export function ago(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  const days = Math.floor((now - t) / 86_400_000);
  const time = d.toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' });
  if (days <= 0 && now - t < 86_400_000) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(LOCALE, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
}

/** The last six entries: the ones this person opened last, then the most recently changed. */
export function recentEntries(all: EntrySummary[], recentKeys: string[], max = 6): EntrySummary[] {
  const byKey = new Map(all.map((e) => [`${e.collection}/${e.id}`, e]));
  const mine = recentKeys.map((k) => byKey.get(k)).filter((e): e is EntrySummary => !!e);
  const rest = all.filter((e) => !mine.includes(e)).sort((a, b) => Date.parse(b.modified ?? '') - Date.parse(a.modified ?? '') || 0);
  return [...mine, ...rest].slice(0, max);
}

export function mountHome(host: HTMLElement, d: HomeDeps): void {
  const root = h('div', 'ms-home');
  host.replaceChildren(root);
  host.classList.add('is-home');
  const alive = () => host.contains(root);
  const entriesHref = (c: string) => `#/entries?c=${enc(c)}`;
  const pages = d.collections.find((c) => collectionWord(c) === 'Pages') ?? d.collections[0];
  const drafts = d.entries.filter((e) => e.status === 'draft' || e.status === 'scheduled');

  // nothing yet: one sentence, one button
  if (!d.entries.length) {
    const empty = h('div', 'ms-home__empty', `${ic('article', 28)}<h1></h1><p>Nothing is written yet. Your first page can start now.</p>`);
    empty.querySelector('h1')!.textContent = greeting(new Date().getHours(), d.me.name);
    if (d.newHref) empty.append(Object.assign(document.createElement('a'), { className: 'ms-btn ms-btn--primary', href: d.newHref, innerHTML: `${ic('plus', 15)}<span>Write your first page</span>` }));
    root.append(empty);
    return;
  }

  const head = h('div', 'ms-home__head', '<h1></h1><p></p>');
  head.querySelector('h1')!.textContent = greeting(new Date().getHours(), d.me.name);
  head.querySelector('p')!.textContent = drafts.length ? `${drafts.length} ${drafts.length === 1 ? 'draft is' : 'drafts are'} not on the site yet.` : 'Everything you saved is on the site.';
  root.append(head);

  const cards = h('div', 'ms-home__cards');
  const card = (href: string | null, icon: string, title: string, text: string) => {
    const a = document.createElement(href ? 'a' : 'div');
    a.className = 'ms-home__card';
    if (a instanceof HTMLAnchorElement && href) a.href = href;
    a.innerHTML = `<span class="ms-home__cardic">${ic(icon, 20)}</span><b></b><p></p>`;
    a.querySelector('b')!.textContent = title;
    a.querySelector('p')!.textContent = text;
    cards.append(a);
    return a.querySelector('p')!;
  };
  if (screenDef('entries') && pages) card(entriesHref(pages.id), 'pencil', 'Edit a page', 'Open any page and change the words or pictures.');
  if (d.newHref) card(d.newHref, 'plus', 'Write a new post', 'Start a blog post from a blank page or a template.');
  const inbox = screenDef('inbox');
  const messagesText = inbox && (!inbox.roles || inbox.roles.includes(d.me.role)) ? card('#/inbox', 'mail', 'Read messages', 'What people wrote through your forms.') : null;
  const goLive = screenDef('releases') ? '#/releases' : screenDef('jobs') ? '#/jobs' : null;
  if (goLive) card(goLive, 'send', 'Go live', drafts.length ? `${drafts.length} ${drafts.length === 1 ? 'change' : 'changes'} waiting.` : 'Nothing waiting. Everything you saved is already on the site.');
  root.append(cards);

  const two = h('div', 'ms-home__two');
  // Recent
  const recent = h('section', 'ms-home__panel', '<h2>Recent</h2>');
  if (screenDef('entries') && pages) {
    const all = Object.assign(document.createElement('a'), { href: entriesHref(pages.id), textContent: 'See all' });
    recent.querySelector('h2')!.append(all);
  }
  for (const e of recentEntries(d.entries, readRecent())) {
    const c = d.collections.find((x) => x.id === e.collection);
    const row = document.createElement('a');
    row.className = 'ms-home__row';
    row.href = `#/${c?.format === 'json' ? 'p' : 'e'}/${enc(e.collection)}/${enc(e.id)}`;
    const st = statusWord(e.status);
    row.innerHTML = `<span class="ms-home__doc">${ic(c?.format === 'json' ? 'file' : 'article', 18)}</span><span class="ms-home__rowtext"><b></b><small></small></span><span class="ms-home__pill is-${st.kind}"></span>`;
    row.querySelector('b')!.textContent = e.title || 'Untitled';
    const kind = c ? collectionWord(c).replace(/s$/, '') : e.collection;
    row.querySelector('small')!.textContent = [kind, e.modified ? ago(e.modified) : ''].filter(Boolean).join(' · ');
    row.querySelector('.ms-home__pill')!.textContent = st.word;
    recent.append(row);
  }
  two.append(recent);

  // Your site
  const site = h('section', 'ms-home__panel', '<h2>Your site</h2>');
  const lines = h('div', 'ms-home__lines');
  site.append(lines);
  const line = (label: string, value: string | HTMLElement, tone?: 'ok' | 'warn') => {
    const l = h('div', 'ms-home__line', '<span></span><span></span>');
    l.firstElementChild!.textContent = label;
    const v = l.lastElementChild as HTMLElement;
    if (typeof value === 'string') v.textContent = value;
    else v.append(value);
    if (tone) v.classList.add(`is-${tone}`);
    lines.append(l);
    return v;
  };
  const link = (href: string, text: string) => Object.assign(document.createElement('a'), { href, textContent: text });
  line('Drafts not live yet', screenDef('entries') && pages ? link(`${entriesHref(drafts[0]?.collection ?? pages.id)}&status=draft`, String(drafts.length)) : String(drafts.length));
  two.append(site);
  root.append(two);

  // the facts that take a request each: unread messages, the last job that went live, the check-up and the backup
  void d.unread().then((n) => {
    if (!alive() || n === null || !messagesText) return;
    messagesText.textContent = n ? `${n} ${n === 1 ? 'person' : 'people'} wrote through the contact form.` : 'No new messages.';
  });
  if (screenDef('jobs')) {
    void request<{ id: string; status: string; finishedAt: string | null; kind: string }[]>('jobs?limit=20')
      .then((jobs) => {
        if (!alive()) return;
        const ok = jobs.find((j) => j.status === 'succeeded' && j.finishedAt);
        line('Last went live', ok ? link(`#/jobs/${enc(ok.id)}`, ago(ok.finishedAt!)) : 'Not yet from here');
      })
      .catch(() => {});
  }
  if (screenDef('health') && MANAGERS.includes(d.me.role)) {
    void request<{ counts: { altText: number; links: number; headings: number; noDescription: number }; backup: { on: boolean; last?: { at?: string; ok: boolean } | null } }>('site/health')
      .then((hh) => {
        if (!alive()) return;
        const b = hh.backup;
        if (b.on) line('Last backup', b.last?.at ? link('#/health?part=backups', `${ago(b.last.at)}${b.last.ok ? '' : ' (failed)'}`) : 'None yet', b.last && !b.last.ok ? 'warn' : undefined);
        const todo = hh.counts.altText + hh.counts.links + hh.counts.headings + hh.counts.noDescription;
        line('Site check-up', link('#/health', todo ? `${todo} ${todo === 1 ? 'thing' : 'things'} to look at` : 'All good'), todo ? 'warn' : 'ok');
      })
      .catch(() => {});
  }
}
