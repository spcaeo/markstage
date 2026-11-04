// Trash (docs/OPERATIONS.md "Delete and undo a delete"):
//   #/trash?collection=&q=&item=<trashId>   what was deleted, newest first, with the address it had: restore it (it
//                         comes back as a draft) or, for administrators, delete it for good. "Delete for good" opens
//                         the entry in the drawer (item=) with the pages that still link to its old address first.
//                         Authors see their own; editors and above see all.
import type { ScreenCtx } from '../host';
import { config } from '../runtime';
import * as api from './api';
import { button, canManageUsers, chips, drawer, el, facts, failure, link, message, page, searchBox, state, value, when, whoami } from './ui';

/** More than this many rows: a search box (about one screen of rows). */
const SEARCH_FROM = 10;

export function mountTrash(host: HTMLElement, ctx: ScreenCtx) {
  const p = page(host, 'Trash', 'Deleted entries. Restoring one brings it back as a draft; the site changes only when it is published again.');
  p.bar.hidden = false;
  const layout = el('div.ms-adm-split');
  let items: api.TrashItem[] = [];
  let people = new Map<string, string>();
  let admin = false;
  let alive = true;
  let linking: { trashId: string; entries: api.LinkingEntry[] | null; error?: string } | null = null;

  let closed = false;

  async function load(): Promise<void> {
    p.body.replaceChildren(state('loading', 'Loading…'));
    try {
      const me = await whoami();
      // astro dev has no delete, so no trash (the Markstage server keeps it)
      closed = Boolean(me.devMode);
      if (me.devMode) return void p.body.replaceChildren(state('empty', 'No trash in development', 'Entries are not deleted from the editor in astro dev, so nothing waits here. The trash is kept by the Markstage server.'));
      admin = canManageUsers(me);
      if (!people.size) people = new Map((await api.usersBrief().catch(() => [])).map((u) => [u.id, u.name]));
      items = await api.trash();
    } catch (e) {
      p.body.replaceChildren(failure(e, () => void load()));
      return;
    }
    if (alive) render();
  }

  function render(): void {
    // no trash in astro dev: its message stays, whatever the address says
    if (closed) return;
    const only = ctx.params().get('collection') ?? '';
    const q = (ctx.params().get('q') ?? '').toLowerCase();
    const names = new Map(config().collections.map((c) => [c.id, c.label]));
    const present = [...new Set(items.map((i) => i.collection))];
    p.bar.replaceChildren(
      items.length > SEARCH_FROM || q ? searchBox(ctx, 'q', 'Search by title or address') : el('span'),
      present.length > 1 ? chips(ctx, 'collection', 'Collection', [['', 'All'], ...present.map((c) => [c, names.get(c) ?? c] as [string, string])]) : el('span'),
    );
    if (!items.length) return void p.body.replaceChildren(state('empty', 'The trash is empty', 'When an entry is deleted it waits here, and can be brought back as a draft.'));
    const rows = items.filter((i) => (!only || i.collection === only) && (!q || `${i.title} ${i.id} ${i.url ?? ''}`.toLowerCase().includes(q)));
    const open = ctx.params().get('item');
    const t = el('table.ms-adm-table.ms-adm-table--rows', el('thead', el('tr', el('th', 'Entry'), el('th', 'Collection'), el('th', 'Deleted'), el('th', 'By'), el('th', ''))));
    const tb = el('tbody');
    for (const i of rows) {
      tb.append(
        el(`tr${i.trashId === open ? '.is-open' : ''}`,
          el('td', el('div.ms-adm-stack', value(i.title || i.id, 'title', 'ms-adm-strong'), i.url ? link(i.url, 'old address', 'ms-adm-sub') : null)),
          el('td', names.get(i.collection) ?? i.collection),
          el('td', when(i.deletedAt)),
          el('td', i.deletedBy ? people.get(i.deletedBy) ?? 'a removed user' : '—'),
          el('td', el('div.ms-adm-row',
            button('Restore', () => void restore(i), { small: true, icon: 'undo' }),
            admin ? button('Delete for good…', () => ctx.go({ params: { item: i.trashId } }, true), { small: true, kind: 'danger', icon: 'trash' }) : null,
          )),
        ),
      );
    }
    t.append(tb);
    layout.replaceChildren(el('div.ms-adm-split__main', rows.length ? el('section.ms-adm-card.ms-adm-card--flush', t) : state('empty', 'Nothing matches', 'Try another search or collection.')));
    p.body.replaceChildren(layout);
    if (open) purgeDrawer(items.find((i) => i.trashId === open) ?? null);
  }

  const close = () => ctx.go({ params: { item: null } }, true);

  /** "Delete for good": the entry, then what still links to its old address, then the button. */
  function purgeDrawer(i: api.TrashItem | null): void {
    const d = drawer(layout, 'Delete for good', close);
    if (!i || !admin) return void d.body.append(state('denied', 'Not available to you', 'This entry is not in the trash, or your role cannot delete it for good.'));
    d.body.append(facts([['Entry', value(i.title || i.id, 'title')], ['Old address', i.url ? link(i.url, 'old address') : el('span.ms-adm-none', 'None')], ['Deleted', when(i.deletedAt)]]));
    if (linking?.trashId !== i.trashId) {
      linking = { trashId: i.trashId, entries: null };
      d.body.append(state('loading', 'Looking for pages that still link to it…'));
      api.trashLinksIn(i.trashId).then(
        (r) => (linking = { trashId: i.trashId, entries: r.entries }),
        (e) => (linking = { trashId: i.trashId, entries: [], error: message(e) }),
      ).then(() => alive && ctx.params().get('item') === i.trashId && render());
      return;
    }
    const list = linking.entries ?? [];
    d.body.append(
      linking.error
        ? el('p.ms-adm-warnline', { role: 'note' }, `Could not check what links to it: ${linking.error}`)
        : list.length
          ? el('div.ms-adm-warnline', { role: 'note' },
              el('strong', `${list.length} ${list.length === 1 ? 'page still links' : 'pages still link'} to it. `),
              'Those links will lead nowhere. Fix them first, or restore the entry.',
              el('ul.ms-adm-issues', ...list.map((x) => el('li', el('a', { href: `#/e/${encodeURIComponent(x.collection)}/${encodeURIComponent(x.id)}` }, x.title), x.url ? el('span.ms-adm-sub', ' · ', link(x.url, 'address')) : null, x.status !== 'published' ? el('span.ms-adm-badge', 'not live') : null))))
          : el('p', 'No page links to it.'),
      el('p.ms-adm-sub', 'It can no longer be restored from here. Its text stays in the site’s history (git), where a developer can still find it.'),
      el('div.ms-adm-row', button('Delete for good', () => void purge(i), { kind: 'danger', icon: 'trash' }), button('Cancel', close, { kind: 'quiet' })),
    );
  }

  async function restore(i: api.TrashItem): Promise<void> {
    try {
      await api.restoreTrash(i.trashId);
      ctx.toast(`Restored “${i.title || i.id}” as a draft.`, 'ok');
      ctx.open(`#/e/${encodeURIComponent(i.collection)}/${encodeURIComponent(i.id)}`);
    } catch (e) {
      ctx.toast(message(e), 'error');
    }
  }

  async function purge(i: api.TrashItem): Promise<void> {
    try {
      await api.purgeTrash(i.trashId);
      items = items.filter((x) => x.trashId !== i.trashId);
      ctx.toast(`“${i.title || i.id}” is deleted for good.`, 'ok');
      close();
    } catch (e) {
      ctx.toast(message(e), 'error');
    }
  }

  void load();
  return {
    update: () => render(),
    destroy: () => {
      alive = false;
    },
  };
}
