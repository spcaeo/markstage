// Authors (docs/API-AUTHORS.md), Ghost style: the people the site's posts are by, each a profile kept as a file in
// the site's content. Every state is in the URL:
//   #/authors?q=&show=archived&action=new            the list (search, the archived ones), the "New author" form
//   #/authors/<slug>                                 one author on the right: profile, links, posts
//   #/authors/<slug>?action=edit&library=1           editing it (library=1: the photo's media library chooser is open)
//   #/authors/<slug>?action=rename&to=<slug>         a new slug; their posts move with it, in one change
//   #/authors/<slug>?action=delete&to=<slug>         delete; their posts are given to another author first
// Editors and above add, archive, rename and delete; anyone may change their own profile (the server decides).
import { rebuildSite } from '../api';
import { authorsChanged, getAuthor, listAuthors, pageUrl, updateAuthor, type Author } from '../../authors';
import type { ScreenCtx } from '../../host';
import { config } from '../../runtime';
import '../../styles/authors.css';
import { button, chips, drawer, el, facts, failure, link, maybe, message, page, searchBox, state, value } from '../ui';
import { authorForm } from './form';
import { avatar, postRow } from './parts';
import { deletePanel, renamePanel } from './remove';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** the params a step keeps to itself: changing only these does not draw the screen again (typing, the chooser) */
const QUIET = ['to', 'library'];

// the list as last fetched, and the note to show once the next mount is up (see leave)
let kept: { items: Author[]; manage: boolean } | null = null;
let carry: (() => void) | null = null;

