// Site health (owner, administrator), docs/SEO.md section 4:
//   #/health?show=   every live page with what needs looking at (show: alt | links | headings | all), the search
//                    titles and descriptions used twice, the last deploy and failures since, disk room, and speed
//                    from Google's field data (the site's own key). The four CSV exports download from here.
//                    show=broken|chains|redirects: what the host serves for each address (health-addresses.ts).
import type { ScreenCtx } from '../host';
import * as api from './api';
import { ADDRESS_SHOWS, addressChips, addressesCard, addressesLine } from './health-addresses';
import { plain } from './plain';
import { buildBlockedLine, button, bytes, chips, el, failure, link, message, page, state, value, when } from './ui';

const size = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : bytes(n));
const RATING_WORDS: Record<string, string> = { good: 'Good', 'needs-work': 'Needs work', poor: 'Poor' };
const EXPORTS: [api.ExportKind, string][] = [['pages', 'Pages'], ['links', 'Links'], ['images', 'Images'], ['headings', 'Headings']];
const SHOW: Record<string, (p: api.HealthPage) => boolean> = {
  alt: (p) => p.altText > 0,
  links: (p) => p.links.length > 0,
  headings: (p) => p.headings > 0,
};

export function mountHealth(host: HTMLElement, ctx: ScreenCtx) {
  const p = page(host, 'Site check-up', 'Every live page and what needs a look, how fast it is for real visitors, the last time it went live, and the backups.');
  p.bar.hidden = false;
  p.actions.append(el('div.ms-adm-row', el('span.ms-adm-sub', 'Download CSV:'), ...EXPORTS.map(([k, l]) => el('a.ms-btn.ms-btn--sm', { href: api.exportUrl(k), download: `site-${k}.csv` }, l))));
  let data: api.Health | null = null;
  let alive = true;

  async function load(): Promise<void> {
    p.body.replaceChildren(state('loading', 'Reading every live page… This takes a few seconds on a large site (each page is checked for its pictures, links and headings).'));
    try {
      data = await api.health();
    } catch (e) {
      p.body.replaceChildren(failure(e, () => void load()));
      return;
    }
    if (alive) render();
  }

  function render(): void {
    if (!data) return;
    const h = data;
    const show = ctx.params().get('show') ?? '';
    p.bar.replaceChildren(chips(ctx, 'show', 'Show', [['', 'Needs a look'], ['alt', `Alt text (${h.counts.altText})`], ['links', `Links (${h.counts.links})`], ['headings', `Headings (${h.counts.headings})`], ['all', `All live pages (${h.counts.live})`], ...addressChips(h.addresses)]));
    const addresses = (ADDRESS_SHOWS as string[]).includes(show);
    p.body.replaceChildren(el('div.ms-adm-health', summary(h), speedCard(h), duplicatesCard(h), addresses ? addressesCard(ctx, show as api.AddressShow) : pagesCard(h, show)));
    // the drawer's Backups line lands on the backup facts
    if (ctx.params().get('part') === 'backups') p.body.querySelector('#ms-backups')?.scrollIntoView({ block: 'center' });
  }

  // ---------- the deploy, disk, backups ----------
  function summary(h: api.Health): HTMLElement {
    const d = h.deploy;
    const free = h.disk.free !== null && h.disk.total ? h.disk.free / h.disk.total : null;
    return el('section.ms-adm-card', { 'aria-label': 'The site' },
      el('div.ms-adm-row', el('h2.ms-adm-h2', 'The site'), el('span.ms-adm-grow'), d.canRollBack ? button('Roll back to the release before', () => void rollBack(), { small: true, icon: 'undo' }) : null),
      el('dl.ms-adm-facts',
        el('dt', 'Live pages'), el('dd', `${h.counts.live}`, h.counts.drafts ? el('span.ms-adm-sub', ` · ${h.counts.drafts} not live (drafts, scheduled)`) : null),
        el('dt', d.kind === 'rollback' ? 'Rolled back' : 'Last deploy'), el('dd', d.at ? when(d.at) : el('span.ms-adm-none', 'Not deployed from here yet'), d.commit ? el('span.ms-adm-sub', ' · commit ', value(d.commit.slice(0, 12), 'commit')) : null, d.job ? el('span.ms-adm-sub', ' · ', el('a', { href: `#/jobs/${encodeURIComponent(d.job)}` }, 'the job')) : null),
        ...(d.blocked?.entries.length ? [el('dt', 'Build blocked'), el('dd', buildBlockedLine(d.blocked, { heading: false }))] : []),
        el('dt', 'Failed since'), el('dd', d.failedSince.length ? el('ul.ms-adm-issues', ...d.failedSince.map((f) => el('li.is-bad', el('a', { href: `#/jobs/${encodeURIComponent(f.id)}` }, f.entry ?? f.kind), el('span.ms-adm-sub', ' · ', when(f.at), f.error ? ` · ${f.error}` : '')))) : 'Nothing'),
        el('dt', 'Disk'), el('dd', h.disk.free !== null ? `${size(h.disk.free)} free${free !== null && free < 0.1 ? ' (low)' : ''}` : 'Unknown', el('span.ms-adm-sub', ` · ${h.disk.media.files} images, ${bytes(h.disk.media.bytes)}`)),
        el('dt', { id: 'ms-backups' }, 'Last backup'), el('dd', backupLine(h.backup)),
        el('dt', 'Alerts'), el('dd', alertsLine(h.alerts)),
        ...(h.addresses?.on ? [el('dt', 'Addresses'), el('dd', addressesLine(h.addresses, ctx, () => void load()))] : []),
        ...(h.forms?.crm?.forms.length ? [el('dt', h.forms.crm.forms[0].name), el('dd', crmLine(h.forms.crm))] : []),
      ),
    );
  }

  /** Each form that sends its messages to the CRM: on, or why not; and the messages that did not go. */
  function crmLine(c: api.CrmStatus): Node {
    const name = c.forms[0].name;
    const forms = c.forms.map((f) => (f.on ? el('span', `${f.label} form: on`) : el('span.is-bad', { title: f.problem ?? undefined }, `${f.label} form: not connected to ${name} on this server. Ask whoever runs the server.`)));
    const failed = c.failed
      ? el('a.is-bad', { href: '#/inbox?crm=failed' }, `${c.failed} ${c.failed === 1 ? 'message' : 'messages'} not sent to ${name}`)
      : el('span.ms-adm-sub', `Every message went to ${name}`);
    return el('span', ...forms.flatMap((f, i) => (i ? [el('span.ms-adm-sub', ' · '), f] : [f])), el('span.ms-adm-sub', ' · '), failed);
  }

  /** The last backup, how often, and Back up now; off: how to turn it on. */
  function backupLine(b: api.BackupStatus): Node {
    if (!b.on) return plain('Backups are not set up on this server yet. Ask whoever runs the server.', 'For the server’s administrator: set backup.dir in the server config (docs/DEPLOY.md, Backups).');
    const l = b.last;
    const now = button('Back up now', () => void backUp(), { small: true, kind: 'quiet', icon: 'refresh' });
    const every = el('span.ms-adm-sub', ` · every ${b.everyHours === 24 ? 'day' : `${b.everyHours} h`}, newest ${b.keep} kept${b.ships ? ', copied on by the server’s command' : ''} · `);
    if (!l) return el('span', el('span.ms-adm-none', 'None yet'), every, now);
    const failed = !l.ok ? el('div.ms-adm-warnline', { role: 'alert' }, 'The last try failed', l.failedAt ? el('span', ' (', when(l.failedAt), ')') : null, `: ${l.error ?? 'see the job'}.`) : null;
    return el('span', l.at ? when(l.at) : el('span.ms-adm-none', 'None yet'), l.bytes ? el('span.ms-adm-sub', ` · ${size(l.bytes)}`) : null, b.late ? el('span.ms-adm-badge.is-bad', 'late') : null, every, now, failed);
  }

  /** Where a failure is told besides the editor, and Send a test alert (each channel's answer under it). */
  function alertsLine(a: api.Health['alerts'] | undefined): Node {
    const on = (['email', 'slack', 'webhook'] as const).filter((k) => a?.[k]);
    if (!on.length) return plain('Problems are shown in the editor only; no email or chat alerts are set up on this server yet. Ask whoever runs the server.', 'For the server’s administrator: notify.email, notify.slack or notify.webhook in the server config (docs/DEPLOY.md, Alerts).');
    const names = { email: 'Email', slack: 'Slack', webhook: 'Webhook' };
    const result = el('ul.ms-adm-issues', { hidden: true, 'aria-live': 'polite' });
    const send = button('Send a test alert', async () => {
      send.disabled = true;
      try {
        const r = await api.testAlert();
        result.replaceChildren(...r.channels.map((c) => el(`li.${c.ok ? 'is-ok' : 'is-bad'}`, el('strong', `${names[c.channel]}: `), c.ok ? 'sent' : 'not sent', el('span.ms-adm-sub', ` · ${c.detail}`))));
        result.hidden = false;
        ctx.toast(r.channels.every((c) => c.ok) ? 'Test alert sent.' : 'Some alerts did not go out. See Site health.', r.channels.every((c) => c.ok) ? 'ok' : 'error');
      } catch (e) {
        ctx.toast(message(e), 'error');
      } finally {
        send.disabled = false;
      }
    }, { small: true, kind: 'quiet', icon: 'alert' });
    return el('span', `In the editor, and by ${on.map((k) => names[k]).join(', ')}`, el('span.ms-adm-sub', ' · failed publishes, deploys and backups, held or late schedules · '), send, result);
  }

  async function backUp(): Promise<void> {
    try {
      const r = await api.backUpNow();
      ctx.toast('Backing up. It shows here when it is done.', 'info');
      ctx.open(`#/jobs/${encodeURIComponent(r.job)}`, true);
    } catch (e) {
      ctx.toast(message(e), 'error');
    }
  }

  // ---------- speed ----------
  function vitals(v: api.Vitals | undefined): HTMLElement {
    if (!v) return el('span.ms-adm-none', '—');
    if ('none' in v) return el('span.ms-adm-none', 'Not enough visitors for Google’s data yet');
    const one = (name: string, m: { p75: number | null; rating: api.Rating }, unit: (n: number) => string) =>
      el(`span.ms-adm-vital.is-${m.rating ?? 'none'}`, { title: m.rating ? RATING_WORDS[m.rating] : 'No data' }, el('strong', name), ' ', m.p75 === null ? '—' : unit(m.p75), m.rating ? el('span.ms-adm-sub', ` ${RATING_WORDS[m.rating]}`) : null);
    return el('span.ms-adm-vitals',
      one('Loading', v.lcp, (n) => `${(n / 1000).toFixed(1)} s`),
      one('Response', v.inp, (n) => `${Math.round(n)} ms`),
      one('Layout shift', v.cls, (n) => n.toFixed(2)),
    );
  }

  function speedRows(s: api.Speed | null): HTMLElement {
    if (!s) return el('p.ms-adm-sub', 'Not asked yet.');
    if (s.error) return el('p.ms-adm-sub.is-bad', s.error);
    return el('dl.ms-adm-facts', el('dt', 'On phones'), el('dd', vitals(s.phone)), el('dt', 'On computers'), el('dd', vitals(s.desktop)));
  }

  function speedCard(h: api.Health): HTMLElement {
    const card = el('section.ms-adm-card', { 'aria-label': 'Speed for real visitors' }, el('div.ms-adm-row', el('h2.ms-adm-h2', 'Speed for real visitors'), el('span.ms-adm-grow')));
    if (!h.speed.on) {
      card.append(el('p.ms-adm-sub', h.speed.why === 'no-site-url' ? plain('Off: the site has no public address yet, so Google has no speed figures for it.', 'For the server’s administrator: siteUrl in markstage.config.') : plain('Not set up on this server yet. Ask whoever runs the server.', 'For the server’s administrator: a Chrome UX Report key as crux in config.json (docs/DEPLOY.md, Operations).')));
      return card;
    }
    card.firstElementChild!.append(button('Ask Google again', () => void ask(null), { icon: 'refresh', small: true }));
    card.append(
      el('p.ms-adm-sub', 'The 75th percentile of the last 28 days of Chrome visitors, for the whole site. Google updates it once a day.', h.speed.site?.fetchedAt ? el('span', ' Asked ', when(h.speed.site.fetchedAt), '.') : null),
      speedRows(h.speed.site),
    );
    return card;
  }

  /** A bad release: the one before goes back live; saved changes stay saved and go live with the next publish. */
  async function rollBack(): Promise<void> {
    const ok = await ctx.ask('Roll back the live site?', 'The release before this one goes back live, for every visitor. Nothing saved here is lost: changes saved since stay in the editor and go live again with the next publish.', [['cancel', 'Cancel'], ['go', 'Roll back', 'ms-btn ms-btn--danger']]);
    if (ok !== 'go') return;
    try {
      const r = await api.rollBack();
      ctx.open(`#/jobs/${encodeURIComponent(r.job)}`);
    } catch (e) {
      ctx.toast(message(e), 'error');
    }
  }

  async function ask(path: string | null): Promise<void> {
    try {
      const s = await api.askSpeed(path);
      if (!data) return;
      if (path === null) data.speed.site = s;
      else for (const row of data.pages) if (row.path === path) row.speed = s;
      render();
    } catch (e) {
      ctx.toast(message(e), 'error');
    }
  }

  // ---------- duplicates ----------
  function duplicatesCard(h: api.Health): HTMLElement | null {
    if (!h.duplicates.length) return null;
    const entryLink = (e: api.EntryRef) => el('a', { href: `#/e/${encodeURIComponent(e.collection)}/${encodeURIComponent(e.id)}` }, `“${e.title}”`);
    return el('section.ms-adm-card', { 'aria-label': 'Used twice' },
      el('h2.ms-adm-h2', 'The same words on more than one page'),
      el('p.ms-adm-sub', 'Search engines show one of them. Give each page its own search title and description.'),
      el('ul.ms-adm-issues', ...h.duplicates.map((d) => el('li', el('strong', d.what === 'title' ? 'Search title ' : 'Description '), value(d.text, d.what === 'title' ? 'search title' : 'description'), el('span.ms-adm-sub', ' on '), ...d.entries.flatMap((e, i) => (i ? [', ', entryLink(e)] : [entryLink(e)]))))),
    );
  }

  // ---------- pages ----------
  function pagesCard(h: api.Health, show: string): HTMLElement {
    const rows = h.pages.filter(show === 'all' ? () => true : SHOW[show] ?? ((x) => x.altText > 0 || x.links.length > 0 || x.headings > 0));
    if (!rows.length) return el('section.ms-adm-card', state('empty', show === 'all' ? 'No live pages' : 'Nothing to look at', show === 'all' ? '' : 'Every live page passes these checks.'));
    const t = el('table.ms-adm-table.ms-adm-table--rows', el('thead', el('tr', el('th', 'Page'), el('th', 'Address'), el('th', 'Words'), el('th', 'Needs a look'), el('th', 'Speed on phones'))));
    const tb = el('tbody');
    for (const r of rows) {
      const issues: (HTMLElement | string)[] = [];
      if (r.altText) issues.push(el('span.ms-adm-badge.is-bad', `${r.altText} image${r.altText === 1 ? '' : 's'} without alt`));
      for (const l of r.links) issues.push(el('span.ms-adm-badge.is-bad', { title: l.href }, l.problem === 'not-live' ? `link to “${l.target?.title ?? l.href}”, not live` : l.sure === false ? `link to ${l.href} (may not exist)` : `link to ${l.href}, no page`));
      if (r.headings) issues.push(el('span.ms-adm-badge', `${r.headings} heading${r.headings === 1 ? '' : 's'} to check`));
      if (r.searchTitle > 60) issues.push(el('span.ms-adm-badge', 'long search title'));
      if (!r.description) issues.push(el('span.ms-adm-badge', 'no description'));
      const phone = r.speed?.phone;
      tb.append(
        el('tr',
          el('td', el('a.ms-adm-rowlink', { href: `#/e/${encodeURIComponent(r.collection)}/${encodeURIComponent(r.id)}` }, r.title)),
          el('td', r.url ? link(r.url, 'the page address') : el('span.ms-adm-none', '—')),
          el('td', r.words === null ? '—' : String(r.words)),
          el('td', issues.length ? el('div.ms-adm-badges', ...issues) : el('span.ms-adm-sub', 'Fine')),
          el('td', phone ? vitals(phone) : r.speed?.error ? el('span.ms-adm-sub.is-bad', r.speed.error) : h.speed.on && r.path ? button('Ask Google', () => void ask(r.path), { small: true, kind: 'quiet' }) : el('span.ms-adm-none', '—')),
        ),
      );
    }
    t.append(tb);
    return el('section.ms-adm-card.ms-adm-card--flush', { 'aria-label': 'Pages' }, t);
  }

  void load();
  return {
    update: () => render(),
    destroy: () => {
      alive = false;
    },
  };
}
