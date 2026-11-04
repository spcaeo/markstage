// The entry search: the header's search button, or ⌘K / Ctrl+K when no text is selected. A centred popup to find
// and open any entry by its title, address or group; the entries opened last come first. Its open state and what
// is typed are in the URL (k=1, q=…; router.ts).
import './styles/palette.css';
import { modalize } from './shell';
import type { EntrySummary } from './api';
import { copyable, siteUrl } from './copy';
import { ic } from './icons';
import { fmtDateTime } from './dates';
import { screenIndex, searchScreens } from './palette-screens';
import { screens } from './host';
import { viewerRole } from './runtime';

const RECENT_KEY = 'markstage.recent';
const RECENT_MAX = 6;
const SHOWN_MAX = 60;

/** The keys (collection/id) of the entries opened last in this browser, newest first. */
export function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

const keyOf = (e: { collection: string; id: string }) => `${e.collection}/${e.id}`;

/** Puts the entry first in the recent list (kept in this browser only; a convenience, never needed). */
export function rememberRecent(collection: string, id: string): void {
  const k = keyOf({ collection, id });
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([k, ...readRecent().filter((s) => s !== k)].slice(0, RECENT_MAX)));
  } catch {
    // private window or blocked storage: no recent list
  }
}

/** 0 best: the title starts with the words, has them in order, has every word; 3: only the address or group does. */
function score(a: EntrySummary, q: string, words: string[]): number {
  const title = a.title.toLowerCase();
  if (title.startsWith(q)) return 0;
  if (title.includes(q)) return 1;
  if (words.every((w) => title.includes(w))) return 2;
  return 3;
}

export class EntryPalette {
  readonly el: HTMLDialogElement;
  private input: HTMLInputElement;
  private list: HTMLElement;
  private rows: { a: EntrySummary | null; go?: string; row: HTMLElement }[] = [];
  private active = 0;
  /** every entry the search knows (Home's Recent reads them too) */
  entries: EntrySummary[] = [];
  /** fetches the entries the first time the palette opens (the shell's shared light index) */
  loader: (() => Promise<EntrySummary[]>) | null = null;
  private loading = false;
  private current: string | null = null;

  constructor(
    private onChoose: (e: EntrySummary) => void,
    private onState: (open: boolean, q: string) => void,
    noun: string,
  ) {
    this.el = document.createElement('dialog');
    this.el.className = 'ms-pal';
    this.el.setAttribute('aria-label', `Open ${noun.toLowerCase()}`);
    this.el.innerHTML = `
      <label class="ms-pal__search">${ic('search', 18)}<input type="text" placeholder="Search ${noun.toLowerCase()} by title, address or group" aria-label="Search ${noun.toLowerCase()}" role="combobox" aria-expanded="true" aria-controls="ms-pal-list" autocomplete="off" spellcheck="false" /></label>
      <div class="ms-pal__list" id="ms-pal-list" role="listbox" aria-label="${noun}"></div>
      <footer class="ms-pal__foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span><span class="ms-pal__tip"><kbd>⌘K</kbd> opens this from anywhere. With text selected, <kbd>⌘K</kbd> adds a link instead.</span></footer>`;
    this.input = this.el.querySelector('input')!;
    this.list = this.el.querySelector('.ms-pal__list')!;
    this.input.addEventListener('input', () => {
      this.render();
      this.onState(true, this.input.value);
    });
    this.input.addEventListener('keydown', (e) => this.key(e));
    // a click on the dimmed page around the popup closes it
    this.el.addEventListener('mousedown', (e) => {
      if (e.target === this.el) this.close();
    });
    this.el.addEventListener('close', () => this.onState(false, ''));
    document.body.append(this.el);
  }

  /** the name a collection's entries are grouped under when they have no group of their own */
  collectionLabel: (id: string) => string = (id) => id;

  get isOpen(): boolean {
    return this.el.open;
  }

  setEntries(list: EntrySummary[]): void {
    this.entries = list;
    if (this.isOpen) this.render();
  }

  setCurrent(collection: string | null, id: string | null): void {
    this.current = collection && id ? keyOf({ collection, id }) : null;
  }

  open(q = ''): void {
    if (!this.isOpen) {
      modalize(this.el);
      this.el.showModal();
    }
    if (!this.entries.length && this.loader && !this.loading) {
      this.loading = true;
      this.loader().then(
        (list) => void ((this.loading = false), this.setEntries(list)),
        () => void (this.loading = false),
      );
    }
    if (this.input.value !== q || !this.rows.length) {
      this.input.value = q;
      this.render();
    }
    this.input.focus();
    this.onState(true, this.input.value);
  }

  close(): void {
    if (!this.isOpen) return;
    this.el.close();
    // at once (the dialog's close event comes a moment later): an entry opened from here must not inherit k=1
    this.onState(false, '');
  }

