// The page's sections in order, each with a picture of its kind and its heading, on the shared order component
// (order.ts): select one (the page scrolls to it and the panel shows its fields), drag it by the grip or use its
// menu (move up / down / to top / to bottom / to…, duplicate, delete with Undo), several at once, and add a new one
// below any section or at the end (a picker with a picture per kind). Every action is one undo step in the model.
// A locked section's row has the "Locked" pill (lock-ui.ts), an unlocked one an open padlock on hover for the
// roles that may lock; a click opens its popover (lock=<index> in the URL), and a change writes the section's
// `value._lock`: true locks, false lifts the site's rule on this page; nothing left removes the key.
// The picker's "From the Library" group adds a copy of a Library section of this page's kinds (library.ts), by a
// click, the keyboard, a drag into the list or onto the page (canvas-drop.ts), or Insert… and a place chosen by name
// (ins=<item> in the URL); each goes through place.ts. A synced copy's row has the "Synced" pill.
import type { Lock } from '@markstage/core';
import { toast } from '../host';
import { ic } from '../icons';
import { closeLockPopover, lockPopoverOpen, openLockPopover, padlockButton, type LockTarget } from '../lock-ui';
import { freshLockRules, lockReason, PARTS } from '../locks';
import { lockRules } from '../page-types';
import { h, iconBtn, textBtn } from '../panel-form';
import type { LibItem } from '../reusable/api';
import { viewerRole } from '../runtime';
import { LIB_DRAG, markerOf, sectionItems } from './library';
import { mergeLocks } from './locks';
import type { PageModel } from './model';
import { mountPageList, type PageList } from './order';
import { layoutLock } from './places';
import { sectionPicture } from './pictures';
import { humanize, itemTitle, newSection, sectionKinds } from './schema';
import type { Field } from './types';

export interface OutlineOpts {
  model: PageModel;
  /** the page's collection (the Library's sections for it) */
  collection: string;
  root: () => Field;
  selected: () => number | null;
  select: (index: number | null) => void;
  /** the section picker's insert position (null: closed) */
  adding: () => number | null;
  setAdding: (index: number | null) => void;
  /** the outline's scrolling area */
  scroller?: HTMLElement;
  /** the section whose lock popover is open (the URL's lock=), and opening or closing it */
  lockOpen: () => number | null;
  setLockOpen: (index: number | null) => void;
  /** a Library section put at `index` (place.ts: saved at once, or taken out again with the server's words) */
  place: (it: LibItem, index: number) => void;
  /** the Library item whose list of places is open (the URL's ins=), and opening or closing it */
  placing: () => string | null;
  setPlacing: (id: string | null) => void;
}

const EDITORS = ['owner', 'administrator', 'editor'];
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/**
 * A section's own marker (`value._lock`, where the editor and Keystatic keep it; a `_lock` beside the value, as the
 * server writes an item's locks on a synced copy, counts too): true locks, false lifts the site's rule here.
 */
const ownMark = (s: Section | undefined): Partial<Record<'move' | 'remove' | 'edit', boolean>> & { by?: string } =>
  isObj(s?.value?._lock) ? (s!.value!._lock as never) : isObj(s?._lock) ? (s!._lock as never) : {};
const siteRule = (s: Section | undefined): Lock | undefined => {
  const r = lockRules().pages[sectionKind(s)];
  return r && (r.move || r.remove || r.edit) ? { move: !!r.move, remove: !!r.remove, edit: !!r.edit, by: 'the site' } : undefined;
};
/** What holds on a section now. */
export const sectionLock = (s: Section | undefined) => mergeLocks(ownMark(s) as Lock, siteRule(s));

type Section = { discriminant?: unknown; value?: Record<string, unknown>; _lock?: unknown };
const sections = (model: PageModel) => (Array.isArray(model.get('sections')) ? (model.get('sections') as Section[]) : []);
export const sectionKind = (s: Section | undefined) => String(s?.discriminant ?? '');
/** "2. FAQ: Questions" */
export const sectionLabel = (s: Section | undefined, i: number) => `${i + 1}. ${humanize(sectionKind(s))}: ${sectionTitle(s)}`;
export const sectionTitle = (s: Section | undefined) =>
  itemTitle({ heading: s?.value?.heading, title: s?.value?.title, eyebrow: s?.value?.eyebrow, lead: s?.value?.lead }) || itemTitle(s?.value) || '(empty)';

