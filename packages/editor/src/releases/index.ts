// Releases (docs/API-RELEASES.md): #/releases, the list (list.ts); #/releases/<id>, one release with its items,
// preview, schedule, go-live and share links (release.ts); #/releases/add?c=&id= or ?lib=, putting a page or a Library
// change into one (add.ts). #/share/<collection>/<id> is a draft's share links (links.ts). A screen is shown over the
// open entry and leaves it as it was, which is how a page's unsaved changes can go into a release.
import { registerScreen, type ScreenCtx } from '../host';
import { getEntry } from '../api';
import { el, failure, page, state } from '../admin/ui';
import '../styles/releases.css';
import { mountAdd } from './add';
import { linksCard } from './links';
import { mountList } from './list';
import { mountRelease } from './release';

registerScreen({
  name: 'releases',
  label: 'Go live',
  icon: 'send',
  nav: 'main',
  group: 'publishing',
  menuLabel: 'Go live',
  mount(host, ctx) {
    if (ctx.args[0] === 'add') return mountAdd(host, ctx);
    if (ctx.args[0]) return mountRelease(host, ctx, ctx.args[0]);
    return mountList(host, ctx);
  },
});

registerScreen({
  name: 'share',
  label: 'Share links',
  icon: 'link',
  nav: null,
  mount(host, ctx) {
    return mountDraftLinks(host, ctx, ctx.args[0] ?? '', ctx.args[1] ?? '');
  },
});

/** One draft's share links: the draft as it would go live, for people with no account. */
function mountDraftLinks(host: HTMLElement, ctx: ScreenCtx, c: string, id: string) {
  let alive = true;
  let entry: Awaited<ReturnType<typeof getEntry>> | null = null;

  function draw(): void {
    const e = entry!;
    const title = e.title || id;
    ctx.setTitle(`Share links · ${title}`);
    const p = page(host, 'Share links', `For “${title}”: the draft as it would go live, for people with no account.`, { narrow: true });
    const open = el('a.ms-btn.ms-btn--quiet.ms-btn--small', { href: `#/${e.format === 'json' ? 'p' : 'e'}/${encodeURIComponent(c)}/${encodeURIComponent(id)}` }, 'Back to the page');
    p.actions.replaceChildren(open);
    const whyNot = e.status === 'published' ? 'This page is live: share its address on the site instead.' : !e.url ? 'This entry has no page of its own to show.' : e.can && !e.can.edit ? 'You can only share entries you can edit.' : undefined;
    const layout = el('div.ms-adm-split');
    const main = el('div.ms-adm-split__main');
    layout.append(main);
    p.body.replaceChildren(layout);
    main.append(linksCard(layout, { ctx, target: { collection: c, id }, what: 'this draft', canMake: !whyNot, whyNot }));
  }

  async function load(): Promise<void> {
    try {
      entry = await getEntry(c, id);
      if (alive) draw();
    } catch (e) {
      if (!alive) return;
      const p = page(host, 'Share links', '');
      const status = (e as { status?: number }).status;
      p.body.replaceChildren(status === 404 || status === 403 ? state('denied', 'Not available to you', 'This page does not exist, or you cannot open it.') : failure(e, () => void load()));
    }
  }

  page(host, 'Share links', '').body.replaceChildren(state('loading', 'Loading…'));
  void load();
  return {
    update(next: ScreenCtx) {
      ctx = next;
      if (entry) draw();
    },
    destroy() {
      alive = false;
    },
  };
}