  private row(a: EntrySummary): HTMLElement {
    const row = document.createElement('div');
    row.className = 'ms-pal__row';
    row.setAttribute('role', 'option');
    row.id = `ms-pal-${a.collection}-${a.id}`;
    const title = document.createElement('span');
    title.className = 'ms-pal__title';
    title.textContent = a.title;
    const meta = document.createElement('span');
    meta.className = 'ms-pal__meta';
    if (a.url) meta.append(copyable(a.url, { label: 'page URL', copy: siteUrl(a.url), open: siteUrl(a.url), className: 'ms-copyable--url' }));
    if (a.status && a.status !== 'published') {
      // a held one says so, and why ("Scheduled, held: 1 image without a description"), and since when in its tooltip
      const held = a.status === 'scheduled' && a.held;
      const why = held ? a.held!.reasons.join('; ') || 'the publish rules stop it' : '';
      const s = Object.assign(document.createElement('span'), { className: `ms-pal__status${held ? ' is-held' : ''}`, textContent: held ? `Scheduled, held: ${why}` : a.status });
      if (held) s.title = `Held since ${fmtDateTime(a.held!.dueAt)}: ${why}. It goes live on the next scheduler run once that is fixed.`;
      meta.append(s);
    }
    if (a.group) meta.append(Object.assign(document.createElement('span'), { className: 'ms-pal__topic', textContent: a.group }));
    row.append(title, meta);
    if (keyOf(a) === this.current) row.append(Object.assign(document.createElement('span'), { className: 'ms-pal__badge', textContent: 'Open now' }));
    row.addEventListener('click', (e) => {
      if ((e.target as Element).closest('.ms-copyable__tools')) return;
      this.choose(a);
    });
    row.addEventListener('mousemove', () => this.highlight(this.rows.findIndex((r) => r.a === a), false));
    this.rows.push({ a, row });
    return row;
  }

  private screenRow(s: { label: string; href: string; hint: string }): HTMLElement {
    const row = document.createElement('div');
    row.className = 'ms-pal__row ms-pal__row--screen';
    row.setAttribute('role', 'option');
    row.id = `ms-pal-screen-${s.href.replace(/[^a-z0-9]+/gi, '-')}`;
    const title = document.createElement('span');
    title.className = 'ms-pal__title';
    title.textContent = s.label;
    const meta = document.createElement('span');
    meta.className = 'ms-pal__meta';
    meta.append(Object.assign(document.createElement('span'), { className: 'ms-pal__topic', textContent: s.hint }));
    row.append(title, meta);
    const index = this.rows.length;
    row.addEventListener('click', () => this.go(s.href));
    row.addEventListener('mousemove', () => this.highlight(index, false));
    this.rows.push({ a: null, go: s.href, row });
    return row;
  }

  private go(href: string): void {
    this.close();
    location.hash = href;
  }

  private head(text: string, icon?: string): HTMLElement {
    const p = document.createElement('p');
    p.className = 'ms-pal__group';
    p.innerHTML = icon ? ic(icon, 13) : '';
    p.append(text);
    return p;
  }

  private render(): void {
    this.rows = [];
    this.list.replaceChildren();
    const q = this.input.value.trim().toLowerCase();
    if (!q) {
      const byKey = new Map(this.entries.map((a) => [keyOf(a), a]));
      const recent = readRecent().map((s) => byKey.get(s)).filter((a): a is EntrySummary => !!a);
      if (recent.length) {
        this.list.append(this.head('Recent', 'clock'));
        for (const a of recent) this.list.append(this.row(a));
      }
      const groups = new Map<string, EntrySummary[]>();
      for (const a of this.entries) {
        const g = a.group || this.collectionLabel(a.collection);
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g)!.push(a);
      }
      for (const [g, list] of [...groups].sort(([x], [y]) => x.localeCompare(y))) {
        this.list.append(this.head(`${g} · ${list.length}`));
        for (const a of list) this.list.append(this.row(a));
      }
    } else {
      // the editor's own screens and settings, by their plain words (palette-screens.ts)
      const hits = searchScreens(q, viewerRole(), screenIndex(viewerRole(), screens()));
      if (hits.length) {
        this.list.append(this.head('Screens', 'sliders'));
        for (const s of hits) this.list.append(this.screenRow(s));
      }
      const words = q.split(/\s+/);
      const found = this.entries
        .filter((a) => {
          const hay = `${a.title} ${a.url ?? ''} ${a.id} ${a.group ?? ''}`.toLowerCase();
          return words.every((w) => hay.includes(w));
        })
        .map((a) => ({ a, s: score(a, q, words) }))
        .sort((x, y) => x.s - y.s || x.a.title.localeCompare(y.a.title));
      if (!found.length && !hits.length) {
        const none = document.createElement('p');
        none.className = 'ms-pal__empty';
        none.textContent = `Nothing matches “${this.input.value.trim()}”.`;
        this.list.append(none);
      }
      for (const { a } of found.slice(0, SHOWN_MAX)) this.list.append(this.row(a));
      if (found.length > SHOWN_MAX) {
        const more = document.createElement('p');
        more.className = 'ms-pal__empty';
        more.textContent = `${found.length - SHOWN_MAX} more: type more of the title to narrow it down.`;
        this.list.append(more);
      }
    }
    this.highlight(0);
    this.list.scrollTop = 0;
  }

  private highlight(n: number, scroll = true): void {
    if (!this.rows.length) {
      this.input.removeAttribute('aria-activedescendant');
      return;
    }
    this.active = Math.max(0, Math.min(n, this.rows.length - 1));
    this.rows.forEach(({ row }, i) => {
      row.classList.toggle('is-active', i === this.active);
      row.setAttribute('aria-selected', String(i === this.active));
    });
    const cur = this.rows[this.active].row;
    this.input.setAttribute('aria-activedescendant', cur.id);
    if (scroll) cur.scrollIntoView({ block: 'nearest' });
  }

  private key(e: KeyboardEvent): void {
    const n = this.rows.length;
    if (e.key === 'ArrowDown') this.highlight((this.active + 1) % Math.max(1, n));
    else if (e.key === 'ArrowUp') this.highlight((this.active - 1 + n) % Math.max(1, n));
    else if (e.key === 'PageDown') this.highlight(this.active + 8);
    else if (e.key === 'PageUp') this.highlight(this.active - 8);
    else if (e.key === 'Enter') {
      const r = this.rows[this.active];
      if (r?.go) this.go(r.go);
      else if (r?.a) this.choose(r.a);
    } else return;
    e.preventDefault();
  }

  private choose(a: EntrySummary): void {
    this.close();
    this.onChoose(a);
  }
}
