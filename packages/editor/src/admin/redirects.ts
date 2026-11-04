// Redirects (editors and above), docs/OPERATIONS.md "Redirects":
//   #/redirects?q=&show=problems&item=<old address>&action=add|edit|test&path=<address to test>
// The site's old -> new addresses with what is wrong flagged (loops, chains, a page at the old address, a target that
// is not a page). A row opens in the drawer (item=), where it is changed, removed, tested, or a chain pointed at its
// end. Moves add redirects on their own; this is for the rest. Every change is built and deployed in a job.
import type { ScreenCtx } from '../host';
import { copyable } from '../copy';
import * as api from './api';
import { plain } from './plain';
import { button, chips, drawer, el, facts, failure, field, form, isEditorPlus, page, searchBox, state, whoami } from './ui';

const FLAG_LABEL: Record<api.RedirectFlagKind, string> = { loop: 'Loop', chain: 'Chain', shadowed: 'Never runs', missing: 'Not a page', duplicate: 'Twice', bad: 'Not an address' };
const VERDICT: Record<string, string> = {
  ok: 'Works: it ends at a page.',
  page: 'No redirect here: a page answers.',
  error: 'It ends at an error.',
  loop: 'A loop: visitors get an error.',
  away: 'It leaves the site.',
  long: 'Too many redirects in a row.',
};

