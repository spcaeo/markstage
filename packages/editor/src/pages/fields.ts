// The side panel's form for a part of the page entry, drawn from its schema: text and HTML text, numbers, switches,
// choices (enums), links to other entries, images (with the media library when there is one), links (with the link
// search), and lists (add; drag, move, duplicate and remove on the shared order component, order.ts). Every edit is one change in the model; `sync()` brings the
// inputs up to date after an edit made elsewhere (on the page, undo). A field the person may not change (read-only,
// or a role that changes some fields only: PageModel.may) is drawn greyed out (field-access.ts lockField).
import { lockField } from '../field-access';
import { h, input, openUrl, textBtn } from '../panel-form';
import { ic } from '../icons';
import { listEntries } from '../api';
import type { PagesAi } from './ai';
import type { PageModel } from './model';
import { mountPageList } from './order';
import { isHtml, itemTitle, labelOf, newItem, roleOf } from './schema';
import type { Field, PageHost } from './types';

export interface FieldsCtx {
  model: PageModel;
  root: Field;
  /** the page's URL (for #anchors in links) */
  entryUrl: string;
  entryId: string;
  host: Pick<PageHost, 'pickImage' | 'searchLinks'>;
  /** where an image path is served from, for the thumbnail */
  mediaUrl: (src: string) => string;
  /** keys the site keeps out of the editor (its `hiddenFields`) */
  hidden: (path: string) => boolean;
  /** lists opened by the writer, by path (kept across redraws) */
  open: Set<string>;
  /** a list was changed (items added, moved or removed): the panel draws again */
  restructure: () => void;
  /** AI alt text for image fields (ai.ts), when the editor has it */
  ai?: PagesAi;
}

type Sync = () => void;
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
// the form helpers draw a hint as markup
const esc = (s: string | undefined) => s?.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const join = (path: string, key: string | number) => (path ? `${path}.${key}` : String(key));

/** Draws `field` (stored at `path`) into `parent`; returns the refreshers. */
export function drawField(parent: HTMLElement, path: string, field: Field, key: string | number, ctx: FieldsCtx, syncs: Sync[]): void {
  // a group of fields (not an image or a link) is decided field by field: its own fields lock themselves; inside a
  // field drawn greyed out (a list, an image), what it holds is greyed with it, without a note of its own
  const group = field.type === 'conditional' || (field.type === 'object' && !roleOf(field));
  if (group || inLocked || parent.closest('.is-locked') || ctx.model.may(path)) return drawOne(parent, path, field, key, ctx, syncs);
  const last = parent.lastElementChild;
  inLocked = true;
  try {
    drawOne(parent, path, field, key, ctx, syncs);
  } finally {
    inLocked = false;
  }
  for (let el = last ? last.nextElementSibling : parent.firstElementChild; el; el = el.nextElementSibling) if (el instanceof HTMLElement) lockField(el);
}
let inLocked = false;

