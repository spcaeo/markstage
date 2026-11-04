// The parts the admin screens are built from, in the shell's calm style (its --ms-* tokens, .ms-btn, .ms-input,
// copyable()): a page with a head and a body, filters bound to the URL, tables, a side drawer for the open item,
// forms that show a 422's field messages, empty and error states, and dates people can read.
import { ApiError } from '../api';
import { copyable, copyText, siteUrl } from '../copy';
import type { ScreenCtx } from '../host';
import { ic } from '../icons';
import { MISMATCH, mismatched, withEye } from '../password';
import { releaseFooter } from '../release';
import type { Me } from './api';
import { me as fetchMe, undoChange } from './api';
import { LOCALE } from '../dates';

type Child = Node | string | null | undefined | false;

/** A tiny element builder: el('div.ms-adm-x', {type: 'button'}, child, …). Text children are text, never HTML. */
export function el<K extends keyof HTMLElementTagNameMap>(sel: K | `${K}.${string}`, attrs: Record<string, string | boolean | number | null | undefined> | Child = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const [tag, ...classes] = sel.split('.');
  const e = document.createElement(tag as K);
  if (classes.length) e.className = classes.join(' ');
  if (attrs instanceof Node || typeof attrs === 'string' || attrs === null || attrs === undefined || attrs === false) children.unshift(attrs as Child);
  else {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'html') e.innerHTML = String(v);
      else e.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

/** An icon (from the shell's set, or one of ours) as a node. */
export const icon = (name: string, size = 16) => {
  const s = document.createElement('span');
  s.className = 'ms-adm-ico';
  s.innerHTML = ADMIN_ICONS[name] ? ADMIN_ICONS[name].replaceAll('{s}', String(size)) : ic(name, size);
  return s;
};

const svg = (paths: string) =>
  `<svg class="ms-i" width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
// a few Lucide shapes the shell's set does not have
const ADMIN_ICONS: Record<string, string> = {
  users: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  user: svg('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  shield: svg('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>'),
  key: svg('<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>'),
  image: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>'),
  history: svg('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'),
  log: svg('<path d="M13 12h8"/><path d="M13 18h8"/><path d="M13 6h8"/><path d="M3 12h1"/><path d="M3 18h1"/><path d="M3 6h1"/><path d="M8 12h1"/><path d="M8 18h1"/><path d="M8 6h1"/>'),
  rocket: svg('<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>'),
  logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>'),
  refresh: svg('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'),
};

// ---------- the signed-in user ----------
let cached: Promise<Me> | null = null;
/** auth/me, once per page (reset after sign-in, sign-out or a change to the own account). */
export const whoami = (fresh = false): Promise<Me> => {
  if (fresh || !cached) cached = fetchMe().catch((e) => ((cached = null), Promise.reject(e)));
  return cached;
};
export const forgetMe = () => (cached = null);
export const canManageUsers = (m: Me) => m.user?.role === 'owner' || m.user?.role === 'administrator';
export const isEditorPlus = (m: Me) => ['owner', 'administrator', 'editor'].includes(m.user?.role ?? '');

// ---------- page ----------
export interface Page {
  root: HTMLElement;
  head: HTMLElement;
  actions: HTMLElement;
  /** the filters row (hidden until something is put in it) */
  bar: HTMLElement;
  body: HTMLElement;
}

/** A screen's page: a title, a line saying what it is for, actions on the right, then its body. */
export function page(host: HTMLElement, title: string, intro: string, opts: { narrow?: boolean } = {}): Page {
  const actions = el('div.ms-adm-head__actions');
  const head = el('header.ms-adm-head', el('div.ms-adm-head__text', el('h1.ms-adm-title', title), intro ? el('p.ms-adm-intro', intro) : null), actions);
  const bar = el('div.ms-adm-bar');
  bar.hidden = true;
  const body = el('div.ms-adm-body');
  const root = el(`div.ms-adm${opts.narrow ? '.ms-adm--narrow' : ''}`, head, bar, body, releaseFooter());
  host.replaceChildren(root);
  return { root, head, actions, bar, body };
}

export function button(label: string, run: () => void, opts: { icon?: string; kind?: 'primary' | 'danger' | 'quiet'; small?: boolean; type?: 'button' | 'submit'; title?: string } = {}): HTMLButtonElement {
  const cls = ['ms-btn', opts.kind ? `ms-btn--${opts.kind}` : '', opts.small ? 'ms-btn--sm' : ''].filter(Boolean).join(' ');
  const b = el('button', { type: opts.type ?? 'button', class: cls, title: opts.title }, opts.icon ? icon(opts.icon, 15) : null, el('span', label));
  if (opts.type !== 'submit') b.addEventListener('click', run);
  return b;
}

/** A state in place of content: loading, empty, error, or "not available to you". */
export function state(kind: 'loading' | 'empty' | 'error' | 'denied', title: string, text = '', action?: HTMLElement): HTMLElement {
  const ico = { loading: 'clock', empty: 'info', error: 'alert', denied: 'shield' }[kind];
  const box = el(`div.ms-adm-state.ms-adm-state--${kind}`, { role: kind === 'error' ? 'alert' : 'status' }, icon(ico, 22), el('h2', title), text ? el('p', text) : null, action ?? null);
  return box;
}

/** What to show for a failed call: 403 is "not available to you", the rest the server's own words. */
export function failure(e: unknown, retry?: () => void): HTMLElement {
  if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return state('denied', 'Not available to you', 'This does not exist, or your role cannot open it. Ask an administrator if you need it.');
  return state('error', 'Something went wrong', message(e), retry ? button('Try again', retry, { icon: 'refresh' }) : undefined);
}

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The toast after a change to many entries (find and replace, an image replaced everywhere), with Undo: that one
 * commit is reverted, except in entries someone changed since (named). `after` runs once the undo is in.
 */
export function undoToast(ctx: ScreenCtx, text: string, commit: string | null, after?: () => void): void {
  if (!commit) return void ctx.toast(text, 'ok');
  ctx.toast(text, 'ok', {
    action: {
      label: 'Undo',
      run: () =>
        void undoChange(commit).then(
          (r) => {
            const n = r.undone.length;
            const back = r.restored?.length ?? 0;
            const left = r.skipped.length ? ` Left as they are (${r.skipped[0].collection === 'media' ? 'a new file is in their place' : 'changed since'}): ${r.skipped.map((s) => `“${s.title}”`).join(', ')}.` : '';
            const done = back ? `Brought back ${back} file${back === 1 ? '' : 's'}.` : n ? `Undone in ${n} entr${n === 1 ? 'y' : 'ies'}.` : 'Nothing was undone.';
            ctx.toast(`${done}${r.job ? ' Publishing the live pages.' : ''}${left}`, r.skipped.length ? 'info' : 'ok');
            after?.();
          },
          (e) => ctx.toast(message(e), 'error'),
        ),
    },
  });
}

// ---------- values people copy ----------
/** A value with its copy button (owner rule). */
export const value = (text: string, label: string, cls = '') => copyable(text, { label, className: cls });
/** A URL or site path with copy and open buttons; a path opens on the site it belongs to. */
/** A site address with copy and open; `fresh`: the open goes with `?v=<fresh>` (a page just published, past any cached copy). */
export const link = (url: string, label: string, cls = '', fresh?: string) => {
  const open = /^https?:/.test(url) ? url : siteUrl(url);
  return copyable(url, { label, open: fresh ? `${open}${open.includes('?') ? '&' : '?'}v=${encodeURIComponent(fresh)}` : open, className: cls });
};
/** A visible "Copy" button for a long text (a log): `get()` is read at the click; the icon turns into a tick. */
export function copyButton(label: string, get: () => string): HTMLButtonElement {
  const b = el('button.ms-btn.ms-btn--sm', { type: 'button', 'aria-label': `Copy the ${label}`, title: `Copy the ${label}`, html: `${ic('copy', 14)}<span>Copy</span>` });
  let t = 0;
  b.addEventListener('click', async () => {
    await copyText(get());
    b.innerHTML = `${ic('check', 14)}<span>Copied</span>`;
    b.classList.add('is-done');
    clearTimeout(t);
    t = window.setTimeout(() => {
      b.innerHTML = `${ic('copy', 14)}<span>Copy</span>`;
      b.classList.remove('is-done');
    }, 1500);
  });
  return b;
}

/** A value that may be empty: the copyable value, or a quiet dash. */
export const maybe = (text: string | null | undefined, label: string) => (text ? value(text, label) : el('span.ms-adm-none', '—'));

// ---------- dates ----------
const ABS = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });
const REL = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const s = Math.round((t - now) / 1000);
  const a = Math.abs(s);
  if (a < 45) return 'just now';
  if (a < 3600) return REL.format(Math.round(s / 60), 'minute');
  if (a < 86400) return REL.format(Math.round(s / 3600), 'hour');
  if (a < 86400 * 14) return REL.format(Math.round(s / 86400), 'day');
  return ABS.format(t);
}
/** A <time> with the relative words and the full date on hover. */
export const when = (iso: string | null | undefined) => {
  const t = el('time', { datetime: iso ?? undefined, title: iso ? ABS.format(Date.parse(iso)) : undefined }, ago(iso));
  return t;
};
export const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

// ---------- forms ----------
export interface FieldOpts {
  type?: string;
  autocomplete?: string;
  value?: string;
  hint?: string;
  required?: boolean;
  placeholder?: string;
  inputmode?: string;
  maxlength?: number;
  minlength?: number;
  pattern?: string;
  /** the name of the password input this one repeats (a "Confirm password" field) */
  confirms?: string;
}

/** A labelled input; its error line shows a 422's message for `name`. */
export function field(name: string, label: string, opts: FieldOpts = {}): HTMLElement {
  const id = `ms-adm-${name}-${Math.random().toString(36).slice(2, 7)}`;
  const input = el('input.ms-input', {
    id,
    name,
    type: opts.type ?? 'text',
    autocomplete: opts.autocomplete ?? 'off',
    required: opts.required ?? false,
    placeholder: opts.placeholder,
    inputmode: opts.inputmode,
    maxlength: opts.maxlength,
    minlength: opts.minlength,
    pattern: opts.pattern,
    spellcheck: 'false',
    'aria-describedby': `${id}-err`,
    'data-confirms': opts.confirms,
  });
  if (opts.value !== undefined) input.value = opts.value;
  const control = opts.type === 'password' ? withEye(input) : input;
  return el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: id }, label), control, opts.hint ? el('p.ms-field__hint', opts.hint) : null, el('p.ms-adm-field__err', { id: `${id}-err`, 'data-err': name, role: 'alert' }));
}

/** A new password typed twice: the field `name` (autocomplete new-password, 12+ characters) and its confirm field. */
export function newPassword(name: string, label = 'New password', hint = 'At least 12 characters. Not your email, not a common password.'): HTMLElement[] {
  return [field(name, label, { type: 'password', autocomplete: 'new-password', required: true, minlength: 12, hint }), field(`${name}Confirm`, 'Confirm password', { type: 'password', autocomplete: 'new-password', required: true, confirms: name })];
}

/** A labelled select of [value, label] options. */
export function select(name: string, label: string, options: [string, string][], val: string): HTMLElement {
  const id = `ms-adm-${name}-${Math.random().toString(36).slice(2, 7)}`;
  const s = el('select.ms-input.ms-adm-select', { id, name });
  for (const [v, l] of options) s.append(el('option', { value: v, selected: v === val }, l));
  return el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: id }, label), s, el('p.ms-adm-field__err', { 'data-err': name, role: 'alert' }));
}

/**
 * A form that calls `submit(values)`: the button is busy meanwhile, a 422's field messages go under their inputs,
 * anything else into the form's error line. Values are the inputs' trimmed text (passwords as typed).
 */
export function form(children: HTMLElement[], submitLabel: string, submit: (v: Record<string, string>, f: HTMLFormElement) => Promise<void>, opts: { kind?: 'primary' | 'danger'; extra?: HTMLElement[] } = {}): HTMLFormElement {
  const err = el('p.ms-adm-form__err', { role: 'alert' });
  const btn = button(submitLabel, () => undefined, { kind: opts.kind ?? 'primary', type: 'submit' });
  const f = el('form.ms-adm-form', { novalidate: true }, ...children, err, el('div.ms-adm-form__tools', btn, ...(opts.extra ?? [])));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (btn.disabled) return;
    for (const x of f.querySelectorAll<HTMLElement>('[data-err]')) x.textContent = '';
    err.textContent = '';
    const v: Record<string, string> = {};
    for (const i of f.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input[name], select[name], textarea[name]')) {
      v[i.name] = i instanceof HTMLInputElement && i.type === 'password' ? i.value : i instanceof HTMLInputElement && i.type === 'checkbox' ? (i.checked ? '1' : '') : i.value.trim();
    }
    // the browser's own checks first (required, lengths), in plain words under the field
    const bad = [...f.querySelectorAll<HTMLInputElement>('input[name]')].find((i) => !i.checkValidity());
    if (bad) {
      const slot = f.querySelector<HTMLElement>(`[data-err="${bad.name}"]`);
      if (slot) slot.textContent = bad.validity.valueMissing ? 'Fill this in.' : bad.validationMessage;
      bad.focus();
      return;
    }
    const twice = mismatched(f)[0];
    if (twice) {
      const slot = f.querySelector<HTMLElement>(`[data-err="${twice.name}"]`);
      if (slot) slot.textContent = MISMATCH;
      twice.focus();
      return;
    }
    btn.disabled = true;
    btn.classList.add('is-busy');
    try {
      await submit(v, f);
    } catch (e2) {
      if (e2 instanceof ApiError && e2.fields) {
        for (const [k, m] of Object.entries(e2.fields)) {
          const slot = f.querySelector<HTMLElement>(`[data-err="${k}"]`);
          if (slot) slot.textContent = m;
          else err.textContent = m;
        }
        if (!Object.keys(e2.fields).length) err.textContent = e2.message;
        f.querySelector<HTMLInputElement>(`[name="${Object.keys(e2.fields)[0]}"]`)?.focus();
      } else err.textContent = message(e2);
    } finally {
      btn.disabled = false;
      btn.classList.remove('is-busy');
    }
  });
  return f;
}

// ---------- filters bound to the URL ----------
/** A search box for param `key`: typing replaces the URL param (no history entry per key press). */
export function searchBox(ctx: ScreenCtx, key: string, placeholder: string): HTMLElement {
  const input = el('input.ms-input.ms-adm-search', { type: 'search', placeholder, 'aria-label': placeholder });
  input.value = ctx.params().get(key) ?? '';
  // a screen that redraws its bar while someone types (a list arrived) keeps their words and the caret
  const live = document.activeElement;
  if (live instanceof HTMLInputElement && live.matches('.ms-adm-search') && live.getAttribute('aria-label') === placeholder) {
    input.value = live.value;
    queueMicrotask(() => {
      if (!input.isConnected) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }
  let t = 0;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = window.setTimeout(() => ctx.go({ params: { [key]: input.value.trim() || null } }), 250);
  });
  return el('label.ms-adm-searchwrap', icon('search', 15), input);
}

/** A row of choices for param `key` ('' = all); a click is a history entry, so Back undoes it. */
export function chips(ctx: ScreenCtx, key: string, label: string, options: [string, string][]): HTMLElement {
  const cur = ctx.params().get(key) ?? '';
  const group = el('div.ms-adm-chips', { role: 'group', 'aria-label': label });
  for (const [v, l] of options) {
    const b = el('button.ms-adm-chip', { type: 'button', 'aria-pressed': String(v === cur) }, l);
    b.addEventListener('click', () => ctx.go({ params: { [key]: v || null, item: null } }, true));
    group.append(b);
  }
  return group;
}

// ---------- drawer ----------
/** The open item's panel on the right (param `item`); Escape or the close button take `item` out of the URL. */
export function drawer(host: HTMLElement, title: string, close: () => void): { el: HTMLElement; body: HTMLElement } {
  const x = el('button.ms-iconbtn', { type: 'button', 'aria-label': 'Close', title: 'Close (Esc)', html: ic('x', 16) });
  x.addEventListener('click', close);
  const body = el('div.ms-adm-drawer__body');
  const d = el('aside.ms-adm-drawer', { 'aria-label': title, tabindex: '-1' }, el('div.ms-adm-drawer__head', el('h2', title), x), body);
  d.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  });
  host.append(d);
  return { el: d, body };
}

/** A definition list of label → node rows (the drawer's facts). */
export function facts(rows: [string, Node | string][]): HTMLElement {
  const dl = el('dl.ms-adm-facts');
  for (const [k, v] of rows) dl.append(el('dt', k), el('dd', v));
  return dl;
}

/** A one-time secret (setup code, recovery codes): shown once, copyable, with the words to say so. */
export function secretBox(title: string, text: string, values: string[], label: string): HTMLElement {
  const list = el('div.ms-adm-secret__values');
  for (const v of values) list.append(value(v, label, 'ms-adm-secret__value'));
  let all: HTMLButtonElement | null = null;
  if (values.length > 1) {
    const b = button(`Copy all ${values.length}`, async () => {
      await navigator.clipboard?.writeText(values.join('\n')).catch(() => undefined);
      b.querySelector('span')!.textContent = 'Copied';
      setTimeout(() => (b.querySelector('span')!.textContent = `Copy all ${values.length}`), 1500);
    }, { small: true, icon: 'copy' });
    all = b;
  }
  return el('section.ms-adm-secret', { role: 'status' }, el('h3', title), el('p', text), list, all);
}

export const ROLE_LABEL: Record<string, string> = { owner: 'Owner', administrator: 'Administrator', editor: 'Editor', author: 'Author', contributor: 'Contributor' };
export const ROLE_HINT: Record<string, string> = {
  owner: 'Everything, including administrators. There is exactly one.',
  administrator: 'Everything but the owner: users, the audit log, all content.',
  editor: 'All content: edit, publish, delete, rebuild the site.',
  author: 'Their own posts: write, publish, delete.',
  contributor: 'Their own drafts. An editor publishes them.',
};

/**
 * "Build blocked by: “Title” — Open": the entries the last build broke on (api.BuildBlocked), each with a link to
 * open it; null when nothing blocks the build. One line for the Site check-up, Go live and the job panel.
 */
export function buildBlockedLine(b: { entries: { collection: string; id: string; title: string }[] } | null | undefined, opts: { heading?: boolean } = {}): HTMLElement | null {
  if (!b?.entries.length) return null;
  const items = b.entries.flatMap((e, i) => [
    i ? ', ' : '',
    el('span.ms-adm-blocked__entry', `“${e.title}”`, ' — ', el('a', { href: `#/e/${encodeURIComponent(e.collection)}/${encodeURIComponent(e.id)}` }, 'Open')),
  ]);
  return el('div.ms-adm-warnline.ms-adm-blocked', { role: 'alert' }, opts.heading === false ? null : el('strong', 'Build blocked by: '), ...items, el('span.ms-adm-sub', ' · The site cannot be built while this entry is as it is. Fix it (or move it to the trash) and publish again.'));
}