export class Outline {
  readonly el: HTMLElement;
  private top: HTMLElement;
  private end: HTMLElement;
  private order: PageList;
  /** the selected section's index after a change made in the list (it follows its section) */
  private follow: number | null | undefined;
  /** the Library's sections for this collection, once read */
  private lib: LibItem[] = [];
  private line = h('div', 'msp-libdrop');
  private readLibrary = () =>
    void sectionItems(this.o.collection).then((items) => {
      this.lib = items;
      this.draw();
    });

  constructor(private o: OutlineOpts) {
    this.el = h('nav', 'msp-outline');
    this.el.setAttribute('aria-label', 'Page sections');
    this.el.append(h('h2', 'msp-outline__title', 'Sections'));
    this.top = h('div', 'msp-outline__slot');
    const box = h('div', 'msp-outline__list');
    this.end = h('div', 'msp-outline__slot msp-outline__end');
    this.line.hidden = true;
    this.el.append(this.top, box, this.end, this.line);
    this.dropping(box);
    this.readLibrary();
    addEventListener('ms-library', this.readLibrary);
    this.order = mountPageList({
      model: o.model,
      path: 'sections',
      root: box,
      label: 'Page sections',
      noun: 'section',
      lockAt: 'value._lock',
      siteLock: (s) => lockRules().pages[sectionKind(s as Section)],
      title: (s, i) => sectionLabel(s as Section, i),
      row: (item) => this.row(item.value as Section, item.index),
      reindex: (map) => {
        const sel = o.selected();
        this.follow = sel === null ? undefined : map.get(sel);
      },
      changed: () => {
        const to = this.follow;
        this.follow = undefined;
        if (to !== undefined && to !== o.selected()) o.select(to);
      },
      scroller: o.scroller,
    });
  }

  destroy(): void {
    removeEventListener('ms-library', this.readLibrary);
  }

  /** A Library section of this page's collection, by id (a drop on the page names it). */
  libItem(id: string): LibItem | undefined {
    return this.lib.find((x) => x.id === id);
  }

  draw(): void {
    freshLockRules();
    const n = sections(this.o.model).length;
    const adding = this.o.adding();
    this.order.refresh();
    this.top.replaceChildren();
    // the person may not change the sections (their role): no way to add one, and why
    const frozen = this.o.model.refuse('sections');
    if (frozen) {
      this.end.replaceChildren(Object.assign(h('p', 'msp-outline__frozen'), { textContent: `${frozen} No section can be added, moved or deleted.` }));
      this.followLock();
      return;
    }
    if (adding === 0 && n) this.top.append(this.picker(0));
    this.end.replaceChildren(textBtn('plus', 'Add section', () => this.o.setAdding(adding === n ? null : n), 'ms-btn ms-btn--sm msp-outline__add'));
    this.end.firstElementChild!.setAttribute('aria-expanded', String(adding === n));
    if (adding === n) this.end.append(this.picker(n));
    this.followLock();
    // a list of places that opens (Insert…, or the URL's ins= on a reload or Back) is scrolled into sight once
    const placing = this.o.placing();
    const menu = this.el.querySelector('.msp-places');
    if (placing !== this.placesShown && menu) menu.scrollIntoView({ block: 'nearest' });
    if (menu || !placing) this.placesShown = placing;
  }

  private placesShown: string | null = null;

