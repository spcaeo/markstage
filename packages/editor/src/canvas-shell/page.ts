// The page shell (docs/CANVAS-FIDELITY.md): the canvas drawn inside the entry's real page. The editor reads the
// page the site renders for the entry (its own dev server, same origin), keeps its frame (top menu, side column,
// breadcrumbs, the grid, what comes after the text, the footer) and its stylesheets, and puts the editor's own parts
// where the page has the same ones: the title, byline and cover (the head the pack draws) and the body text (the
// canvas, in place of the element with canvas.bodyClass). So the text is edited at the page's width, size and
// margins, and a change to the site's layout shows on the canvas at its next open without any change to the editor.
//
// What the site draws stays the site's: nothing of the shell can be clicked or focused (inert), its scripts never
// run here (only its first <head> scripts, sandboxed, to learn what they set on <html>: first-paint.ts), and nothing
// of it is saved. A block pack may keep parts of it live (EditorPack.shell: a contents list that
// follows the headings, a reading time), and make those clickable. "What readers see" (?readers=1) shows the page's own text as last saved, with
// what the build does to it (respellings, components the site adds): the stored source is never changed.
import type { Editor } from '@tiptap/core';
import '../styles/shell.css';
import type { ShellCtx } from '../pack';
import * as router from '../router';
import { config, editorPacks } from '../runtime';
import { editorDark, onEditorTheme } from '../theme';
import { BODY, ROOT, scopeSheet } from './css';
import { adoptScope, classSelector, sanitize } from './dom';
import { fenceSiteCopy } from './fence';
import { firstPaint, type Attrs } from './first-paint';

export interface ShellDeps {
  sheet: HTMLElement;
  /** the editor's own article (the head slot and the canvas live in it when there is no shell) */
  article: HTMLElement;
  headSlot: HTMLElement;
  canvas: HTMLElement;
  /** the address of the entry's page, or null when it has none */
  pageUrl: (e: { collection: string; id: string; url: string | null }) => Promise<string | null>;
  /** the canvas has changes not saved yet */
  dirty: () => boolean;
  /** draws the head again (the pack may take parts of it from the page: HeadCtx.page) */
  redrawHead: () => void;
  /** the canvas's editor, and the open entry's settings as they are now (for EditorPack.shell) */
  editor: () => Editor | null;
  frontmatter: () => Record<string, unknown>;
  /** the canvas's scrolling box */
  scroller: HTMLElement;
}

type Entry = { collection: string; id: string; url: string | null };

export class PageShell {
  private root: HTMLElement | null = null;
  private pageArticle: HTMLElement | null = null;
  private readersBody: HTMLElement | null = null;
  private bodyAttrs: [string, string][] = [];
  private bodyClasses: string[] = [];
  private css = document.createElement('style');
  private cssKey = '';
  private run = 0;
  /** the entry the shell was last drawn for (a save draws it again: the head is not redrawn then) */
  private drawnFor = '';
  private bar: HTMLElement;
  private sizer: ResizeObserver;
  private entry: Entry | null = null;
  /** the parts of the page a pack keeps live (ShellCtx.live), and what was made inert around them */
  private live = new Set<HTMLElement>();
  private inerted: Element[] = [];
  private changeTimer = 0;
  private scrollQueued = false;
  /** why the last open drew no shell (for the person, and for tests) */
  reason = '';

  constructor(private d: ShellDeps) {
    this.css.id = 'ms-shell-css';
    // the editor's own copy of the site's CSS reaches everything but the page (fence.ts)
    if (PageShell.enabled) fenceSiteCopy();
    this.bar = this.makeBar();
    this.sizer = new ResizeObserver(() => this.size());
    this.sizer.observe(d.sheet);
    // a new editor (another entry, a reload from Source) puts a new text element in the canvas: it gets the page's
    // scope attributes again; a redrawn head likewise
    new MutationObserver(() => this.adoptBody()).observe(d.canvas, { childList: true });
    new MutationObserver(() => this.placeHead()).observe(d.headSlot, { childList: true, subtree: true });
    onEditorTheme(() => this.theme());
    addEventListener('hashchange', () => this.readers(router.parse().readers));
    d.scroller.addEventListener(
      'scroll',
      () => {
        if (!this.root || this.scrollQueued) return;
        this.scrollQueued = true;
        requestAnimationFrame(() => ((this.scrollQueued = false), this.callPacks('scroll')));
      },
      { passive: true },
    );
  }

