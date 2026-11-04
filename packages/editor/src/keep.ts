// Never lose typing (docs/OPERATIONS.md):
//   - every change also goes to a recovery copy in this browser (recovery.ts); when the entry opens again with one,
//     a banner offers it: "Unsaved changes from 12:41 in this browser: Restore / Discard";
//   - a save that finds the file changed (409) merges: what only the other side changed comes in by itself, where
//     both changed the same block the picker asks (merge-ui.ts), then it saves; nothing typed is thrown away;
//   - a save that cannot reach the server keeps the text and saves again by itself when the connection is back.
import type { Editor, JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { changedLeaves, splitBlocks } from '@markstage/core';
import { ApiError, getEntry, getSource, type Entry } from './api';
import { merge3 } from './merge-ui';
import { dropCopy, getCopy, putCopy, type RecoveryCopy } from './recovery';
import { collection } from './runtime';
import type { Banner } from './shell';
import { toEditor } from './transform';
import { LOCALE } from './dates';

export interface KeepDeps {
  /** what tells this site's copies apart in the browser (the API prefix) */
  scope: string;
  entry(): Entry | null;
  editor(): Editor | null;
  /** the canvas document as last loaded or saved */
  savedDoc(): PMNode | null;
  inSource(): boolean;
  /** pages are kept by the pages editor itself */
  pageActive(): boolean;
  dirty(): boolean;
  /** the frontmatter as saved, and with the pending changes */
  fmSaved(): Record<string, unknown>;
  fmNow(): Record<string, unknown>;
  sourceText(): string;
  /** the file text the Source view started from */
  sourceBase(): string | null;
  /** the canvas shows `doc` (one undo step) and the pending frontmatter becomes `fm` */
  apply(doc: JSONContent | null, fm: Record<string, unknown> | undefined): void;
  /** the Source view shows `text` as unsaved changes on top of the file text `saved` */
  applySource(text: string, saved: string): Promise<void>;
  /** the file is newer: the entry's version, frontmatter and canvas base become the file's */
  adopt(fresh: Entry, base: PMNode | null, fileText?: string): void;
  save(): Promise<boolean>;
  /** the open entry again from the file (the writer's changes dropped) */
  reload(): void;
  banner: Banner;
}

/** A frontmatter path as the writer knows it from Post settings ("Search engines: title"), else the path. */
function label(collectionId: string, path: string): string {
  for (const f of collection(collectionId)?.settings ?? []) {
    if ('key' in f && f.key === path) return f.label;
    if ('title' in f && f.title === path) return `${f.label}: title`;
    if ('description' in f && f.description === path) return `${f.label}: description`;
  }
  return path;
}

const time = (ms: number) => {
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString(LOCALE, today ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

/** A block's words for the merge picker (an image: its alt text). */
function words(block: JSONContent): string {
  const out: string[] = [];
  const walk = (n: JSONContent) => {
    if (n.text) out.push(n.text);
    if (n.type === 'image' || n.type === 'figure') out.push(`[Image${n.attrs?.alt ? `: ${n.attrs.alt}` : ''}]`);
    n.content?.forEach(walk);
    if (n.type && /paragraph|heading|listItem|tableCell/.test(n.type)) out.push('\n');
  };
  walk(block);
  return out.join('').replace(/\n+/g, '\n').trim() || `(${block.type ?? 'block'})`;
}

export class Keeper {
  private timer = 0;
  private retry = 0;
  private offline = false;
  /** a copy offered and not answered yet: it stays while the writer has changed nothing */
  private offered: string | null = null;

  constructor(private d: KeepDeps) {
    // the last change before the tab goes away is written now, not after the pause
    addEventListener('pagehide', () => void this.flush());
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void this.flush());
    addEventListener('online', () => this.offline && void this.again());
  }

  private key(e = this.d.entry()): string | null {
    return e ? `${this.d.scope}${e.collection}/${e.id}` : null;
  }

  /** Something changed: the recovery copy follows (written after a short pause; dropped once nothing is unsaved). */
  note(): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), 400);
  }

  /** Writes the copy now. Resolves false when there are unsaved changes this browser could not keep (a page in the
   *  pages editor, which keeps no copy here, or no IndexedDB): leaving the page would lose them. */
  flush(): Promise<boolean> {
    clearTimeout(this.timer);
    const e = this.d.entry();
    const key = this.key(e);
    if (!e || !key) return Promise.resolve(true);
    if (this.d.pageActive()) return Promise.resolve(!this.d.dirty());
    // an offered copy is kept until the writer answers (Restore or Discard), whatever they type meanwhile
    if (this.offered === key) return Promise.resolve(true);
    if (!this.d.dirty()) return dropCopy(key).then(() => true);
    const base = { key, title: e.title, at: Date.now(), version: e.version };
    const ed = this.d.editor();
    if (this.d.inSource()) return putCopy({ ...base, view: 'source', sourceBase: this.d.sourceBase() ?? '', source: this.d.sourceText() });
    if (ed) return putCopy({ ...base, view: 'canvas', base: this.d.savedDoc()?.toJSON(), doc: ed.getJSON(), fmBase: this.d.fmSaved(), fm: this.d.fmNow() });
    return Promise.resolve(false);
  }

  /** The writer chose to drop their changes: the copy goes too. */
  drop(): void {
    clearTimeout(this.timer);
    const key = this.key();
    if (key) void dropCopy(key);
  }

  /** The entry just opened: a copy of unsaved changes from before is offered. */
  async offer(): Promise<void> {
    const e = this.d.entry();
    const key = this.key(e);
    if (!e || !key || this.d.pageActive()) return;
    const copy = await getCopy(key);
    if (!copy || this.key() !== key) return;
    const ed = this.d.editor();
    const same =
      copy.view === 'canvas'
        ? copy.version === e.version && !!ed && JSON.stringify(copy.doc) === JSON.stringify(ed.getJSON()) && !changedLeaves(this.d.fmSaved(), copy.fm ?? {}).length
        : copy.version === e.version && copy.source === copy.sourceBase;
    if (same) return void dropCopy(key);
    this.offered = key;
    const older = copy.version !== e.version ? ' The file changed since; restoring merges your changes into it.' : '';
    this.d.banner.show('info', [{ strong: `Unsaved changes from ${time(copy.at)}` }, ` in this browser.${older}`], [
      ['Restore', () => void this.restore(copy), 'ms-btn ms-btn--sm ms-btn--primary'],
      ['Discard', () => ((this.offered = null), this.d.banner.hide(), void dropCopy(key))],
    ]);
  }

  private async restore(copy: RecoveryCopy): Promise<void> {
    const e = this.d.entry();
    if (!e || this.key() !== copy.key) return;
    this.offered = null;
    this.d.banner.hide();
    if (copy.view === 'source') {
      const now = await getSource(e.collection, e.id);
      let text = copy.source ?? '';
      if (copy.version !== now.version) {
        const r = await merge3({ base: splitBlocks(copy.sourceBase ?? ''), mine: splitBlocks(text), theirs: splitBlocks(now.source), describe: (t) => t, label: (p) => p, theirsName: 'In the file now' });
        if (!r) return this.offer();
        text = `${r.blocks.join('\n\n')}\n`;
      }
      await this.d.applySource(text, now.source);
    } else {
      const ed = this.d.editor();
      if (!ed || !copy.doc) return;
      if (copy.version === e.version) this.d.apply(copy.doc, copy.fm);
      else {
        const r = await merge3({
          base: copy.base?.content ?? [],
          mine: copy.doc.content ?? [],
          theirs: ed.getJSON().content ?? [],
          fmBase: copy.fmBase,
          fmMine: copy.fm,
          fmTheirs: this.d.fmSaved(),
          describe: words,
          label: (p) => label(e.collection, p),
          theirsName: 'In the file now',
        });
        if (!r) return this.offer();
        this.d.apply({ type: 'doc', content: r.blocks }, r.fm);
      }
    }
    this.d.banner.show('info', 'Your unsaved changes are back. Save (⌘S) to keep them.');
  }

  /** A save failed: a newer file is merged, a lost connection is retried, anything else is said plainly. */
  async failed(err: unknown): Promise<void> {
    if (err instanceof ApiError && err.status === 409) return this.conflict();
    if (err instanceof ApiError && err.status === 0) {
      this.offline = true;
      void this.flush();
      this.d.banner.show('error', [{ strong: 'Not saved: the server cannot be reached.' }, ' Your changes are kept in this browser and saved by themselves when the connection is back.'], [
        ['Try now', () => void this.again(), 'ms-btn ms-btn--sm'],
      ]);
      clearInterval(this.retry);
      this.retry = window.setInterval(() => void this.again(), 15000);
      return;
    }
    this.d.banner.show('error', `Saving failed: ${(err as Error).message}`, [['Try again', () => (this.d.banner.hide(), void this.d.save())]]);
  }

  private async again(): Promise<void> {
    if (!this.d.dirty()) return this.online();
    if (await this.d.save()) this.online();
  }

  private online(): void {
    clearInterval(this.retry);
    if (!this.offline) return;
    this.offline = false;
    this.d.banner.hide();
  }

  /** The file changed since it was opened: merge the two and save; the picker asks where both changed one block. */
  private async conflict(): Promise<void> {
    const e = this.d.entry();
    const ed = this.d.editor();
    if (!e) return;
    try {
      const fresh = await getEntry(e.collection, e.id);
      if (this.d.entry() !== e) return;
      if (this.d.inSource()) {
        const now = await getSource(e.collection, e.id);
        const r = await merge3({ base: splitBlocks(this.d.sourceBase() ?? ''), mine: splitBlocks(this.d.sourceText()), theirs: splitBlocks(now.source), describe: (t) => t, label: (p) => p, theirsName: 'Saved meanwhile' });
        if (!r) return this.stuck();
        this.d.adopt({ ...fresh, version: now.version }, null, now.source);
        await this.d.applySource(`${r.blocks.join('\n\n')}\n`, now.source);
      } else {
        if (!ed || !fresh.doc) return this.stuck();
        const theirs = ed.schema.nodeFromJSON(toEditor(fresh.doc));
        const r = await merge3({
          base: this.d.savedDoc()?.toJSON().content ?? [],
          mine: ed.getJSON().content ?? [],
          theirs: theirs.toJSON().content ?? [],
          fmBase: this.d.fmSaved(),
          fmMine: this.d.fmNow(),
          fmTheirs: fresh.frontmatter ?? {},
          describe: words,
          label: (p) => label(e.collection, p),
          theirsName: 'Saved meanwhile',
        });
        if (!r) return this.stuck();
        this.d.adopt(fresh, theirs);
        this.d.apply({ type: 'doc', content: r.blocks }, r.fm);
      }
      if (await this.d.save()) this.d.banner.show('info', [{ strong: 'Merged with the changes saved meanwhile' }, ' and saved. Undo (⌘Z) takes the merge back.']);
    } catch (err) {
      this.d.banner.show('error', `The changes could not be merged: ${(err as Error).message}`, [['Try again', () => void this.conflict()]]);
    }
  }

  /** The writer put the merge off: their text stays, the choices stay offered. */
  private stuck(): void {
    this.d.banner.show('conflict', [{ strong: 'Someone else saved this entry' }, ' after you opened it. Your text is still here and kept in this browser.'], [
      ['Merge…', () => void this.conflict(), 'ms-btn ms-btn--sm ms-btn--primary'],
      ['Reload theirs (drop mine)', () => (this.drop(), this.d.reload()), 'ms-btn ms-btn--sm ms-btn--danger'],
    ]);
  }
}