  private row(s: Section, i: number): HTMLElement {
    const sel = this.o.selected();
    const adding = this.o.adding();
    const n = sections(this.o.model).length;
    const wrap = h('div', 'msp-sec-wrap');
    const li = h('div', `msp-sec${sel === i ? ' is-selected' : ''}`);
    li.dataset.index = String(i);
    const main = h('button', 'msp-sec__main');
    main.type = 'button';
    main.setAttribute('aria-current', String(sel === i));
    main.innerHTML = `<span class="msp-sec__pic">${sectionPicture(sectionKind(s))}</span><span class="msp-sec__txt"><span class="msp-sec__kind"></span><span class="msp-sec__title"></span></span>`;
    main.querySelector('.msp-sec__kind')!.textContent = `${i + 1}. ${humanize(sectionKind(s))}`;
    main.querySelector('.msp-sec__title')!.textContent = sectionTitle(s);
    main.addEventListener('click', () => this.o.select(sel === i ? null : i));
    const tools = h('span', 'msp-sec__tools');
    const lock = sectionLock(s);
    let locked: HTMLElement | null = null;
    const frozen = this.o.model.refuse('sections');
    if (frozen) {
      // shown as it is, not changed: the pill says the lock, the rest of the row only selects
      if (lock) locked = padlockButton(lock, () => toast(frozen, 'info'));
      li.append(main, ...(markerOf(s) ? [this.syncedPill(s, i)] : []), ...(locked ? [locked] : []));
      wrap.append(li);
      return wrap;
    }
    if (lock || EDITORS.includes(viewerRole())) {
      const pad = padlockButton(lock, () => this.openLock(i));
      pad.dataset.index = String(i);
      pad.setAttribute('aria-expanded', String(this.o.lockOpen() === i));
      // locked: always shown, in the row; else an open padlock with the row's other tools (on hover or focus)
      if (lock) locked = pad;
      else {
        pad.classList.add('is-hover');
        tools.append(pad);
      }
    }
    const add = iconBtn('plus', 'Add a section below', () => this.o.setAdding(adding === i + 1 ? null : i + 1));
    add.setAttribute('aria-expanded', String(adding === i + 1));
    tools.append(add);
    const synced = markerOf(s) ? this.syncedPill(s, i) : null;
    li.append(main, ...(synced ? [synced] : []), ...(locked ? [locked] : []), tools);
    wrap.append(li);
    // the picker for "add below" opens under its section (at the end it opens under the list)
    if (adding === i + 1 && i + 1 < n) wrap.append(this.picker(i + 1));
    return wrap;
  }

  /** The URL's lock popover (a reload, Back), once the rows are drawn; closed when the URL has none. */
  followLock(): void {
    const want = this.o.lockOpen();
    if (want === null) return void (this.lockShown !== null && closeLockPopover());
    if (want !== this.lockShown || !lockPopoverOpen()) this.openLock(want);
  }

  private lockShown: number | null = null;

  /** What the popover shows for section `i`, read again after each change. */
  private lockTarget(i: number): LockTarget | null {
    const s = sections(this.o.model)[i];
    if (!s) return null;
    const kind = sectionKind(s);
    return {
      label: `${humanize(kind)} section`,
      site: siteRule(s),
      lock: sectionLock(s),
      set: (want) => this.setLock(i, want),
      ruleHref: `#/settings/locks?kind=pages&type=${encodeURIComponent(kind)}`,
    };
  }

  /** The section's marker: what the site's rule doesn't say, as true / false; one undo step; none left: no key. */
  private setLock(i: number, want: Record<'move' | 'remove' | 'edit', boolean>): void {
    const s = sections(this.o.model)[i];
    if (!s) return;
    const site = siteRule(s);
    const mark: Record<string, boolean> = {};
    for (const w of PARTS) if (want[w] !== !!site?.[w]) mark[w] = want[w];
    const path = `sections.${i}.value._lock`;
    const had = isObj(s.value?._lock);
    // who and when: the server stamps them on save
    if (Object.keys(mark).length) this.o.model.changeMany([{ op: 'set', path, value: mark }]);
    else if (had) this.o.model.changeMany([{ op: 'remove', path }]);
  }

  openLock(i: number): void {
    if (!this.lockTarget(i)) return;
    this.lockShown = i;
    if (this.o.lockOpen() !== i) this.o.setLockOpen(i);
    const anchor = this.el.querySelector<HTMLElement>(`.ms-padlock[data-index="${i}"]`);
    if (!anchor) return;
    anchor.scrollIntoView({ block: 'nearest' });
    anchor.setAttribute('aria-expanded', 'true');
    openLockPopover(anchor, () => this.lockTarget(i), () => {
      this.lockShown = null;
      if (this.o.lockOpen() !== null) this.o.setLockOpen(null);
    });
  }

