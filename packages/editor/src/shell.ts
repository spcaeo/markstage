// The page around the canvas: the top bar (menu, the site's name, the place chip, one search, then with an entry open
// its title and address, view switch, sections, save state, Post settings, preview, more actions, save; Help and the
// account at the right), the banner for conflicts and errors, the confirm dialog and the save state text.
import './styles/top-bar.css';
import { ic } from './icons';
import { openMenus } from './router';

export type Status = 'idle' | 'loading' | 'saved' | 'dirty' | 'saving' | 'conflict' | 'error';

export const STATUS_TEXT: Record<Status, string> = {
  idle: '',
  loading: 'Opening…',
  saved: 'Saved',
  dirty: 'Unsaved changes',
  saving: 'Saving…',
  conflict: 'Conflict',
  error: 'Not saved',
};

export interface ShellOpts {
  siteName: string;
  /** what the search button says ("Search pages, posts, images and messages") */
  noun: string;
  articleClass: string;
}

/** Draws the page into `app` and returns a finder for its parts. */
export function buildShell(app: HTMLElement, o: ShellOpts) {
  app.innerHTML = `
  <a class="ms-skip" href="#ms-main">Skip to content</a>
  <main class="ms-main" id="ms-main" tabindex="-1">
    <header class="ms-head">
      <button type="button" class="ms-iconbtn ms-head__menu" data-menu hidden aria-label="Main menu" title="Main menu: show or hide the places">${ic('menu', 20)}</button>
      <a class="ms-head__brand" href="#/" aria-label="Home"><span class="ms-head__logo"></span><b></b><span>Editor</span></a>
      <span class="ms-head__place"></span>
      <button type="button" class="ms-btn ms-head__search" data-search title="Find and open (⌘K)">${ic('search', 16)}<span></span><kbd>⌘K</kbd></button>
      <a class="ms-btn ms-btn--quiet ms-head__new" data-new href="#/new" hidden title="Start a new draft" aria-label="New draft">${ic('plus', 15)}<span>New</span></a>
      <div class="ms-head__doc">
        <div class="ms-head__title"></div>
        <div class="ms-head__url"></div>
      </div>
      <div class="ms-head__actions">
        <div class="ms-seg ms-viewswitch" role="radiogroup" aria-label="View" data-views data-fold>
          <button type="button" class="ms-seg__btn" data-view="visual" role="radio" title="Edit on the page">Visual</button>
          <button type="button" class="ms-seg__btn" data-view="source" role="radio" title="Edit the Markdown file">Source</button>
        </div>
        <button type="button" class="ms-btn ms-btn--quiet" data-sections data-fold aria-pressed="false" title="Outline: every block, to go to or move (drag, Alt+↑/↓)" aria-label="Outline">${ic('sections', 15)}<span>Outline</span></button>
        <button type="button" class="ms-btn ms-btn--quiet" data-seo data-fold aria-pressed="false" title="SEO: what search engines and social sites will see, with what to fix" aria-label="SEO check">${ic('globe', 15)}<span>SEO</span></button>
        <button type="button" class="ms-btn ms-btn--quiet" data-library data-fold aria-pressed="false" title="Library: sections and snippets to drag onto the page" aria-label="Library">${ic('blocks', 15)}<span>Library</span></button>
        <span class="ms-status" data-status="idle" role="status" aria-live="polite"><span class="ms-status__dot"></span><span class="ms-status__text"></span></span>
        <button type="button" class="ms-iconbtn ms-iconbtn--lg" data-undo data-fold aria-label="Undo (⌘Z)" title="Undo (⌘Z)">${ic('undo', 16)}</button>
        <button type="button" class="ms-iconbtn ms-iconbtn--lg" data-redo data-fold aria-label="Redo (⇧⌘Z)" title="Redo (⇧⌘Z)">${ic('redo', 16)}</button>
        <button type="button" class="ms-iconbtn ms-iconbtn--lg" data-settings aria-expanded="false" aria-label="Post settings" title="Post settings: address, excerpt, cover, tags, author, date, SEO">${ic('settings', 16)}</button>
        <button type="button" class="ms-iconbtn ms-iconbtn--lg" data-devices data-fold aria-pressed="false" aria-label="Check on screens" title="Check on screens: the page on a desktop, a tablet and a phone, with what does not fit">${ic('phone', 16)}</button>
        <a class="ms-btn" data-preview data-fold target="_blank" rel="noopener" aria-label="Preview page">${ic('eye', 15)}<span>Preview page</span></a>
        <button type="button" class="ms-iconbtn ms-iconbtn--lg" data-more aria-haspopup="menu" aria-expanded="false" aria-label="More actions" title="More: download, copy as Markdown, import (on a narrow screen: the view, Outline, SEO, Library, undo, redo, the screen check and the preview too)">${ic('more', 16)}</button>
        <a class="ms-btn" data-publish hidden aria-label="Publish" title="Publish, schedule or unpublish, with the checks first">${ic('rocket', 15)}<span>Publish</span></a>
        <button type="button" class="ms-btn ms-btn--primary" data-save title="Save (⌘S)">Save <kbd>⌘S</kbd></button>
      </div>
      <div class="ms-head__trail">
        <button type="button" class="ms-iconbtn ms-head__help" data-help hidden aria-label="Help" title="Help: how do I…">${ic('help', 20)}</button>
        <button type="button" class="ms-head__me" data-me hidden aria-haspopup="menu" aria-expanded="false"></button>
      </div>
    </header>
    <div class="ms-banner" hidden role="alert"></div>
    <div class="ms-banner ms-presence" hidden role="status"></div>
    <div class="ms-find" hidden></div>
    <div class="ms-scroll">
      <div class="ms-sheet">
        <article class="${o.articleClass}">
          <div class="ms-headslot"></div>
          <div class="ms-canvas"></div>
        </article>
        <button type="button" class="ms-chip" hidden tabindex="-1"></button>
      </div>
      <div class="ms-source" hidden></div>
      <div class="ms-blank" hidden></div>
    </div>
    <div class="ms-pagehost" hidden></div>
    <div class="ms-screen" hidden></div>
    <div class="ms-devices"></div>
  </main>
  <aside class="ms-panel" aria-label="Block settings"></aside>
  <aside class="ms-panel ms-drawer" aria-label="Post settings"></aside>
  <aside class="ms-panel ms-outline-panel" aria-label="Outline"></aside>
  <aside class="ms-panel ms-library-panel" aria-label="Library"></aside>
  <aside class="ms-panel ms-seo-panel" aria-label="SEO check"></aside>
  <aside class="ms-panel ms-help-panel" aria-label="How do I…"></aside>
  <aside class="ms-panel ms-checks" aria-label="Screen checks"></aside>
  <aside class="ms-panel ms-pagepanel" aria-label="Page settings"></aside>`;
  app.removeAttribute('aria-busy');
  // the skip link puts the focus on the content (the address stays: #ms-main is not a route)
  app.querySelector('.ms-skip')!.addEventListener('click', (e) => {
    e.preventDefault();
    app.querySelector<HTMLElement>('.ms-main')!.focus();
  });
  app.querySelector('[data-search] span')!.textContent = o.noun;
  app.querySelector('.ms-head__brand b')!.textContent = o.siteName;
  app.querySelector('.ms-head__logo')!.textContent = (o.siteName.trim()[0] ?? 'M').toUpperCase();
  return <T extends HTMLElement = HTMLElement>(s: string) => app.querySelector<T>(s)!;
}

