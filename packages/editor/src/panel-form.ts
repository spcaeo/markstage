// The parts the settings panel is built from: labelled inputs (with copy/open icons on links), a segmented choice,
// rows of repeated fields and the box's own items (both on the order component, panel-items.ts), action buttons and
// notes. A block's `panel(ctx)` uses them through
// PanelCtx; every change goes straight to the canvas.
import type { Editor, JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { copyable, siteUrl } from './copy';
import type { ImagePickerOpts } from './image-picker';
import { ic } from './icons';
import { attrRows, childItems } from './panel-items';

export const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

/** An element holding `text` as text (a message from the server, or anything someone else wrote): never HTML. */
export const ht = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text: string) => {
  const e = h(tag, cls);
  e.textContent = text;
  return e;
};

/**
 * A text area that grows with its text: at least `min` lines, never an inner scrollbar. It measures again when the
 * panel is resized (the text wraps differently) and when it is first shown.
 */
export function autoGrow(el: HTMLTextAreaElement, min = 4): void {
  el.rows = min;
  el.classList.add('ms-input--grow');
  const fit = () => {
    if (!el.isConnected) return;
    el.style.height = 'auto';
    const cs = getComputedStyle(el);
    const lines = parseFloat(cs.lineHeight) * min + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    el.style.height = `${Math.max(el.scrollHeight + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth), Number.isFinite(lines) ? lines : 0)}px`;
  };
  el.addEventListener('input', fit);
  let width = 0;
  new ResizeObserver(() => {
    if (el.clientWidth !== width) {
      width = el.clientWidth;
      fit();
    }
  }).observe(el);
  (el as HTMLTextAreaElement & { fit?: () => void }).fit = fit;
}

/** A part of the panel; `sync` refreshes it from the document (unless it is being typed in). */
export interface Field {
  el: HTMLElement;
  sync?: () => void;
}

export interface InputOpts {
  placeholder?: string;
  area?: boolean;
  code?: boolean;
  hint?: string;
  /** the value is a link: copy and open icons at the end of the field */
  link?: boolean;
}

export interface RowField {
  key: string;
  label: string;
  placeholder?: string;
  options?: readonly string[];
  link?: boolean;
}

export interface PanelCtx {
  editor: Editor;
  /** position of the box in the document */
  pos: number;
  /** the box as it is now (looked up again on every call) */
  node: () => PMNode | null;
  /** the page URL of the entry (for #anchors in links) */
  entryUrl: string;
  /** AI alt text for the image at `pos` (an image picker's `ai`), when the editor has it */
  altAi?: ImagePickerOpts['ai'];
  /** writes attributes of the box */
  set: (patch: Record<string, unknown>) => void;
  add: (...parts: Field[]) => void;
  input: (label: string, get: () => string, set: (v: string) => void, opts?: InputOpts) => Field;
  segmented: (label: string, options: [string, string][], get: () => string, set: (v: string) => void) => Field;
  /** rows of repeated fields kept in one array attribute */
  rows: (attr: string, fields: RowField[], blank: Record<string, string>, noun: string) => void;
  /** the box's own items (its children: FAQ questions, fact cards), to go to, reorder, duplicate and delete;
   *  `label` is what a row says (the item's words by default) */
  items: (noun: string, label?: (child: PMNode) => string) => void;
  button: (icon: string, label: string, run: () => void, kind?: 'primary' | 'danger') => HTMLButtonElement;
  actions: (...buttons: HTMLElement[]) => void;
  note: (text: string) => void;
  /** a line of text (may hold simple HTML the block wrote itself) */
  stat: (html: string) => void;
  /** inserts a node (editor shape) at `at` and puts the caret `caret` positions into it */
  insert: (at: number, json: JSONContent, caret?: number) => void;
  remove: (pos: number) => void;
}

/** Where a link opens: outside links as they are, site paths and #anchors on this server. */
export const openUrl = (base: string) => (v: string) => (/^(https?:|mailto:)/.test(v) ? v : siteUrl(v.startsWith('#') ? `${base}${v}` : v));

export function input(label: string, value: () => string, set: (v: string) => void, opts: InputOpts & { open?: (v: string) => string } = {}): Required<Field> {
  const wrap = h('label', 'ms-field');
  wrap.append(h('span', 'ms-field__label', label));
  const el = opts.area || opts.code ? h('textarea', `ms-input ms-input--area${opts.code ? ' ms-input--code' : ''}`) : h('input', 'ms-input');
  if (el instanceof HTMLInputElement) el.type = 'text';
  if (el instanceof HTMLTextAreaElement) autoGrow(el, opts.code ? 8 : 4);
  el.placeholder = opts.placeholder ?? '';
  el.spellcheck = !opts.area && !opts.code;
  const row = h('span', 'ms-field__row');
  const tools = h('span', 'ms-field__tools');
  row.append(el, tools);
  wrap.append(opts.open ? row : el);
  const syncTools = () => {
    if (!opts.open || tools.dataset.v === el.value) return;
    tools.dataset.v = el.value;
    tools.replaceChildren(el.value ? copyable(el.value, { label: label.toLowerCase(), open: opts.open(el.value), iconsOnly: true }) : '');
  };
  el.addEventListener('input', () => {
    set(el.value);
    syncTools();
  });
  if (opts.hint) wrap.append(h('span', 'ms-field__hint', opts.hint));
  const sync = () => {
    if (document.activeElement !== el && el.value !== value()) {
      el.value = value();
      (el as HTMLTextAreaElement & { fit?: () => void }).fit?.();
    }
    syncTools();
  };
  sync();
  return { el: wrap, sync };
}

