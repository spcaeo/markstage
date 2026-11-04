// The drawer (docs/EDITOR-UX.md section 2): Create, Home, then the places a signed-in person goes, grouped and named
// by the word list (shell-words.ts, from the registered screens), the release line at its foot. The top bar's menu
// button folds it to an icon rail (labels as tooltips); under 720px it slides over the page with a scrim. The
// folded state and the folded groups are remembered in this browser; under 1100px it starts folded unless it was
// opened in this session (drawerFolded). The person's own menu (account, sign out)
// hangs off the top bar's avatar (accountMenu). Shown whenever someone is signed in, in `astro dev` too.
import { request } from './api';
import { screen as screenDef, screens, type ScreenDef } from './host';
import { ic } from './icons';
import { releaseFooter } from './release';
import type { Route } from './router';
import { Menu } from './shell';
import { drawerFolded, drawerPlan, GROUPS, type MenuCollection, type MenuItem } from './shell-words';
import { themeRow } from './theme';

export interface Me {
  user: { id: string; name: string; email: string; role: string } | null;
  devMode?: boolean;
}

/** The signed-in person (in `astro dev` a stand-in with devMode), or null when nobody is signed in. */
export async function whoAmI(): Promise<Me | null> {
  try {
    return await request<Me>('auth/me');
  } catch {
    return null;
  }
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

const KEY = 'markstage.drawer';
const PHONE = '(max-width: 720px)';
/** a window where the open drawer would crowd the page: it starts folded there */
const NARROW = '(max-width: 1099px)';

/** What the person chose this session (the menu button), or null. */
function session(): boolean | null {
  try {
    const v = sessionStorage.getItem(KEY);
    return v === null ? null : v === 'folded';
  } catch {
    return null;
  }
}

interface Kept {
  folded?: boolean;
  groups?: Record<string, boolean>;
}

function kept(): Kept {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function keep(change: Kept): void {
  try {
    const now = kept();
    localStorage.setItem(KEY, JSON.stringify({ ...now, ...change, groups: { ...now.groups, ...change.groups } }));
  } catch {
    // private window or blocked storage: the drawer just opens as new
  }
}

export class Drawer {
  readonly el = document.createElement('nav');
  private scrim = document.createElement('div');
  private links: { a: HTMLAnchorElement; screen: string | null; href: string }[] = [];
  private counts = new Map<string, HTMLElement>();
  private tools: MenuItem[];

  constructor(
    private app: HTMLElement,
    me: NonNullable<Me['user']>,
    o: { collections: MenuCollection[]; newHref: string | null },
  ) {
    const plan = drawerPlan(screens() as ScreenDef[], o.collections, me.role);
    this.tools = plan.tools;
    this.el.className = 'ms-nav';
    this.el.setAttribute('aria-label', 'Main menu');
    const create = document.createElement('a');
    create.className = 'ms-nav__create';
    create.innerHTML = `${ic('plus', 20)}<span>Create</span>`;
    create.title = 'Start a new draft';
    if (o.newHref) create.href = o.newHref;
    else create.hidden = true;
    const list = document.createElement('div');
    list.className = 'ms-nav__list';
    list.append(this.link({ href: '#/', label: 'Home', icon: 'home', screen: null }));
    const was = kept();
    for (const g of plan.groups) {
      if (!g.items.length) continue;
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'ms-nav__group';
      head.innerHTML = `<span></span>${ic('down', 16)}`;
      head.querySelector('span')!.textContent = g.label;
      const items = document.createElement('div');
      items.className = 'ms-nav__items';
      items.setAttribute('role', 'group');
      items.setAttribute('aria-label', g.label);
      const open = was.groups?.[g.id] ?? !g.folded;
      // a class, not `hidden`: the icon rail shows every group's items whatever the group's state
      const set = (on: boolean) => {
        head.setAttribute('aria-expanded', String(on));
        items.classList.toggle('is-folded', !on);
      };
      set(open);
      head.addEventListener('click', () => {
        const on = head.getAttribute('aria-expanded') !== 'true';
        set(on);
        keep({ groups: { [g.id]: on } });
      });
      for (const it of g.items) items.append(this.link(it));
      if (g.id === 'site' && this.tools.length) items.append(this.moreTools());
      list.append(head, items);
    }
    if (!plan.groups.some((g) => g.id === 'site' && g.items.length) && this.tools.length) list.append(this.moreTools());
    const foot = releaseFooter();
    foot.classList.add('ms-nav__foot');
    this.el.append(create, list, foot);
    this.scrim.className = 'ms-nav__scrim';
    this.scrim.addEventListener('click', () => this.setOpen(false));
    app.prepend(this.el, this.scrim);
    // the skip link stays the first thing a keyboard reaches (shell.ts, QA pass 2, N6)
    const skip = app.querySelector('.ms-skip');
    if (skip) app.prepend(skip);
    app.classList.add('has-nav');
    const narrow = matchMedia(NARROW);
    const apply = () => app.classList.toggle('nav-folded', drawerFolded(narrow.matches, session(), was.folded ?? kept().folded ?? null));
    apply();
    // the window grows or shrinks past 1100px: the drawer follows, unless the person chose this session
    narrow.addEventListener('change', apply);
    // on a phone the drawer closes once a place is chosen
    this.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('a[href]') && matchMedia(PHONE).matches) this.setOpen(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.app.classList.contains('nav-open')) this.setOpen(false);
    });
  }

  /** The menu button: on a phone slides the drawer in or out; otherwise folds it to icons or opens it again. */
  toggle(): void {
    if (matchMedia(PHONE).matches) return this.setOpen(!this.app.classList.contains('nav-open'));
    const folded = this.app.classList.toggle('nav-folded');
    keep({ folded });
    try {
      sessionStorage.setItem(KEY, folded ? 'folded' : 'open');
    } catch {
      // no session storage: the next load decides by the window again
    }
  }

  get folded(): boolean {
    return this.app.classList.contains('nav-folded');
  }

  private setOpen(on: boolean): void {
    this.app.classList.toggle('nav-open', on);
  }

  private link(it: MenuItem): HTMLAnchorElement {
    const a = document.createElement('a');
    a.className = 'ms-nav__item';
    a.href = it.href;
    a.innerHTML = `${ic(it.icon, 20)}<span class="ms-nav__label"></span>`;
    a.querySelector('.ms-nav__label')!.textContent = it.label;
    a.title = it.label;
    a.setAttribute('aria-label', it.label);
    if (it.count) {
      const n = document.createElement('span');
      n.className = 'ms-nav__count';
      n.hidden = true;
      a.append(n);
      this.counts.set(it.count, n);
    }
    this.links.push({ a, screen: it.screen, href: it.href });
    return a;
  }

  /** "More tools": a small menu of everything else the role may open. */
  private moreTools(): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ms-nav__item ms-nav__more';
    b.innerHTML = `${ic('grid', 20)}<span class="ms-nav__label">More tools</span>`;
    b.title = 'More tools';
    b.setAttribute('aria-haspopup', 'menu');
    const menu = new Menu(b, 'More tools');
    b.addEventListener('click', () =>
      menu.isOpen
        ? menu.close()
        : menu.open((m) => {
            for (const t of this.tools) m.item(t.label, () => (location.hash = t.href), { icon: t.icon });
          }, false, this.folded),
    );
    return b;
  }

  /** A count at the right of an item (a collection's entries, the unread messages); 0 hides it. */
  setCount(key: string, n: number, hot = false): void {
    const el = this.counts.get(key);
    if (!el) return;
    el.hidden = n <= 0;
    el.textContent = String(n);
    el.classList.toggle('is-hot', hot && n > 0);
  }

  /** Marks the place of `r`. */
  update(r: Route): void {
    const at = r.screen?.name ?? null;
    const c = at === 'entries' ? r.screenParams.c : null;
    const home = !at && !r.collection;
    for (const { a, screen, href } of this.links) {
      const on = screen === 'entries' ? href === `#/entries?c=${encodeURIComponent(c ?? '')}` : screen ? screen === at : href === '#/' && home;
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  }
}

