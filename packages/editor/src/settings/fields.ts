// The Post settings fields (one per `settings` entry of the collection config): text, textarea (with a character
// counter), slug (with the address it gives), date, tags, select (choices from another collection), image (path,
// preview, alt text), author (the site's authors, author-field.ts) and switch (on or off). Each reads and writes the pending frontmatter
// (state.ts); nothing is saved until ⌘S. A field whose key the person's role may not change is greyed out
// (field-access.ts lockField).
import type { AiEditor } from '../ai/editor';
import { echoDate } from '../dates';
import { copyable, siteUrl } from '../copy';
import { imageKeys, lockField } from '../field-access';
import { imagePicker } from '../image-picker';
import { autoGrow, h, iconBtn } from '../panel-form';
import { config, type SettingField } from '../runtime';
import { authorField } from './author-field';
import { holds, type FrontmatterEdits } from './state';

export interface FieldCtx {
  edits: FrontmatterEdits;
  /** the open entry's page address as saved (null: no page) */
  url: () => string | null;
  /** a media path from the frontmatter -> a URL the browser can show */
  media: (src: string) => string;
  /** [value, label] choices: the entries of a collection */
  choices: (collection: string) => Promise<[string, string][]>;
  /** every tag used in the collection, for suggestions */
  tags: () => Promise<string[]>;
  /** where entries can be moved (the Markstage server): the slug field changes the address at once */
  move?: AddressMove;
  /** how the writer knows a frontmatter key ("the title", "the excerpt") */
  fieldName?: (key: string) => string;
  /** the media library chooser of the image field for `key` opens or closes (its state is in the URL) */
  library?: (key: string, open: boolean) => void;
  /** AI suggestions (alt text, a region's title and description), each at its URL */
  ai?: AiEditor;
}

export interface AddressMove {
  /** the entry is live: the move publishes */
  live(): boolean;
  /** the entry's id (its file name): the address part when the frontmatter has no slug */
  id(): string;
  /** moves the entry so its address ends in `slug` (the frontmatter key `key`); an error message, or null once moved */
  run(key: string, slug: string): Promise<string | null>;
}