  /** The kinds to add, each with its picture. */
  private picker(index: number): HTMLElement {
    const box = h('div', 'msp-picker');
    box.setAttribute('role', 'menu');
    const kinds = sectionKinds(this.o.root(), this.o.model.data);
    if (!kinds.length) box.append(h('p', 'msp-picker__none', 'This page has no section kinds to add.'));
    for (const kind of kinds) {
      const b = h('button', 'msp-picker__kind', `<span class="msp-picker__pic">${sectionPicture(kind)}</span><span class="msp-picker__name"></span>`);
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.dataset.kind = kind;
      b.querySelector('.msp-picker__name')!.textContent = humanize(kind);
      b.addEventListener('click', () => {
        this.o.model.settle();
        const value = newSection(this.o.root(), this.o.model.data, kind);
        if (Array.isArray(this.o.model.get('sections'))) this.o.model.change({ op: 'insert', path: 'sections', index, value });
        else this.o.model.change({ op: 'set', path: 'sections', value: [value] });
        this.o.setAdding(null);
        this.o.select(index);
      });
      box.append(b);
    }
    const mine = this.lib.filter((it) => kinds.includes(it.sectionType!));
    if (mine.length) {
      const group = h('div', 'msp-picker__lib');
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', 'From the Library');
      group.append(h('p', 'msp-picker__group', 'From the Library'));
      for (const it of mine) {
        const cell = h('div', 'msp-picker__libitem');
        cell.append(this.libButton(it, index), this.placesButton(it));
        group.append(cell);
        if (this.o.placing() === it.id) group.append(this.places(it));
      }
      box.append(group);
    }
    box.addEventListener('keydown', (e) => e.key === 'Escape' && this.o.setAdding(null));
    return box;
  }

  /** A Library section in the picker: a click or Enter adds it here; it can be dragged into the list too. */
  private libButton(it: LibItem, index: number): HTMLElement {
    const pic = it.thumb ? `<img src="${encodeURI(it.thumb)}" alt="" loading="lazy">` : sectionPicture(it.sectionType!);
    const b = h('button', 'msp-picker__kind', `<span class="msp-picker__pic">${pic}</span><span class="msp-picker__name"></span>`);
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.dataset.lib = it.id;
    b.draggable = true;
    b.title = `${it.name}${it.synced ? ' (synced: a change to it reaches every page that uses it)' : ''}. Click to add it here, or drag it into the list or onto the page.`;
    const name = b.querySelector('.msp-picker__name')!;
    name.textContent = it.name;
    if (it.synced) name.append(h('span', 'msp-picker__synced', 'Synced'));
    b.addEventListener('click', () => this.o.place(it, index));
    b.addEventListener('dragstart', (e) => {
      e.dataTransfer!.setData(LIB_DRAG, it.id);
      e.dataTransfer!.setData('text/plain', it.name);
      e.dataTransfer!.effectAllowed = 'copy';
    });
    b.addEventListener('dragend', () => (this.line.hidden = true));
    return b;
  }

  /** Insert…: the list of places for `it` opens under it (ins= in the URL), for the keyboard and to choose by name. */
  private placesButton(it: LibItem): HTMLElement {
    const open = this.o.placing() === it.id;
    const b = h('button', 'msp-picker__places', 'Insert…');
    b.type = 'button';
    b.dataset.places = it.id;
    b.setAttribute('aria-haspopup', 'menu');
    b.setAttribute('aria-expanded', String(open));
    b.setAttribute('aria-label', `Insert “${it.name}”…: choose where`);
    b.addEventListener('click', () => {
      this.o.setPlacing(open ? null : it.id);
      this.el.querySelector<HTMLElement>(open ? `[data-places="${CSS.escape(it.id)}"]` : '.msp-places [role=menuitem]:not([aria-disabled=true])')?.focus({ preventScroll: true });
    });
    return b;
  }

