// Markstage editor: start({ config, packs, markdown }) draws the page into #markstage. The canvas edits the entry
// in the site's own wrappers and styles; Source mode edits the file as written; every state is in the URL
// (router.ts). Loads and saves through the API (api.ts) with a version check on every write.
//
// Shortcuts: ⌘K / Ctrl+K opens the search, or, with text selected (or the cursor in a link), the link field;
// ⌘S saves; Esc closes the settings panel (or leaves the screen check); "/" on an empty line opens the block menu.
import { changedLeaves, readFrontmatter, setFrontmatter } from '@markstage/core';
import { Editor, type JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
/// <reference types="vite/client" />
import { ApiError, getEntry, getSource, listEntries, onUnauthorized, previewUrl, request, saveEntry, saveSource, type Entry } from './api';
import { BoxBehaviors } from './behaviors';
import { BlockMoves } from './blocks';
import { BodyLock } from './body-lock';
import { copyable, siteUrl } from './copy';
import { activeBlock, Decorations } from './decorations';
import { limitNote, mayChange, mayChangeAll } from './field-access';
import { BlockHandle } from './handle';
import { placeBoxChip } from './chip';
import { beforeSave } from './save-check';
import { showHint } from './hint';
import { cleanWordHtml } from './paste-word';
import { screen as screenDef, toast } from './host';
import { moveEntry, moveError, movedNote } from './move-entry';
import { ic } from './icons';
import { InsertMenu } from './inserter';
import { Keeper } from './keep';
import { closeChooser } from './library';
import { DevNote } from './dev-note';
import type { EditorPack } from './pack';
import { registerMenusScreen } from './menus';
import { NoticesBar } from './notices';
import { FindBar } from './find';
import { Outline } from './outline';
import { Padlocks } from './padlocks';
import { SyncedCopies } from './reusable/synced';
import { Presence } from './presence';
import { signInHere } from './signin';
import { SidePanels } from './side';
import { addSides } from './side-setup';
import { aiEditor } from './ai/editor';
import { SitePages } from './site-pages';
import { shellIndex } from './shell-index';
import { newable, registerNewScreen } from './new-entry';
import { EntryPalette, rememberRecent } from './palette';
import { PopupBadges } from './links';
import { linkWordsOnCanvas } from './link-words';
import { resolveTemps } from './images';
import { settled, uploading } from './media';
import { MoreMenu } from './more-menu';
import { foldedControls } from './fold';
import { pointPreview, scheduledPill } from './preview-link';
import { routeEditor } from './navigate';
import { wireShortcuts } from './shortcuts';
import { LinkPreview } from './link-preview';
import { type Drawer, type Me, whoAmI } from './nav';
import { mountHome } from './home';
import { collectionWord } from './shell-words';
import { mountSignedIn, skipHotReload, unreadCount } from './top-bar';
import { NO_SCREEN, ScreenCheck } from './screen-check';
import { applyTheme } from './theme';
import { PageHost } from './page-host';
import { Panel } from './panel';
import { PostSettings } from './post';
import { resizablePanels } from './resize';
import * as router from './router';
import { collection, editable, md, setEntryDir, setup, setViewer, viewerName, type ClientConfig, type MarkdownPack } from './runtime';
import { extensions } from './schema';
import { mdxUnreadable } from './mdx/entry';
import { WHOLE_DOC } from './mdx/nodes';
import { ask, Banner, buildShell, nothingOpen, STATUS_TEXT, type Status } from './shell';
import { PageShell } from './canvas-shell/page';
import { ScreenHost } from './screen-host';
import { SourceEditor } from './source';
import { Toolbar } from './toolbar';
import { refreshEditButton } from './edit-link';
import { sameContent, toContract, toEditor } from './transform';

export type { ClientConfig, MarkdownPack } from './runtime';
export * from './host';

// the admin screens (src/admin/**, when that folder is in the build), the Inbox, the Page tree and Site settings register themselves
import.meta.glob(['./admin/index.ts', './inbox/index.ts', './pages-tree/index.ts', './groups/index.ts', './edit-link/index.ts', './gallery/index.ts', './site-settings/index.ts', './environments/index.ts', './releases/index.ts', './snippets/index.ts', './reusable/index.ts', './translations/index.ts', './num-columns.ts'], { eager: true });
export type { EditorPack } from './pack';

export interface StartOptions {
  config: ClientConfig;
  /** the editor side of the site's block packs */
  packs?: EditorPack[];
  /** the Markdown side (the same codecs the server uses), for Source mode and Copy as Markdown */
  markdown?: MarkdownPack[];
  mount?: HTMLElement;
}

export function start(opts: StartOptions): void {
  setup(opts.config, opts.packs ?? [], opts.markdown ?? []);
  applyTheme();
  const cfg = opts.config;
  const app = opts.mount ?? document.getElementById('markstage')!;
  const editables = [...editable(), ...cfg.collections.filter((c) => c.format === 'json' && c.hasUrl && PageHost.available)];
  const noun = editables.length === 1 ? editables[0].label : 'Content';
  // what the drawer and Home list as content: the pages and the kinds of writing (not data such as authors)
  const kinds = editables.filter((c) => c.format === 'md' || collectionWord(c) === 'Pages');
  let drawer: Drawer | null = null;
  /** signed in with the Markstage server (not `astro dev`) */
  let server = false;
  let me: Me | null = null;
  let devNote: DevNote | null = null;
  const pages = new SitePages();
  const $ = buildShell(app, { siteName: cfg.siteName, noun: 'Search pages, posts, images and messages', articleClass: cfg.canvas.articleClass });
  const scroller = $('.ms-scroll');
  const sheet = $('.ms-sheet');
  const canvas = $('.ms-canvas');
  const chip = $('.ms-chip');
  const statusEl = $('.ms-status');
  const blank = $('.ms-blank');
  const sourceEl = $('.ms-source');
  const preview = $<HTMLAnchorElement>('[data-preview]');
  const banner = new Banner($('.ms-banner'));
  // who else has the entry open (server only, switched on in boot())
  const presence = new Presence($('.ms-presence'));
  /** the role this person was given while editing (presence.ts): Save asks before trying (QA N10) */
  let roleNow: string | null = null;
  presence.wire({ dirty: () => isDirty(), reload: () => entry && void load(entry.collection, entry.id), save: () => void save(), roleChanged: (role) => void ((roleNow = role), me?.user && setViewer({ role, name: me.user.email })) });

  let editor: Editor | null = null;
  let entry: Entry | null = null;
  /** the canvas document as last loaded or saved */
  let savedDoc: PMNode | null = null;
  /** the file text and its version, once fetched (Source mode, Copy as Markdown) */
  let fileText: string | null = null;
  /** the text the canvas document came from when it is not the file (source edits not saved yet) */
  let baseText: string | null = null;
  /** the source text made from the canvas on the last switch (unchanged = the canvas still holds it) */
  let derivedText: string | null = null;
  /** the canvas is older than the file (saved from Source mode) */
  let canvasStale = false;
  let status: Status = 'idle';
  let savedAt = 0;
  // false until the writer clicks or types in the canvas: no box is shown as selected before that
  let engaged = false;
  const getEditor = () => editor;
  const inSource = () => router.route().view === 'source';

  const inserter = new InsertMenu(getEditor);
  const handle = new BlockHandle(getEditor, inserter);
  const toolbar = new Toolbar(getEditor, scroller);
  const panel = new Panel($('.ms-panel:not(.ms-drawer):not(.ms-checks)'), getEditor, () => engaged);
  // the right column's own panels (side.ts, ?side=outline|seo|help), where Post settings go: one of them at a time
  const sides = new SidePanels(() => post.close(), () => renderHeader());
  const outline = new Outline($('.ms-outline-panel'), $<HTMLButtonElement>('[data-sections]'), getEditor, (open) => sides.toggled('outline', open));
  sides.add('outline', outline, $('[data-sections]'));
  const find = new FindBar($('.ms-find'), getEditor, (s) => router.go({ find: s }));
  const badges = new PopupBadges(canvas, sheet);
  new LinkPreview(sheet, {
    editor: getEditor,
    known: (path) => {
      const e = pages.at(path);
      return e ? { title: e.title, description: e.excerpt, tag: e.group ?? collection(e.collection)?.label, draft: e.status === 'draft' } : null;
    },
    edit: () => toolbar.editLink(),
    busy: (href) => toolbar.linkBusy(href),
  });
  const post = new PostSettings({
    drawerEl: $('.ms-drawer'),
    headSlot: $('.ms-headslot'),
    gear: $<HTMLButtonElement>('[data-settings]'),
    toText: () => {
      if (!editor) return;
      editor.chain().focus().setTextSelection(1).run();
      engage();
    },
    onToggle: (isOpen) => {
      if (isOpen) sides.close();
      router.go({ settings: isOpen });
      if (!isOpen && post.drawer.el.contains(document.activeElement)) editor?.view.focus();
      onChange();
    },
    onChange: () => {
      renderHeader();
      onChange();
      shell.changed();
    },
    page: (selector): HTMLElement | null => shell.pageElement(selector),
  });
  // the canvas inside the entry's real page, when the site turns it on (canvas.shell, docs/CANVAS-FIDELITY.md)
  const shell: PageShell = new PageShell({ sheet, article: $('.ms-sheet > article'), headSlot: $('.ms-headslot'), canvas, dirty: () => isDirty(), redrawHead: () => void post.drawHead(), editor: getEditor, frontmatter: () => post.edits.merged(), scroller, pageUrl: (e) => (e.url ? previewUrl(e.collection, e.id, e.url).then((r) => r.url) : Promise.resolve(null)) });
  // AI suggestions, each at its URL, next to the value it is for (ai/editor.ts)
  const ai = aiEditor({ getEditor, entry: () => entry, title: () => post.title(), edits: post.edits, canvas, redraw: () => (post.drawer.sync(), seo.refresh(), panel.update()) });
  // the writing help: "Improve with AI" at the end of the format bar (ai/rewrite.ts)
  toolbar.addTool(ai.rewriteButton);
  panel.altAi = (pos) => ai.panelAlt(pos);
  post.drawer.ai = ai;
  post.drawer.linkHere = linkWordsOnCanvas(getEditor);
  const { seo, help } = addSides(sides, $, { getEditor, entry: () => entry, post, pages, app, unsaved: () => isDirty(), renderHeader, ai });
  router.onChange(() => ai.follow());
  // the screen check: the page in a frame at a device's width (?device=), with its checks in the right column
  const check = new ScreenCheck($('.ms-devices'), $('.ms-checks'), cfg, {
    entry: () => entry,
    inSource,
    text: () => (editor ? `${post.title()}\n${editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', ' ')}` : ''),
    clear: () => {
      panel.close();
      post.close();
      handle.closeMenu();
    },
    shown: (open) => {
      showView();
      if (open) {
        toolbar.update();
        unsavedNotes();
      } else editor?.view.focus();
    },
    fail: (message) => banner.show('error', message),
  });
  const devices = check.stage;
  const showDevice = () => check.show();
  const devicesBtn = $<HTMLButtonElement>('[data-devices]');
  panel.suppressed = () => post.isOpen || devices.isOpen || sides.isOpen;
  resizablePanels(app, [panel.el, post.drawer.el, ...sides.els, devices.checks.el]);
  // an image field's media library has its address (?s=1&lib=<key>)
  post.drawer.onLibrary = (key) => {
    router.go({ lib: key });
    if (key) void post.drawer.library(key);
  };
  // the whole file is the person's only when every field is (not read-only, no role that changes some fields only)
  const source = new SourceEditor(sourceEl, () => onChange(), () => void save(), () => !mayChangeAll(entry?.can));
  // never lose typing: a recovery copy in this browser, merging a newer file, saving again when back online (keep.ts)
  const keep = new Keeper({
    scope: cfg.api,
    entry: () => entry,
    editor: getEditor,
    savedDoc: () => savedDoc,
    inSource,
    pageActive: () => pageHost.active,
    dirty: () => isDirty(),
    fmSaved: () => entry?.frontmatter ?? {},
    fmNow: () => post.edits.merged(),
    sourceText: () => source.text(),
    sourceBase: () => fileText,
    apply: (doc, fm) => {
      // the caret stays where the writer was (setContent alone puts it at the end and scrolls there)
      const at = editor?.state.selection;
      if (doc && at) editor?.chain().setContent(doc, { emitUpdate: true }).setTextSelection({ from: at.from, to: at.to }).setMeta(WHOLE_DOC, true).run();
      for (const [p, v] of fm ? changedLeaves(post.edits.merged(), fm) : []) post.edits.set(p, v ?? null);
      onChange();
    },
    applySource: async (text, saved) => {
      if (!inSource()) await setView('source');
      fileText = saved;
      source.load(text, saved);
      onChange();
    },
    adopt: (fresh, base, text) => {
      if (!entry) return;
      entry.version = fresh.version;
      if (base) savedDoc = base;
      fileText = text ?? null;
      baseText = null;
      post.saved(fresh.frontmatter ?? {}, fresh.url);
      setStatus('dirty');
    },
    save: () => save(),
    reload: () => entry && void load(entry.collection, entry.id),
    banner,
  });
  const palette = new EntryPalette(
    (e) => void open(e.collection, e.id, true),
    (isOpen, q) => router.go({ k: isOpen, q: isOpen ? q : '' }),
    noun,
  );
  palette.collectionLabel = (id) => collection(id)?.label ?? id;
  // the shared light index: the palette takes it when it first opens, never at boot (shell-index.ts)
  const { takeIndex, refreshList } = shellIndex(cfg, { palette, pages, setLinkTargets: (t) => toolbar.setLinkTargets(t), setCount: (k, n) => drawer?.setCount(k, n) });
  palette.loader = takeIndex;
  // a page (JSON entry with an address) opens in the pages editor (#/p/…); admin screens (#/users…) replace the canvas
  const pageHost = new PageHost({
    host: $('.ms-pagehost'),
    panel: $('.ms-pagepanel'),
    banner,
    setStatus: (s, text) => setStatus(s, text),
    previewUrl: (e) => previewUrl(e.collection, e.id, e.url ?? '/'),
    searchLinks: async (q) => pages.search(q),
    changed: () => {
      renderHeader();
      if (status !== 'saving' && status !== 'conflict' && status !== 'loading') setStatus(isDirty() ? 'dirty' : 'saved');
    },
  });
  const screens = new ScreenHost(app, $('.ms-screen'), cfg.siteName);
  // the "New" sheet (#/new/<collection>): a title (and what the site needs), then the new draft opens
  registerNewScreen({
    choices: async (c) => (await listEntries(c).catch(() => [])).map((e) => [e.id, e.title] as [string, string]),
    created: async (made) => {
      await refreshList();
      await open(made.collection, made.id);
    },
  });
  registerMenusScreen();
  const newBtn = $<HTMLAnchorElement>('[data-new]');
  /** where "New" starts a draft: the open entry's collection, else the first that takes new drafts */
  const newHref = () => {
    const c = (entry && newable().find((x) => x.id === entry!.collection)) ?? newable()[0];
    return c ? `#/new/${c.id}` : null;
  };
  resizablePanels(app, [$('.ms-pagepanel')]);
  // a request that finds no session goes to the sign-in screen (the server's), back here once signed in; once
  // signed in with an entry open, the sign-in comes over the editor instead (signin.ts)
  /** on the way to a sign-in provider, the unsaved changes kept in the recovery copy (signin.ts) */
  let leaving = false;
  function toSignIn(): boolean {
    // a public screen (setup, accept invite) stays where it is; true when it moved to sign-in
    const on = router.route().screen?.name;
    if (!screenDef('sign-in') || on === 'sign-in' || (on && screenDef(on)?.public)) return false;
    router.go({ screen: { name: 'sign-in', args: [] }, screenParams: { next: location.hash } }, true);
    screens.show(router.route());
    return true;
  }
  onUnauthorized(toSignIn);

  // ---------- status ----------
  function setStatus(s: Status, text?: string): void {
    status = s;
    statusEl.dataset.status = s;
    statusEl.title = statusEl.querySelector('.ms-status__text')!.textContent = text ?? STATUS_TEXT[s];
    unsavedNotes();
  }
  /** Where the page is shown outside the canvas, say when it does not have the unsaved changes. */
  function unsavedNotes(): void {
    const unsaved = isDirty();
    check.note(unsaved);
    preview.toggleAttribute('data-unsaved', unsaved);
    preview.title = unsaved
      ? 'Opens the page in a new tab. You have unsaved changes: the page shows the last saved version until you save (⌘S).'
      : 'Opens the page in a new tab, as visitors see it.';
  }
  const canvasDirty = () => !!editor && !!savedDoc && !sameContent(editor.state.doc, savedDoc);
  const isDirty = () =>
    inSource() ? source.isDirty() : pageHost.active ? pageHost.dirty() : canvasDirty() || post.isDirty || (baseText !== null && baseText !== fileText);

  /** True when it is fine to leave the open entry (saved, or the writer chose to save or discard). */
  async function canLeave(): Promise<boolean> {
    if (!isDirty()) return true;
    const choice = await ask('Unsaved changes', `Save your changes to “${entry?.title ?? 'this entry'}” before leaving it?`, [
      ['cancel', 'Keep editing'],
      ['discard', 'Discard changes', 'ms-btn ms-btn--danger'],
      ['save', 'Save', 'ms-btn ms-btn--primary'],
    ]);
    if (choice === 'save') return save();
    if (choice === 'discard') keep.drop();
    return choice === 'discard';
  }

  /** The writer chose (saved, discarded, or the changes went into a release): they are not asked about again. */
  function letGo(): void {
    savedDoc = editor?.state.doc ?? null;
    source.markSaved();
    baseText = fileText;
    if (pageHost.active) pageHost.close();
  }

  // ---------- header ----------
  /** The right column's panels apply: an article on the canvas (not Source mode, a screen check or a page). */
  function sidesFit(): boolean {
    return !!entry && entry.format !== 'json' && !pageHost.active && !inSource() && !devices.isOpen;
  }

  function renderHeader(): void {
    const pageMode = pageHost.active || (!!entry && entry.format === 'json');
    const title = $('.ms-head__title');
    title.textContent = entry ? (pageMode ? entry.title : post.title()) || 'Untitled' : cfg.siteName;
    // a long title is cut with an ellipsis: the whole of it in the tooltip (QA F41)
    title.title = entry ? title.textContent : '';
    const url = $('.ms-head__url');
    url.replaceChildren(entry?.url ? copyable(entry.url, { label: 'page URL', copy: siteUrl(entry.url), open: siteUrl(entry.url), className: 'ms-copyable--url' }) : '');
    preview.hidden = !entry?.url;
    if (entry?.url) pointPreview(preview, url, entry, server, () => entry);
    if (entry) scheduledPill(url, entry);
    for (const sel of ['[data-views]', '[data-more]']) $(sel).hidden = !entry;
    const screen = devices.isOpen;
    const sideOk = sidesFit();
    app.classList.toggle('has-entry', !!entry);
    app.classList.toggle('is-home', !entry && !screens.active);
    presence.follow(entry);
    help.sync(router.route().topic, router.route().hq);
    // the Library is the server's: not in astro dev; the guide opens on Home and the screens too
    sides.sync((n) => (n === 'help' ? sideOk || !entry || screens.active : sideOk && (n !== 'seo' || !!entry?.url) && (n !== 'library' || !!viewerName())));
    find.sync(sideOk ? router.route().find : null);
    const marked = sideOk && router.route().side === 'seo' && router.route().nofollow;
    canvas.classList.toggle('ms-mark-nofollow', marked);
    seo.markNofollow(marked);
    $('[data-settings]').hidden = !post.available() || inSource() || screen || pageMode;
    $<HTMLButtonElement>('[data-view="source"]').title = pageMode ? 'Edit the JSON file' : entry?.mdx ? 'Edit the MDX file' : 'Edit the Markdown file';
    $<HTMLButtonElement>('[data-view="visual"]').disabled = !!entry?.unreadable; // an MDX file the reader cannot read: Source only
    for (const sel of ['[data-undo]', '[data-redo]']) $(sel).hidden = screen;
    devicesBtn.hidden = !entry?.url || inSource();
    // with the server: the publish sheet of the open entry (its own screen)
    const publish = $<HTMLAnchorElement>('[data-publish]');
    publish.hidden = !entry || !server || !screenDef('publish');
    const nh = newHref();
    newBtn.hidden = !nh;
    if (nh) newBtn.href = nh;
    if (entry) publish.href = `#/publish/${entry.collection}/${entry.id}`;
    devicesBtn.classList.toggle('is-on', screen);
    devicesBtn.setAttribute('aria-pressed', String(screen));
    for (const b of app.querySelectorAll<HTMLButtonElement>('[data-view]')) {
      const on = (b.dataset.view === 'source') === inSource();
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    }
    if (!screens.active) document.title = entry ? `${(pageMode ? entry.title : post.title()) || 'Untitled'} · Markstage` : `${cfg.siteName} · Markstage`;
  }

  // ---------- the canvas ----------
  function engage(): void {
    if (engaged || !editor) return;
    engaged = true;
    canvas.classList.add('ms-engaged');
    onChange();
  }

  const placeChip = () => placeBoxChip(chip, sheet, editor && engaged && !inSource() ? editor : null, panel.hasSettings() && !panel.isOpen);

  function onChange(): void {
    keep.note();
    panel.update();
    toolbar.update();
    placeChip();
    badges.update();
    if (status !== 'saving' && status !== 'conflict' && status !== 'loading') setStatus(isDirty() ? 'dirty' : 'saved');
    // the selected block is part of the URL
    if (editor && !inSource() && (editor.view.hasFocus() || editor.state.selection instanceof NodeSelection)) {
      router.go({ block: activeBlock(editor.state)?.index ?? null });
    }
  }

  // the Library's synced copies (reusable/synced.ts): changed everywhere, this file too, so its blocks are the saved ones
  const synced = () =>
    SyncedCopies.on(sheet, { getEditor, edits: post.edits, entry: () => entry, adopted: (fresh, base) => entry && ((entry.version = fresh.version), (savedDoc = base), post.saved(fresh.frontmatter ?? {}, fresh.url), onChange()) });

  function createEditor(doc: JSONContent): Editor {
    editor?.destroy();
    canvas.replaceChildren();
    engaged = false;
    canvas.classList.remove('ms-engaged');
    const e = new Editor({
      element: canvas,
      extensions: [...extensions(), Decorations, BoxBehaviors, BodyLock, BlockMoves, handle.extension(), outline.extension(), seo.extension(), find.extension(), Padlocks.on(sheet, getEditor, post.edits).extension(), synced().extension()],
      content: doc,
      editable: mayChange(entry?.can, 'body'),
      editorProps: {
        attributes: { class: cfg.canvas.bodyClass, spellcheck: 'true', 'aria-label': 'Text of the entry' },
        // text from Word: its lists and headings made real, its office markup gone (QA N3)
        transformPastedHTML: cleanWordHtml,
        handleKeyDown: (view, ev) => {
          // "/" on an empty line opens the block menu (in a table cell, at the start of its words too)
          if (ev.key === '/' && !ev.metaKey && !ev.ctrlKey && inserter.openOnSlash(view)) {
            ev.preventDefault();
            return true;
          }
          // Esc closes the settings panel first (ProseMirror's own Esc selects the surrounding box)
          if (ev.key === 'Escape' && panel.isOpen) {
            panel.close();
            placeChip();
            return true;
          }
          // ⌘K with text selected (or in a link) is the link field; with nothing selected it is the search
          if (ev.key.toLowerCase() === 'k' && (ev.metaKey || ev.ctrlKey) && (!view.state.selection.empty || e.isActive('link'))) {
            ev.preventDefault();
            toolbar.editLink();
            return true;
          }
          return false;
        },
      },
      enableContentCheck: true,
      onContentError: ({ error }) => {
        banner.show('error', `This entry has content the editor does not know: ${error.message}. Nothing will be saved from it.`);
      },
    });
    e.on('transaction', onChange);
    e.on('update', () => (ai.update(), shell.changed()));
    e.on('focus', () => (engage(), toolbar.update()));
    e.on('blur', () => setTimeout(() => toolbar.update(), 0));
    return e;
  }

  /** Shows the canvas or the source (the URL's view) for the open entry. */
  function showView(): void {
    const src = inSource();
    sheet.hidden = !entry || src || pageHost.active;
    $('.ms-pagehost').hidden = !pageHost.active || src || devices.isOpen;
    sourceEl.hidden = !entry || !src;
    blank.hidden = !!entry;
    if (src) {
      panel.close();
      post.close();
      toolbar.update();
      handle.closeMenu();
    }
    if (src || !entry) devices.hide();
    scroller.hidden = devices.isOpen || (pageHost.active && !src);
    renderHeader();
    placeChip();
  }

  // ---------- open, load, save ----------
  async function open(c: string, id: string, push = false): Promise<void> {
    if (screens.active && !(await screens.canLeave())) return;
    if (screens.active) {
      router.go({ screen: null });
      screens.close();
      showView();
    }
    if (entry?.collection === c && entry.id === id && (editor || pageHost.active)) return;
    if (!(await canLeave())) {
      router.go({ collection: entry?.collection ?? null, id: entry?.id ?? null });
      return;
    }
    router.go({ collection: c, id, mode: collection(c)?.format === 'json' ? 'p' : 'e' }, push);
    await load(c, id);
  }

  /** The slug field's move (the server's): saved first, then moved; the editor follows to the new id. */
  async function moveTo(key: string, slug: string): Promise<string | null> {
    if (!entry) return 'Nothing is open.';
    if (isDirty() && !(await save())) return 'Save your changes first (⌘S), then change the address.';
    try {
      const { collection: c } = entry;
      const moved = await moveEntry(entry, key, slug);
      router.go({ collection: c, id: moved.id });
      await load(c, moved.id);
      void refreshList();
      toast(movedNote(moved), 'ok');
      // a live entry publishes: its job shows like a publish
      if (moved.job && screenDef('jobs')) location.hash = `#/jobs/${encodeURIComponent(moved.job)}`;
      return null;
    } catch (err) {
      return moveError(err);
    }
  }

  async function fetchSource(): Promise<string> {
    const s = await getSource(entry!.collection, entry!.id);
    if (s.version !== entry!.version) throw new ApiError('The file changed on disk since it was opened.', 409, s.version);
    fileText = s.source;
    return s.source;
  }

  async function load(c: string, id: string, keepBlock = router.route().block): Promise<void> {
    banner.hide();
    setStatus('loading');
    palette.setCurrent(c, id);
    more.close();
    try {
      // the link tools need the site's pages (the shared light index): fetched alongside the entry, once
      if (!pages.known) void takeIndex().catch(() => {});
      const e = await getEntry(c, id);
      const r = router.route();
      if (r.collection !== c || r.id !== id) return; // the writer moved on meanwhile
      if (e.format === 'json') return openPage(e);
      const unreadable = mdxUnreadable(e);
      if (e.format !== 'md' || !e.doc) throw new ApiError('This entry cannot be edited here.', 415);
      pageHost.close();
      if (r.mode !== 'e') router.go({ mode: 'e', extra: {} });
      entry = e;
      fileText = baseText = derivedText = null;
      canvasStale = false;
      setEntryDir(collection(c)?.dir ?? '', !!(e.mdx || collection(c)?.mdx));
      if (unreadable && !inSource()) router.go({ view: 'source' });
      post.load(e);
      check.reset();
      seo.reset();
      editor = createEditor(toEditor(e.doc));
      savedDoc = editor.state.doc;
      panel.setEntry(e.url);
      rememberRecent(c, id);
      if (inSource()) {
        source.load(await fetchSource());
      } else source.destroy();
      showView();
      void shell.open(e);
      setStatus('saved');
      void keep.offer();
      // "click any text to edit" only where the text is the person's to change
      if (mayChange(e.can, 'body')) showHint($('.ms-main'));
      if (router.route().device) void showDevice();
      if (router.route().settings && !inSource()) post.open();
      if (router.route().lib && !inSource()) void post.drawer.library(router.route().lib!);
      ai.follow();
      const note = unreadable ?? (e.can && !e.can.edit ? 'You can read this entry but not change it.' : limitNote(e.can));
      if (note) banner.show('info', note);
      if (inSource()) source.focus();
      else if (keepBlock !== null && Panel.selectBlock(editor, keepBlock)) engage();
      else if (keepBlock !== null) router.go({ block: null });
      else scroller.scrollTop = 0;
    } catch (err) {
      closeEntry();
      const notFound = err instanceof ApiError && (err.status === 404 || err.status === 403);
      blank.innerHTML = `<div class="ms-blank__box">${ic(notFound ? 'file' : 'alert', 28)}<h2>${notFound ? 'Not available' : 'Could not open this'}</h2><p></p></div>`;
      blank.querySelector('p')!.textContent = notFound ? 'This entry does not exist, or is not available to you.' : (err as Error).message;
      setStatus('error', notFound ? '' : 'Not opened');
    }
  }

  /** Nothing open: the canvas and the pages editor let go of the entry (Home, or an entry that did not open). */
  function closeEntry(): void {
    entry = null;
    pageHost.close();
    shell.close();
    editor?.destroy();
    editor = null;
    savedDoc = null;
    source.destroy();
    panel.setEntry(null);
    post.load(null);
    showView();
  }

  /** Home (#/): the entry closes (after the unsaved-changes question) and the home screen shows. */
  async function home(): Promise<void> {
    if (entry && isDirty() && !(await canLeave())) return void history.replaceState(null, '', `#/${entry.format === 'json' ? 'p' : 'e'}/${entry.collection}/${entry.id}`);
    if (entry) (letGo(), closeEntry());
    showHome();
  }

  function showHome(): void {
    panel.setEntry(null);
    if (!me?.user) return nothingOpen(blank, cfg.siteName, newHref(), () => palette.open());
    const mount = () => mountHome(blank, { me: me!.user!, siteName: cfg.siteName, entries: palette.entries, collections: kinds, newHref: newHref(), unread: () => unreadCount(me, server) });
    mount();
    // Home's Recent needs the entries: the shared light index, drawn in when it comes (if Home still shows)
    if (!palette.entries.length) void takeIndex().then(() => !entry && blank.classList.contains('is-home') && mount(), () => {});
  }

  /** A JSON entry: in the pages editor when it has a page and the editor is built in; otherwise not here. */
  function openPage(e: Entry): void {
    if (!e.url || !PageHost.available) throw new ApiError('This entry is data (JSON) without a page: it cannot be edited here yet.', 415);
    if (router.route().mode !== 'p') router.go({ mode: 'p' });
    editor?.destroy();
    editor = null;
    shell.close();
    savedDoc = null;
    entry = e;
    fileText = baseText = derivedText = null;
    post.load(null);
    panel.setEntry(null);
    check.reset();
    rememberRecent(e.collection, e.id);
    pageHost.open(e);
    if (inSource()) void fetchSource().then((t) => source.load(t));
    else source.destroy();
    showView();
    setStatus('saved');
    if (router.route().device) void showDevice();
    const note = e.can && !e.can.edit ? 'You can read this page but not change it.' : limitNote(e.can);
    if (note) banner.show('info', note);
  }

  /** The file text the canvas would save now (the source it came from, with the canvas's changes). */
  async function canvasText(): Promise<string> {
    const base = baseText ?? fileText ?? (await fetchSource());
    const text = md().docToMd(toContract(editor!.getJSON()) as never, base);
    const fm = post.edits.changes();
    return fm ? setFrontmatter(text, fm) : text;
  }

  async function save(): Promise<boolean> {
    if (pageHost.active) {
      // the dev server's reload after this write must not reload the editor (the guard below)
      savedAt = Date.now();
      const ok = !inSource() ? await pageHost.save() : entry ? await savePageSource(entry) : false;
      savedAt = Date.now();
      return ok;
    }
    if (!editor || !entry || status === 'saving' || status === 'conflict') return false;
    // a title past the limit is refused with the count (QA N11); after a role change the person is asked first (N10)
    const stop = await beforeSave(post.title().length, roleNow);
    if (stop.error) setStatus('error', stop.error);
    if (stop.error || stop.declined) return false;
    roleNow = null;
    if (uploading()) {
      setStatus(status, 'Waiting for the image upload…');
      await settled();
      if (!editor || !entry) return false;
    }
    resolveTemps(editor.view);
    const { collection: c, id } = entry;
    const src = inSource();
    const sentDoc = editor.state.doc;
    let sentFm: Record<string, unknown> | undefined;
    const fmBefore = post.isDirty || src || baseText !== null;
    setStatus('saving');
    try {
      savedAt = Date.now();
      let text: string | null = null;
      let res;
      if (src) {
        text = source.text();
        res = await saveSource(c, id, text, entry.version);
      } else if (baseText !== null && baseText !== fileText) {
        // the canvas holds source edits not saved yet (e.g. frontmatter): save the whole text
        text = await canvasText();
        res = await saveSource(c, id, text, entry.version);
      } else {
        // the document if it changed, and the frontmatter keys that changed
        sentFm = post.edits.changes();
        res = await saveEntry(c, id, canvasDirty() || !sentFm ? toContract(editor.getJSON()) : undefined, entry.version, sentFm);
      }
      if (entry?.collection !== c || entry.id !== id) return true;
      entry.version = res.version;
      if (src) {
        source.markSaved(text!);
        fileText = text;
        canvasStale = text !== derivedText;
        baseText = null;
      } else {
        savedDoc = sentDoc;
        fileText = text; // unknown after a canvas save (fetched again when needed)
        baseText = null;
        derivedText = null;
      }
      // the frontmatter (and with it the title, the address) may have changed: read the entry's head again
      if (fmBefore) {
        const fresh = await getEntry(c, id).catch(() => null);
        if (fresh && entry?.collection === c && entry.id === id) {
          entry.title = fresh.title;
          post.saved(fresh.frontmatter ?? {}, fresh.url, sentFm);
          panel.setEntry(fresh.url);
        }
      }
      if (devices.isOpen) void showDevice();
      if (shell.active && entry) void shell.open(entry);
      seo.saved();
      renderHeader();
      const n = res.changedBlocks;
      const parts = [n ? `${n} block${n === 1 ? '' : 's'} changed` : '', sentFm ? 'settings' : ''].filter(Boolean);
      setStatus(isDirty() ? 'dirty' : 'saved', isDirty() ? undefined : parts.length ? `Saved · ${parts.join(' and ')}` : 'Saved · no change');
      keep.note();
      if (!isDirty()) devNote?.saved();
      return true;
    } catch (err) {
      setStatus(err instanceof ApiError && err.status === 409 ? 'conflict' : 'error');
      void keep.failed(err);
      return false;
    }
  }

  /** A page's JSON file saved from Source; the pages editor gets the new entry when Visual comes back. */
  async function savePageSource(e: Entry): Promise<boolean> {
    if (status === 'saving' || !source.isDirty()) return true;
    setStatus('saving');
    try {
      const text = source.text();
      const res = await saveSource(e.collection, e.id, text, e.version);
      e.version = res.version;
      source.markSaved(text);
      fileText = text;
      setStatus('saved', res.changedBlocks ? 'Saved' : 'Saved · no change');
      return true;
    } catch (err) {
      setStatus(err instanceof ApiError && err.status === 409 ? 'conflict' : 'error');
      banner.show('error', `Saving failed: ${(err as Error).message}`);
      return false;
    }
  }

  /** Visual <-> Source for a page: the JSON file as written; unsaved changes are saved (or kept) first. */
  async function setPageView(view: 'source' | null): Promise<void> {
    if (!entry) return;
    const leaving = view === 'source' ? pageHost.dirty() : source.isDirty();
    if (leaving) {
      const choice = await ask('Unsaved changes', view === 'source' ? 'Save the page before showing its file?' : 'Save the file before going back to the page?', [
        ['cancel', 'Stay'],
        ['save', 'Save', 'ms-btn ms-btn--primary'],
      ]);
      if (choice !== 'save' || !(await save())) {
        router.go({ view: view === 'source' ? null : 'source' });
        return;
      }
    }
    router.go(view === 'source' ? { view: 'source', ...NO_SCREEN } : { view: null });
    if (view === 'source') {
      source.load(await getSource(entry.collection, entry.id).then((x) => ((fileText = x.source), x.source)));
      showView();
      source.focus();
    } else {
      source.destroy();
      await pageHost.reload();
      showView();
    }
  }

  // ---------- visual <-> source ----------
  async function setView(view: 'source' | null): Promise<void> {
    if (pageHost.active) return setPageView(view);
    if (!entry || !editor || (view === 'source') === source.active) {
      router.go({ view });
      showView();
      return;
    }
    try {
      if (view === 'source') {
        const saved = fileText ?? (await fetchSource());
        const text = canvasDirty() || baseText !== null || post.isDirty ? await canvasText() : saved;
        derivedText = text;
        // the source now holds the pending settings; the drawer starts again from it when the canvas comes back
        post.load(entry, readFrontmatter(saved));
        router.go({ view: 'source', ...NO_SCREEN });
        source.load(text, saved);
        showView();
        source.focus();
      } else {
        const text = source.text();
        if (text !== derivedText || canvasStale) {
          const before = md().rawHtmlOf(toContract(editor.getJSON()) as never, { mdx: false }).length;
          const doc = md().mdToDoc(text).doc;
          const after = md().rawHtmlOf(doc, { mdx: false }).length;
          const clean = text === fileText;
          editor = createEditor(toEditor(doc as JSONContent));
          if (clean) savedDoc = editor.state.doc;
          baseText = clean ? null : text;
          post.load(entry, readFrontmatter(text));
          canvasStale = false;
          if (after > before) {
            banner.show('info', `${after - before} part${after - before === 1 ? '' : 's'} of the Markdown ${after - before === 1 ? 'has' : 'have'} no block in the editor: ${after - before === 1 ? 'it shows' : 'they show'} as an HTML block and ${after - before === 1 ? 'is' : 'are'} saved exactly as written.`);
          }
        }
        source.destroy();
        router.go({ view: null });
        showView();
        editor.view.focus();
      }
      onChange();
    } catch (err) {
      router.go({ view: source.active ? 'source' : null });
      showView();
      banner.show('error', `Could not switch the view: ${(err as Error).message}`, [['Reload', () => void load(entry!.collection, entry!.id)]]);
    }
  }

  // ---------- more: download, copy as Markdown, import ----------
  const more = new MoreMenu({
    app,
    button: $<HTMLButtonElement>('[data-more]'),
    entry: () => entry,
    editor: getEditor,
    inSource,
    source,
    canvasText,
    isDirty,
    note: (text) => {
      setStatus(status, text);
      setTimeout(() => setStatus(status), 1800);
    },
    banner,
    importTo: () => (entry?.format === 'md' ? entry.collection : null) ?? editable()[0]?.id ?? null,
    history: () => (entry && server && screenDef('revisions') ? `#/revisions/${entry.collection}/${entry.id}` : null),
    themeHere: () => !me?.user,
    help: () => (sidesFit() ? () => help.open() : null),
    frontmatter: () => post.edits.merged(),
    pageData: () => pageHost.snapshot(),
    // the changes wait in a release now: not kept for recovery, not asked about, and the entry shows as saved
    released: async () => void (keep.drop(), letGo(), entry && (await load(entry.collection, entry.id))),
    // the entry is gone to the trash: nothing to keep or ask about; the menu then shows its list
    trashed: async () => void (keep.drop(), letGo(), closeEntry(), await refreshList().catch(() => {})),
    imported: async (made) => void (await refreshList(), await open(made.collection, made.id, true)),
    folded: () => foldedControls(app),
  });

  // ---------- wiring ----------
  $('[data-save]').addEventListener('click', () => void save());
  $('[data-search]').addEventListener('click', () => palette.open());
  devicesBtn.addEventListener('click', () => check.toggle());
  for (const b of app.querySelectorAll<HTMLButtonElement>('[data-view]')) {
    b.addEventListener('click', () => void setView(b.dataset.view === 'source' ? 'source' : null));
  }
  // the canvas narrows or widens as the settings panel slides: re-place the floating tools once it settles
  for (const side of [panel.el, post.drawer.el, ...sides.els])
    side.addEventListener('transitionend', (e) => {
      if (e.target === side && e.propertyName === 'transform') window.dispatchEvent(new Event('resize'));
    });
  chip.addEventListener('mousedown', (e) => e.preventDefault());
  chip.addEventListener('click', () => {
    if (!chip.classList.contains('is-action')) return;
    panel.reopen();
    placeChip();
  });
  $('[data-undo]').addEventListener('click', () => (inSource() ? source.undo() : pageHost.active ? pageHost.undo() : editor?.chain().focus().undo().run()));
  $('[data-redo]').addEventListener('click', () => (inSource() ? source.redo() : pageHost.active ? pageHost.redo() : editor?.chain().focus().redo().run()));
  wireShortcuts({
    save: () => save(),
    palette,
    find,
    findable: () => !!editor && !inSource() && !pageHost.active && !screens.active,
    help,
    // the guide opens beside an article, and on Home and the screens too (sides.sync says the same)
    helpFits: () => sidesFit() || !entry || screens.active,
    panel,
    closed: placeChip,
    post,
    devices,
    closeCheck: () => check.close(),
    isDirty: () => !leaving && isDirty(),
  });
  scroller.addEventListener(
    'scroll',
    () => {
      inserter.scrolled();
      handle.closeMenu();
      more.close();
    },
    { passive: true },
  );
  new ResizeObserver(() => placeChip()).observe(sheet);

  skipHotReload(() => isDirty() || status === 'saving' || Date.now() - savedAt < 15000);

  routeEditor({
    palette,
    screens,
    pageHost,
    afterScreen,
    isDirty,
    canLeave,
    letGo,
    load,
    home: () => void home(),
    setView,
    settings: (on) => (on ? post.open() : post.close()),
    renderHeader,
    library: (key) => void post.drawer.library(key),
    closeChooser,
    showDevice: () => void showDevice(),
    selectBlock: (b) => editor && Panel.selectBlock(editor, b) && engage(),
  });

  /** Back on the editor from a screen: the entry of the URL (already open, or opened now). */
  function afterScreen(r: router.Route): void {
    showView();
    if (r.collection && r.id && (r.collection !== entry?.collection || r.id !== entry?.id)) void load(r.collection, r.id, r.block);
    else if (!r.collection) void home();
  }

  async function boot(): Promise<void> {
    router.init(cfg.compat);
    // signed in (with the Markstage server, or astro dev's stand-in): the drawer of places and the person's menu
    me = await whoAmI();
    if (me?.devMode) devNote = new DevNote(statusEl, banner);
    server = !!me?.user && !me.devMode;
    let notices: NoticesBar | null = null;
    if (me?.user && server) {
      setViewer({ role: me.user.role, name: me.user.email });
      presence.on = true;
      signInHere(me.user.email, {
        here: () => !!entry && !screens.active,
        toScreen: toSignIn,
        back: () => (banner.hide(), presence.resume(), isDirty() && void save()),
        owner: me.user.role === 'owner',
        // signing in at a provider leaves the page: the unsaved changes go to the recovery copy first, and the
        // "leave the page?" question is not asked (the copy is offered when the entry opens again)
        leave: async () => {
          const kept = await keep.flush();
          if (kept) leaving = true;
          return kept;
        },
      });
      notices = new NoticesBar($('.ms-head'));
      // the site's "Edit this page" link looks for a cookie this sets (the session's lifetime, gone at sign-out)
      void refreshEditButton();
      post.drawer.setMover(moveTo);
    }
    if (me?.user) {
      drawer = mountSignedIn(app, $, me.user, { collections: kinds, newHref: newHref(), server, help, onRoute: router.onChange, afterRoute: () => void notices?.refresh() });
      drawer.update(router.route());
      void unreadCount(me, server).then((n) => n !== null && drawer?.setCount('inbox', n, true));
      renderHeader();
    }
    // the lists only for someone signed in (or astro dev's stand-in); anyone else goes to sign-in at once (QA F13)
    if (me && !me.user && toSignIn()) return;
    // the drawer's counts come alongside the screen, never before it (the screen's own requests start now)
    if (me?.user) void refreshList().catch((err) => banner.show('error', `The list did not load: ${(err as Error).message}`));
    const r = router.route();
    if (r.screen) {
      screens.show(r);
      if (!r.collection) return;
    }
    if (entry) return;
    if (r.collection && r.id) await load(r.collection, r.id, r.block);
    else {
      showView();
      showHome();
      if (!r.k && !me?.user) palette.open();
    }
    if (r.k) palette.open(r.q);
  }

  void boot();
}
