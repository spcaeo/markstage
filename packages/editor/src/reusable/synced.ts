// Synced Library items on the article's canvas. The entry lists them in its frontmatter (`synced: [{id, version}]`) and
// holds each as an ordinary copy of the item's blocks (docs/API-LIBRARY.md "Synced items"); the server finds a copy by
// its exact text, so the canvas finds it the same way, block for block. A copy gets a "Synced: <name>" pill just above
// it, or the nearest place that covers no text and no control, and a tint. Typing in it asks first: "This changes N pages":
// edit it everywhere (the pill then says so, and Apply sends the new blocks to every page, this one too), or detach
// it here (it becomes this page's own text). An author can't detach an item an editor locked.
import { Extension, type Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, TextSelection, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { ApiError, getEntry, type Entry } from '../api';
import { toast } from '../host';
import { CLICKABLE, covered, letters } from '../links';
import { viewerName, viewerRole } from '../runtime';
import type { FrontmatterEdits } from '../settings/state';
import { ask } from '../shell';
import { toContract, toEditor } from '../transform';
import * as api from './api';

const EDITORS = ['owner', 'administrator', 'editor'];
const OK = 'ms-synced-ok';
type Marker = { id: string; version?: string };

/** A synced item's copy on the canvas: its top-level blocks `first`..`last`, from `pos` to `end`. */
export interface Copy {
  item: api.LibItem;
  first: number;
  last: number;
  pos: number;
  end: number;
}

/** Where each listed item's blocks stand in `doc`, block for block (every place it is). */
export function findCopies(doc: PMNode, items: api.LibItem[]): Copy[] {
  const out: Copy[] = [];
  const starts: number[] = [];
  doc.forEach((_, offset) => starts.push(offset));
  for (const item of items) {
    let want: PMNode[];
    try {
      want = (toEditor(item.body.doc!).content ?? []).map((n) => doc.type.schema.nodeFromJSON(n));
    } catch {
      continue;
    }
    if (!want.length) continue;
    for (let i = 0; i + want.length <= doc.childCount; i++) {
      if (!want.every((n, k) => doc.child(i + k).eq(n))) continue;
      const last = i + want.length - 1;
      out.push({ item, first: i, last, pos: starts[i]!, end: starts[last]! + doc.child(last).nodeSize });
      i = last;
    }
  }
  return out.sort((a, b) => a.pos - b.pos);
}

/** Does `tr` change anything inside the copy (typing in it, deleting it); adding a block right before or after is fine. */
export function touches(tr: Transaction, c: Copy): boolean {
  let hit = false;
  for (const step of tr.steps) {
    step.getMap().forEach((from, to) => {
      if (from === to ? from > c.pos && from < c.end : from < c.end && to > c.pos) hit = true;
    });
    if (hit) break;
  }
  return hit;
}

const whole = (tr: Transaction, size: number) =>
  tr.steps.some((step) => {
    let all = false;
    step.getMap().forEach((from, to) => (all ||= from === 0 && to === size));
    return all;
  });

export interface SyncedDeps {
  getEditor(): Editor | null;
  edits: FrontmatterEdits;
  entry(): Entry | null;
  /** the item was changed everywhere, this entry's file too: its version and saved blocks are the server's now */
  adopted(fresh: Entry, base: PMNode): void;
}

let current: SyncedCopies | null = null;

export class SyncedCopies {
  /** The canvas's synced copies (made with the first editor, then kept). */
  static on(sheet: HTMLElement, d: SyncedDeps): SyncedCopies {
    return (current ??= new SyncedCopies(sheet, d));
  }

  private layer: HTMLElement;
  private items = new Map<string, api.LibItem>();
  private copies: Copy[] = [];
  /** the item whose copy is being edited everywhere (Apply sends it) */
  private editing: string | null = null;
  private asking = false;
  private frame = 0;

  constructor(
    private sheet: HTMLElement,
    private d: SyncedDeps,
  ) {
    this.layer = document.createElement('div');
    this.layer.className = 'ms-synced-pills';
    sheet.append(this.layer);
    new ResizeObserver(() => this.update()).observe(sheet);
    d.edits.onChange((path) => (path === null || path === 'synced') && void this.load());
    addEventListener('ms-library', () => void this.load(true));
  }

  private markers(): Marker[] {
    const v = this.d.edits.get('synced');
    return Array.isArray(v) ? v.filter((m): m is Marker => !!m && typeof m === 'object' && typeof (m as Marker).id === 'string') : [];
  }

  /** The listed items (from the Library's list, else one by one), then the copies on the canvas. */
  private async load(fresh = false): Promise<void> {
    const ids = this.markers().map((m) => m.id);
    if (!ids.length || !viewerName()) {
      this.items.clear();
      this.editing = null;
      return this.find();
    }
    const list = await api.all(fresh).catch(() => null);
    for (const id of ids) {
      const hit = list?.items.find((i) => i.id === id) ?? (await api.item(id).catch(() => null));
      if (hit?.body.doc) this.items.set(id, hit);
      else this.items.delete(id);
    }
    for (const id of [...this.items.keys()]) if (!ids.includes(id)) this.items.delete(id);
    this.find();
  }

  /** The copies found again by their text; the one being edited everywhere keeps its (mapped) place. */
  private find(): void {
    const editor = this.d.getEditor();
    if (!editor || editor.isDestroyed) return void (this.copies = []);
    const kept = this.copies.filter((c) => c.item.id === this.editing);
    if (!kept.length) this.editing = null;
    const others = findCopies(editor.state.doc, [...this.items.values()].filter((it) => it.id !== this.editing)).filter((c) => !kept.some((k) => c.pos < k.end && c.end > k.pos));
    const next = [...kept, ...others].sort((a, b) => a.pos - b.pos);
    const same = next.length === this.copies.length && next.every((c, i) => c.pos === this.copies[i]!.pos && c.end === this.copies[i]!.end);
    this.copies = next;
    // the side lines drawn again, after the change being handled now
    if (!same) queueMicrotask(() => !editor.isDestroyed && editor.view.dispatch(editor.state.tr.setMeta('ms-synced', true)));
    this.update();
  }

  /** The copies follow a change (the edited one grows and shrinks with the writer's text, not past its edges). */
  private map(tr: Transaction): void {
    const doc = tr.doc;
    this.copies = this.copies.flatMap((c) => {
      const pos = tr.mapping.map(c.pos, 1);
      const end = tr.mapping.map(c.end, -1);
      if (end <= pos) return [];
      return [{ ...c, pos, end, first: doc.resolve(pos).index(0), last: doc.resolve(end).index(0) - 1 }];
    });
  }

  /** The TipTap extension: the copies' side line, and the question before a change inside one. */
  extension() {
    const self = this;
    return Extension.create({
      name: 'syncedCopies',
      onCreate() {
        void self.load();
      },
      onTransaction({ transaction }) {
        if (transaction.docChanged) self.map(transaction);
      },
      onUpdate() {
        // found again after every change (Undo, a paste); the one being edited everywhere keeps its place
        self.find();
      },
      addProseMirrorPlugins() {
        return [
          new Plugin({
            filterTransaction: (tr, state) => {
              if (!tr.docChanged || tr.getMeta(OK) || !self.copies.length) return true;
              // the whole text replaced (an entry opened, a recovered draft): not an edit of a copy
              if (whole(tr, state.doc.content.size)) return true;
              const hit = self.copies.find((c) => c.item.id !== self.editing && touches(tr, c));
              if (!hit) return true;
              void self.question(hit, tr);
              return false;
            },
            props: {
              decorations(state) {
                const out: Decoration[] = [];
                for (const c of self.copies) {
                  if (c.end > state.doc.content.size) continue;
                  // not typed in until the writer chose to edit it everywhere (or detached it)
                  const editing = self.editing === c.item.id;
                  state.doc.forEach((node, offset, i) => {
                    if (i >= c.first && i <= c.last) out.push(Decoration.node(offset, offset + node.nodeSize, editing ? { class: 'ms-synced is-editing' } : { class: 'ms-synced', contenteditable: 'false' }));
                  });
                }
                return DecorationSet.create(state.doc, out);
              },
              handleDOMEvents: {
                // a click into a copy asks first (it can't be typed in as it is)
                mousedown(view, e) {
                  const at = view.posAtCoords({ left: e.clientX, top: e.clientY });
                  const c = at && self.copies.find((x) => x.item.id !== self.editing && at.pos >= x.pos && at.pos <= x.end && (e.target as Element).closest?.('.ms-synced'));
                  if (!c) return false;
                  e.preventDefault();
                  void self.question(c, null);
                  return true;
                },
              },
            },
          }),
        ];
      },
    });
  }

  private mayEditEverywhere = (it: api.LibItem) => EDITORS.includes(viewerRole()) || (it.kind === 'snippet' && it.createdByName === viewerName());
  private mayDetach = (it: api.LibItem) => EDITORS.includes(viewerRole()) || !(it.locks?.move || it.locks?.remove || it.locks?.edit);

  /** A click or a change inside a copy: edit it everywhere, detach it here, or leave it. A change goes on after the choice. */
  private async question(c: Copy, tr: Transaction | null): Promise<void> {
    if (this.asking) return;
    this.asking = true;
    try {
      const n = await api.impact(c.item.id).then(
        (r) => r.pages.length,
        () => null,
      );
      const pages = n === null ? 'every page that uses it' : `${n} page${n === 1 ? '' : 's'}`;
      const buttons: [string, string, string?][] = [['cancel', 'Leave it']];
      if (this.mayDetach(c.item)) buttons.push(['detach', 'Detach here']);
      if (this.mayEditEverywhere(c.item)) buttons.push(['everywhere', `Edit on ${pages}`, 'ms-btn ms-btn--primary']);
      const then = !this.mayDetach(c.item)
        ? `An editor locked it, so only an editor can ${this.mayEditEverywhere(c.item) ? '' : 'change or '}detach it.`
        : !this.mayEditEverywhere(c.item)
          ? "Only an editor can change it everywhere; detach it to make it this page's own text."
          : "Detach it to make it this page's own text.";
      const choice = await ask(`“${c.item.name}” is synced`, `It comes from the Library, and changing it changes ${pages}. ${then}`, buttons);
      const editor = this.d.getEditor();
      if (!editor || choice === 'cancel') return;
      if (choice === 'detach') this.detach(c.item.id);
      else this.editing = c.item.id;
      // the change the writer made, unless the text moved on meanwhile
      if (tr?.before.eq(editor.state.doc)) editor.view.dispatch(tr.setMeta(OK, true));
      // a click: the caret goes to the end of the copy's text, to type on
      const after = editor.state.tr.setMeta('ms-synced', true);
      if (!tr && c.end <= after.doc.content.size) after.setSelection(TextSelection.near(after.doc.resolve(c.end - 1), -1));
      editor.view.dispatch(after);
      editor.view.focus();
      this.update();
    } finally {
      this.asking = false;
    }
  }

  /** The copy becomes this page's own text: the frontmatter stops listing it (the save is the detach). */
  detach(id: string): void {
    this.d.edits.set(
      'synced',
      this.markers().filter((m) => m.id !== id),
    );
    if (this.editing === id) this.editing = null;
    toast('Detached: it is this page’s own text now. Save to keep it that way.', 'ok');
  }

  /** The edited copy's blocks go to the item and to every page that uses it (this one too), in one commit. */
  private async apply(c: Copy): Promise<void> {
    const editor = this.d.getEditor();
    const entry = this.d.entry();
    if (!editor || !entry) return;
    const nodes: unknown[] = [];
    editor.state.doc.forEach((node, _, i) => i >= c.first && i <= c.last && nodes.push(node.toJSON()));
    const doc = toContract({ type: 'doc', content: nodes as never });
    try {
      const r = await api.editEverywhere(c.item.id, { doc }, c.item.version);
      this.editing = null;
      const fresh = await getEntry(entry.collection, entry.id);
      this.d.adopted(fresh, editor.schema.nodeFromJSON(toEditor(fresh.doc!)));
      const skipped = r.skipped?.length ? ` ${r.skipped.length} left alone (changed there by hand): ${r.skipped.map((s) => s.title).join(', ')}.` : '';
      toast(`Changed “${c.item.name}” on ${r.changed} page${r.changed === 1 ? '' : 's'}.${skipped}`, 'ok');
      await this.load(true);
    } catch (e) {
      toast(e instanceof ApiError && e.status === 409 ? `“${c.item.name}” changed in the Library meanwhile: undo your changes here, then try again.` : `Not changed everywhere: ${(e as Error).message}`, 'error');
    }
  }

  /** Puts the item's blocks back in place of the edited copy (one ⌘Z brings the edit back). */
  private revert(c: Copy): void {
    const editor = this.d.getEditor();
    if (!editor) return;
    const nodes = (toEditor(c.item.body.doc!).content ?? []).map((n) => editor.schema.nodeFromJSON(n));
    this.editing = null;
    editor.view.dispatch(editor.state.tr.replaceWith(c.pos, c.end, nodes).setMeta(OK, true));
  }

  /** The pill's choices: open it in the Library, detach it; while it is edited, apply or undo. */
  private async menu(c: Copy): Promise<void> {
    const editing = this.editing === c.item.id;
    const n = await api.impact(c.item.id).then(
      (r) => r.pages.length,
      () => null,
    );
    const pages = n === null ? 'every page that uses it' : `${n} page${n === 1 ? '' : 's'}`;
    const buttons: [string, string, string?][] = editing
      ? [
          ['revert', 'Undo my changes'],
          ['keep', 'Keep editing'],
          ['apply', `Apply to ${pages}`, 'ms-btn ms-btn--primary'],
        ]
      : [['close', 'Close'], ['library', 'Open in the Library'], ...(this.mayDetach(c.item) ? ([['detach', 'Detach here']] as [string, string][]) : [])];
    const text = editing ? `Your changes go to ${pages} (this one too) in one commit; a page where it was changed by hand is left alone.` : `It comes from the Library and ${pages} use${n === 1 ? 's' : ''} it: a change to it changes them all.`;
    const choice = await ask(`Synced: “${c.item.name}”`, text, buttons);
    const now = this.copies.find((x) => x.item.id === c.item.id) ?? c;
    if (choice === 'apply') await this.apply(now);
    else if (choice === 'revert') this.revert(now);
    else if (choice === 'detach') this.detach(c.item.id);
    else if (choice === 'library') location.hash = `#/library?open=${encodeURIComponent(c.item.id)}`;
  }

  update(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.draw());
  }

  private draw(): void {
    this.layer.replaceChildren();
    const editor = this.d.getEditor();
    if (!editor || editor.isDestroyed) return;
    const s = this.sheet.getBoundingClientRect();
    // a pill covers no letters and no control: the first of its places that is clear of both, else the least on text
    const text = this.copies.length ? letters(editor.view.dom) : [];
    const taken = [...this.sheet.querySelectorAll(CLICKABLE)]
      .filter((e) => !this.layer.contains(e))
      .flatMap((e) => [...e.getClientRects()])
      .filter((r) => r.width && r.height);
    for (const c of this.copies) {
      const dom = editor.view.nodeDOM(c.pos) as HTMLElement | null;
      if (!dom?.getBoundingClientRect) continue;
      const r = dom.getBoundingClientRect();
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `ms-synced-pill${this.editing === c.item.id ? ' is-editing' : ''}`;
      b.textContent = this.editing === c.item.id ? `Synced: ${c.item.name} · editing everywhere` : `Synced: ${c.item.name}`;
      b.title = 'From the Library: every page that uses it follows its changes';
      b.addEventListener('click', () => void this.menu(c));
      this.layer.append(b);
      const { width: w, height: h } = b.getBoundingClientRect();
      // above the copy at its left, then its right (the padlock's corner when it has one); in the margin beside it;
      // inside it, at the end of its first line, then of its last line, where those lines stop short
      const places = [
        [r.left, r.top - h - 2],
        [r.right - w, r.top - h - 2],
        [r.right + 8, r.top],
        [r.right - w - 4, r.top + 2],
        [r.right - w - 4, r.bottom - h - 2],
      ].filter(([x, y]) => x! >= s.left && x! + w <= s.right && y! >= s.top) as [number, number][];
      const on = ([x, y]: [number, number], boxes: DOMRect[]) => covered(x, y, w, h, boxes);
      const clear = places.filter((p) => !on(p, taken));
      const [x, y] = clear.find((p) => !on(p, text)) ?? clear.sort((p, q) => on(p, text) - on(q, text))[0] ?? [r.left, r.top - h - 2];
      taken.push(new DOMRect(x, y, w, h));
      b.style.left = `${x - s.left}px`;
      b.style.top = `${y - s.top}px`;
    }
  }
}
