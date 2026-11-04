// The page editor: a JSON entry with sections (a marketing page) edited on the real rendered page. The page is drawn
// by the site in editor mode in a frame; text and rich text are edited where they stand (agent.ts), a section's other
// fields in the side panel from the schema (fields.ts, open only while a section is selected), the sections in the
// outline (outline.ts), and the page-level values in the shell's Page settings drawer (settings.ts). Saving sends
// only the changes made (core's JSON engine writes just those characters). The shell mounts it for
// #/p/<collection>/<id> (host.ts MountPageEditor).
import { ApiError, getEntry, type Entry } from '../api';
import { lockField, mayChange, mayChangeAll } from '../field-access';
import { toast } from '../host';
import { hasPageBox, setOpenPage, typeKey, valueAt } from '../page-types';
import { collection, config } from '../runtime';
import { pageBox } from '../settings/page-box';
import { topicBox } from '../settings/topic-box';
import { topicsOn } from '../topics';
import { h, iconBtn } from '../panel-form';
import { ic } from '../icons';
import { getSchema, saveChanges } from './api';
import { pagesAi } from './ai';
import { drawField, shapeKey, type FieldsCtx } from './fields';
import { PageFrame } from './frame';
import { frameFields } from './frame-fields';
import { CanvasDrop } from './canvas-drop';
import { copiesOf, detach, markerOf, syncedNote } from './library';
import { diffChanges, PageModel } from './model';
import { Outline, sectionKind, sectionLabel, sectionLock } from './outline';
import { place, type PlaceCtx } from './place';
import { sectionPicture } from './pictures';
import { WAIT_MS, WAIT_START, waitStep, waitWords, type WaitEvent, type WaitState } from './wait';
import { fieldOf, humanize, rootField } from './schema';
import { drawPageFields, pageSettings } from './settings';
import { PAGE_CSS } from './styles';
import type { BoundField, PageEditorHandle, PageHost } from './types';

export type { PageHost, PageEditorHandle } from './types';
export { pagePictures } from './pictures';

const sectionOfPath = (path: string) => {
  const m = /^sections\.(\d+)(?:\.|$)/.exec(path);
  return m ? Number(m[1]) : null;
};
const index = (v: string | undefined) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : null);

/** Keys a site keeps out of the editor (`hiddenFields` in its collection config): a key name, or a dotted path with * for list items. */
function hiddenMatcher(list: string[]): (path: string) => boolean {
  const names = new Set(list.filter((k) => !k.includes('.')));
  const paths = list.filter((k) => k.includes('.')).map((k) => new RegExp(`^${k.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\\.\*(?=\\\.|$)/g, '\\.\\d+').replace(/\*/g, '[^.]+')}$`));
  return (path) => names.has(path.slice(path.lastIndexOf('.') + 1)) || paths.some((re) => re.test(path));
}

/** What the person may change on the page (read-only, or a role that changes some fields only), for PageModel. */
function accessOf(e: Entry): Parameters<PageModel['setAccess']>[0] {
  if (mayChangeAll(e.can)) return null;
  const why = e.can?.edit === false ? 'You can read this page but not change it.' : null;
  return {
    may: (path) => mayChange(e.can, path),
    why: (path) => why ?? (path === 'sections' || path.startsWith('sections.') ? 'Your role can’t change this page’s sections.' : 'Your role can’t change this.'),
  };
}

