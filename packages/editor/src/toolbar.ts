// Floating tools on the canvas: the format bar over selected text (bold, italic, link, H2, H3, lists, code), the
// link card when the cursor is in a link (open, copy, edit, remove), and the table menu while editing a table.
import type { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { copyable, siteUrl } from './copy';
import { toast } from './host';
import { ic } from './icons';
import { optionChips, OPTIONS, optionsOf, unsafeLink, withOptions, type Option } from './link-rel';
import { opensPopup, popupRule } from './links';
import { duplicateRow, moveColumn, moveRow, sortRows } from './tables';

/** A page of the site a link can point to (its path, as the site's own links use). `kind` picks the icon:
 *  'article' for written entries (posts), 'page' for the rest, 'special' for the site's special links (config
 *  editor.links.special, e.g. "Book a call"), which the search lists first. */
export interface LinkTarget {
  title: string;
  url: string;
  kind: 'article' | 'page' | 'special';
}

/** What a typed address becomes: "example.com/x" gets https://, everything else stays as typed. */
const normalizeHref = (v: string) => {
  const t = v.trim();
  return /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(t) && !t.startsWith('/') ? `https://${t}` : t;
};

type Btn = { id: string; icon?: string; text?: string; label: string; run: (e: Editor) => void; active?: (e: Editor) => boolean };

const FORMAT: (Btn | '|')[] = [
  { id: 'bold', icon: 'bold', label: 'Bold (⌘B)', run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive('bold') },
  { id: 'italic', icon: 'italic', label: 'Italic (⌘I)', run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive('italic') },
  { id: 'link', icon: 'link', label: 'Link (⌘K)', run: () => {}, active: (e) => e.isActive('link') },
  '|',
  { id: 'h2', text: 'H2', label: 'Heading 2', run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), active: (e) => e.isActive('heading', { level: 2 }) },
  { id: 'h3', text: 'H3', label: 'Heading 3', run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(), active: (e) => e.isActive('heading', { level: 3 }) },
  '|',
  { id: 'ul', icon: 'list', label: 'Bulleted list', run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive('bulletList') },
  { id: 'ol', icon: 'ordered', label: 'Numbered list', run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive('orderedList') },
  { id: 'code', icon: 'code', label: 'Code', run: (e) => e.chain().focus().toggleCode().run(), active: (e) => e.isActive('code') },
];

/** Puts the caret in the cell `row` rows and `col` columns from the one it is in: after adding a row or a column
 *  the writer types into the new cell. (Markdown tables have no merged cells, so rows and columns line up.) */
function toCell(e: Editor, row: number, col: number): boolean {
  const { $from } = e.state.selection;
  let d = $from.depth;
  while (d > 2 && !/^table(Cell|Header)$/.test($from.node(d).type.name)) d--;
  if (d <= 2) return false;
  const table = $from.node(d - 2);
  const r = $from.index(d - 2) + row;
  const c = $from.index(d - 1) + col;
  if (r < 0 || r >= table.childCount || c < 0 || c >= table.child(r).childCount) return false;
  let pos = $from.start(d - 2);
  for (let i = 0; i < r; i++) pos += table.child(i).nodeSize;
  pos += 1;
  for (let i = 0; i < c; i++) pos += table.child(r).child(i).nodeSize;
  const tr = e.state.tr.setSelection(TextSelection.near(e.state.doc.resolve(pos + 1)));
  e.view.dispatch(tr.scrollIntoView());
  return true;
}

/** A table move that could not be made says why (a note at the bottom). */
const said = (why: string) => (why ? (toast(why, 'info'), false) : true);

const TABLE: [string, string, (e: Editor) => boolean][] = [
  ['Add a row above', 'plus', (e) => e.chain().focus().addRowBefore().run() && toCell(e, -1, 0)],
  ['Add a row below', 'plus', (e) => e.chain().focus().addRowAfter().run() && toCell(e, 1, 0)],
  ['Add a column left', 'plus', (e) => e.chain().focus().addColumnBefore().run() && toCell(e, 0, -1)],
  ['Add a column right', 'plus', (e) => e.chain().focus().addColumnAfter().run() && toCell(e, 0, 1)],
  ['Move row up', 'up', (e) => said(moveRow(e, -1))],
  ['Move row down', 'down', (e) => said(moveRow(e, 1))],
  ['Move column left', 'undo', (e) => said(moveColumn(e, -1))],
  ['Move column right', 'redo', (e) => said(moveColumn(e, 1))],
  ['Duplicate row', 'duplicate', (e) => said(duplicateRow(e))],
  ['Sort by this column, A to Z', 'down', (e) => said(sortRows(e))],
  ['Sort by this column, Z to A', 'up', (e) => said(sortRows(e, true))],
  ['Delete row', 'x', (e) => e.chain().focus().deleteRow().run()],
  ['Delete column', 'x', (e) => e.chain().focus().deleteColumn().run()],
  ['Header row on/off', 'table', (e) => e.chain().focus().toggleHeaderRow().run()],
  ['Delete table', 'trash', (e) => e.chain().focus().deleteTable().run()],
];
export const TABLE_ACTIONS = TABLE;