export interface DrawnField {
  el: HTMLElement;
  sync: () => void;
  /** focuses the field's first input (a click on the cover in the canvas head opens this field) */
  focus: () => void;
  /** an image field: opens its media library chooser */
  library?: () => Promise<void>;
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
let uid = 0;

/** A labelled box around `control`; returns the parts the field types fill in. */
function frame(label: string, hint?: string) {
  const el = h('div', 'ms-field');
  const id = `ms-set-${++uid}`;
  const lab = h('label', 'ms-field__label');
  lab.textContent = label;
  lab.htmlFor = id;
  const top = h('div', 'ms-field__top');
  const count = h('span', 'ms-count');
  top.append(lab, count);
  el.append(top);
  const after = h('div', 'ms-field__after');
  if (hint) after.append(Object.assign(h('span', 'ms-field__hint'), { textContent: hint }));
  return { el, id, count, after };
}

/** "45 / 60" next to the label; over the limit it turns red. */
export function counter(el: HTMLElement, length: number, max?: number): void {
  if (!max) return void (el.textContent = '');
  el.textContent = `${length} / ${max}`;
  el.classList.toggle('is-over', length > max);
}

/** The server's hard limits (content/limits.mjs): a title 300, a description 500, a name 100, an address part 200. */
export const HARD = { title: 300, description: 500, name: 100, segment: 200 };

export function textInput(f: { key: string; label: string; hint?: string; max?: number; placeholder?: string }, ctx: FieldCtx, area = false, placeholder = () => f.placeholder ?? ''): DrawnField {
  const { el, id, count, after } = frame(f.label, f.hint);
  const input = area ? h('textarea', 'ms-input ms-input--area') : h('input', 'ms-input');
  input.id = id;
  // `max` is the advice (60 for a search title); the hard line is the server's, so the field stops there
  input.maxLength = area ? HARD.description : HARD.title;
  if (input instanceof HTMLInputElement) input.type = 'text';
  if (input instanceof HTMLTextAreaElement) autoGrow(input, 3);
  input.addEventListener('input', () => {
    ctx.edits.set(f.key, input.value);
    counter(count, input.value.length, f.max);
  });
  el.append(input, after);
  const sync = () => {
    const v = str(ctx.edits.get(f.key));
    if (!holds(input) && input.value !== v) {
      input.value = v;
      (input as HTMLTextAreaElement & { fit?: () => void }).fit?.();
    }
    input.placeholder = placeholder();
    counter(count, (input.value || input.placeholder).length, f.max);
  };
  sync();
  if (!ctx.edits.may(f.key)) lockField(el);
  return { el, sync, focus: () => input.focus() };
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

function slugField(f: { key: string; label: string; hint?: string }, ctx: FieldCtx): DrawnField {
  const field = textInput(f, ctx);
  const input = field.el.querySelector('input')!;
  input.spellcheck = false;
  input.maxLength = HARD.segment;
  input.addEventListener('blur', () => {
    const v = slugify(input.value);
    if (v && v !== input.value) {
      input.value = v;
      ctx.edits.set(f.key, v);
    }
  });
  const out = h('div', 'ms-field__url');
  field.el.querySelector('.ms-field__after')!.prepend(out);
  const saved = str(ctx.edits.get(f.key));
  const sync = () => {
    field.sync();
    const v = str(ctx.edits.get(f.key));
    out.replaceChildren();
    const url = ctx.url();
    const ok = SLUG.test(v);
    input.classList.toggle('is-invalid', !ok);
    if (!ok) return void out.append(Object.assign(h('span', 'ms-field__error'), { textContent: 'Lower-case letters, digits and dashes only.' }));
    const now = str(ctx.edits.get(f.key));
    if (!url) return;
    // the page address with the last part replaced (the site builds addresses as …/<slug>/)
    const next = url.endsWith(`/${saved}/`) ? `${url.slice(0, -saved.length - 1)}${now}/` : url;
    out.append(copyable(next, { label: 'page URL', copy: siteUrl(next), open: siteUrl(url), className: 'ms-copyable--url' }));
    if (now !== saved) out.append(Object.assign(h('span', 'ms-field__hint'), { textContent: 'The page moves here when you save. Links to the old address stop working unless the site redirects them.' }));
  };
  sync();
  return { el: field.el, sync, focus: field.focus };
}

/**
 * The slug where the server can move entries: the address changes at once, not with ⌘S, because a move renames the
 * file, updates the site's links to it and records a redirect (POST …/move). Typing shows the new address and
 * Change address / Cancel; Enter changes it, Escape puts the old one back.
 */
function addressField(f: { key: string; label: string; hint?: string }, ctx: FieldCtx, move: AddressMove): DrawnField {
  const { el, id, after } = frame(f.label, f.hint);
  const input = h('input', 'ms-input');
  input.id = id;
  input.spellcheck = false;
  input.autocomplete = 'off';
  const out = h('div', 'ms-field__url');
  after.prepend(out);
  const box = h('div', 'ms-move');
  box.hidden = true;
  const note = h('p', 'ms-move__note');
  const error = h('p', 'ms-field__error');
  error.setAttribute('role', 'alert');
  const go = h('button', 'ms-btn ms-btn--sm ms-btn--primary');
  go.type = 'button';
  const cancel = h('button', 'ms-btn ms-btn--sm', 'Cancel');
  cancel.type = 'button';
  const row = h('div', 'ms-move__actions');
  row.append(go, cancel);
  box.append(note, error, row);
  el.append(input, box, after);
  const saved = () => str(ctx.edits.get(f.key)) || move.id();
  let busy = false;
  const draw = () => {
    const v = input.value;
    const was = saved();
    const ok = SLUG.test(v);
    input.classList.toggle('is-invalid', !ok);
    out.replaceChildren();
    const url = ctx.url();
    if (!ok) out.append(Object.assign(h('span', 'ms-field__error'), { textContent: 'Lower-case letters, digits and dashes only.' }));
    else if (url) {
      const next = url.endsWith(`/${was}/`) ? `${url.slice(0, -was.length - 1)}${v}/` : url;
      out.append(copyable(next, { label: 'page URL', copy: siteUrl(next), open: v === was ? siteUrl(url) : undefined, className: 'ms-copyable--url' }));
    }
    box.hidden = !ok || v === was;
    if (box.hidden) return;
    const live = move.live();
    const after = config().redirects ? 'and the old address redirects to the new one.' : 'but links from other sites to the old address stop working.';
    // a draft was never at the old address, so nothing redirects (QA F35)
    note.textContent = live ? `This page is live: the new address is published at once. Links on this site are updated, ${after}` : 'Links on this site to it are updated. It is not live, so there is no old address to redirect.';
    go.innerHTML = `<span>${live ? 'Change and publish' : 'Change address'}</span>`;
    go.disabled = busy;
    cancel.disabled = busy;
  };
  const reset = () => {
    input.value = saved();
    error.textContent = '';
    draw();
  };
  const run = async () => {
    const v = slugify(input.value);
    if (busy || !SLUG.test(v) || v === saved()) return;
    input.value = v;
    busy = true;
    error.textContent = '';
    draw();
    go.innerHTML = '<span>Changing…</span>';
    const failed = await move.run(f.key, v).catch((e: Error) => e.message);
    busy = false;
    if (failed) error.textContent = failed;
    draw();
  };
  input.addEventListener('input', () => {
    error.textContent = '';
    draw();
  });
  input.addEventListener('blur', () => {
    const v = slugify(input.value);
    if (v && v !== input.value) {
      input.value = v;
      draw();
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void run();
    } else if (e.key === 'Escape' && input.value !== saved()) {
      e.stopPropagation();
      reset();
    }
  });
  go.addEventListener('click', () => void run());
  cancel.addEventListener('click', () => {
    reset();
    input.focus();
  });
  input.value = saved();
  draw();
  if (!ctx.edits.may(f.key)) lockField(el);
  return { el, sync: () => (busy || document.activeElement === input || box.hidden === false ? undefined : reset()), focus: () => input.focus() };
}

/** Dates as the file writes them: a day (2026-10-28), or a moment in UTC in the file's own form (+00:00 or Z). */
function dateField(f: { key: string; label: string; hint?: string }, ctx: FieldCtx): DrawnField {
  const { el, id, after } = frame(f.label, f.hint);
  const input = h('input', 'ms-input');
  input.id = id;
  el.append(input, after);
  const day = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const zone = (v: string) => (/Z$/.test(v) ? 'Z' : (/([+-]\d{2}:\d{2})$/.exec(v)?.[1] ?? '+00:00'));
  input.addEventListener('change', () => {
    const was = str(ctx.edits.get(f.key));
    if (!input.value) return ctx.edits.set(f.key, null);
    if (input.type === 'date') return ctx.edits.set(f.key, input.value);
    const t = new Date(`${input.value}:00Z`);
    if (Number.isNaN(t.valueOf())) return;
    const iso = t.toISOString().slice(0, 19);
    ctx.edits.set(f.key, zone(was) === 'Z' ? `${iso}Z` : `${iso}+00:00`);
  });
  const sync = () => {
    const v = str(ctx.edits.get(f.key));
    input.type = !v || day(v) ? 'date' : 'datetime-local';
    if (input.type === 'datetime-local') {
      const t = new Date(v);
      input.step = '1';
      if (!holds(input)) input.value = Number.isNaN(t.valueOf()) ? '' : t.toISOString().slice(0, 19);
      input.title = 'In UTC';
    } else if (!holds(input)) input.value = v.slice(0, 10);
  };
  if (!after.childElementCount && !f.hint) after.append(Object.assign(h('span', 'ms-field__hint'), { textContent: 'Times are in UTC.' }));
  // the chosen day (or time, in UTC like the value) in the site's words beside the browser's own picker (QA F38)
  const words = echoDate(input, { utc: true });
  sync();
  words.hidden = !words.textContent;
  if (!ctx.edits.may(f.key)) lockField(el);
  return { el, sync, focus: () => input.focus() };
}

function tagsField(f: { key: string; label: string; hint?: string }, ctx: FieldCtx): DrawnField {
  const locked = !ctx.edits.may(f.key);
  const { el, id, after } = frame(f.label, locked ? f.hint : (f.hint ?? 'Enter or comma adds a tag.'));
  const box = h('div', 'ms-tags');
  const input = h('input', 'ms-tags__input');
  input.id = id;
  input.maxLength = HARD.name;
  const list = h('datalist');
  list.id = `${id}-list`;
  input.setAttribute('list', list.id);
  box.addEventListener('click', (e) => e.target === box && input.focus());
  const tags = () => (Array.isArray(ctx.edits.get(f.key)) ? (ctx.edits.get(f.key) as unknown[]).map(String) : []);
  const add = (t: string) => {
    const v = t.trim();
    if (v && !tags().includes(v)) ctx.edits.set(f.key, [...tags(), v]);
    input.value = '';
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(input.value);
    } else if (e.key === 'Backspace' && !input.value && tags().length) ctx.edits.set(f.key, tags().slice(0, -1));
  });
  input.addEventListener('change', () => input.value && add(input.value));
  input.addEventListener('focus', () => void ctx.tags().then((all) => list.replaceChildren(...all.filter((t) => !tags().includes(t)).map((t) => new Option(t)))), { once: true });
  el.append(box, list, after);
  const sync = () => {
    box.replaceChildren(
      ...tags().map((t) => {
        const chip = h('span', 'ms-tag');
        chip.append(copyable(t, { label: 'tag', iconsOnly: false }));
        if (!locked) chip.append(iconBtn('x', `Remove tag ${t}`, () => ctx.edits.set(f.key, tags().filter((x) => x !== t)), 'ms-iconbtn ms-tag__x'));
        return chip;
      }),
      input,
    );
  };
  sync();
  if (locked) lockField(el);
  return { el, sync, focus: () => input.focus() };
}

