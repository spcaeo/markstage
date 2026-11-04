// The Post settings drawer (gear in the header, ?s=1 in the URL): the collection's `settings` fields for the open
// entry, in the right column where the block settings panel goes (one of the two at a time). Changes are pending
// until the entry is saved (⌘S), together with the canvas; only the changed keys are written (setFrontmatter).
import type { AiEditor } from '../ai/editor';
import { listEntries } from '../api';
import { ic } from '../icons';
import { fieldName } from '../image-picker';
import { h } from '../panel-form';
import { hasPageBox, typeKey, valueAt } from '../page-types';
import { collection, config, type SettingField } from '../runtime';
import { drawField, type DrawnField, type FieldCtx } from './fields';
import { localesField } from './locales';
import { robotsField, wantsRobots } from './robots-field';
import { pageBox } from './page-box';
import { topicBox } from './topic-box';
import { topicsOn, type Suggestion } from '../topics';
import { seoField, socialField, type Fallbacks } from './previews';
import type { FrontmatterEdits } from './state';
import { undoKeys } from './undo-keys';

const keyOf = (f: SettingField) => ('key' in f ? f.key : f.title);
type DrawerEntry = { collection: string; id?: string; url: string | null; status?: string; frontmatter?: Record<string, unknown> };

export class SettingsDrawer {
  private body: HTMLElement;
  private fields: { def: SettingField; drawn: DrawnField }[] = [];
  private entry: DrawerEntry | null = null;
  private lists = new Map<string, Promise<{ id: string; title: string; tags?: string[] }[]>>();
  private mover: ((key: string, slug: string) => Promise<string | null>) | null = null;
  /** an image field's library chooser opens (its key) or closes (null): the URL follows */
  onLibrary: ((key: string | null) => void) | null = null;
  /** AI suggestions for the fields (alt text, a region's title and description) */
  ai: AiEditor | null = null;
  /** links a suggestion's words on the canvas (the topic part, topic-box.ts) */
  linkHere: ((s: Suggestion) => boolean) | null = null;
  private offTopics: (() => void) | null = null;