function drawOne(parent: HTMLElement, path: string, field: Field, key: string | number, ctx: FieldsCtx, syncs: Sync[]): void {
  if (ctx.hidden(path)) return;
  const label = labelOf(field, key);
  const set = (value: unknown) => ctx.model.change({ op: 'set', path, value });
  const get = () => ctx.model.get(path);
  const wrap = (el: HTMLElement) => {
    el.dataset.path = path;
    parent.append(el);
    return el;
  };
  const hint = (el: HTMLElement) => field.description && el.append(h('span', 'ms-field__hint', esc(field.description)));

  switch (field.type) {
    case 'ignored':
    case 'content':
      return; // kept as stored; changed elsewhere (status, the article body)
    case 'text': {
      const rich = isHtml(field);
      const f = input(label, () => str(get()), set, {
        area: field.multiline || rich,
        code: rich,
        hint: rich ? 'HTML: &lt;strong&gt;, &lt;em&gt;, &lt;a href&gt;, &lt;br&gt; and lists are kept as written.' : esc(field.description),
      });
      wrap(f.el);
      syncs.push(f.sync);
      return;
    }
    case 'slug':
      if (field.stored === false) {
        // the file name, not a value in the file: shown, renamed elsewhere
        const f = wrap(h('div', 'ms-field'));
        f.append(h('span', 'ms-field__label', label), h('span', 'ms-panel__stat', ctx.entryId));
        return;
      }
    // falls through: a slug stored in the file is edited as text
    case 'url':
    case 'date':
    case 'datetime': {
      const f = input(label, () => str(get()), set, {
        placeholder: field.type === 'date' ? 'YYYY-MM-DD' : field.type === 'datetime' ? 'YYYY-MM-DDTHH:MM' : '',
        ...(field.type === 'url' ? { open: openUrl(ctx.entryUrl), link: true } : {}),
        hint: esc(field.description),
      });
      wrap(f.el);
      syncs.push(f.sync);
      return;
    }
    case 'number': {
      const f = h('label', 'ms-field');
      f.append(h('span', 'ms-field__label', label));
      const el = h('input', 'ms-input');
      el.type = 'number';
      el.addEventListener('input', () => (el.value === '' ? ctx.model.change({ op: 'remove', path }) : set(Number(el.value))));
      f.append(el);
      hint(f);
      wrap(f);
      const sync = () => document.activeElement !== el && (el.value = str(get()));
      sync();
      syncs.push(sync);
      return;
    }
    case 'checkbox': {
      const f = h('label', 'ms-field ms-field--check');
      const el = h('input');
      el.type = 'checkbox';
      el.addEventListener('change', () => set(el.checked));
      f.append(el, h('span', 'ms-field__label', label));
      hint(f);
      wrap(f);
      const sync = () => void (el.checked = get() === true || (get() === undefined && field.default === true));
      sync();
      syncs.push(sync);
      return;
    }
    case 'select':
    case 'relationship': {
      const f = h('label', 'ms-field');
      f.append(h('span', 'ms-field__label', label));
      const el = h('select', 'ms-input');
      const fill = (options: { value: string; label: string }[]) => {
        el.replaceChildren(...[{ value: '', label: '(none)' }, ...options].map((o) => Object.assign(document.createElement('option'), { value: o.value, textContent: o.label })));
        sync();
      };
      el.addEventListener('change', () => (el.value === '' && field.type === 'relationship' ? ctx.model.change({ op: 'remove', path }) : set(el.value)));
      f.append(el);
      hint(f);
      wrap(f);
      const sync = () => {
        const v = str(get());
        if (v && ![...el.options].some((o) => o.value === v)) el.append(Object.assign(document.createElement('option'), { value: v, textContent: v }));
        el.value = v;
      };
      if (field.type === 'select') fill(field.options);
      else if (field.collection)
        listEntries(field.collection)
          .then((list) => fill(list.map((e) => ({ value: e.id, label: e.title || e.id }))))
          .catch(() => fill([]));
      else fill([]);
      syncs.push(sync);
      return;
    }
    case 'image':
      return imageField(parent, path, field, label, ctx, syncs, false);
    case 'object': {
      if (roleOf(field) === 'image') return imageField(parent, path, field, label, ctx, syncs, true);
      if (roleOf(field) === 'link') return linkField(parent, path, field, label, ctx, syncs);
      const box = wrap(h('fieldset', 'msp-group'));
      box.append(h('legend', 'msp-group__label', label));
      for (const [k, f] of Object.entries(field.fields)) drawField(box, join(path, k), f, k, ctx, syncs);
      return;
    }
    case 'array':
      return listField(parent, path, field, label, ctx, syncs);
    case 'conditional': {
      const kind = str((get() as Record<string, unknown> | undefined)?.[field.storage?.discriminant ?? 'discriminant']);
      const branch = field.values[kind];
      if (branch) drawField(parent, join(path, field.storage?.value ?? 'value'), branch, key, ctx, syncs);
      return;
    }
    default: {
      // custom: shown as stored
      const f = wrap(h('div', 'ms-field'));
      f.append(h('span', 'ms-field__label', label));
      const pre = h('pre', 'msp-raw');
      pre.textContent = JSON.stringify(get() ?? null, null, 2);
      f.append(pre);
    }
  }
}