function selectField(f: { key: string; label: string; hint?: string; from?: string; options?: [string, string][] }, ctx: FieldCtx): DrawnField {
  const { el, id, after } = frame(f.label, f.hint);
  const select = h('select', 'ms-input');
  select.id = id;
  let choices: [string, string][] = f.options ?? [];
  let loading = !!f.from;
  const fill = () => {
    const v = str(ctx.edits.get(f.key));
    const all = v && !choices.some(([c]) => c === v) ? [[v, v] as [string, string], ...choices] : choices;
    // while the list is on its way the box says so (QA F22), instead of an empty "—"
    select.replaceChildren(new Option(loading ? `Loading ${f.label.toLowerCase()}s…` : '—', ''), ...all.map(([value, label]) => new Option(label === value ? label : `${label}`, value)));
    select.value = v;
    select.disabled = loading;
  };
  if (f.from)
    void ctx.choices(f.from).then((c) => {
      choices = c;
      loading = false;
      fill();
    }, () => {
      loading = false;
      fill();
    });
  select.addEventListener('change', () => ctx.edits.set(f.key, select.value || null));
  el.append(select, after);
  fill();
  if (!ctx.edits.may(f.key)) lockField(el);
  return { el, sync: () => (select.value !== str(ctx.edits.get(f.key)) ? fill() : undefined), focus: () => select.focus() };
}