/** The person's own menu under the top bar's avatar: account, alerts, tokens, sign out, the theme. */
export function accountMenu(btn: HTMLButtonElement, me: NonNullable<Me['user']>, signOut: (() => Promise<void>) | null): void {
  btn.hidden = false;
  btn.setAttribute('aria-label', `${me.name}: your account`);
  btn.title = `${me.name} (${me.role})`;
  btn.textContent = initials(me.name);
  const menu = new Menu(btn, 'Your account');
  btn.addEventListener('click', () =>
    menu.isOpen
      ? menu.close()
      : menu.open((m) => {
          const who = document.createElement('div');
          who.className = 'ms-nav__who';
          who.innerHTML = '<strong></strong><span></span>';
          who.querySelector('strong')!.textContent = me.name;
          who.querySelector('span')!.textContent = `${me.email} · ${me.role}`;
          m.el.prepend(who);
          if (screenDef('account')) m.item('Your account', () => (location.hash = '#/account'), { icon: 'user' });
          if (screenDef('my-alerts')) m.item('My alerts', () => (location.hash = '#/my-alerts'), { icon: 'bell' });
          if (screenDef('edit')) m.item('Edit button on your site', () => (location.hash = '#/edit'), { icon: 'link' });
          if (screenDef('settings')) m.item('Tokens', () => (location.hash = '#/settings/tokens'), { icon: 'key' });
          if (signOut) m.item('Sign out', () => void signOut(), { icon: 'logout' });
          m.el.append(themeRow());
        }, true),
  );
}