const btn = (cls: string, html: string, label: string) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.innerHTML = html;
  b.setAttribute('aria-label', label);
  b.title = label;
  b.addEventListener('mousedown', (e) => e.preventDefault());
  return b;
};

export class Toolbar {
  private bar: HTMLElement;
  private buttons: { def: Btn; el: HTMLButtonElement }[] = [];
  private linkPop: HTMLElement;
  private linkInput: HTMLInputElement;
  /** the link's options (link-rel.ts): new tab, nofollow, sponsored, ugc */
  private linkOpts: HTMLInputElement[];
  private linkCard: HTMLElement;
  private tableBtn: HTMLElement;
  private tableMenu: HTMLElement;
  private linkRange: { from: number; to: number } | null = null;
  private linkList: HTMLElement;
  private targets: LinkTarget[] = [];
  private found: { t: LinkTarget; row: HTMLElement }[] = [];
  private foundActive = -1;

  constructor(
    private getEditor: () => Editor | null,
    private scroller: HTMLElement,
  ) {
    this.bar = document.createElement('div');
    this.bar.className = 'ms-pop ms-bar';
    this.bar.setAttribute('role', 'toolbar');
    this.bar.setAttribute('aria-label', 'Text format');
    this.bar.hidden = true;
    for (const def of FORMAT) {
      if (def === '|') {
        this.bar.append(Object.assign(document.createElement('span'), { className: 'ms-bar__sep' }));
        continue;
      }
      const el = btn('ms-bar__btn', def.icon ? ic(def.icon, 15) : `<b>${def.text}</b>`, def.label);
      el.addEventListener('click', () => {
        const e = this.getEditor();
        if (!e) return;
        if (def.id === 'link') this.editLink();
        else def.run(e);
        this.update();
      });
      this.bar.append(el);
      this.buttons.push({ def, el });
    }

    this.linkPop = document.createElement('form');
    this.linkPop.className = 'ms-pop ms-link';
    this.linkPop.hidden = true;
    this.linkPop.innerHTML = `<div class="ms-link__row"><input type="text" placeholder="Search the site's pages, or paste a link" aria-label="Link: search the site or paste an address" role="combobox" aria-expanded="false" aria-controls="ms-link-list" autocomplete="off" spellcheck="false" /><button type="submit" class="ms-btn ms-btn--primary ms-btn--sm">Apply</button><button type="button" class="ms-btn ms-btn--sm" data-remove>Remove</button></div><p class="ms-link__err" role="alert" hidden></p><div class="ms-link__opts" role="group" aria-label="Link options">${OPTIONS.map((o) => `<label class="ms-link__opt" title="${o.why}"><input type="checkbox" data-opt="${o.id}" />${o.label}</label>`).join('')}</div><div class="ms-link__list" id="ms-link-list" role="listbox" aria-label="Pages of the site"></div>`;
    this.linkInput = this.linkPop.querySelector('input')!;
    this.linkOpts = [...this.linkPop.querySelectorAll<HTMLInputElement>('[data-opt]')];
    this.linkList = this.linkPop.querySelector('.ms-link__list')!;
    this.linkPop.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const pick = this.found[this.foundActive];
      const href = pick ? pick.t.url : normalizeHref(this.linkInput.value);
      // refused here, with the server's words, instead of at the save (QA F11)
      const bad = unsafeLink(href);
      const err = this.linkPop.querySelector<HTMLElement>('.ms-link__err')!;
      err.hidden = !bad;
      err.textContent = bad ?? '';
      if (bad) return void this.linkInput.focus();
      this.applyLink(href);
    });
    this.linkPop.querySelector('[data-remove]')!.addEventListener('click', () => this.applyLink(''));
    this.linkInput.addEventListener('input', () => this.searchLinks());
    this.linkInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        this.closeLink(true);
      } else if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && this.found.length) {
        ev.preventDefault();
        const n = this.found.length;
        this.markLink(ev.key === 'ArrowDown' ? (this.foundActive + 1) % n : (this.foundActive - 1 + n) % n);
      }
    });

    this.linkCard = document.createElement('div');
    this.linkCard.className = 'ms-pop ms-linkcard';
    this.linkCard.hidden = true;

    this.tableBtn = btn('ms-tablebtn', `${ic('table', 14)}<span>Table</span>${ic('down', 12)}`, 'Table rows and columns');
    this.tableBtn.hidden = true;
    this.tableMenu = document.createElement('div');
    this.tableMenu.className = 'ms-pop ms-menu';
    this.tableMenu.hidden = true;
    this.tableMenu.setAttribute('role', 'menu');
    for (const [label, icon, run] of TABLE) {
      const b = btn(`ms-menu__item${label.startsWith('Delete') ? ' is-danger' : ''}`, `${ic(icon, 15)}<span>${label}</span>`, label);
      b.setAttribute('role', 'menuitem');
      b.addEventListener('click', () => {
        const e = this.getEditor();
        this.tableMenu.hidden = true;
        if (e) run(e);
      });
      this.tableMenu.append(b);
    }
    this.tableBtn.addEventListener('click', () => {
      this.tableMenu.hidden = !this.tableMenu.hidden;
      const r = this.tableBtn.getBoundingClientRect();
      this.tableMenu.style.top = `${r.bottom + 4}px`;
      this.tableMenu.style.left = `${r.right - 190}px`;
    });

    document.body.append(this.bar, this.linkPop, this.linkCard, this.tableBtn, this.tableMenu);
    document.addEventListener('mousedown', (e) => {
      const t = e.target as Node;
      if (!this.linkPop.hidden && !this.linkPop.contains(t) && !this.bar.contains(t)) this.closeLink();
      if (!this.tableMenu.hidden && !this.tableMenu.contains(t) && !this.tableBtn.contains(t)) this.tableMenu.hidden = true;
    });
    this.scroller.addEventListener('scroll', () => this.update(), { passive: true });
    window.addEventListener('resize', () => this.update());
  }

  hideAll(): void {
    this.bar.hidden = this.linkCard.hidden = this.tableBtn.hidden = this.tableMenu.hidden = true;
    this.closeLink();
  }

  /** Re-positions every tool after a selection or document change. */
  update(): void {
    const editor = this.getEditor();
    if (!editor) return this.hideAll();
    const { state, view } = editor;
    const sel = state.selection;
    const focused = view.hasFocus();
    const box = this.scroller.getBoundingClientRect();
    const inView = (y: number) => y > box.top + 4 && y < box.bottom - 4;

    // format bar: a text selection inside the canvas
    const showBar = focused && !sel.empty && !(sel instanceof NodeSelection) && this.linkPop.hidden;
    if (showBar) {
      const a = view.coordsAtPos(sel.from);
      const b = view.coordsAtPos(sel.to, -1);
      for (const { def, el } of this.buttons) el.classList.toggle('is-on', !!def.active?.(editor));
      // headings and lists only make sense for a paragraph or a heading; hide them in one-line boxes and fields
      const inline = !['paragraph', 'heading'].includes(sel.$from.parent.type.name);
      for (const { def, el } of this.buttons) if (['h2', 'h3', 'ul', 'ol'].includes(def.id)) el.hidden = inline;
      this.bar.hidden = false;
      const left = (a.left + b.right) / 2 - this.bar.offsetWidth / 2;
      const top = Math.min(a.top, b.top) - this.bar.offsetHeight - 8;
      this.bar.style.left = `${Math.max(8, Math.min(left, innerWidth - this.bar.offsetWidth - 8))}px`;
      this.bar.style.top = `${top < box.top ? Math.max(a.bottom, b.bottom) + 8 : top}px`;
      this.bar.hidden = !inView(a.top) && !inView(b.bottom);
    } else this.bar.hidden = true;

    // link card: the cursor in a link, nothing selected
    const link = sel.empty && focused && editor.isActive('link') ? (editor.getAttributes('link').href as string) : null;
    if (link && this.linkPop.hidden) {
      const c = view.coordsAtPos(sel.from);
      const key = `${link} ${optionChips(editor.getAttributes('link')).join(' ')}`;
      if (this.linkCard.dataset.key !== key) {
        this.linkCard.dataset.key = key;
        this.linkCard.dataset.href = link;
        this.linkCard.replaceChildren();
        const target = this.targets.find((t) => t.url === link) ?? this.targets.find((t) => t.url === link.replace(/#.*$/, ''));
        if (target) this.linkCard.append(Object.assign(document.createElement('span'), { className: 'ms-linkcard__title', textContent: target.title }));
        this.linkCard.append(copyable(link, { label: 'link', open: /^(https?:|mailto:)/.test(link) ? link : siteUrl(link) }));
        const chips = optionChips(editor.getAttributes('link'));
        if (chips.length) this.linkCard.append(Object.assign(document.createElement('span'), { className: 'ms-linkcard__opts', textContent: chips.join(' · ') }));
        // the site opens this link in a popup (its own rule, config editor.links.popup)
        const at = view.domAtPos(sel.from).node;
        const a = (at instanceof Element ? at : at.parentElement)?.closest('a') ?? null;
        if (opensPopup(a)) {
          const note = document.createElement('span');
          note.className = 'ms-linkcard__note';
          note.innerHTML = ic('calendar', 13);
          note.append(popupRule()!.note);
          this.linkCard.append(note);
        }
        const edit = btn('ms-btn ms-btn--sm', `${ic('link', 13)}<span>Edit</span>`, 'Edit link');
        edit.addEventListener('click', () => this.editLink());
        const remove = btn('ms-btn ms-btn--sm', `${ic('unlink', 13)}<span>Remove</span>`, 'Remove link');
        remove.addEventListener('click', () => {
          this.getEditor()?.chain().focus().extendMarkRange('link').unsetLink().run();
          this.update();
        });
        this.linkCard.append(edit, remove);
      }
      this.linkCard.hidden = !inView(c.bottom);
      this.linkCard.style.left = `${Math.max(8, Math.min(c.left - 20, innerWidth - this.linkCard.offsetWidth - 8))}px`;
      this.linkCard.style.top = `${c.bottom + 8}px`;
    } else {
      this.linkCard.hidden = true;
      delete this.linkCard.dataset.href;
      delete this.linkCard.dataset.key;
    }

    // table menu button: top right of the table being edited
    const tableDepth = (() => {
      for (let d = sel.$from.depth; d > 0; d--) if (sel.$from.node(d).type.name === 'table') return d;
      return 0;
    })();
    if (tableDepth && (focused || !this.tableMenu.hidden)) {
      const dom = view.nodeDOM(sel.$from.before(tableDepth)) as HTMLElement | null;
      const r = dom?.getBoundingClientRect();
      if (r && inView(r.top + 10)) {
        this.tableBtn.hidden = false;
        this.tableBtn.style.top = `${r.top - this.tableBtn.offsetHeight - 6}px`;
        this.tableBtn.style.left = `${r.right - this.tableBtn.offsetWidth}px`;
      } else this.tableBtn.hidden = true;
    } else if (this.tableMenu.hidden) this.tableBtn.hidden = true;
  }

  /** Opens the link field for the selection (⌘K, or the link button). */
  editLink(): void {
    const editor = this.getEditor();
    if (!editor) return;
    if (editor.isActive('link')) editor.chain().extendMarkRange('link').run();
    const { from, to, empty } = editor.state.selection;
    if (empty) return;
    this.linkRange = { from, to };
    this.linkInput.value = editor.getAttributes('link').href ?? '';
    const on = optionsOf(editor.isActive('link') ? editor.getAttributes('link') : {});
    for (const box of this.linkOpts) box.checked = on.has(box.dataset.opt as Option);
    this.searchLinks();
    const a = editor.view.coordsAtPos(from);
    this.bar.hidden = true;
    this.linkCard.hidden = true;
    this.linkPop.hidden = false;
    (this.linkPop.querySelector('[data-remove]') as HTMLElement).hidden = !editor.isActive('link');
    this.linkPop.style.left = `${Math.max(8, Math.min(a.left, innerWidth - this.linkPop.offsetWidth - 8))}px`;
    this.linkPop.style.top = `${a.bottom + 8}px`;
    this.linkInput.focus();
    this.linkInput.select();
  }

  /** True while the link field is open, or the caret's card already shows `href`. */
  linkBusy(href: string): boolean {
    return !this.linkPop.hidden || (!this.linkCard.hidden && this.linkCard.dataset.href === href);
  }

  /** The site's pages the link field searches. */
  setLinkTargets(list: LinkTarget[]): void {
    this.targets = list;
  }

  /** Lists the pages matching what is typed (not for a pasted address: that is used as it is). */
  private searchLinks(): void {
    const q = this.linkInput.value.trim().toLowerCase();
    this.found = [];
    this.linkList.replaceChildren();
    const isAddress = /^(https?:|mailto:|tel:|#|www\.)/.test(q) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(q);
    const specials = this.targets.filter((t) => t.kind === 'special');
    if (!q && specials.length) {
      // the site's special links first (nothing chosen yet: Enter on an empty field links nothing)
      const hint = document.createElement('p');
      hint.className = 'ms-link__hint';
      hint.textContent = 'Type a few words of a page title, or paste a full link. Special links:';
      this.linkList.append(hint);
      this.drawHits(specials.map((t) => ({ t })), false);
      return;
    }
    if (!q || isAddress) {
      const hint = document.createElement('p');
      hint.className = 'ms-link__hint';
      hint.textContent = q ? 'Enter to link to this address.' : 'Type a few words of a page title, or paste a full link.';
      this.linkList.append(hint);
      this.markLink(-1);
      return;
    }
    const words = q.split(/\s+/);
    const hits = this.targets
      .filter((t) => words.every((w) => `${t.title} ${t.url}`.toLowerCase().includes(w)))
      .map((t) => ({ t, s: t.kind === 'special' ? -2 : t.url === q ? -1 : t.title.toLowerCase().startsWith(q) ? 0 : t.title.toLowerCase().includes(q) ? 1 : 2 }))
      .sort((x, y) => x.s - y.s || x.t.title.localeCompare(y.t.title))
      .slice(0, 8);
    if (!hits.length) {
      const none = document.createElement('p');
      none.className = 'ms-link__hint';
      none.textContent = /^\//.test(q) ? 'No page has this address yet; Enter links to it as typed.' : 'No page matches. Paste a full link (https://…) to link elsewhere.';
      this.linkList.append(none);
    }
    this.drawHits(hits);
  }

  private drawHits(hits: { t: LinkTarget }[], choose = true): void {
    for (const { t } of hits) {
      const row = document.createElement('div');
      row.className = 'ms-link__item';
      row.setAttribute('role', 'option');
      row.id = `ms-link-${this.found.length}`;
      row.innerHTML = `<span class="ms-link__icon">${ic(t.kind === 'article' ? 'article' : t.kind === 'special' ? 'star' : 'globe', 14)}</span>`;
      if (t.kind === 'special') row.classList.add('ms-link__item--special');
      const text = document.createElement('span');
      text.className = 'ms-link__text';
      text.append(Object.assign(document.createElement('span'), { className: 'ms-link__title', textContent: t.title }));
      const abs = /^(https?:|mailto:|tel:)/.test(t.url);
      text.append(copyable(t.url, { label: t.kind === 'special' ? 'link' : 'page URL', copy: abs ? t.url : siteUrl(t.url), open: abs ? t.url : siteUrl(t.url), className: 'ms-copyable--url' }));
      row.append(text);
      row.addEventListener('mousedown', (e) => e.preventDefault());
      row.addEventListener('click', (e) => {
        if ((e.target as Element).closest('.ms-copyable__tools')) return;
        this.applyLink(t.url);
      });
      row.addEventListener('mousemove', () => this.markLink(this.found.findIndex((f) => f.row === row)));
      this.found.push({ t, row });
      this.linkList.append(row);
    }
    this.markLink(choose && this.found.length ? 0 : -1);
  }

  private markLink(n: number): void {
    this.foundActive = n;
    this.found.forEach(({ row }, i) => {
      row.classList.toggle('is-active', i === n);
      row.setAttribute('aria-selected', String(i === n));
    });
    this.linkInput.setAttribute('aria-expanded', String(this.found.length > 0));
    if (n >= 0 && this.found[n]) {
      this.linkInput.setAttribute('aria-activedescendant', this.found[n].row.id);
      this.found[n].row.scrollIntoView({ block: 'nearest' });
    } else this.linkInput.removeAttribute('aria-activedescendant');
  }

  private applyLink(href: string): void {
    const editor = this.getEditor();
    const range = this.linkRange;
    this.closeLink();
    if (!editor || !range) return;
    const chain = editor.chain().focus().setTextSelection(range);
    // a new link with no options is a plain Markdown link (the site adds what outside links need); an edited one keeps
    // the words of its target and rel the options do not touch
    const was = editor.state.doc.nodeAt(range.from)?.marks.find((m) => m.type.name === 'link')?.attrs ?? {};
    const picked = new Set(this.linkOpts.filter((b) => b.checked).map((b) => b.dataset.opt as Option));
    if (href) chain.extendMarkRange('link').setLink({ href, ...withOptions(was, picked) }).run();
    else chain.extendMarkRange('link').unsetLink().run();
    this.update();
  }

  private closeLink(refocus = false): void {
    if (this.linkPop.hidden) return;
    this.linkPop.hidden = true;
    if (refocus) this.getEditor()?.view.focus();
  }
}
