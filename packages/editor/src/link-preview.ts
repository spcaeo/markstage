// The link preview on the canvas: resting the pointer on a link (about 300 ms) shows what it points to, the way a
// visitor's hover card shows it: for a page of the site its picture, group, title, description and date (the site's
// own card data, config editor.linkCards, else what the editor knows of the page), for another site its domain; the
// address with copy and open; and the link's actions (Edit, Open, Copy, Remove) along the bottom. It never takes
// the focus and changes nothing until an action is clicked; a click on the link still puts the caret in it.
import type { Editor } from '@tiptap/core';
import './styles/link-preview.css';
import { copyable, copyText, siteUrl } from './copy';
import { ic } from './icons';
import { config } from './runtime';

/** What a card shows for a page of the site. */
export interface CardData {
  title: string;
  description?: string;
  image?: string;
  tag?: string;
  date?: string;
  /** a draft: the link leads nowhere until it is published */
  draft?: boolean;
}

export interface PreviewDeps {
  editor(): Editor | null;
  /** what the editor knows of the page at `path` (its entry), or null */
  known(path: string): CardData | null;
  /** opens the link field on this link (the toolbar's) */
  edit(): void;
  /** true while the link field is open, or the caret card already shows this link */
  busy(href: string): boolean;
}

const SHOW_MS = 300;
const HIDE_MS = 160;

let siteCards: Promise<Record<string, Record<string, unknown>>> | null = null;
/** The site's card data (fetched once, on the first hover of a site link). */
function loadSiteCards(): Promise<Record<string, Record<string, unknown>>> {
  const lc = config().linkCards;
  if (!lc) return Promise.resolve({});
  return (siteCards ??= fetch(lc.url, { credentials: 'same-origin' })
    .then((r): Promise<unknown> | object => (r.ok ? r.json() : {}))
    .then((j) => (j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, Record<string, unknown>>) : {}))
    .catch(() => ({})));
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** The site's own card for `path`, in the shape above (its key names from the config). */
async function siteCard(path: string): Promise<CardData | null> {
  const lc = config().linkCards;
  if (!lc) return null;
  const all = await loadSiteCards();
  const raw = all[path] ?? all[path.endsWith('/') ? path.slice(0, -1) : `${path}/`];
  const title = str(raw?.[lc.fields.title]);
  if (!raw || !title) return null;
  return { title, description: str(raw[lc.fields.description]), image: str(raw[lc.fields.image]), tag: str(raw[lc.fields.tag]), date: str(raw[lc.fields.date]) };
}

type Target = { kind: 'site'; path: string; href: string } | { kind: 'away'; url: URL } | { kind: 'other'; href: string };