  /** The text or a setting changed: the packs' live parts follow, a moment after the last change. */
  changed(): void {
    if (!this.root) return;
    clearTimeout(this.changeTimer);
    this.changeTimer = window.setTimeout(() => this.callPacks('change'), 150);
  }

  static get enabled(): boolean {
    return !!config().canvas.shell;
  }

  get active(): boolean {
    return this.root !== null;
  }

  /** Draws the canvas inside the page of `entry` (after a save: again, so the frame shows what the site has now). */
  async open(entry: Entry): Promise<void> {
    if (!PageShell.enabled) return;
    const run = ++this.run;
    const page = await this.fetchPage(entry).catch((err: Error) => ((this.reason = err.message), null));
    if (run !== this.run) return;
    if (!page) return this.close();
    const { doc, sheets } = page;
    // <html> and <body> as the page's first scripts leave them (a `js` class, a theme: first-paint.ts)
    const first = await firstPaint(doc, this.d.sheet.clientWidth || innerWidth, this.d.scroller.clientHeight || innerHeight);
    if (run !== this.run) return;
    const { articleClass, bodyClass } = config().canvas;
    const body = doc.querySelector<HTMLElement>(classSelector(bodyClass));
    if (!body) return this.fail(`The page has no element with class "${bodyClass}" (canvas.bodyClass).`);
    const article = body.closest<HTMLElement>(classSelector(articleClass)) ?? body.parentElement!;
    this.applyCss(sheets);
    sanitize(doc.body);
    // made here, kept only after unmount() below (which forgets the last draw's copy): a draw after a save keeps it
    const readersBody = body.cloneNode(true) as HTMLElement;
    readersBody.classList.add('ms-pg-readers');
    this.bodyAttrs = [...body.attributes].filter((a) => a.value === '' && a.name.startsWith('data-')).map((a) => [a.name, a.value]);
    this.bodyClasses = [...body.classList];
    const root = document.createElement('div');
    setAttrs(root, first.html);
    root.classList.add(ROOT);
    const b = document.createElement('div');
    setAttrs(b, first.body);
    b.classList.add(BODY);
    b.append(...doc.body.childNodes);
    root.append(b);
    // a link in a live part never leaves the editor (the pack handles its click)
    root.addEventListener('click', (e) => (e.target as Element).closest?.('a') && !(e.target as Element).closest('.ms-canvas, .ms-headslot') && e.preventDefault(), true);
    this.unmount();
    this.readersBody = readersBody;
    this.root = root;
    this.entry = entry;
    this.pageArticle = article;
    this.d.sheet.classList.add('is-shell');
    this.d.sheet.prepend(root);
    this.d.sheet.append(this.bar);
    body.replaceWith(this.d.canvas);
    this.d.canvas.after(this.readersBody);
    article.insertBefore(this.d.headSlot, article.firstChild);
    // a code block wraps, or scrolls, as the site's do (the canvas's own rule wraps it always)
    const probe = this.readersBody.appendChild(document.createElement('pre'));
    this.d.sheet.style.setProperty('--ms-pre-ws', getComputedStyle(probe).whiteSpace);
    probe.remove();
    this.reason = '';
    this.size();
    this.theme();
    this.adoptBody();
    this.placeHead();
    this.inert();
    this.readers(router.parse().readers);
    requestAnimationFrame(() => this.hideOverlays());
    this.callPacks('open');
    const key = `${entry.collection}/${entry.id}`;
    if (key !== this.drawnFor) this.d.redrawHead();
    this.drawnFor = key;
  }

  /** A copy of the page's own element for a part of the head (HeadCtx.page), or null without the shell. */
  pageElement(selector: string): HTMLElement | null {
    if (!this.pageArticle) return null;
    let found: Element | undefined;
    try {
      found = [...this.pageArticle.querySelectorAll(selector)].find((el) => !this.d.headSlot.contains(el));
    } catch {
      return null; // not a selector
    }
    if (!(found instanceof HTMLElement)) return null;
    const copy = found.cloneNode(true) as HTMLElement;
    copy.classList.remove('ms-pg-covered');
    copy.removeAttribute('inert');
    return copy;
  }

  /** Back to the plain canvas. */
  close(): void {
    this.run++;
    this.unmount();
  }

  private fail(reason: string): void {
    this.reason = reason;
    this.unmount();
  }

  private unmount(): void {
    if (!this.root) return;
    this.drawnFor = '';
    this.d.article.append(this.d.headSlot, this.d.canvas);
    this.root.remove();
    this.bar.remove();
    this.root = this.pageArticle = null;
    this.entry = null;
    this.live.clear();
    this.inerted = [];
    clearTimeout(this.changeTimer);
    this.readersBody?.remove();
    this.readersBody = null;
    this.d.sheet.classList.remove('is-shell', 'is-readers');
  }