/** One action of a panel: full width, icon and text on the left; `danger` ones are red and go last. */
export function actionBtn(icon: string, label: string, run: () => void, kind?: 'primary' | 'danger'): HTMLButtonElement {
  const b = h('button', `ms-action${kind ? ` ms-action--${kind}` : ''}`, `${ic(icon, 15)}<span></span>`);
  b.querySelector('span')!.textContent = label;
  b.type = 'button';
  b.addEventListener('click', run);
  return b;
}

/** A stack of actions: the others first, then a divider and the destructive ones. */
export function actionStack(buttons: HTMLElement[]): HTMLElement {
  const stack = h('div', 'ms-actions');
  const danger = buttons.filter((b) => b.classList.contains('ms-action--danger'));
  stack.append(...buttons.filter((b) => !danger.includes(b)));
  if (danger.length) {
    if (danger.length < buttons.length) stack.append(h('hr', 'ms-actions__rule'));
    stack.append(...danger);
  }
  return stack;
}

export const iconBtn = (icon: string, label: string, run: () => void, cls = 'ms-iconbtn') => {
  const b = h('button', cls, ic(icon, 14));
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.title = label;
  b.addEventListener('click', run);
  return b;
};

export const textBtn = (icon: string, label: string, run: () => void, cls = 'ms-btn ms-btn--sm') => {
  const b = h('button', cls, `${ic(icon, 14)}<span>${label}</span>`);
  b.type = 'button';
  b.addEventListener('click', run);
  return b;
};

/** The context a block's panel is drawn with. `body` is where it goes; `syncs` collects the refreshers. */
export function panelCtx(editor: Editor, pos: number, body: HTMLElement, syncs: (() => void)[], entryUrl: string, altAi?: (pos: number) => ImagePickerOpts['ai']): PanelCtx {
  const node = () => editor.state.doc.nodeAt(pos);
  const type = node()?.type.name;
  const set = (patch: Record<string, unknown>) => {
    const n = editor.state.doc.nodeAt(pos);
    if (!n || n.type.name !== type) return;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...n.attrs, ...patch }));
  };
  const add = (...parts: Field[]) => {
    for (const p of parts) {
      body.append(p.el);
      if (p.sync) syncs.push(p.sync);
    }
  };
  const link = openUrl(entryUrl);
  const ctx: PanelCtx = {
    editor,
    pos,
    node,
    entryUrl,
    altAi: altAi?.(pos),
    set,
    add,
    input: (label, get, setter, opts = {}) => input(label, get, setter, { ...opts, open: opts.link ? link : undefined }),
    segmented(label, options, get, setter) {
      const seg = h('div', 'ms-seg');
      seg.setAttribute('role', 'radiogroup');
      seg.setAttribute('aria-label', label);
      for (const [value, text] of options) {
        const b = h('button', 'ms-seg__btn', text);
        b.type = 'button';
        b.dataset.value = value;
        b.setAttribute('role', 'radio');
        b.addEventListener('click', () => setter(value));
        seg.append(b);
      }
      const sync = () => {
        for (const b of seg.querySelectorAll<HTMLButtonElement>('button')) {
          const on = b.dataset.value === get();
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-checked', String(on));
        }
      };
      const wrap = h('div', 'ms-field');
      wrap.append(h('span', 'ms-field__label', label), seg);
      sync();
      return { el: wrap, sync };
    },
    rows(attr, fields, blank, noun) {
      const rows = (): Record<string, string>[] => (node()?.attrs[attr] as Record<string, string>[]) ?? [];
      const write = (next: Record<string, string>[]) => set({ [attr]: next });
      attrRows({
        body,
        rows,
        write,
        noun,
        blank,
        syncs,
        fields: (i) =>
          fields.map((f) => {
            const get = () => String(rows()[i]?.[f.key] ?? '');
            const setter = (v: string) => write(rows().map((r, j) => (j === i ? { ...r, [f.key]: v } : r)));
            if (!f.options) return input(f.label, get, setter, { placeholder: f.placeholder, open: f.link ? link : undefined });
            const wrap = h('label', 'ms-field');
            wrap.append(h('span', 'ms-field__label', f.label));
            const sel = h('select', 'ms-input');
            for (const o of f.options) sel.append(new Option(o, o));
            sel.addEventListener('change', () => setter(sel.value));
            wrap.append(sel);
            const sync = () => void (sel.value = get());
            sync();
            return { el: wrap, sync };
          }),
      });
      body.append(actionStack([actionBtn('plus', `Add ${noun}`, () => write([...rows(), { ...blank }]))]));
    },
    items: (noun, label) => childItems({ editor, pos, body, syncs, noun, label }),
    button: actionBtn,
    actions(...buttons) {
      body.append(actionStack(buttons));
    },
    note: (text) => void body.append(Object.assign(h('p', 'ms-panel__note'), { textContent: text })),
    stat: (html) => void body.append(h('p', 'ms-panel__stat', html)),
    insert(at, json, caret = 2) {
      const tr = editor.state.tr.insert(at, editor.schema.nodeFromJSON(json));
      tr.setSelection(TextSelection.create(tr.doc, at + caret));
      editor.view.dispatch(tr.scrollIntoView());
      editor.view.focus();
    },
    remove(at) {
      const n = editor.state.doc.nodeAt(at);
      if (!n) return;
      const tr = editor.state.tr.delete(at, at + n.nodeSize);
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(at, tr.doc.content.size))));
      editor.view.dispatch(tr);
      editor.view.focus();
    },
  };
  return ctx;
}