export function mountRedirects(host: HTMLElement, ctx: ScreenCtx) {
  const p = page(host, 'Moved addresses', 'Old addresses that send visitors (and search engines) to new ones. Moving a page adds them on its own; add the others here. This list is the redirects kept with the content; Site check-up counts every address the built site answers, each language copy too, so its number is larger.');
  const layout = el('div.ms-adm-split');
  let data: api.RedirectList | null = null;
  let alive = true;
  let tested: { path: string; result: api.RedirectTest | Error } | null = null;

  /** A site path (or full URL) with copy and open; a path opens on the site itself. */
  const addr = (a: string, label = 'address', cls = '') => copyable(a, { label, open: /^https?:/.test(a) ? a : data?.siteUrl ? new URL(a, data.siteUrl).href : undefined, className: cls });

  async function load(): Promise<void> {
    p.body.replaceChildren(state('loading', 'Loading the redirects…'));
    try {
      if (!isEditorPlus(await whoami())) return void p.body.replaceChildren(state('denied', 'Not available to you', 'Editors, administrators and the owner manage redirects.'));
      data = await api.redirects();
    } catch (e) {
      return void p.body.replaceChildren(failure(e, () => void load()));
    }
    if (!alive) return;
    if (!data.on) {
      p.body.replaceChildren(state('empty', 'This site keeps no redirects yet', 'Ask whoever runs the site to turn redirects on; moving a page then leaves one behind, and this page lists them.', plain('Details', 'For the developer: add a redirects hook to markstage.config (docs/API.md, “The redirects hook”).', true)));
      return;
    }
    p.actions.replaceChildren(
      button('Test an address', () => ctx.go({ params: { action: 'test', item: null, path: null } }, true), { icon: 'search' }),
      button('Add a redirect', () => ctx.go({ params: { action: 'add', item: null } }, true), { kind: 'primary', icon: 'plus' }),
    );
    render();
  }

  function render(): void {
    // denied (no data) or no redirects hook: the message drawn by load stays
    if (!data?.on) return;
    const q = (ctx.params().get('q') ?? '').toLowerCase();
    const show = ctx.params().get('show') ?? '';
    const all = data.redirects;
    const problems = all.filter((r) => r.flags.length).length;
    p.bar.hidden = !data.canList;
    p.bar.replaceChildren(searchBox(ctx, 'q', 'Search old or new addresses'), chips(ctx, 'show', 'Show', [['', 'All'], ['problems', `With problems (${problems})`]]));
    const rows = all.filter((r) => (!q || r.from.toLowerCase().includes(q) || r.to.toLowerCase().includes(q)) && (!show || r.flags.length));
    const open = ctx.params().get('item');
    const parts: (HTMLElement | null)[] = [];
    if (!data.canList) parts.push(el('p.ms-adm-warnline', { role: 'note' }, data.message ?? 'The site’s redirects hook cannot list its redirects.'));
    if (data.canList) {
      const table = el('table.ms-adm-table.ms-adm-table--rows', el('thead', el('tr', el('th', 'Old address'), el('th', 'Goes to'), el('th', 'Problems'))));
      const tb = el('tbody');
      for (const r of rows) {
        const name = el('a.ms-adm-rowlink', { href: `#/redirects?item=${encodeURIComponent(r.from)}` }, 'Details');
        name.addEventListener('click', (e) => {
          e.preventDefault();
          ctx.go({ params: { item: r.from, action: null } }, true);
        });
        tb.append(
          el(`tr${r.from === open ? '.is-open' : ''}`,
            el('td', el('div.ms-adm-stack', addr(r.from, 'old address'), name)),
            el('td', addr(r.to, 'new address'), r.status ? el('span.ms-adm-badge', String(r.status)) : null),
            el('td', r.flags.length ? el('div.ms-adm-redirflags', ...r.flags.map((f) => el(`span.ms-adm-badge.ms-adm-badge--${f.kind === 'chain' || f.kind === 'missing' ? 'invited' : 'disabled'}`, { title: f.text }, FLAG_LABEL[f.kind]))) : el('span.ms-adm-none', '—')),
          ),
        );
      }
      table.append(tb);
      parts.push(
        el('p.ms-adm-count', `${rows.length} of ${all.length} redirect${all.length === 1 ? '' : 's'}${problems ? ` · ${problems} with problems` : ''}${data.more ? ' (the first 20,000)' : ''}`),
        rows.length ? el('section.ms-adm-card.ms-adm-card--flush', table) : state('empty', all.length ? 'Nothing matches' : 'No redirects yet', all.length ? 'Try another search, or show all.' : 'Moving a live page leaves one behind; Add a redirect makes one by hand.'),
      );
    }
    layout.replaceChildren(el('div.ms-adm-split__main', ...parts));
    p.body.replaceChildren(layout);

    const action = ctx.params().get('action');
    const item = open ? all.find((r) => r.from === open) : null;
    if (action === 'add') editDrawer(null);
    else if (action === 'test') testDrawer();
    else if (open && item) action === 'edit' ? editDrawer(item) : itemDrawer(item);
    else if (open) drawer(layout, 'Not available', close).body.append(state('denied', 'Not available to you', 'There is no redirect from this address, or it was removed.'));
  }

  const close = () => ctx.go({ params: { item: null, action: null, path: null } }, true);

  /** After a change: say so, link the job, and load the list again. */
  async function changed(text: string, job: string | null, params: Record<string, string | null>): Promise<void> {
    ctx.toast(job ? `${text} The site is being rebuilt.` : text, 'ok', job ? { action: { label: 'Follow it', run: () => ctx.open(`#/jobs/${encodeURIComponent(job)}`) } } : {});
    data = await api.redirects();
    ctx.go({ params }, true);
  }

  function itemDrawer(r: api.Redirect): void {
    const d = drawer(layout, 'Redirect', close);
    const remove = button('Remove', () => void removeOne(r), { kind: 'danger', icon: 'trash' });
    d.body.append(
      facts([
        ['Old address', addr(r.from, 'old address')],
        ['Goes to', addr(r.to, 'new address')],
        ['Kind', r.status === 302 || r.status === 307 ? `Temporary (${r.status})` : r.status ? `Permanent (${r.status})` : 'As the site sets it'],
      ]),
      ...r.flags.map((f) =>
        el('div.ms-adm-warnline.ms-adm-redirflag', { role: 'note' }, el('strong', `${FLAG_LABEL[f.kind]}. `), f.text, f.fix ? el('div.ms-adm-row', button(`Point it at ${f.fix}`, () => void pointAt(r, f.fix!), { small: true, icon: 'check' })) : null),
      ),
      el('div.ms-adm-row',
        button('Test it', () => ctx.go({ params: { action: 'test', path: r.from, item: null } }, true), { icon: 'search' }),
        button('Change', () => ctx.go({ params: { action: 'edit' } }, true), { icon: 'settings' }),
        remove),
    );
  }

  async function pointAt(r: api.Redirect, to: string): Promise<void> {
    try {
      const res = await api.saveRedirect(r.from, to);
      await changed(`${r.from} now goes straight to ${to}.`, res.job, { item: r.from, action: null });
    } catch (e) {
      ctx.toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  async function removeOne(r: api.Redirect): Promise<void> {
    const ok = await ctx.ask(`Remove the redirect from ${r.from}?`, 'Visitors and search engines that still use the old address then get “not found”, unless a page is there.', [['cancel', 'Cancel'], ['go', 'Remove', 'ms-btn ms-btn--danger']]);
    if (ok !== 'go') return;
    try {
      const res = await api.removeRedirects([r.from]);
      await changed(`Removed the redirect from ${r.from}.`, res.job, { item: null, action: null });
    } catch (e) {
      ctx.toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  function editDrawer(r: api.Redirect | null): void {
    const d = drawer(layout, r ? 'Change the redirect' : 'Add a redirect', r ? () => ctx.go({ params: { action: null } }, true) : close);
    const prefill = ctx.params();
    const from = field('from', 'Old address', { required: true, maxlength: 512, hint: 'The path visitors used, starting with /, e.g. /services/old-name/', value: r?.from ?? prefill.get('from') ?? '' });
    const to = field('to', 'Goes to', { required: true, maxlength: 2000, hint: 'A path on this site, or a full https:// address.', value: r?.to ?? prefill.get('to') ?? '' });
    d.body.append(
      el('p.ms-adm-sub', 'Saving a redirect publishes the site: a short build runs and the live site gets it.'),
      form([from, to], r ? 'Save' : 'Add the redirect', async (v) => {
        const res = await api.saveRedirect(v.from, v.to, r && r.from !== v.from ? r.from : undefined);
        const warn = res.redirect.flags.find((f) => f.kind === 'chain' || f.kind === 'missing');
        await changed(`${v.from} now goes to ${v.to}.${warn ? ` Note: ${warn.text}` : ''}`, res.job, { item: v.from, action: null, from: null, to: null });
      }),
    );
    (from.querySelector('input') as HTMLInputElement).focus();
  }

  function hopList(t: api.RedirectTest): HTMLElement {
    const live = t.live;
    if (live.error) return el('p.ms-adm-warnline', { role: 'note' }, live.error);
    const hops = live.hops ?? [];
    return el(
      'div.ms-adm-redirtest',
      el('p', el('strong', VERDICT[live.verdict ?? ''] ?? ''), live.text ? ` ${live.text}` : ''),
      el('ol.ms-adm-hops', ...hops.map((h) => el('li', addr(h.url), h.status !== null ? el(`span.ms-adm-badge${h.status >= 400 ? '.ms-adm-badge--disabled' : h.status === 200 ? '.ms-adm-badge--ok' : ''}`, String(h.status)) : el('span.ms-adm-sub', ' another site, not asked'), h.via === 'page' ? el('span.ms-adm-sub', ' (a page that redirects)') : null))),
    );
  }

  function testDrawer(): void {
    const d = drawer(layout, 'Test an address', close);
    const path = ctx.params().get('path') ?? '';
    const f = field('path', 'Address', { required: true, maxlength: 512, hint: 'A path on the site, starting with /', value: path });
    d.body.append(form([f], 'Test', async (v) => {
      tested = null;
      ctx.go({ params: { path: v.path } }, true);
    }));
    if (!path) return;
    if (tested?.path !== path) {
      d.body.append(state('loading', `Looking in the last build for ${path}…`));
      api.testRedirect(path).then(
        (r) => (tested = { path, result: r }),
        (e) => (tested = { path, result: e instanceof Error ? e : new Error(String(e)) }),
      ).then(() => alive && ctx.params().get('path') === path && render());
      return;
    }
    const t = tested.result;
    if (t instanceof Error) return void d.body.append(failure(t));
    d.body.append(
      el('h3.ms-adm-h3', 'In the last build'),
      el('p', !t.build ? 'There is no build to look at yet: publish once and this fills in.' : t.build.kind === 'redirect' ? el('span', 'A redirect to ', t.build.to ? addr(t.build.to) : '(unknown)') : t.build.kind === 'page' ? 'A page.' : 'Nothing: the host answers this address on its own.'),
      el('h3.ms-adm-h3', 'Hop by hop, in that build'),
      el('p.ms-adm-sub', 'What a visitor would get from the last build or release. The live site itself is not asked from here.'),
      hopList(t),
    );
  }

  void load();
  return {
    update: () => render(),
    destroy: () => {
      alive = false;
    },
  };
}
