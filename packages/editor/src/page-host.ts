// Drives the pages editor (src/pages/**, host.ts PageEditor) for #/p/<collection>/<id>: mounts it in .ms-pagehost
// with the right column .ms-pagepanel, and gives the shell's Save, ⌘S, undo, the leave guard and the conflict
// banner to it. The pages editor is optional: without src/pages/index.ts a page opens as "not editable here".
/// <reference types="vite/client" />
import type { Entry } from './api';
import { getEntry } from './api';
import type { MountPageEditor, PageCtx, PageEditor, PageStatus } from './host';
import * as router from './router';
import type { Banner } from './shell';
import { mediaValue } from './assets';

const mods = import.meta.glob<{ mountPageEditor?: MountPageEditor }>('./pages/index.ts', { eager: true });
const mountPageEditor = Object.values(mods)[0]?.mountPageEditor ?? null;

export interface PageHostDeps {
  host: HTMLElement;
  panel: HTMLElement;
  banner: Banner;
  setStatus(s: PageStatus, text?: string): void;
  previewUrl(entry: Entry): Promise<{ url: string; live: boolean }>;
  searchLinks(q: string): Promise<{ href: string; label: string }[]>;
  /** after an edit, a save or a reload: the shell redraws its header and status */
  changed(): void;
}

export class PageHost {
  private ed: PageEditor | null = null;
  private entry: Entry | null = null;

  constructor(private d: PageHostDeps) {}

  /** The pages editor is part of this build. */
  static get available(): boolean {
    return mountPageEditor !== null;
  }

  get active(): boolean {
    return this.ed !== null;
  }

  open(entry: Entry): void {
    this.close();
    if (!mountPageEditor) return;
    this.entry = entry;
    this.d.host.hidden = false;
    const ctx: PageCtx = {
      entry,
      panel: this.d.panel,
      banner: this.d.banner,
      setStatus: (s, text) => this.d.setStatus(s, text),
      params: () => ({ ...router.route().extra }),
      go: (params, push = false) => {
        const extra = { ...router.route().extra };
        for (const [k, v] of Object.entries(params)) {
          if (v === null) delete extra[k];
          else extra[k] = v;
        }
        router.go({ extra }, push);
      },
      previewUrl: () => this.d.previewUrl(this.entry!),
      searchLinks: (q) => this.d.searchLinks(q),
      // the media library (upload, drop or paste inside it); the value is the path inside the media folder
      pickImage: async (current) => {
        const { chooseImage } = await import('./library');
        const m = await chooseImage();
        return m ? { src: mediaValue(m.path), alt: m.alt?.trim() || current?.alt || '' } : null;
      },
      changed: () => this.d.changed(),
      onConflict: () => this.conflict(),
    };
    this.ed = mountPageEditor(this.d.host, ctx);
  }

  close(): void {
    this.ed?.destroy();
    this.ed = null;
    this.entry = null;
    this.d.host.replaceChildren();
    this.d.host.hidden = true;
    this.d.panel.replaceChildren();
    this.d.panel.classList.remove('is-open');
  }

  /** Back or forward changed only the pages editor's own params. */
  paramsChanged(params: Record<string, string>): void {
    this.ed?.paramsChanged?.(params);
  }

  dirty = (): boolean => this.ed?.dirty() ?? false;
  snapshot = () => this.ed?.snapshot?.() ?? null;
  undo = (): void => this.ed?.undo?.();
  redo = (): void => this.ed?.redo?.();

  async save(): Promise<boolean> {
    if (!this.ed) return false;
    if (!this.ed.dirty()) return true;
    this.d.setStatus('saving');
    try {
      const ok = await this.ed.save();
      if (ok) this.d.setStatus('saved');
      this.d.changed();
      return ok;
    } catch (err) {
      this.d.setStatus('error');
      this.d.banner.show('error', `Saving failed: ${(err as Error).message}`, [['Try again', () => (this.d.banner.hide(), void this.save())]]);
      return false;
    }
  }

  /** Reads the entry again (after a conflict, or a save from Source) and hands it to the pages editor. */
  async reload(): Promise<void> {
    if (!this.ed || !this.entry) return;
    const fresh = await getEntry(this.entry.collection, this.entry.id);
    this.entry = fresh;
    this.d.banner.hide();
    this.ed.reload(fresh);
    this.d.setStatus('saved');
    this.d.changed();
  }

  private conflict(): void {
    this.d.setStatus('conflict');
    this.d.banner.show(
      'conflict',
      [{ strong: 'Someone else saved this page' }, ' (or the file changed on disk) after you opened it. Your changes were not saved. Reload to get the latest version; your unsaved changes will be lost.'],
      [
        ['Reload', () => void this.reload(), 'ms-btn ms-btn--sm ms-btn--primary'],
        ['Keep my changes open', () => this.d.banner.hide()],
      ],
    );
  }
}