function imageField(f: Extract<SettingField, { type: 'image' }>, ctx: FieldCtx): DrawnField {
  const fb = f.altFallback;
  // another picture also clears its alt text and focal point: the field is the person's when every key is
  const locked = !imageKeys(f).every((k) => ctx.edits.may(k));
  const drawn = imagePicker({
    label: f.label,
    hint: f.hint,
    get: () => str(ctx.edits.get(f.key)),
    set: (v) =>
      ctx.edits.group(() => {
        ctx.edits.set(f.key, v);
        // another picture's size and focal point no longer apply; with no picture its alt text goes too
        for (const k of [...(f.clears ?? []), ...(f.focal ? [f.focal] : []), ...(!v && f.alt ? [f.alt] : [])]) ctx.edits.set(k, null);
      }),
    url: ctx.media,
    alt: f.alt
      ? {
          get: () => str(ctx.edits.get(f.alt!)),
          set: (v) => ctx.edits.set(f.alt!, v),
          fallback: fb ? { name: ctx.fieldName?.(fb) ?? `“${fb}”`, text: () => str(ctx.edits.get(fb)) } : undefined,
        }
      : undefined,
    route: ctx.library ? (open) => ctx.library!(f.key, open) : undefined,
    ai: ctx.ai && f.alt && !locked ? ctx.ai.alt(f.key, () => str(ctx.edits.get(f.key)), f.label) : undefined,
  });
  if (!locked) return drawn;
  lockField(drawn.el);
  return { ...drawn, library: undefined };
}

/** On or off. The file holds the key only when it is not the default: turned back to it, the key is removed. */
function switchField(f: Extract<SettingField, { type: 'switch' }>, ctx: FieldCtx): DrawnField {
  const el = h('div', 'ms-field ms-field--switch');
  const id = `ms-set-${++uid}`;
  const lab = h('label', 'ms-switch');
  lab.htmlFor = id;
  const input = h('input', 'ms-switch__box');
  input.type = 'checkbox';
  input.id = id;
  lab.append(input, Object.assign(h('span', 'ms-switch__label'), { textContent: f.label }));
  el.append(lab);
  if (f.hint) el.append(Object.assign(h('span', 'ms-field__hint'), { textContent: f.hint }));
  const on = () => {
    const v = ctx.edits.get(f.key);
    return typeof v === 'boolean' ? v : (f.default ?? false);
  };
  input.addEventListener('change', () => ctx.edits.set(f.key, input.checked === (f.default ?? false) ? null : input.checked));
  const sync = () => void (input.checked = on());
  sync();
  if (!ctx.edits.may(f.key)) lockField(el);
  return { el, sync, focus: () => input.focus() };
}

/** Draws one plain field (seo and social are drawn by previews.ts). */
export function drawField(f: SettingField, ctx: FieldCtx): DrawnField | null {
  switch (f.type) {
    case 'text':
      return textInput(f, ctx);
    case 'textarea':
      return textInput(f, ctx, true);
    case 'slug':
      return ctx.move ? addressField(f, ctx, ctx.move) : slugField(f, ctx);
    case 'date':
      return dateField(f, ctx);
    case 'tags':
      return tagsField(f, ctx);
    case 'select':
      return selectField(f, ctx);
    case 'image':
      return imageField(f, ctx);
    case 'author':
      return authorField(f, ctx);
    case 'switch':
      return switchField(f, ctx);
    default:
      return null;
  }
}
