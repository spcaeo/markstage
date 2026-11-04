// The signed-in chrome around the canvas (docs/EDITOR-UX.md section 2): the drawer and the top bar's menu button,
// Help and account avatar, the place chip, and the unread-messages count the drawer and Home share. Also the dev
// server's reload guard, which keeps a tab with unsaved text from reloading on its own save.
import { request } from './api';
import { mountEnvBadge } from './environments/badge';
import { screen as screenDef } from './host';
import { accountMenu, Drawer, type Me } from './nav';
import type { MenuCollection } from './shell-words';

export interface SignedInOpts {
  collections: MenuCollection[];
  newHref: string | null;
  /** signed in with the Markstage server (not astro dev's stand-in) */
  server: boolean;
  help: { isOpen: boolean; open(): void; close(): void };
  onRoute(cb: (r: import('./router').Route) => void): void;
  afterRoute?: () => void;
}

/** Mounts the drawer, the menu, Help and account buttons and the place chip for `me`; returns the drawer. */
export function mountSignedIn(app: HTMLElement, $: <T extends HTMLElement = HTMLElement>(s: string) => T, me: NonNullable<Me['user']>, o: SignedInOpts): Drawer {
  const drawer = new Drawer(app, me, { collections: o.collections, newHref: o.newHref });
  const menuBtn = $<HTMLButtonElement>('[data-menu]');
  menuBtn.hidden = false;
  menuBtn.addEventListener('click', () => drawer.toggle());
  const helpBtn = $<HTMLButtonElement>('[data-help]');
  helpBtn.hidden = false;
  helpBtn.addEventListener('click', () => (o.help.isOpen ? o.help.close() : o.help.open()));
  accountMenu(
    $<HTMLButtonElement>('[data-me]'),
    me,
    o.server
      ? async () => {
          await request('auth/logout', { method: 'POST' }).catch(() => {});
          history.replaceState(null, '', '#/sign-in');
          location.reload();
        }
      : null,
  );
  void mountEnvBadge($('.ms-head__place'));
  o.onRoute((r) => (drawer.update(r), o.afterRoute?.()));
  return drawer;
}

let unreadOnce: Promise<number | null> | null = null;
/** The unread messages (one request, shared by the drawer and Home); null when there is no inbox to ask. */
export function unreadCount(me: Me | null, server: boolean): Promise<number | null> {
  const inbox = screenDef('inbox');
  if (!server || !inbox || (inbox.roles && !inbox.roles.includes(me?.user?.role ?? ''))) return Promise.resolve(null);
  // visitor messages only: the person's own alerts are in the inbox too, and are not messages (QA F27)
  return (unreadOnce ??= request<{ total: number }>('inbox?status=new&kind=message').then((r) => r.total).catch(() => null));
}

/**
 * A save writes a content file and the dev server then reloads every page. This tab skips that reload while `busy`
 * (just saved, saving, or unsaved text: Vite only reloads for an .html path when it is this page's, so the path is
 * pointed elsewhere); a clean tab reloads as usual and so picks up code edits and other tabs' saves.
 */
export function skipHotReload(busy: () => boolean): void {
  const hot = (import.meta as { hot?: { on: (ev: string, cb: (p: { path?: string }) => void) => void } }).hot;
  hot?.on('vite:beforeFullReload', (payload) => {
    // a busy watcher (a build writing dist/) was measured delivering a save's reload 12 s late
    if (busy()) payload.path = '/markstage-reload-skipped.html';
  });
}
