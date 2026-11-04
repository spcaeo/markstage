// Everything about the open entry's frontmatter on the canvas: the title edited in place, the head (byline, date,
// cover) drawn from the pending values and opening Post settings at their field, and the Post settings drawer (gear
// in the header, ?s=1). The changes stay pending (FrontmatterEdits) until the entry is saved with the canvas.
import type { Entry } from './api';
import { mayChange } from './field-access';
import { drawHead } from './head';
import { setOpenPage, typeKey, valueAt } from './page-types';
import { collection } from './runtime';
import { SettingsDrawer } from './settings/drawer';
import { FrontmatterEdits, getPath } from './settings/state';
import { titleElement } from './title';

export interface PostOpts {
  /** the right-column element the drawer draws into */
  drawerEl: HTMLElement;
  /** where the canvas head goes */
  headSlot: HTMLElement;
  /** the header's gear button */
  gear: HTMLButtonElement;
  /** Enter in the title: on to the first line of the text */
  toText: () => void;
  /** the drawer opened or closed (the URL and the block panel follow) */
  onToggle: (open: boolean) => void;
  /** something pending changed (status, header title) */
  onChange: () => void;
  /** the page's own element for a part of the head, when the canvas is drawn in the page (canvas.shell) */
  page?: (selector: string) => HTMLElement | null;
}

export class PostSettings {
  readonly edits = new FrontmatterEdits();
  readonly drawer: SettingsDrawer;
  private entry: Entry | null = null;
  private headTimer = 0;
  /** keys the head draws in place as they change (a cover's alt text, its focal point), with how it does */
  private live = new Map<string, () => void>();

  constructor(private o: PostOpts) {
    this.drawer = new SettingsDrawer(o.drawerEl, this.edits, () => this.close());
    o.gear.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    this.edits.onChange((path) => {
      o.onChange();
      // the head shows the pending byline, date and cover (not redrawn for the title: it is being typed in)
      if (path !== null && this.live.has(path)) this.live.get(path)!();
      else if (path !== null && path !== this.titleKey()) {
        clearTimeout(this.headTimer);
        this.headTimer = window.setTimeout(() => void this.drawHead(), 250);
      }
    });
  }

  get isOpen(): boolean {
    return this.drawer.isOpen;
  }

  get isDirty(): boolean {
    return this.edits.isDirty;
  }

  titleKey(): string {
    return (this.entry && collection(this.entry.collection)?.titleKey) || 'title';
  }

  /** The title as the writer sees it now. */
  title(): string {
    return this.entry ? String(this.edits.get(this.titleKey()) ?? this.entry.title) : '';
  }

  /** True when the open entry's collection has settings (the gear shows). */
  available(): boolean {
    return !!this.entry && this.drawer.has(this.entry.collection);
  }

  /** A new entry is open (or none). `frontmatter`: what its file (or the unsaved source) says. */
  load(entry: Entry | null, frontmatter: Record<string, unknown> = entry?.frontmatter ?? {}): void {
    this.entry = entry;
    this.edits.setRequired(entry ? (collection(entry.collection)?.required ?? []) : []);
    // a read-only entry, or a role that changes some fields only: the rest never becomes a change
    this.edits.setAccess(entry?.can ? (path) => mayChange(entry.can, path) : null);
    this.edits.reset(frontmatter);
    // the article's type, saved and pending: its locks hold on the padlocks (page-types.ts)
    setOpenPage('post', entry?.format === 'md' ? { collection: entry.collection, types: () => [valueAt(this.entry?.frontmatter, typeKey()), this.edits.get(typeKey())] } : null);
    this.drawer.setEntry(entry);
    if (entry) void this.drawHead();
    else this.o.headSlot.replaceChildren();
    if (!this.available()) this.close();
  }

  /**
   * After a save: the file's frontmatter now (changes typed meanwhile stay pending). `sent`: the changes the save
   * carried; a value the server wrote differently (a synced item's version it stamps) is the file's, not a change.
   */
  saved(frontmatter: Record<string, unknown>, url: string | null, sent?: Record<string, unknown>): void {
    if (!this.entry) return;
    const sentAs = (p: string) => JSON.stringify(getPath(sent ?? {}, p) ?? null);
    const typed = new Map(this.edits.changedPaths().filter((p) => !sent || JSON.stringify(this.edits.get(p) ?? null) !== sentAs(p)).map((p) => [p, this.edits.get(p)]));
    this.entry.frontmatter = frontmatter;
    this.entry.url = url;
    // the history stays (⌘Z after a save takes back a change, as on the canvas); what was typed meanwhile stays pending
    this.edits.reset(frontmatter, { keepHistory: true });
    for (const [p, v] of typed) this.edits.set(p, v, { record: false });
    this.drawer.setEntry(this.entry);
  }

  /** The canvas head, from the pending frontmatter. */
  async drawHead(): Promise<void> {
    const entry = this.entry;
    if (!entry) return;
    const editable = this.edits.may(this.titleKey());
    this.live.clear();
    await drawHead(this.o.headSlot, entry, {
      frontmatter: this.edits.merged(),
      title: (tag = 'h1', className = '') => titleElement(tag, className, { edits: this.edits, key: this.titleKey(), onEnter: this.o.toText, editable }),
      openSetting: (key) => this.open(key),
      edits: this.edits,
      live: (key, sync) => this.live.set(key, sync ?? (() => {})),
      page: this.o.page,
    });
  }

  /** Opens the drawer (at the field for `key`). */
  open(key?: string): void {
    if (!this.available()) return;
    const was = this.isOpen;
    this.drawer.show(true);
    this.o.gear.setAttribute('aria-expanded', 'true');
    this.o.gear.classList.add('is-on');
    if (!was) this.o.onToggle(true);
    requestAnimationFrame(() => this.drawer.focus(key));
  }

  close(): void {
    if (!this.isOpen) return;
    this.drawer.show(false);
    this.o.gear.setAttribute('aria-expanded', 'false');
    this.o.gear.classList.remove('is-on');
    this.o.onToggle(false);
  }
}