/** Where `href` leads: a page of this site (a path), another site, or something else (mailto:, tel:, #part). */
export function targetOf(href: string): Target {
  let url: URL;
  try {
    url = new URL(href, location.origin);
  } catch {
    return { kind: 'other', href };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { kind: 'other', href };
  const site = config().siteUrl ? new URL(config().siteUrl!) : null;
  const bare = (h: string) => h.replace(/^www\./, '');
  const ours = url.origin === location.origin || (!!site && bare(url.hostname) === bare(site.hostname));
  if (!ours) return { kind: 'away', url };
  if (href.startsWith('#')) return { kind: 'other', href };
  return { kind: 'site', path: url.pathname, href: url.pathname + url.search + url.hash };
}

export class LinkPreview {
  readonly el: HTMLElement;
  private link: HTMLAnchorElement | null = null;
  private showTimer = 0;
  private hideTimer = 0;
  private token = 0;

  constructor(
    private canvas: HTMLElement,
    private d: PreviewDeps,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'ms-pop ms-lprev';
    this.el.setAttribute('role', 'group');
    this.el.setAttribute('aria-label', 'Link preview');
    this.el.hidden = true;
    document.body.append(this.el);
    canvas.addEventListener('mouseover', (e) => this.over(e));
    canvas.addEventListener('mouseout', (e) => this.out(e));
    // a click (or typing) is editing: the caret's own card takes over
    canvas.addEventListener('mousedown', () => this.hide());
    canvas.addEventListener('keydown', () => this.hide());
    this.el.addEventListener('mouseenter', () => clearTimeout(this.hideTimer));
    this.el.addEventListener('mouseleave', () => this.later());
    document.addEventListener('keydown', (e) => e.key === 'Escape' && this.hide());
    window.addEventListener('scroll', () => this.hide(), { capture: true, passive: true });
  }

  hide(): void {
    clearTimeout(this.showTimer);
    clearTimeout(this.hideTimer);
    this.token++;
    this.link = null;
    this.el.hidden = true;
  }

  private over(e: MouseEvent): void {
    const a = (e.target as Element).closest?.<HTMLAnchorElement>('.ProseMirror a[href]');
    if (!a || !this.canvas.contains(a)) return;
    clearTimeout(this.hideTimer);
    if (a === this.link) return;
    clearTimeout(this.showTimer);
    // not while selecting with the mouse
    if (e.buttons) return;
    this.showTimer = window.setTimeout(() => void this.show(a), SHOW_MS);
  }

  private out(e: MouseEvent): void {
    const a = (e.target as Element).closest?.('a[href]');
    if (!a) return;
    const to = e.relatedTarget as Node | null;
    if (to && (a.contains(to) || this.el.contains(to))) return;
    clearTimeout(this.showTimer);
    if (this.link) this.later();
  }

  private later(): void {
    clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.hide(), HIDE_MS);
  }

  private async show(a: HTMLAnchorElement): Promise<void> {
    const href = a.getAttribute('href') ?? '';
    if (!href || !a.isConnected || this.d.busy(href)) return;
    const mine = ++this.token;
    const t = targetOf(href);
    const data = t.kind === 'site' ? ((await siteCard(t.path)) ?? this.d.known(t.path)) : null;
    if (mine !== this.token || !a.isConnected) return;
    this.fill(a, href, t, data);
    this.link = a;
    this.el.hidden = false;
    this.place(a);
  }

  private fill(a: HTMLAnchorElement, href: string, t: Target, data: CardData | null): void {
    this.el.replaceChildren();
    const open = t.kind === 'site' ? siteUrl(t.href) : t.kind === 'away' ? t.url.href : /^(mailto:|tel:)/.test(href) ? href : null;
    const body = document.createElement('div');
    body.className = 'ms-lprev__body';
    if (data) {
      if (data.image) {
        const img = document.createElement('img');
        img.className = 'ms-lprev__img';
        img.alt = '';
        img.src = data.image;
        img.addEventListener('error', () => img.remove());
        body.append(img);
      }
      const text = document.createElement('div');
      text.className = 'ms-lprev__text';
      const tag = data.draft ? 'Draft: not live yet' : data.tag;
      if (tag) text.append(Object.assign(document.createElement('span'), { className: `ms-lprev__tag${data.draft ? ' is-draft' : ''}`, textContent: tag }));
      text.append(Object.assign(document.createElement('strong'), { className: 'ms-lprev__title', textContent: data.title }));
      if (data.description) text.append(Object.assign(document.createElement('span'), { className: 'ms-lprev__desc', textContent: data.description }));
      if (data.date) text.append(Object.assign(document.createElement('span'), { className: 'ms-lprev__date', textContent: data.date }));
      body.append(text);
    } else {
      const text = document.createElement('div');
      text.className = 'ms-lprev__text';
      const label = t.kind === 'away' ? t.url.hostname.replace(/^www\./, '') : t.kind === 'site' ? 'A page of this site' : href.startsWith('mailto:') ? 'Email' : href.startsWith('tel:') ? 'Phone' : 'Link';
      text.append(Object.assign(document.createElement('span'), { className: 'ms-lprev__tag', textContent: t.kind === 'away' ? 'Another site' : 'Link' }));
      text.append(Object.assign(document.createElement('strong'), { className: 'ms-lprev__title', textContent: label }));
      body.append(text);
    }
    this.el.append(body);
    this.el.append(copyable(href, { label: 'link', copy: open ?? href, open: open ?? undefined, className: 'ms-copyable--url ms-lprev__url' }));

    const foot = document.createElement('div');
    foot.className = 'ms-lprev__foot';
    const action = (label: string, icon: string, run: () => void, cls = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `ms-btn ms-btn--sm ms-btn--quiet ${cls}`.trim();
      b.innerHTML = `${ic(icon, 13)}<span>${label}</span>`;
      // a click here must not move the caret or the focus before the action runs
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', run);
      foot.append(b);
      return b;
    };
    action('Edit', 'link', () => this.act(a, 'edit'));
    if (open) {
      const o = action('Open', 'open', () => window.open(open, '_blank', 'noopener'));
      o.title = `Open ${open} in a new tab`;
    }
    const c = action('Copy', 'copy', () => {
      void copyText(open ?? href);
      c.querySelector('span')!.textContent = 'Copied';
      c.classList.add('is-done');
    });
    action('Remove', 'unlink', () => this.act(a, 'remove'), 'is-danger');
    this.el.append(foot);
  }

  /** Puts the caret in the link, then edits it or takes it off. */
  private act(a: HTMLAnchorElement, what: 'edit' | 'remove'): void {
    const editor = this.d.editor();
    this.hide();
    if (!editor || !a.isConnected) return;
    let pos: number;
    try {
      pos = editor.view.posAtDOM(a, 0);
    } catch {
      return;
    }
    const chain = editor.chain().focus().setTextSelection(pos + 1).extendMarkRange('link');
    if (what === 'remove') chain.unsetLink().run();
    else {
      chain.run();
      // the editor takes the focus a frame later; the link field must get it after that
      requestAnimationFrame(() => requestAnimationFrame(() => this.d.edit()));
    }
  }

  /** Below the link's last line, or above it when there is no room; never off the screen. */
  private place(a: HTMLAnchorElement): void {
    const rects = a.getClientRects();
    const r = a.getBoundingClientRect();
    const last = rects.length ? rects[rects.length - 1] : r;
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    const left = Math.max(12, Math.min(last.left - 8, innerWidth - w - 12));
    let top = last.bottom + 8;
    if (top + h > innerHeight - 12) top = r.top - h - 8;
    this.el.style.left = `${left}px`;
    this.el.style.top = `${Math.max(12, top)}px`;
  }
}
