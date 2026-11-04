// The header's More menu: Duplicate (a draft copy, opened at once) and Move to the trash for the open entry, download
// the file, copy it (or the selected blocks) as Markdown, import a .md file as a new draft; the entry's history when
// the server keeps it. For a page (a JSON entry) only the copy, the trash, the download and history. Images & files
// are here too, so an entry's writer reaches them without leaving, and the "How do I…" guide.
import type { Editor } from '@tiptap/core';
import { downloadUrl, duplicateEntry, getEntry, importEntry, trashEntry, type Entry } from './api';
import { unpublish } from './admin/api';
import { ask } from './shell';
import { copyText } from './copy';
import { screen } from './host';
import { config, md, onServer, viewerRole } from './runtime';
import { toast } from './host';
import { Menu, type Banner } from './shell';
import { themeRow } from './theme';
import type { SourceEditor } from './source';
import { toContract } from './transform';
import { snippetsHere } from './snippets/api';
import { blocksDoc } from './snippets/save';
import { saveAsTemplate, saveToLibrary } from './reusable/save';
import { provideOpenEntry } from './releases/open-entry';

const EDITORS = ['owner', 'administrator', 'editor'];

export interface MoreDeps {
  app: HTMLElement;
  button: HTMLButtonElement;
  entry(): Entry | null;
  editor(): Editor | null;
  inSource(): boolean;
  source: SourceEditor;
  /** the file text the canvas would save now */
  canvasText(): Promise<string>;
  isDirty(): boolean;
  /** a short note in the status pill */
  note(text: string): void;
  banner: Banner;
  /** the collection a .md import goes to */
  importTo(): string | null;
  /** opens the imported entry */
  imported(made: Entry): Promise<void>;
  /** the address of the entry's history (revisions), when the server has it */
  history(): string | null;
  /** the theme switch goes here (no person's menu) */
  themeHere(): boolean;
  /** opens the "How do I…" guide, where it applies */
  help(): (() => void) | null;
  /** the entry's settings as they are now (a template keeps them) */
  frontmatter(): Record<string, unknown>;
  /** a page's data as it is now, unsaved changes and all, with the version it was read at */
  pageData(): { version: string; data: Record<string, unknown> } | null;
  /** the unsaved changes went into a release: drop them, and show the entry as saved */
  released(): Promise<void>;
  /** the open entry went to the trash: let go of it (the menu then shows its list) */
  trashed(entry: Entry): Promise<void>;
  /** the header controls a narrow screen folded away (chrome.css [data-fold]): shown here instead */
  folded(): FoldedControl[];
}

export interface FoldedControl {
  label: string;
  icon?: string;
  /** a pressed toggle (Outline, SEO, the screen check) */
  on?: boolean;
  run(): void;
}

export class MoreMenu {
  private menu: Menu;
  /** where the entry was open when Add to a release was chosen (its section, view…): the add screen comes back there */
  private from = '';
  private file = Object.assign(document.createElement('input'), { type: 'file', accept: '.md,.markdown,text/markdown,text/plain', hidden: true });

  constructor(private d: MoreDeps) {
    this.menu = new Menu(d.button, 'More actions');
    d.app.append(this.file);
    this.file.addEventListener('change', () => void this.import());
    d.button.addEventListener('click', () => (this.menu.isOpen ? this.menu.close() : this.open()));
    // Add to a release (releases/add.ts) takes the open entry's unsaved changes from here
    provideOpenEntry(() => {
      const e = d.entry();
      if (!e) return null;
      const page = e.format === 'json' && !d.inSource() ? d.pageData() : null;
      const here = `#/${e.format === 'json' ? 'p' : 'e'}/${encodeURIComponent(e.collection)}/${encodeURIComponent(e.id)}`;
      return {
        collection: e.collection,
        id: e.id,
        title: e.title,
        version: page?.version ?? e.version,
        hash: this.from.split('?')[0] === here ? this.from : here,
        dirty: d.isDirty(),
        content: async () => (d.inSource() ? { source: d.source.text() } : page ? { data: page.data } : { source: await d.canvasText() }),
        release: () => d.released(),
      };
    });
  }

  close(): void {
    this.menu.close();
  }