function imageField(parent: HTMLElement, path: string, field: Field, label: string, ctx: FieldsCtx, syncs: Sync[], object: boolean): void {
  const box = h('fieldset', 'msp-group msp-image');
  box.dataset.path = path;
  box.append(h('legend', 'msp-group__label', label));
  const srcPath = object ? join(path, 'src') : path;
  const altPath = object ? join(path, 'alt') : null;
  const thumb = h('div', 'msp-image__thumb');
  box.append(thumb);
  const drawThumb = () => {
    const src = str(ctx.model.get(srcPath));
    thumb.replaceChildren();
    if (!src) thumb.append(h('span', 'msp-image__none', 'No image'));
    else {
      const img = document.createElement('img');
      img.alt = '';
      img.src = ctx.mediaUrl(src);
      thumb.append(img);
    }
  };
  if (ctx.host.pickImage) {
    box.append(
      textBtn('upload', 'Choose image', async () => {
        const got = await ctx.host.pickImage!({ src: str(ctx.model.get(srcPath)), alt: altPath ? str(ctx.model.get(altPath)) : '' });
        if (!got) return;
        ctx.model.settle();
        ctx.model.change({ op: 'set', path: srcPath, value: got.src });
        if (altPath && got.alt) ctx.model.change({ op: 'set', path: altPath, value: got.alt });
      }),
    );
  }
  const src = input('File', () => str(ctx.model.get(srcPath)), (v) => ctx.model.change({ op: 'set', path: srcPath, value: v }), { placeholder: '2026/10/picture.webp' });
  box.append(src.el);
  syncs.push(src.sync, drawThumb);
  if (altPath) {
    const alt = input('Alt text', () => str(ctx.model.get(altPath)), (v) => ctx.model.change({ op: 'set', path: altPath, value: v }), {
      hint: 'What the image shows, for people who cannot see it.',
    });
    box.append(alt.el);
    syncs.push(alt.sync);
    if (ctx.ai) {
      // "Suggest alt text", and its suggestion under the alt text while the URL asks for it
      const ai = ctx.ai;
      const altOf = { get: () => str(ctx.model.get(altPath)), set: (v: string) => ctx.model.change({ op: 'set', path: altPath, value: v }) };
      const ask = ai.button(path);
      const slot = h('div', 'msp-image__ai');
      box.append(ask, slot);
      const place = () => {
        const has = !!str(ctx.model.get(srcPath));
        ask.hidden = !has;
        const card = has ? ai.card(path, () => str(ctx.model.get(srcPath)), altOf) : null;
        if (card && card.parentElement !== slot) slot.replaceChildren(card);
        if (!card) slot.replaceChildren();
      };
      syncs.push(place);
      place();
    }
  }
  if (object && field.type === 'object')
    for (const [k, f] of Object.entries(field.fields)) if (k !== 'src' && k !== 'alt') drawField(box, join(path, k), f, k, ctx, syncs);
  drawThumb();
  parent.append(box);
}

function linkField(parent: HTMLElement, path: string, field: Extract<Field, { type: 'object' }>, label: string, ctx: FieldsCtx, syncs: Sync[]): void {
  const box = h('fieldset', 'msp-group msp-link');
  box.dataset.path = path;
  box.append(h('legend', 'msp-group__label', label));
  const text = input('Text', () => str(ctx.model.get(join(path, 'text'))), (v) => ctx.model.change({ op: 'set', path: join(path, 'text'), value: v }));
  const href = input('Link', () => str(ctx.model.get(join(path, 'href'))), (v) => ctx.model.change({ op: 'set', path: join(path, 'href'), value: v }), {
    open: openUrl(ctx.entryUrl),
    link: true,
    placeholder: '/contact-us/ or https://…',
  });
  box.append(text.el, href.el);
  syncs.push(text.sync, href.sync);
  linkSearch(href.el.querySelector('input')!, ctx);
  for (const [k, f] of Object.entries(field.fields)) if (k !== 'text' && k !== 'href') drawField(box, join(path, k), f, k, ctx, syncs);
  parent.append(box);
}

/** Suggestions under a link input: the site's pages and posts that match what is typed. */
function linkSearch(el: HTMLInputElement, ctx: FieldsCtx): void {
  const list = document.createElement('datalist');
  list.id = `msp-links-${Math.random().toString(36).slice(2, 9)}`;
  el.setAttribute('list', list.id);
  el.after(list);
  let last = '';
  el.addEventListener('input', async () => {
    const q = el.value.trim();
    if (q.length < 2 || q === last || /^(https?:|mailto:|tel:)/.test(q)) return;
    last = q;
    const found = await ctx.host.searchLinks(q).catch(() => []);
    if (last !== q) return;
    list.replaceChildren(...found.slice(0, 12).map((l) => Object.assign(document.createElement('option'), { value: l.href, label: l.label })));
  });
}