  constructor(
    readonly el: HTMLElement,
    private edits: FrontmatterEdits,
    private onClose: () => void,
  ) {
    el.innerHTML = `<header class="ms-panel__head"><h2 class="ms-panel__title">Post settings</h2><button type="button" class="ms-iconbtn ms-panel__close" aria-label="Close Post settings (Esc)" title="Close Post settings (Esc)">${ic('x', 16)}</button></header><div class="ms-panel__body ms-settings"></div>`;
    this.body = el.querySelector('.ms-panel__body')!;
    el.querySelector('.ms-panel__close')!.addEventListener('click', () => this.onClose());
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.onClose();
      }
    });
    edits.onChange(() => {
      for (const f of this.fields) f.drawn.sync();
    });
    undoKeys(el, edits);
    this.show(false);
  }

  get isOpen(): boolean {
    return this.el.classList.contains('is-open');
  }

  show(on: boolean): void {
    this.el.classList.toggle('is-open', on);
    this.el.inert = !on;
    this.el.setAttribute('aria-hidden', String(!on));
  }

  /** Moves the open entry so its address ends in a new slug (the server's move); null: the slug is saved with ⌘S. */
  setMover(fn: ((key: string, slug: string) => Promise<string | null>) | null): void {
    this.mover = fn;
    // an entry opened before the server was known gets the moving slug field now
    if (this.entry) this.setEntry(this.entry);
  }

  /** True when the collection has settings to show (or a frame or page type to choose). */
  has(collectionId: string): boolean {
    return !!collection(collectionId)?.settings?.length || hasPageBox(collectionId) || topicsOn(collectionId);
  }

  private list(c: string) {
    if (!this.lists.has(c)) this.lists.set(c, listEntries(c).catch(() => []));
    return this.lists.get(c)!;
  }

  /** Draws the fields for the open entry (or nothing). */
  setEntry(entry: DrawerEntry | null): void {
    this.entry = entry;
    this.fields = [];
    this.offTopics?.();
    this.offTopics = null;
    this.body.replaceChildren();
    if (!entry) return;
    const info = collection(entry.collection);
    const defs = info?.settings ?? [];
    const ctx: FieldCtx = {
      edits: this.edits,
      url: () => this.entry?.url ?? null,
      media: (src) => (/^(https?:)?\/\//.test(src) || src.startsWith('/') ? src : `${config().media?.url ?? '/'}${src}`),
      choices: async (c) => (await this.list(c)).map((e) => [e.id, e.title] as [string, string]),
      tags: async () => [...new Set((await this.list(entry.collection)).flatMap((e) => e.tags ?? []))].sort(),
      move: this.mover ? { live: () => this.entry?.status === 'published', id: () => this.entry?.id ?? '', run: this.mover } : undefined,
      fieldName: (key) => fieldName(entry.collection, key),
      library: (key, open) => (this.onLibrary ? this.onLibrary(open ? key : null) : open && void this.library(key)),
      ai: this.ai ?? undefined,
    };
    const seo = defs.find((d) => d.type === 'seo') as Extract<SettingField, { type: 'seo' }> | undefined;
    const fb: Fallbacks & { seoTitle?: string; seoDescription?: string } = {
      title: info?.titleKey ?? 'title',
      excerpt: (defs.find((d) => d.type === 'textarea') as { key: string } | undefined)?.key,
      image: (defs.find((d) => d.type === 'image') as { key: string } | undefined)?.key,
      seoTitle: seo?.title,
      seoDescription: seo?.description,
    };
    // what the page is and how the site lays it out (page-box.ts), first
    if (hasPageBox(entry.collection)) {
      const drawn = pageBox({ collection: entry.collection, edits: this.edits, id: () => this.entry?.id ?? null, savedType: () => valueAt(this.entry?.frontmatter, typeKey()), dirty: () => this.edits.isDirty });
      drawn.el.dataset.setting = 'page';
      this.fields.push({ def: { type: 'text', key: 'page', label: 'Page' }, drawn });
      this.body.append(drawn.el);
    }
    // its topic and its links (topic-box.ts), next
    if (topicsOn(entry.collection)) {
      const drawn = topicBox({ collection: entry.collection, id: () => this.entry?.id ?? null, linkHere: (s) => this.linkHere?.(s) ?? false });
      drawn.el.dataset.setting = 'topic-links';
      this.offTopics = drawn.destroy;
      this.fields.push({ def: { type: 'text', key: 'topic-links', label: 'Topic and links' }, drawn });
      this.body.append(drawn.el);
    }
    for (const def of defs) {
      const drawn = def.type === 'seo' ? seoField(def, ctx, fb) : def.type === 'social' ? socialField(def, ctx, fb) : drawField(def, ctx);
      if (!drawn) continue;
      drawn.el.dataset.setting = keyOf(def);
      this.fields.push({ def, drawn });
      this.body.append(drawn.el);
    }
    // "Hide from search engines", when the site names its robots key and no setting above is it
    const robots = wantsRobots(defs, !!info?.hasUrl);
    if (robots) {
      const drawn = robotsField(robots, ctx);
      drawn.el.dataset.setting = 'robots';
      this.fields.push({ def: { type: 'switch', key: robots, label: 'Hide from search engines' }, drawn });
      this.body.append(drawn.el);
    }
    const locales = config().locales;
    if (locales && locales.list.length > 1 && info?.hasUrl) {
      const drawn = localesField(locales, ctx, () => this.entry?.status, { title: fb.title ?? 'title', description: fb.seoDescription ?? fb.excerpt });
      drawn.el.dataset.setting = 'locales';
      this.fields.push({ def: { type: 'text', key: 'locales', label: 'Languages and regions' }, drawn });
      this.body.append(drawn.el);
    }
    this.body.append(Object.assign(h('p', 'ms-panel__note'), { textContent: 'Changes here are saved with the post (⌘S). Only the settings you change are rewritten in the file.' }));
  }

  /** Draws every field again from the values (and the URL: an AI suggestion shows or goes). */
  sync(): void {
    for (const f of this.fields) f.drawn.sync();
  }

  /** Opens the media library chooser of the image field for `key` (the URL says it is open). */
  async library(key: string): Promise<void> {
    await this.fields.find(({ def }) => keyOf(def) === key)?.drawn.library?.();
  }

  /** Puts the cursor in the field for frontmatter key `key` (or the first field). */
  focus(key?: string): void {
    const f = (key && this.fields.find(({ def }) => keyOf(def) === key || ('alt' in def && def.alt === key))) || this.fields[0];
    if (!f) return;
    f.drawn.el.scrollIntoView({ block: 'nearest' });
    f.drawn.focus();
  }
}