  private open(): void {
    this.menu.open((m) => {
      const e = this.d.entry();
      if (!e) return;
      const ext = e.format === 'json' ? 'json' : 'md';
      // a narrow screen: what the header could not fit comes first
      const folded = this.d.folded();
      for (const f of folded) {
        const b = m.item(f.label, f.run, { icon: f.icon, cls: 'ms-menu__item--folded' });
        if (f.on !== undefined) b.setAttribute('aria-pressed', String(f.on));
      }
      if (folded.length) m.el.append(Object.assign(document.createElement('hr'), { className: 'ms-menu__rule' }));
      // the entry itself first: a copy to start from, or the trash (the server decides who may)
      if (onServer() && e.can?.edit !== false) m.item('Duplicate…', () => void this.duplicate(e), { icon: 'duplicate' });
      if (onServer() && e.can?.delete) m.item('Move to the trash…', () => void this.trash(e), { icon: 'trash' });
      if (onServer() && e.status === 'scheduled' && e.can?.publish) m.item('Cancel the schedule…', () => void this.unschedule(e), { icon: 'calendar' });
      const dl = m.item(`Download .${ext}`, () => {
        const a = Object.assign(document.createElement('a'), { href: downloadUrl(e.collection, e.id), download: `${e.id}.${ext}` });
        a.click();
      }, { icon: 'download' });
      if (this.d.isDirty()) dl.title = 'Downloads the saved file (your unsaved changes are not in it).';
      const history = this.d.history();
      if (history) m.item('History: earlier versions…', () => (location.hash = history), { icon: 'history' });
      const q = `c=${encodeURIComponent(e.collection)}&id=${encodeURIComponent(e.id)}`;
      if (screen('releases') && e.can?.edit !== false) m.item(this.d.isDirty() ? 'Add with my changes to a release…' : 'Add to a release…', () => ((this.from = location.hash), (location.hash = `#/releases/add?${q}`)), { icon: 'rocket' });
      if (screen('share') && e.status !== 'published' && e.url && e.can?.edit !== false) m.item('Share links…', () => (location.hash = `#/share/${encodeURIComponent(e.collection)}/${encodeURIComponent(e.id)}`), { icon: 'link' });
      if (e.format !== 'json') {
        m.item(this.selected() ? 'Copy selection as Markdown' : 'Copy as Markdown', () => void this.copy(), { icon: 'markdown' });
        m.item('Import .md as a new draft…', () => this.file.click(), { icon: 'upload' });
        const editor = this.d.editor();
        if (editor && !this.d.inSource() && snippetsHere()) {
          const { $from, $to } = editor.state.selection;
          const [from, to] = [$from.index(0), $to.index(0)];
          m.item(editor.state.selection.empty ? 'Save this block to Library…' : `Save ${to - from + 1 === 1 ? 'the selected block' : `${to - from + 1} selected blocks`} to Library…`, () => saveToLibrary(editor, blocksDoc(editor, from, to), to - from + 1), { icon: 'copy' });
          if (EDITORS.includes(viewerRole())) m.item('Save page as template…', () => saveAsTemplate(e, { frontmatter: this.d.frontmatter(), doc: toContract(editor.getJSON()) }, () => editor.view.focus()), { icon: 'blocks' });
        }
      }
      // a page (its sections): kept as saved, read again here
      if (e.format === 'json' && snippetsHere() && EDITORS.includes(viewerRole()))
        m.item('Save page as template…', () => void getEntry(e.collection, e.id).then((x) => saveAsTemplate(e, { data: x.data ?? {} }, () => undefined, this.d.isDirty()), (err) => this.d.note(`Not read: ${(err as Error).message}`)), { icon: 'blocks' });
      if (snippetsHere()) m.item('Reusable sections', () => (location.hash = '#/library'), { icon: 'blocks' });
      if (screen('media')) m.item('Images & files', () => (location.hash = '#/media'), { icon: 'image' });
      if (screen('menus')) m.item('Site menus', () => (location.hash = '#/menus'), { icon: 'list' });
      // the screens the drawer keeps under More tools, for the roles they are for
      const may = (name: string) => !!screen(name) && (!screen(name)!.roles || screen(name)!.roles!.includes(viewerRole()));
      if (may('taxonomy')) m.item('Categories and tags', () => (location.hash = '#/taxonomy'), { icon: 'list' });
      if (may('authors') && config().authors) m.item('Authors', () => (location.hash = '#/authors'), { icon: 'user' });
      // the site's topics and its internal links (docs/API-LINKS.md)
      if (may('links') && config().topics) m.item('Links between pages', () => (location.hash = '#/links'), { icon: 'link' });
      if (may('topic-map') && config().topics) m.item('Topic map', () => (location.hash = '#/topic-map'), { icon: 'layers' });
      // what each region still needs in its own words, on a site whose regions take a title or description
      if (may('translations') && config().locales?.list.some((l) => !l.default && l.overrides.some((f) => f === 'title' || f === 'description')))
        m.item('Languages', () => (location.hash = '#/translations'), { icon: 'globe' });
      if (may('settings')) m.item('Lock rules', () => (location.hash = '#/settings/locks'), { icon: 'lock' });
      const help = this.d.help();
      if (help) m.item('How do I…', help, { icon: 'info' });
      // the editor's colours (with the server they are in the person's menu instead)
      if (this.d.themeHere()) m.el.append(themeRow());
    }, true);
  }