function listField(parent: HTMLElement, path: string, field: Extract<Field, { type: 'array' }>, label: string, ctx: FieldsCtx, syncs: Sync[]): void {
  const box = h('fieldset', 'msp-group msp-list');
  box.dataset.path = path;
  const items = () => (Array.isArray(ctx.model.get(path)) ? (ctx.model.get(path) as unknown[]) : []);
  const legend = h('legend', 'msp-group__label');
  box.append(legend);
  const noun = labelOf(field.item, 'item').toLowerCase();
  const count = () => (legend.textContent = `${label} (${items().length})`);
  count();
  syncs.push(count);
  // each row's refreshers, by item id: the order component draws the rows again after its own changes
  const rowSyncs = new Map<string, Sync[]>();
  const rows = h('div', 'msp-list__rows');
  box.append(rows);
  const order = mountPageList({
    model: ctx.model,
    path,
    root: rows,
    label,
    noun,
    title: (v, i) => itemTitle(v) || `${labelOf(field.item, i)}`,
    row: (item) => {
      const i = item.index;
      const itemPath = join(path, i);
      const own: Sync[] = [];
      rowSyncs.set(item.id, own);
      const row = h('details', 'msp-item');
      row.dataset.path = itemPath;
      row.open = ctx.open.has(itemPath);
      row.addEventListener('toggle', () => (row.open ? ctx.open.add(itemPath) : ctx.open.delete(itemPath)));
      const sum = h('summary', 'msp-item__head');
      const title = h('span', 'msp-item__title');
      const syncTitle = () => (title.textContent = itemTitle(ctx.model.get(itemPath)) || `${labelOf(field.item, i)}`);
      syncTitle();
      own.push(syncTitle);
      sum.append(h('span', 'msp-item__chev', ic('down', 12)), title);
      row.append(sum);
      const body = h('div', 'msp-item__body');
      drawField(body, itemPath, field.item, i, ctx, own);
      row.append(body);
      return row;
    },
    // the open items follow their moves
    reindex: (map) => {
      const prefix = `${path}.`;
      const moved = [...ctx.open].filter((p) => p.startsWith(prefix) && /^\d+(\.|$)/.test(p.slice(prefix.length)));
      for (const p of moved) ctx.open.delete(p);
      for (const p of moved) {
        const [, i, rest] = /^(\d+)(.*)$/.exec(p.slice(prefix.length))!;
        const to = map.get(Number(i));
        if (to !== null && to !== undefined) ctx.open.add(`${prefix}${to}${rest}`);
      }
    },
  });
  syncs.push(() => {
    const live = new Set(order.ids());
    for (const [id, own] of rowSyncs) if (live.has(id)) for (const s of own) s();
    else rowSyncs.delete(id);
  });
  box.append(
    textBtn('plus', `Add ${noun}`, () => {
      ctx.model.settle();
      const value = newItem(ctx.root, path, ctx.model.data);
      const now = ctx.model.get(path);
      // the new item's index, read before the insert (which changes the list in place); it opens ready to fill
      const index = Array.isArray(now) ? now.length : 0;
      ctx.open.add(join(path, index));
      if (Array.isArray(now)) ctx.model.change({ op: 'insert', path, index, value });
      else ctx.model.change({ op: 'set', path, value: [value] });
      ctx.restructure();
    }),
  );
  parent.append(box);
}

/** The structure the panel was drawn for (list lengths, section kinds): when it changes, the panel draws again. */
export function shapeKey(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(shapeKey).join(',')}]`;
  // only lists, nested objects and section kinds count: typing a text (even one that was not stored yet) does not
  if (isObject(v))
    return `{${Object.entries(v)
      .filter(([k, x]) => typeof x === 'object' || k === 'discriminant')
      .map(([k, x]) => `${k}:${k === 'discriminant' ? String(x) : shapeKey(x)}`)
      .join(',')}}`;
  return '';
}