  /**
   * Every place `it` can go, by name: at the top, after each section, at the end. A locked section is named in its
   * place with why it does not change (the copy goes above or below it); a page whose layout is locked takes none.
   */
  private places(it: LibItem): HTMLElement {
    const list = sections(this.o.model);
    const menu = h('div', 'msp-places');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', `Where to put “${it.name}”`);
    const why = layoutLock(this.o.model);
    if (why) menu.append(Object.assign(h('p', 'msp-places__why'), { textContent: why }));
    const option = (text: string, index: number) => {
      const b = h('button', 'msp-places__at');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.textContent = text;
      b.dataset.index = String(index);
      if (why) b.setAttribute('aria-disabled', 'true');
      else b.addEventListener('click', () => this.o.place(it, index));
      menu.append(b);
    };
    option(list.length ? `At the top, before ${sectionLabel(list[0], 0)}` : 'On the page', 0);
    list.forEach((s, i) => {
      const lock = sectionLock(s);
      if (lock) {
        const note = h('p', 'msp-places__locked');
        note.textContent = `${sectionLabel(s, i)}. ${lockReason(lock)}`;
        menu.append(note);
      }
      option(i === list.length - 1 ? `At the end, after ${sectionLabel(s, i)}` : `After ${sectionLabel(s, i)}`, i + 1);
    });
    menu.addEventListener('keydown', (e) => {
      const items = [...menu.querySelectorAll<HTMLElement>('[role=menuitem]')];
      const at = items.indexOf(document.activeElement as HTMLElement);
      const go = (k: number) => items[(k + items.length) % items.length]?.focus();
      if (e.key === 'ArrowDown') go(at + 1);
      else if (e.key === 'ArrowUp') go(at - 1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(items.length - 1);
      else if (e.key === 'Escape') {
        this.o.setPlacing(null);
        this.el.querySelector<HTMLElement>(`[data-places="${CSS.escape(it.id)}"]`)?.focus();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    });
    return menu;
  }

  /** Where a drop at `y` lands among the rows: the index, and the line's place in the outline. */
  private dropAt(list: HTMLElement, y: number): { index: number; top: number } {
    const rows = [...list.querySelectorAll<HTMLElement>('.msp-sec[data-index]')];
    const base = this.el.getBoundingClientRect().top;
    for (const r of rows) {
      const b = r.getBoundingClientRect();
      if (y < b.top + b.height / 2) return { index: Number(r.dataset.index), top: b.top - base - 2 };
    }
    const last = rows.at(-1)?.getBoundingClientRect();
    return { index: rows.length, top: (last ? last.bottom : list.getBoundingClientRect().top) - base + 2 };
  }

  /** Library sections dropped on the outline: a line where it lands while dragging, the copy on drop. */
  private dropping(list: HTMLElement): void {
    const ours = (e: DragEvent) => !!e.dataTransfer?.types.includes(LIB_DRAG);
    this.el.addEventListener('dragover', (e) => {
      if (!ours(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
      const at = this.dropAt(list, e.clientY);
      this.line.style.top = `${at.top}px`;
      this.line.hidden = false;
    });
    this.el.addEventListener('dragleave', (e) => !this.el.contains(e.relatedTarget as Node | null) && (this.line.hidden = true));
    this.el.addEventListener('drop', (e) => {
      if (!ours(e)) return;
      e.preventDefault();
      this.line.hidden = true;
      const it = this.lib.find((x) => x.id === e.dataTransfer!.getData(LIB_DRAG));
      if (it) this.o.place(it, this.dropAt(list, e.clientY).index);
    });
  }

  /** The "Synced" pill of a synced copy's row: selecting the section shows where it comes from and what to do. */
  private syncedPill(s: Section, i: number): HTMLElement {
    const it = this.lib.find((x) => x.id === markerOf(s)!.id);
    const pill = h('button', 'msp-sec__synced', `${ic('layers', 12)}<span>Synced</span>`);
    pill.type = 'button';
    pill.title = it ? `Synced from the Library: “${it.name}”. Select it to apply, undo or detach.` : 'Synced from the Library. Select it to see more.';
    pill.setAttribute('aria-label', pill.title);
    pill.addEventListener('click', () => this.o.select(i));
    return pill;
  }
}