export function mountPageEditor(host: HTMLElement, ctx: PageHost): PageEditorHandle {
  if (!document.getElementById('msp-style')) document.head.append(Object.assign(document.createElement('style'), { id: 'msp-style', textContent: PAGE_CSS }));
  let entry = ctx.entry;
  const model = new PageModel((entry.data ?? {}) as Record<string, unknown>, entry.version);
  model.setAccess(accessOf(entry));
  let root = rootField(null, model.data);
  let bound: BoundField[] = [];
  let shape = shapeKey(model.data);
  let saving = false;
  let destroyed = false;
  const info = collection(entry.collection) as (ReturnType<typeof collection> & { hiddenFields?: string[] }) | undefined;
  const hidden = hiddenMatcher(info?.hiddenFields ?? []);

  const params = () => ctx.params();
  const selected = () => index(params().sec);
  const adding = () => index(params().add);

  // --- layout: outline | page
  const wrap = h('div', 'msp');
  const side = h('aside', 'msp-side');
  const stage = h('div', 'msp-stage');
  stage.tabIndex = -1; // takes the keyboard back from the page (the frame's ⌘S)
  stage.append(h('p', 'msp-note', model.may('sections') ? 'Click any text on the page to edit it. Click a section, a picture or a link for its other fields.' : `${model.refuse('sections')} Click a section, a picture or a link to see its fields.`));
  wrap.append(side, stage);
  host.append(wrap);

  // --- while the page has not reported in (wait.ts): a quiet notice, one automatic retry, then Try again
  const waitEl = h('div', 'msp-wait');
  waitEl.setAttribute('role', 'status');
  let wait: WaitState = WAIT_START;
  let waitTimer = 0;
  function drawWait(): void {
    const w = waitWords(wait);
    waitEl.hidden = !w;
    waitEl.replaceChildren();
    if (!w) return;
    const box = h('div', 'msp-wait__box');
    if (!w.button) box.append(h('span', 'msp-wait__spin'));
    box.append(h('p', 'msp-wait__text', escapeHtml(w.text)));
    if (w.button) {
      const b = h('button', 'ms-btn ms-btn--sm', escapeHtml(w.button));
      b.type = 'button';
      b.addEventListener('click', () => waitOn('try-again'));
      box.append(b);
    }
    waitEl.append(box);
  }
  function waitOn(e: WaitEvent): void {
    if (destroyed) return;
    const r = waitStep(wait, e);
    wait = r.state;
    drawWait();
    window.clearTimeout(waitTimer);
    if (wait.phase === 'waiting') waitTimer = window.setTimeout(() => waitOn('timeout'), WAIT_MS);
    if (r.reload) void openFrame();
  }
  /** The frame on a fresh preview URL (in production: a fresh one-time ticket on the way in). */
  async function openFrame(): Promise<void> {
    try {
      const { url } = await ctx.previewUrl();
      if (destroyed) return;
      frame.open(url);
      waitOn('open');
      ctx.changed();
    } catch (err) {
      if (destroyed) return;
      ctx.setStatus('error');
      ctx.banner.show('error', `The page cannot be shown: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const outline = new Outline({
    model,
    collection: entry.collection,
    root: () => root,
    selected,
    select: (i) => select(i, null),
    adding,
    scroller: side,
    setAdding: (i) => {
      ctx.go({ add: i === null ? null : String(i), ins: null });
      outline.draw();
    },
    lockOpen: () => index(params().lock),
    setLockOpen: (i) => ctx.go({ lock: i === null ? null : String(i) }),
    place: (it, i) => void place(placeCtx, it, i),
    placing: () => params().ins ?? null,
    setPlacing: (id) => {
      ctx.go({ ins: id });
      outline.draw();
    },
  });
  const sectionAt = (i: number) => (model.get('sections') as Parameters<typeof sectionLabel>[0][] | undefined)?.[i];
  const placeCtx: PlaceCtx = {
    model,
    save: () => save(),
    refusal: () => refused,
    refresh: async () => {
      const fresh = await getEntry(entry.collection, entry.id);
      model.absorb((fresh.data ?? {}) as Record<string, unknown>, fresh.version);
    },
    select: (i) => select(i, null),
    done: () => {
      ctx.go({ add: null, ins: null });
      outline.draw();
    },
    label: (i) => sectionLabel(sectionAt(i), i),
  };
  // what the page is and how the site lays it out (settings/page-box.ts), above its sections; its type's locks
  // hold on the rows (page-types.ts lockRules), saved and pending
  const pageEdits = pageSettings(model, () => model.savedData);
  const box = hasPageBox(entry.collection) ? pageBox({ collection: entry.collection, edits: { get: pageEdits.get, set: pageEdits.set, may: (p) => model.may(p) }, id: () => entry.id, savedType: () => valueAt(model.savedData, typeKey()), dirty: () => model.dirty }) : null;
  setOpenPage('page', { collection: entry.collection, types: () => [valueAt(model.savedData, typeKey()), model.get(typeKey())] });
  const offBox = box ? model.onChange(() => box.sync()) : () => {};
  if (box) side.append(box.el);
  // its topic and links (settings/topic-box.ts), under it
  const topic = topicsOn(entry.collection) ? topicBox({ collection: entry.collection, id: () => entry.id }) : null;
  if (topic) side.append(topic.el);
  side.append(outline.el);
  const sideShown = () => wrap.classList.toggle('is-outline-hidden', params().o === '0');
  const toggle = iconBtn('layers', 'Show or hide the sections', () => {
    ctx.go({ o: params().o === '0' ? null : '0' });
    sideShown();
  });
  toggle.classList.add('msp-side__toggle');
  wrap.append(toggle);
  sideShown();

  // --- the page
  const inlineValues = () => Object.fromEntries(bound.filter((f) => f.kind === 'text' || f.kind === 'rich').map((f) => [f.path, model.get(f.path) ?? '']));
  // The page shows the file as it was drawn. Once sections were added, moved or deleted and the page not drawn again,
  // its paths name other sections than the entry's: nothing goes between the two until it is drawn again.
  const reshapes = (ch: (typeof model.changes)[number]) => (ch.op === 'remove' ? /^sections\.\d+$/.test(ch.path) : ch.path === 'sections');
  let drawnOld = false;
  let toldOutOfStep = false;
  const outOfStep = () => drawnOld || model.changes.some(reshapes);
  const frame = new PageFrame(stage, {
    ready: (fields) => {
      // the page's word on what it binds is a hint: only fields the editor's own schema has in a section (S2)
      bound = frameFields(fields, root, model.data, hidden);
      drawnOld = false;
      toldOutOfStep = false;
      // the fields the person may not change are not edited in place (a click shows them, greyed, in the panel)
      frame.post({ markstage: 'page:on', values: outOfStep() ? {} : inlineValues(), locked: bound.filter((f) => !model.may(f.path)).map((f) => f.path) });
      const sel = selected();
      if (params().f) frame.post({ markstage: 'page:reveal', path: params().f });
      else if (sel !== null) frame.post({ markstage: 'page:reveal', section: sel });
    },
    edit: (path, value) => {
      if (!bound.some((f) => f.path === path && (f.kind === 'text' || f.kind === 'rich'))) return;
      if (outOfStep()) {
        if (!toldOutOfStep) toast(drawnOld ? 'The page is being drawn again with its sections as they are now: type on it again in a moment.' : 'The page still shows the sections where they were: save (⌘S) and it is drawn again, then type on it. Or use the fields on the right.', 'info');
        toldOutOfStep = true;
        return;
      }
      model.change({ op: 'set', path, value });
      // the panel follows, but the caret stays on the page
      if (sectionOfPath(path) !== selected() || params().f !== path) select(sectionOfPath(path), path, false);
    },
    pick: (path) => {
      if (bound.some((f) => f.path === path)) select(sectionOfPath(path), path, false, true);
    },
    section: (i) => select(i, null, false),
    editing: (on) => {
      typing = on;
      redrawWhenIdle();
    },
    // ⌘S pressed on the page: a page can say so but not prove it (any script there can send it, S2), so it never
    // saves. The keyboard comes back to the editor, where the person's own ⌘S saves.
    save: () => {
      if (document.activeElement !== frame.el) return;
      stage.focus({ preventScroll: true });
      toast('Press ⌘S again to save.', 'info');
    },
    stale: () => siteChanged(),
    rects: (rects, height) => drop.rectsAre(rects, height),
    shown: () => waitOn('ready'),
    expired: () => waitOn('expired'),
  });
  stage.append(waitEl);
  drawWait();
  // a Library section dragged from the outline onto the page lands there (canvas-drop.ts)
  const drop = new CanvasDrop({
    stage,
    frame,
    model,
    item: (id) => outline.libItem(id),
    place: (it, i) => void place(placeCtx, it, i),
    label: placeCtx.label,
    lockOf: (i) => sectionLock(sectionAt(i)),
    outOfStep: () =>
      !outOfStep() ? null : drawnOld ? 'The page is being drawn again with its sections as they are now: drop it here in a moment.' : 'The page still shows the sections where they were: save (⌘S) first, then drop it here, or drop it in the Sections list.',
  });

  // The page is drawn again only when it must be, and never under the writer's hands. In dev the page skips the
  // dev server's reloads and says 'page:stale' instead (agent.ts). After a save whose changes were all typed in place
  // the page already shows them, so the notice that follows is our own save's and is let go; after any other save
  // the page is drawn again once that notice says the site has the new file (or after FRESH_MS without one, as on a
  // preview server); a notice at any other time is a change from elsewhere (another tab, an edit to the site's code).
  // The redraw waits until the writer has stopped typing on the page and paused for IDLE_MS.
  let typing = false;
  let lastEdit = 0;
  let stale = false;
  let idleTimer = 0;
  let freshTimer = 0;
  let awaitFresh = false;
  let ownSaveUntil = 0;
  const IDLE_MS = 1500;
  const FRESH_MS = 8000;
  const OWN_SAVE_MS = 15000;
  const shownInPlace = (ch: (typeof model.changes)[number]) => ch.op === 'set' && bound.some((f) => f.path === ch.path && (f.kind === 'text' || f.kind === 'rich'));
  function saved(sent: typeof model.changes): void {
    // the saved type's checks, and its locks alone now (the rows' pills)
    box?.recheck();
    topic?.recheck();
    outline.draw();
    if (sent.some(reshapes)) drawnOld = true;
    if (sent.every(shownInPlace)) {
      ownSaveUntil = Date.now() + OWN_SAVE_MS;
      return;
    }
    awaitFresh = true;
    window.clearTimeout(freshTimer);
    freshTimer = window.setTimeout(() => siteChanged(), FRESH_MS);
  }
  function siteChanged(): void {
    if (!awaitFresh && Date.now() < ownSaveUntil) return;
    awaitFresh = false;
    window.clearTimeout(freshTimer);
    stale = true;
    redrawWhenIdle();
  }
  function redrawWhenIdle(): void {
    window.clearTimeout(idleTimer);
    if (!stale || destroyed) return;
    const wait = lastEdit + IDLE_MS - Date.now();
    if (typing || wait > 0) {
      idleTimer = window.setTimeout(redrawWhenIdle, typing ? IDLE_MS : wait);
      return;
    }
    stale = false;
    frame.reload();
  }

  // --- the panel: a section's fields, open only while a section is selected
  const panel = ctx.panel;
  panel.innerHTML = `<header class="ms-panel__head"><h2 class="ms-panel__title"></h2><button type="button" class="ms-iconbtn ms-panel__close" aria-label="Close (Esc)" title="Close (Esc)">${ic('x', 16)}</button></header><div class="ms-panel__body msp-panel"></div>`;
  panel.setAttribute('aria-label', 'Section fields');
  panel.querySelector('.ms-panel__close')!.addEventListener('click', () => select(null, null));
  const onPanelKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    select(null, null);
  };
  panel.addEventListener('keydown', onPanelKey);
  const title = panel.querySelector<HTMLElement>('.ms-panel__title')!;
  const body = panel.querySelector<HTMLElement>('.ms-panel__body')!;
  let syncs: (() => void)[] = [];
  const open = new Set<string>();
  const mediaBase = (config().media?.url ?? '/').replace(/\/?$/, '/');
  const fctx: FieldsCtx = {
    model,
    get root() {
      return root;
    },
    entryUrl: entry.url ?? '/',
    entryId: entry.id,
    host: ctx,
    mediaUrl: (src) => (/^(https?:)?\/\//.test(src) || src.startsWith('/') ? src : mediaBase + src),
    open,
    hidden,
    restructure: () => drawPanel(),
    // AI alt text for image fields: its own params (suggest=alt&field=<path>)
    ai: pagesAi({
      params,
      go: (p, push) => ctx.go(p, push),
      redraw: () => syncs.forEach((s) => s()),
      entry: { collection: entry.collection, id: entry.id },
      readOnly: (path) => {
        const why = model.refuse(path);
        return why ? `${why} The suggestion can’t be used here.` : null;
      },
    }),
  };
  /** the params other than an AI suggestion's: when only that changes, the panel keeps its fields (and the focus) */
  const placeParams = () => JSON.stringify(Object.entries(params()).filter(([k]) => k !== 'suggest' && k !== 'field'));
  let drawnFor = placeParams();

  function showPanel(on: boolean): void {
    panel.classList.toggle('is-open', on);
    panel.inert = !on;
    panel.setAttribute('aria-hidden', String(!on));
  }

  function drawPanel(focus = false): void {
    drawnFor = placeParams();
    fctx.ai!.follow();
    syncs = [];
    body.replaceChildren();
    const sel = selected();
    const data = model.data;
    const list = Array.isArray(data.sections) ? (data.sections as { discriminant?: unknown }[]) : [];
    shape = shapeKey(model.data);
    if (sel === null || !list[sel]) {
      showPanel(false);
      return;
    }
    const kind = sectionKind(list[sel]);
    // the person may not change the sections: the panel shows the fields greyed out, with why once
    body.classList.remove('is-locked');
    const frozen = model.refuse('sections');
    if (frozen) lockField(body, frozen);
    title.innerHTML = `<span class="msp-panel__pic">${sectionPicture(kind)}</span><span></span>`;
    title.querySelector('span:last-child')!.textContent = `${humanize(kind)} section`;
    // a synced copy: where it comes from, and apply / undo / detach
    if (markerOf(list[sel])) {
      const note = syncedNote({ model, index: sel, entry: () => entry, save, reload });
      body.append(note.el);
      syncs.push(note.sync);
    }
    // the section's own fields, straight in the panel (its kind is the title)
    const f = fieldOf(root, `sections.${sel}.value`, data);
    if (f?.type === 'object') for (const [k, sub] of Object.entries(f.fields)) drawField(body, `sections.${sel}.value.${k}`, sub, k, fctx, syncs);
    else if (f) drawField(body, `sections.${sel}.value`, f, sel, fctx, syncs);
    showPanel(true);
    revealField(params().f, focus);
  }

  /** Opens the lists holding `path` and scrolls the panel to its field (`focus`: and puts the caret in it). */
  function revealField(path: string | undefined, focus = false): void {
    if (!path) return;
    let el: HTMLElement | null = null;
    for (let p = path; p; p = p.replace(/\.?[^.]+$/, '')) {
      el = body.querySelector<HTMLElement>(`[data-path="${CSS.escape(p)}"]`);
      if (el) break;
    }
    if (!el) return;
    for (let d = el.closest('details'); d; d = d.parentElement?.closest('details') ?? null) {
      (d as HTMLDetailsElement).open = true;
      if (d instanceof HTMLElement && d.dataset.path) open.add(d.dataset.path);
    }
    el.scrollIntoView({ block: 'nearest' });
    el.classList.remove('msp-flash');
    void el.offsetWidth;
    el.classList.add('msp-flash');
    if (focus) el.querySelector<HTMLElement>('input, textarea, select')?.focus({ preventScroll: true });
  }

  /**
   * Selects a section (and a field in it). `reveal`: scroll the page to it too; `focus`: put the caret in its panel
   * field (not while the writer types on the page).
   */
  function select(i: number | null, field: string | null, reveal = true, focus = reveal): void {
    const same = i === selected() && (field ?? undefined) === params().f;
    // an AI suggestion goes with the section it is in
    ctx.go({ sec: i === null ? null : String(i), f: field, ...(i === selected() ? {} : { suggest: null, field: null }) });
    if (!same) {
      outline.draw();
      drawPanel(focus && !!field);
    } else revealField(field ?? undefined, focus);
    if (reveal && field) frame.post({ markstage: 'page:reveal', path: field });
    else if (reveal && i !== null) frame.post({ markstage: 'page:reveal', section: i });
  }

  // --- changes
  model.onChange((why) => {
    lastEdit = Date.now();
    ctx.changed();
    const next = shapeKey(model.data);
    // a list or a section changed (or undo, or a fresh file): draw again; else just refresh the inputs and titles. A
    // list's own reorder, delete or duplicate (why 'list') draws its rows itself and keeps the focus on them.
    if (why === 'list') {
      shape = next;
      for (const s of syncs) s();
    } else if (next !== shape || why !== 'edit') drawPanel();
    else for (const s of syncs) s();
    outline.draw();
    if (!outOfStep()) frame.post({ markstage: 'page:values', values: inlineValues() });
  });

  /** the server's words for the last save it refused (place.ts takes a Library copy out again with them) */
  let refused: string | null = null;
  async function save(): Promise<boolean> {
    if (!model.dirty) return true;
    if (saving) return false;
    saving = true;
    refused = null;
    model.settle();
    const sent = model.changes;
    ctx.setStatus('saving');
    try {
      const r = await saveChanges(entry.collection, entry.id, sent, model.version);
      model.markSaved(sent, r.version);
      // saved from here too (Detach and save, Apply to every page), not only through the shell's Save
      ctx.setStatus('saved');
      ctx.banner.hide();
      ctx.changed();
      saved(sent);
      return true;
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 409 && err.code !== 'synced')) refused = err instanceof Error ? err.message : String(err);
      if (err instanceof ApiError && err.status === 409 && err.code === 'synced') {
        ctx.setStatus('error', err.message);
        syncedRefused(err);
      } else if (err instanceof ApiError && err.status === 409) {
        ctx.setStatus('conflict');
        ctx.onConflict(err.version);
      } else {
        ctx.setStatus('error', err instanceof Error ? err.message : String(err));
        ctx.banner.show('error', err instanceof Error ? err.message : String(err));
      }
      return false;
    } finally {
      saving = false;
    }
  }

  /** A save refused because a synced copy was changed in place: say so, show it, and offer to detach it and save. */
  function syncedRefused(err: ApiError): void {
    const id = err.data?.id;
    const at = typeof id === 'string' ? copiesOf(model, id) : [];
    const actions: [string, () => void, string?][] = [];
    if (at.length) actions.push(['Show it', () => select(at[0]!, null)]);
    if (at.length)
      actions.push([
        'Detach and save',
        () => {
          for (const i of at) detach(model, i, true);
          void save().then((ok) => ok && toast('Detached and saved: it is this page’s own section now.', 'ok'));
        },
        'ms-btn ms-btn--sm ms-btn--primary',
      ]);
    ctx.banner.show('error', err.message, actions);
  }

  function reload(fresh: typeof entry): void {
    entry = fresh;
    model.setAccess(accessOf(fresh));
    model.load((fresh.data ?? {}) as Record<string, unknown>, fresh.version);
    ctx.banner.hide();
    ctx.changed();
    frame.reload();
  }

  // ⌘Z / ⇧⌘Z (and Ctrl+Y) outside the fields, which keep their own undo: the page's changes, one step each
  const onUndoKey = (e: KeyboardEvent) => {
    const z = e.key.toLowerCase() === 'z';
    if (!(e.metaKey || e.ctrlKey) || e.altKey || !(z || (e.key.toLowerCase() === 'y' && e.ctrlKey)) || e.defaultPrevented) return;
    if ((e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable], dialog')) return;
    e.preventDefault();
    if (z && !e.shiftKey) model.undo();
    else model.redo();
  };
  document.addEventListener('keydown', onUndoKey);

  // the site's lock rules as the server has them now: the rows' pills follow
  const rulesRead = () => outline.draw();
  addEventListener('ms-lock-rules', rulesRead);

  // --- start
  ctx.setStatus('loading');
  outline.draw();
  drawPanel();
  getSchema(entry.collection)
    .then((s) => {
      if (destroyed) return;
      root = rootField(s, model.data);
      drawPanel();
    })
    .catch(() => {
      // keep the schema read from the entry
    });
  waitOn('open');
  void openFrame();

  return {
    save,
    dirty: () => model.dirty,
    undo: () => model.undo(),
    redo: () => model.redo(),
    reload,
    settings: pageSettings(model, () => model.savedData),
    drawSettings: (el, skip) => drawPageFields(el, fctx, model, skip),
    snapshot: () => ({ version: model.version, base: structuredClone(model.savedData), data: structuredClone(model.data) }),
    restore: (data) => {
      model.settle();
      model.changeMany(diffChanges(model.data, data));
    },
    onChange: (fn) => model.onChange(() => fn()),
    paramsChanged: () => {
      if (placeParams() === drawnFor) {
        fctx.ai!.follow();
        for (const s of syncs) s();
        return;
      }
      sideShown();
      outline.draw();
      drawPanel();
      const sel = selected();
      if (params().f) frame.post({ markstage: 'page:reveal', path: params().f });
      else if (sel !== null) frame.post({ markstage: 'page:reveal', section: sel });
    },
    destroy: () => {
      destroyed = true;
      fctx.ai!.destroy();
      outline.destroy();
      offBox();
      topic?.destroy();
      setOpenPage('page', null);
      drop.destroy();
      document.removeEventListener('keydown', onUndoKey);
      removeEventListener('ms-lock-rules', rulesRead);
      window.clearTimeout(idleTimer);
      window.clearTimeout(freshTimer);
      window.clearTimeout(waitTimer);
      frame.destroy();
      wrap.remove();
      panel.removeEventListener('keydown', onPanelKey);
      showPanel(false);
      panel.replaceChildren();
    },
  };
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