  /** The page's HTML and its stylesheets' text, in document order. */
  private async fetchPage(entry: { collection: string; id: string; url: string | null }) {
    if (!entry.url) throw new Error('This entry has no page.');
    const href = await this.d.pageUrl(entry);
    if (!href) throw new Error('This entry has no page.');
    const url = new URL(href, location.href);
    // the page must be the site's own, on this origin (the dev server); a preview on its own origin is never read
    // from here (docs/CANVAS-FIDELITY.md "With the server")
    if (url.origin !== location.origin) throw new Error('The page is on another origin.');
    const res = await fetch(url, { credentials: 'same-origin', headers: { accept: 'text/html' } });
    if (!res.ok) throw new Error(`The page answered ${res.status}.`);
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const sheets: string[] = [];
    for (const el of doc.querySelectorAll<HTMLElement>('style, link[rel~="stylesheet"]')) {
      if (el instanceof HTMLStyleElement) sheets.push(el.textContent ?? '');
      else {
        const css = new URL(el.getAttribute('href') ?? '', url);
        if (css.origin !== location.origin) continue;
        const r = await fetch(css, { credentials: 'same-origin' });
        if (r.ok) sheets.push(await r.text());
      }
    }
    return { doc, sheets };
  }

  /** The page's CSS, scoped to the shell; parsed again only when it changed. */
  private applyCss(sheets: string[]): void {
    const key = `${sheets.length}:${hash(sheets.join('\u0000'))}`;
    if (key !== this.cssKey) {
      this.css.textContent = sheets.map((s) => safeScope(s)).join('\n');
      this.cssKey = key;
    }
    // last in <head>: the site's rules, met at the same weight, win over the editor's copies of them
    if (document.head.lastElementChild !== this.css) document.head.append(this.css);
  }

  /** A hundredth of the canvas's width: the page's vw. */
  private size(): void {
    this.root?.style.setProperty('--ms-vw', `${this.d.sheet.clientWidth / 100}px`);
  }

  /** The site's dark scheme while the editor is dark (config `themes.dark`). */
  private theme(): void {
    const t = config().themes?.dark;
    if (!this.root || !t) return;
    if (editorDark()) this.root.setAttribute(t.attr, t.value);
    else if (this.root.getAttribute(t.attr) === t.value) this.root.removeAttribute(t.attr);
  }

  /** The text element gets what the page's body element had: its scope attributes and classes. */
  private adoptBody(): void {
    const pm = this.d.canvas.querySelector<HTMLElement>(':scope > .ProseMirror');
    if (!this.root || !pm) return;
    for (const [k, v] of this.bodyAttrs) if (!pm.hasAttribute(k)) pm.setAttribute(k, v);
    for (const c of this.bodyClasses) pm.classList.add(c);
  }

  /**
   * The head the pack draws (title, byline, cover) in place of the page's own: each page element before the body
   * whose first class the head also draws is hidden, the head goes where the first of them was, and its elements
   * get the page's scope (the attributes and classes a framework adds to style a component: Astro's
   * data-astro-cid-*, Vue's data-v-*, Svelte's svelte-* classes).
   */
  private placeHead(): void {
    const article = this.pageArticle;
    if (!article) return;
    const slot = this.d.headSlot;
    const drawn = new Set([...slot.querySelectorAll('[class]')].flatMap((el) => [...el.classList]));
    const before: HTMLElement[] = [];
    for (const el of article.children) {
      if (el === this.d.canvas) break;
      if (el !== slot && el instanceof HTMLElement) before.push(el);
    }
    // the head's title stands for the page's first heading of its kind (a page may draw its title with no class)
    const title = slot.querySelector('.ms-title');
    const pageTitle = title ? before.find((el) => el.tagName === title.tagName) : undefined;
    let first: HTMLElement | null = null;
    for (const el of before) {
      const covered = (!!el.classList[0] && drawn.has(el.classList[0])) || el === pageTitle;
      el.classList.toggle('ms-pg-covered', covered);
      if (covered) {
        first ??= el;
        adoptScope(el, slot, el === pageTitle ? title : null);
      }
    }
    if (first && first.previousElementSibling !== slot && slot.nextElementSibling !== first) article.insertBefore(slot, first);
  }