export function mountAuthors(host: HTMLElement, ctx: ScreenCtx) {
  const p = page(host, 'Authors', 'The people your posts are by. Each has a profile and an author page on the site.');
  const layout = el('div.ms-adm-split');
  let items: Author[] | null = kept?.items ?? null;
  let manage = kept?.manage ?? false;
  let alive = true;
  let drawn = '';
  // the open step's own reaction to a QUIET param (the form's chooser, a panel's `to`)
  let quiet: ((params: URLSearchParams) => void) | null = null;

  const key = () => {
    const params = new URLSearchParams(ctx.params());
    for (const k of QUIET) params.delete(k);
    return `${ctx.args.join('/')}?${params}`;
  };

  /** The list, fresh from the server; true when it differs from the one drawn. */
  async function fetchList(): Promise<boolean> {
    const r = await listAuthors();
    const differs = !items || manage !== r.can.manage || JSON.stringify(items) !== JSON.stringify(r.items);
    items = r.items;
    manage = r.can.manage;
    kept = { items, manage };
    return differs;
  }

  // the last list is drawn at once (another author opened is another mount), then checked against the server
  async function load(): Promise<void> {
    if (!config().authors) return void p.body.replaceChildren(state('empty', 'This site keeps no author files', 'A developer turns them on in the site config (authors). Until then the author of a post is plain text.'));
    if (items) render();
    else p.body.replaceChildren(state('loading', 'Loading authors…'));
    try {
      if ((await fetchList()) && alive) render();
    } catch (e) {
      if (alive && !kept) p.body.replaceChildren(failure(e, () => void load()));
    }
  }

  /** After a change: every author picker on the page fetches again, and so does the list (drawn by the next step). */
  const changed = async () => {
    authorsChanged();
    await fetchList();
  };

  /** Another author or the list is another mount, which clears the notes: the note is shown by that mount. */
  const leave = (change: { args: string[]; params: Record<string, string | null> }, note: () => void) => {
    carry = note;
    ctx.go(change, false);
  };

  /** The site shows a profile on its author page and next to posts: a change is live after the next publish. */
  function saved(text: string, a: Author): void {
    if (!a.live) return void ctx.toast(text, 'ok');
    ctx.toast(`${text} The site shows it after the next publish.`, 'ok', {
      action: {
        label: 'Publish now',
        run: () =>
          void rebuildSite().then(
            () => ctx.toast('Publishing the site. Publishing shows how it goes.', 'ok'),
            (e) => ctx.toast(message(e), 'error'),
          ),
      },
    });
  }

  function render(): void {
    if (!items) return;
    drawn = key();
    quiet = null;
    const params = ctx.params();
    const q = (params.get('q') ?? '').toLowerCase();
    const archived = params.get('show') === 'archived';
    p.actions.replaceChildren(manage ? button('New author', () => ctx.go({ args: [], params: { action: 'new', to: null, library: null } }, true), { kind: 'primary', icon: 'plus' }) : el('span'));
    p.bar.hidden = false;
    p.bar.replaceChildren(searchBox(ctx, 'q', 'Search by name, role or slug'), chips(ctx, 'show', 'Show', [['', 'Active'], ['archived', `Archived (${items.filter((a) => a.archived).length})`]]));
    const rows = items.filter((a) => a.archived === archived && (!q || `${a.name} ${a.role} ${a.slug}`.toLowerCase().includes(q)));
    const open = ctx.args[0] ?? null;
    const t = el('table.ms-adm-table.ms-adm-table--rows', el('thead', el('tr', el('th', 'Author'), el('th', 'Slug'), el('th.ms-num', 'Posts'), el('th.ms-num', 'Live'), el('th', 'Author page'))));
    t.append(
      el(
        'tbody',
        ...rows.map((a) => {
          const name = el('a.ms-adm-rowlink', { href: `#/authors/${encodeURIComponent(a.slug)}` }, a.name);
          name.addEventListener('click', (e) => {
            e.preventDefault();
            ctx.go({ args: [a.slug], params: { action: null, to: null, library: null } }, true);
          });
          return el(
            `tr${a.slug === open ? '.is-open' : ''}`,
            el('td', el('div.ms-adm-authorcell', avatar(a, 32), el('div.ms-adm-stack', name, a.role ? el('span.ms-adm-sub', a.role) : null))),
            el('td', value(a.slug, 'author slug', 'ms-adm-mono')),
            el('td.ms-num', String(a.posts)),
            el('td.ms-num', String(a.live)),
            el('td', a.url ? link(pageUrl(a.url), 'author page URL', 'ms-adm-sub') : el('span.ms-adm-none', '—')),
          );
        }),
      ),
    );
    const empty = q
      ? state('empty', 'Nobody matches', 'Try another search.')
      : archived
        ? state('empty', 'No archived authors', 'Archive an author to keep their posts while hiding them from the author pickers.')
        : state('empty', 'No authors yet', 'Add the people your posts are by.');
    layout.replaceChildren(
      el(
        'div.ms-adm-split__main',
        el('p.ms-adm-count', `${plural(rows.length, archived ? 'archived author' : 'author', archived ? 'archived authors' : 'authors')}${q ? ` matching “${q}”` : ''}`),
        rows.length ? el('section.ms-adm-card.ms-adm-card--flush', t) : empty,
      ),
    );
    p.body.replaceChildren(layout);
    if (open) void authorDrawer(open);
    else if (params.get('action') === 'new') newDrawer();
  }

  const close = () => ctx.go({ args: [], params: { action: null, to: null, library: null } }, true);

  function newDrawer(): void {
    const d = drawer(layout, 'New author', close);
    if (!manage) return void d.body.append(state('denied', 'Not available to you', 'Only editors and above add authors.'));
    const f = authorForm(
      ctx,
      null,
      async (a) => {
        await changed();
        leave({ args: [a.slug], params: { action: null, library: null } }, () => ctx.toast(`Added ${a.name}. Pick them as the author in a post’s settings.`, 'ok'));
      },
      close,
    );
    quiet = (params) => f.library(params.get('library') === '1');
    d.body.append(f.el);
    f.el.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
  }

  async function authorDrawer(slug: string): Promise<void> {
    const d = drawer(layout, items?.find((a) => a.slug === slug)?.name ?? slug, close);
    d.body.append(state('loading', 'Loading…'));
    const at = drawn;
    let r: Awaited<ReturnType<typeof getAuthor>>;
    try {
      r = await getAuthor(slug);
    } catch (e) {
      if (alive && at === drawn) d.body.replaceChildren(failure(e));
      return;
    }
    if (!alive || at !== drawn) return;
    const { author: a, posts, can } = r;
    const action = ctx.params().get('action');
    ctx.setTitle(`${a.name} · Authors`);
    const go = (params: Record<string, string | null>) => ctx.go({ params: { action: null, to: null, library: null, ...params } }, true);
    const back = () => go({});
    if (action === 'edit' && can.edit) {
      const f = authorForm(
        ctx,
        a,
        async (s) => {
          await changed();
          ctx.go({ params: { action: null, library: null } }, false);
          saved(`Saved ${s.name}.`, s);
        },
        back,
      );
      quiet = (params) => f.library(params.get('library') === '1');
      return void d.body.replaceChildren(f.el);
    }
    if ((action === 'delete' || action === 'rename') && can.manage) {
      const panel = action === 'delete' ? deletePanel(ctx, a, posts, items ?? [], { changed, back, leave }) : renamePanel(ctx, a, posts, { changed, back, leave });
      quiet = (params) => panel.sync(params.get('to') ?? '');
      return void d.body.replaceChildren(el('h3.ms-adm-h3', action === 'delete' ? `Delete ${a.name}` : `Change ${a.name}’s slug`), panel.el);
    }
    if (action && action !== 'edit' && action !== 'delete' && action !== 'rename') return void d.body.replaceChildren(state('empty', 'Nothing to do here', `“${action}” is not a step of this screen.`));
    if (action) return void d.body.replaceChildren(state('denied', 'Not available to you', can.edit ? 'Only editors and above do this.' : 'You can change your own author profile only.'));
    d.body.replaceChildren(
      el('div.ms-adm-authorhead', avatar(a, 64), el('div.ms-adm-stack', el('strong', a.name), a.role ? el('span.ms-adm-sub', a.role) : null, a.archived ? el('span.ms-adm-badge.ms-adm-badge--disabled', 'Archived') : null)),
      facts([
        ['Slug', value(a.slug, 'author slug', 'ms-adm-mono')],
        ['Author page', a.url ? link(pageUrl(a.url), 'author page URL') : el('span.ms-adm-none', 'The site has no author pages')],
        ...(a.email !== undefined ? [['Email (private)', maybe(a.email, 'email')] as [string, Node]] : []),
        ['Website', a.website ? link(a.website, 'website') : el('span.ms-adm-none', '—')],
        ['Profile links', a.social.length ? el('ul.ms-adm-list', ...a.social.map((s) => el('li', link(s, 'profile link')))) : el('span.ms-adm-none', '—')],
        ['Search title', maybe(a.seoTitle, 'search title')],
        ['Search description', maybe(a.seoDescription, 'search description')],
      ]),
      a.bio ? el('div.ms-adm-authorbio', el('h3.ms-adm-h3', 'Bio'), value(a.bio, 'bio', 'ms-adm-authorbio__text')) : '',
      el(
        'div.ms-adm-actions',
        can.edit ? button('Edit profile', () => go({ action: 'edit' }), { kind: 'primary' }) : null,
        can.manage ? button(a.archived ? 'Bring back' : 'Archive', () => void archive(a), { title: a.archived ? 'Show them in the author pickers again' : 'Keep their posts; hide them from the author pickers' }) : null,
        can.manage ? button('Change slug…', () => go({ action: 'rename' })) : null,
        can.manage ? button('Delete…', () => go({ action: 'delete' }), { kind: 'danger', icon: 'trash' }) : null,
      ),
      el('h3.ms-adm-h3', `Posts (${posts.length})`),
      posts.length ? el('ul.ms-adm-authorposts', ...posts.map(postRow)) : el('p.ms-adm-sub', 'No post names them yet.'),
    );
  }

  async function archive(a: Author): Promise<void> {
    try {
      const r = await updateAuthor(a.slug, a.version, { archived: !a.archived });
      await changed();
      render();
      if (r.author.archived) saved(`Archived ${a.name}. Their posts keep them as author; new posts can’t pick them.`, r.author);
      else saved(`${a.name} is back in the author pickers.`, r.author);
    } catch (e) {
      ctx.toast(message(e), 'error');
    }
  }

  ctx.setTitle('Authors');
  const note = carry;
  carry = null;
  note?.();
  void load();
  return {
    update: () => {
      // a step's own params (typing a slug, the photo chooser) are told to it; anything else draws the screen again
      if (key() === drawn && quiet) return quiet(ctx.params());
      render();
    },
    destroy: () => {
      alive = false;
    },
  };
}