/** The canvas with nothing open: find something (⌘K), or start a draft (`newHref`). */
export function nothingOpen(blank: HTMLElement, siteName: string, newHref: string | null, find: () => void): void {
  blank.innerHTML = `<div class="ms-blank__box">${ic('article', 28)}<h2>Open something to edit</h2><p></p><button type="button" class="ms-btn ms-btn--primary">${ic('search', 15)}<span>Find</span><kbd>⌘K</kbd></button></div>`;
  if (newHref) blank.querySelector('.ms-blank__box')!.append(Object.assign(document.createElement('a'), { className: 'ms-btn ms-blank__new', href: newHref, innerHTML: `${ic('plus', 15)}<span>Start a new draft</span>` }));
  blank.querySelector('p')!.textContent = `Find an entry of ${siteName} by its title, address or group, then edit it as the page shows it.`;
  blank.querySelector('button')!.addEventListener('click', find);
}

/**
 * A banner's words: plain text, or a list of parts of which `{ strong }` ones are bold. Never HTML: the words often
 * quote a server's message, which can quote what someone else wrote (a heading in a lock message), so they are drawn
 * as text (security review 3 Nov 2026, S3; test/banner-text.test.ts guards every caller).
 */
export type BannerText = string | readonly (string | { strong: string })[];

/** The words of a banner as one string (to compare two of them). */
export const bannerWords = (text: BannerText): string => (typeof text === 'string' ? text : text.map((p) => (typeof p === 'string' ? p : p.strong)).join(''));

export class Banner {
  constructor(private el: HTMLElement) {}

  show(kind: 'conflict' | 'error' | 'info', text: BannerText, actions: [string, () => void, string?][] = []): void {
    const el = this.el;
    el.hidden = false;
    el.dataset.kind = kind;
    // the icon is our own markup; the words are text nodes only
    el.innerHTML = `<span class="ms-banner__icon">${ic(kind === 'info' ? 'info' : 'alert', 16)}</span>`;
    const p = document.createElement('p');
    for (const part of typeof text === 'string' ? [text] : text) {
      if (typeof part === 'string') p.append(part);
      else p.append(Object.assign(document.createElement('strong'), { textContent: part.strong }));
    }
    el.append(p);
    const tools = document.createElement('div');
    tools.className = 'ms-banner__tools';
    for (const [label, run, cls] of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls ?? 'ms-btn ms-btn--sm';
      b.textContent = label;
      b.addEventListener('click', run);
      tools.append(b);
    }
    el.append(tools);
  }

  hide(): void {
    this.el.hidden = true;
  }
}