  /** Nothing of the page around the editor's parts (and the packs' live parts) can be clicked, focused or typed in. */
  private inert(): void {
    const body = this.root?.querySelector(`.${BODY}`);
    if (!body) return;
    for (const el of this.inerted) el.removeAttribute('inert');
    this.inerted = [];
    const keep = [this.d.headSlot, this.d.canvas, ...this.live].filter((el) => body.contains(el));
    const mark = (el: Element) => {
      if (keep.includes(el as HTMLElement)) return;
      if (keep.some((k) => el.contains(k))) {
        for (const c of el.children) mark(c);
        return;
      }
      el.setAttribute('inert', '');
      this.inerted.push(el);
    };
    for (const c of body.children) mark(c);
  }

  /** Each pack's `shell` with the page and the document as they are now (EditorPack.shell). */
  private callPacks(reason: ShellCtx['reason']): void {
    const shells = editorPacks()
      .map((p) => p.shell)
      .filter((f): f is NonNullable<typeof f> => !!f);
    if (!this.root || !this.entry || !shells.length) return;
    const ed = this.d.editor();
    const headings: ShellCtx['headings'] = [];
    ed?.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'heading') return true;
      const dom = ed.view.nodeDOM(pos);
      headings.push({ level: Number(node.attrs.level), text: node.textContent, el: dom instanceof HTMLElement ? dom : null });
      return false;
    });
    const ctx: ShellCtx = {
      reason,
      root: this.root,
      scroller: this.d.scroller,
      entry: { ...this.entry, frontmatter: this.d.frontmatter() },
      headings,
      text: ed ? ed.state.doc.textBetween(0, ed.state.doc.content.size, '\n', ' ') : '',
      live: (el) => {
        if (this.live.has(el)) return;
        this.live.add(el);
        this.inert();
      },
      scrollTo: (el) => {
        const box = this.d.scroller;
        const pad = parseFloat(getComputedStyle(this.root!).scrollPaddingTop) || 0;
        box.scrollTo({ top: box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - pad });
      },
    };
    for (const f of shells) {
      try {
        f(ctx);
      } catch (err) {
        console.warn('A block pack could not update the page around the canvas:', err);
      }
    }
  }

  /** What the page lays over the window (a sticky call-to-action bar, a cookie note, a dialog) is not drawn. */
  private hideOverlays(): void {
    if (!this.root) return;
    for (const el of this.root.querySelectorAll<HTMLElement>(`.${BODY} *`)) {
      if (el.closest('.ms-canvas, .ms-headslot')) continue;
      if (getComputedStyle(el).position === 'fixed') el.classList.add('ms-pg-fixed');
    }
  }

  /** "What readers see": the page's own text (as last saved) in place of the canvas. */
  private readers(on: boolean): void {
    const was = this.d.sheet.classList.contains('is-readers');
    this.d.sheet.classList.toggle('is-readers', on && !!this.root);
    const btn = this.bar.querySelector<HTMLButtonElement>('[data-readers]')!;
    btn.setAttribute('aria-pressed', String(on));
    btn.querySelector('span')!.textContent = on ? 'Back to editing' : 'What readers see';
    const note = this.bar.querySelector<HTMLElement>('.ms-pg-bar__note')!;
    note.hidden = !on;
    note.textContent = this.d.dirty() ? 'As last saved: your unsaved changes are not in it.' : 'As last saved, with what the site does to the text.';
    if (on !== was && this.root) this.d.sheet.closest('.ms-scroll')?.scrollTo({ top: 0 });
  }

  private makeBar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'ms-pg-bar';
    bar.innerHTML = `<div class="ms-pg-bar__in"><p class="ms-pg-bar__note" hidden></p><button type="button" class="ms-btn ms-btn--sm" data-readers aria-pressed="false" title="The page as readers get it: the site's spelling and the parts it adds. Nothing here changes your text."><span>What readers see</span></button></div>`;
    bar.querySelector('[data-readers]')!.addEventListener('click', () => {
      const on = !router.route().readers;
      router.go({ readers: on });
      this.readers(on);
    });
    return bar;
  }
}

/** A stand-in gets the page's element's attributes (no event handlers: they never run here). */
function setAttrs(el: HTMLElement, attrs: Attrs): void {
  for (const [k, v] of attrs) if (!/^on/i.test(k)) el.setAttribute(k, v);
}

/** One stylesheet the browser cannot read whole (a rule it does not know) is dropped, not the shell. */
function safeScope(css: string): string {
  try {
    return scopeSheet(css);
  } catch {
    return '';
  }
}

/** FNV-1a: enough to know the page's CSS is the same as last time. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return `${text.length}.${(h >>> 0).toString(36)}`;
}
