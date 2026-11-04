// "Edit this page" on the live site (docs/API-EDIT.md). The link on a page opens #/edit?to=<its path>:
// this finds the entry at that address (GET site/entry-at) and opens it, or says plainly why not. #/edit on its own
// is the edit button's page: whether it is on in this browser (the cookie GET site/edit-button sets), why not, and
// the bookmarklet that does the same from any site. refreshEditButton() sets the cookie when the editor starts.
import { ApiError, request } from '../api';
import { el, failure, link, message, page, state, value } from '../admin/ui';
import { registerScreen, type ScreenCtx } from '../host';
import { config } from '../runtime';

interface EditButton {
  on: boolean;
  reason?: 'off' | 'other-cms' | 'other-domain';
  message?: string;
  domain?: string | null;
  bookmarklet: string;
}
interface EntryAt {
  collection: string;
  id: string;
  title: string;
  url: string;
  locale: string | null;
  can: { edit: boolean };
}

/** Sets or refreshes the cookie the site's edit link looks for (signed in; nothing in astro dev). */
export const refreshEditButton = () => request<EditButton>('site/edit-button').catch(() => null);

function openEntry(host: HTMLElement, ctx: ScreenCtx, to: string) {
  const p = page(host, 'Edit this page', '', { narrow: true });
  ctx.setTitle('Edit this page');
  p.body.replaceChildren(state('loading', 'Finding the page…'));
  request<EntryAt>(`site/entry-at?path=${encodeURIComponent(to)}`)
    .then((e) => {
      if (!e.can.edit) return void p.body.replaceChildren(state('denied', 'Not available to you', `Your role cannot change “${e.title}”. Ask an editor if it needs a change.`));
      // the entry, in the locale whose address was opened; replaces #/edit so Back goes to the site
      ctx.open(`#/e/${encodeURIComponent(e.collection)}/${encodeURIComponent(e.id)}${e.locale ? `?region=${encodeURIComponent(e.locale)}` : ''}`, false);
    })
    .catch((err) => {
      if (err instanceof ApiError && err.status === 404 && err.code === 'not-found' && /No entry/.test(err.message)) {
        return void p.body.replaceChildren(state('empty', 'No entry has this address', 'The page may be made by the site’s code rather than from an entry, or it moved.', link(to, 'the page address')));
      }
      if (err instanceof ApiError && err.status === 404) return void p.body.replaceChildren(state('empty', 'This needs the Markstage server', 'Opening a page from the site works when the editor runs on the Markstage server.'));
      p.body.replaceChildren(failure(err, () => openEntry(host, ctx, to)));
    });
}

function about(host: HTMLElement, ctx: ScreenCtx) {
  const p = page(host, 'Edit button', 'An “Edit this page” link on your site, shown only in a browser where you are signed in here. Visitors never see it.', { narrow: true });
  ctx.setTitle('Edit button');
  p.body.replaceChildren(state('loading', 'Checking…'));
  request<EditButton>('site/edit-button')
    .then((b) => {
      const site = config().siteUrl;
      const status = b.on
        ? el('section.ms-adm-card', el('h2.ms-adm-h2', 'On in this browser'), el('p', 'Open any page of your site: the link is in its corner. It goes when you sign out here.'), site ? link(site, 'your site') : null)
        : el('section.ms-adm-card', el('h2.ms-adm-h2', b.reason === 'off' ? 'Not set up on this site' : 'Not in this browser'), el('p', b.message ?? ''));
      // the bookmarklet: a link to drag to the bookmarks bar; clicked here it would only run in the editor
      const mark = el('a.ms-btn.ms-editlink__mark', { href: b.bookmarklet, draggable: 'true' }, 'Edit this page');
      mark.addEventListener('click', (ev) => {
        ev.preventDefault();
        ctx.toast('Drag it to your bookmarks bar, then click it on any page of your site.');
      });
      const bookmark = el(
        'section.ms-adm-card',
        el('h2.ms-adm-h2', 'Or use a bookmark'),
        el('p', 'Drag this to your bookmarks bar. On any page of your site, click it to open that page here. It works wherever the editor runs.'),
        el('p', mark),
        value(b.bookmarklet, 'the bookmark’s address'),
      );
      p.body.replaceChildren(status, bookmark);
    })
    .catch((err) => {
      if (err instanceof ApiError && err.status === 404) return void p.body.replaceChildren(state('empty', 'This needs the Markstage server', 'The edit button is set when you sign in to the Markstage server.'));
      p.body.replaceChildren(state('error', 'Something went wrong', message(err)));
    });
}

registerScreen({
  name: 'edit',
  label: 'Edit button',
  icon: 'link',
  nav: null,
  mount(host, ctx) {
    const to = ctx.params().get('to');
    if (to) openEntry(host, ctx, to);
    else about(host, ctx);
    return {
      update(next) {
        const t = next.params().get('to');
        if (t) openEntry(host, next, t);
        else about(host, next);
      },
      destroy() {},
    };
  },
});