let dialogs = 0;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A dialog a screen reader can name and that keeps the focus (QA pass 2, N6): aria-modal, its heading as its name
 * (unless it has one), and Tab from its last control goes to its first (Shift+Tab the other way), never out into
 * the page behind. Call it before showModal().
 */
export function modalize(dlg: HTMLDialogElement): void {
  dlg.setAttribute('aria-modal', 'true');
  if (!dlg.hasAttribute('aria-labelledby') && !dlg.hasAttribute('aria-label')) {
    const h = dlg.querySelector<HTMLElement>('h1, h2, h3');
    if (h) {
      h.id ||= `ms-dialog-${++dialogs}`;
      dlg.setAttribute('aria-labelledby', h.id);
    }
  }
  dlg.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const items = [...dlg.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    const inside = !!active && dlg.contains(active);
    if (e.shiftKey ? !inside || active === first : !inside || active === last) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  });
}

/** A modal question; resolves with the chosen button's value ('cancel' on Esc). */
export function ask(title: string, text: string, buttons: [string, string, string?][]): Promise<string> {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'ms-dialog';
    dlg.innerHTML = `<h2></h2><p></p><div class="ms-dialog__tools"></div>`;
    dlg.querySelector('h2')!.textContent = title;
    dlg.querySelector('p')!.textContent = text;
    const tools = dlg.querySelector('.ms-dialog__tools')!;
    for (const [value, label, cls] of buttons) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls ?? 'ms-btn';
      b.textContent = label;
      b.addEventListener('click', () => dlg.close(value));
      tools.append(b);
    }
    dlg.addEventListener('close', () => {
      resolve(dlg.returnValue || 'cancel');
      dlg.remove();
    });
    document.body.append(dlg);
    modalize(dlg);
    dlg.showModal();
    (tools.lastElementChild as HTMLElement)?.focus();
  });
}

/** A small menu under `anchor`: one button per item; closes on choice, Esc, a click elsewhere or scrolling. */
export class Menu {
  readonly el: HTMLElement;
  /** told when the menu closes (a screen keeps its open menu in the URL) */
  onClose: (() => void) | null = null;

  constructor(
    private anchor: HTMLButtonElement,
    label: string,
    cls = '',
  ) {
    this.el = document.createElement('div');
    this.el.className = `ms-pop ms-menu ${cls}`.trim();
    this.el.setAttribute('role', 'menu');
    this.el.setAttribute('aria-label', label);
    this.el.hidden = true;
    document.body.append(this.el);
    this.el.addEventListener('keydown', (e) => {
      const items = [...this.el.querySelectorAll<HTMLElement>('button')];
      const i = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'ArrowDown') items[(i + 1) % items.length]?.focus();
      else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length]?.focus();
      else if (e.key === 'Escape') this.close(true);
      else return;
      e.preventDefault();
    });
    document.addEventListener('mousedown', this.outside);
  }

  private outside = (e: MouseEvent) => {
    if (!this.el.contains(e.target as Node) && !this.anchor.contains(e.target as Node)) this.close();
  };

  /** Removes the menu for good (its button is gone). */
  destroy(): void {
    document.removeEventListener('mousedown', this.outside);
    this.el.remove();
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  item(text: string, run: () => void, opts: { icon?: string; cls?: string } = {}): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `ms-menu__item ${opts.cls ?? ''}`.trim();
    b.setAttribute('role', 'menuitem');
    if (opts.icon) b.innerHTML = ic(opts.icon, 15);
    b.append(text);
    b.addEventListener('click', () => {
      this.close();
      run();
    });
    this.el.append(b);
    return b;
  }

  empty(text: string): void {
    this.el.append(Object.assign(document.createElement('p'), { className: 'ms-menu__empty', textContent: text }));
  }

  /** Clears the items, lets `fill` add them and shows the menu (below its button, or `beside` it, upwards). */
  open(fill: (m: Menu) => void, alignRight = false, beside = false): void {
    this.el.replaceChildren();
    fill(this);
    this.el.hidden = false;
    this.anchor.setAttribute('aria-expanded', 'true');
    openMenus.add(this);
    const r = this.anchor.getBoundingClientRect();
    // below the button, or above it when it would run off the bottom of the window
    const above = !beside && r.bottom + 6 + this.el.offsetHeight > innerHeight - 8 && r.top - 6 - this.el.offsetHeight >= 8;
    this.el.style.top = beside ? `${Math.max(8, r.bottom - this.el.offsetHeight)}px` : above ? `${r.top - 6 - this.el.offsetHeight}px` : `${r.bottom + 6}px`;
    const left = beside ? r.right + 8 : alignRight ? r.right - this.el.offsetWidth : r.left;
    this.el.style.left = `${Math.max(8, Math.min(left, innerWidth - this.el.offsetWidth - 8))}px`;
    this.el.querySelector<HTMLElement>('button')?.focus();
  }

  close(refocus = false): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    openMenus.delete(this);
    this.anchor.setAttribute('aria-expanded', 'false');
    if (refocus) this.anchor.focus();
    this.onClose?.();
  }
}