  /** The selected top-level blocks as Markdown, or '' when nothing is selected. */
  private selected(): string {
    if (this.d.inSource()) return this.d.source.selection();
    const editor = this.d.editor();
    if (!editor || editor.state.selection.empty) return '';
    const { $from, $to } = editor.state.selection;
    const nodes = (editor.getJSON().content ?? []).slice($from.index(0), $to.index(0) + 1);
    return md().printBlocks(toContract({ type: 'doc', content: nodes }).content as never);
  }

  private async copy(): Promise<void> {
    try {
      const part = this.selected();
      await copyText(part || (this.d.inSource() ? this.d.source.text() : await this.d.canvasText()));
      this.d.note(part ? 'Copied the selection as Markdown' : 'Copied the whole file as Markdown');
    } catch (err) {
      this.d.banner.show('error', `Could not copy: ${(err as Error).message}`);
    }
  }

  /** A draft copy ("<title> (copy)"), opened in place of this one; the unsaved changes here stay here. */
  private async duplicate(e: Entry): Promise<void> {
    const go = await ask(`Duplicate “${e.title}”?`, `A draft copy called “${e.title} (copy)” opens, with everything this one has as saved${this.d.isDirty() ? ' (your unsaved changes stay here)' : ''}.`, [['cancel', 'Cancel'], ['go', 'Duplicate', 'ms-btn ms-btn--primary']]);
    if (go !== 'go') return;
    try {
      const made = await duplicateEntry(e.collection, e.id);
      await this.d.imported(made);
      this.d.banner.show('info', `This is the copy, “${made.title}”, saved as a draft.`);
    } catch (err) {
      this.d.banner.show('error', `Not copied: ${(err as Error).message}`);
    }
  }

  /** A scheduled entry back to a draft: it does not go live at that time (QA F9). */
  private async unschedule(e: Entry): Promise<void> {
    const go = await ask('Cancel the schedule?', `“${e.title}” does not go live at that time. It is a draft again, with its text as it is.`, [['cancel', 'Keep the schedule'], ['go', 'Cancel the schedule', 'ms-btn ms-btn--danger']]);
    if (go !== 'go') return;
    try {
      await unpublish(e.collection, e.id, e.version);
      await this.d.imported(e);
      this.d.banner.show('info', 'The schedule is cancelled: it is a draft again.');
    } catch (err) {
      this.d.banner.show('error', `The schedule was not cancelled: ${(err as Error).message}`);
    }
  }

  /** To the trash, where it can be brought back as a draft; a live one leaves the site. */
  private async trash(e: Entry): Promise<void> {
    const live = e.status === 'published';
    const go = await ask(`Move “${e.title}” to the trash?`, `${live ? 'It leaves the site. ' : ''}It waits in the trash, where it can be brought back as a draft.${this.d.isDirty() ? ' Your unsaved changes are lost.' : ''}`, [['cancel', 'Cancel'], ['go', 'Move to the trash', 'ms-btn ms-btn--danger']]);
    if (go !== 'go') return;
    try {
      await trashEntry(e.collection, e.id, e.version);
      await this.d.trashed(e);
      // the list opens first (opening a screen clears the toasts), then the note
      const arrived = new Promise<void>((resolve) => window.addEventListener('hashchange', () => resolve(), { once: true }));
      location.hash = `#/entries?c=${encodeURIComponent(e.collection)}`;
      await arrived;
      toast(`“${e.title}” is in the trash. Bring it back from Trash if you need it.`, 'ok');
    } catch (err) {
      this.d.banner.show('error', `Not moved to the trash: ${(err as Error).message}`);
    }
  }

  private async import(): Promise<void> {
    const file = this.file.files?.[0];
    this.file.value = '';
    const c = this.d.importTo();
    if (!file || !c) return;
    try {
      const made = await importEntry(c, file.name, await file.text());
      await this.d.imported(made);
      this.d.banner.show('info', `Imported “${made.title}” as a new draft.`);
    } catch (err) {
      this.d.banner.show('error', `Import failed: ${(err as Error).message}`);
    }
  }
}
