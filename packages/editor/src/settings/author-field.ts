// The author field of Post settings (setting type `author`, docs/API-AUTHORS.md): the site's authors in a searchable
// list (type a name, a role or a slug; ↑ ↓ and Enter pick one), "Add … as a new author" when the name is not there
// (a name, a slug made from it, a role: the author file is made at once and picked), co-authors as chips under it
// when the site keeps them, and a plain warning when the entry names an author the site does not have (or one
// archived), never an error that stops the drawer. Writes the pending frontmatter like every other field (⌘S saves).
import { authors, authorsChanged, createAuthor, onAuthorsChanged, slugOf, type Author } from '../authors';
import { ApiError } from '../api';
import { copyable } from '../copy';
import { lockField } from '../field-access';
import { h, iconBtn } from '../panel-form';
import '../styles/authors.css';
import type { DrawnField, FieldCtx } from './fields';

type AuthorSetting = { key: string; label: string; hint?: string; coAuthors?: string | null };

let uid = 0;
/** An element with plain text in it (names and slugs are the site's data: never HTML). */
const t = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text: string) => Object.assign(h(tag, cls), { textContent: text });
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const listOf = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);

/** A search box over the authors with a list under it: `pick(slug)` when one is chosen, `add(name)` for a new one. */
function picker(o: { label: string; placeholder: string; skip: () => string[]; pick: (a: Author) => void; add: (name: string) => void }) {
  const id = `ms-author-${++uid}`;
  const input = h('input', 'ms-input ms-author__search');
  Object.assign(input, { id, type: 'text', autocomplete: 'off', spellcheck: false, placeholder: o.placeholder });
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', `${id}-list`);
  input.setAttribute('aria-label', o.label);
  const list = h('ul', 'ms-author__list');
  list.id = `${id}-list`;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', o.label);
  list.hidden = true;
  const box = h('div', 'ms-author__picker');
  box.append(input, list);
  let all: Author[] = [];
  let shown: (Author | string)[] = [];
  let active = 0;
  const match = (a: Author, q: string) => !q || `${a.name} ${a.role} ${a.slug}`.toLowerCase().includes(q);
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const hits = all.filter((a) => !a.archived && !o.skip().includes(a.slug) && match(a, q));
    const exact = all.some((a) => a.name.toLowerCase() === q || a.slug === q);
    shown = [...hits, ...(exact ? [] : [input.value.trim()])];
    active = Math.min(active, shown.length - 1);
    list.replaceChildren(
      ...shown.map((x, i) => {
        const li = h('li', `ms-author__opt${i === active ? ' is-active' : ''}${typeof x === 'string' ? ' ms-author__opt--add' : ''}`);
        li.id = `${id}-opt-${i}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(i === active));
        if (typeof x === 'string') li.textContent = x ? `Add “${x}” as a new author…` : 'Add a new author…';
        else {
          const name = t('span', 'ms-author__name', x.name);
          const meta = t('span', 'ms-author__meta', [x.role, x.slug].filter(Boolean).join(' · '));
          li.append(name, meta);
        }
        li.addEventListener('mousedown', (e) => e.preventDefault());
        li.addEventListener('click', () => choose(i));
        return li;
      }),
    );
    input.setAttribute('aria-activedescendant', shown.length ? `${id}-opt-${active}` : '');
  };
  const open = (on: boolean) => {
    list.hidden = !on;
    input.setAttribute('aria-expanded', String(on));
    if (on) draw();
  };
  const choose = (i: number) => {
    const x = shown[i];
    if (x === undefined) return;
    open(false);
    input.value = '';
    if (typeof x === 'string') o.add(x);
    else o.pick(x);
  };
  input.addEventListener('focus', () => {
    void authors().then((a) => {
      all = a;
      if (document.activeElement === input) open(true);
    }, () => undefined);
  });
  input.addEventListener('blur', () => open(false));
  input.addEventListener('input', () => {
    active = 0;
    open(true);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) return open(true);
      const n = shown.length;
      if (n) active = e.key === 'ArrowDown' ? (active + 1) % n : (active - 1 + n) % n;
      draw();
      list.children[active]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && !list.hidden) {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape' && !list.hidden) {
      e.stopPropagation();
      open(false);
    }
  });
  return { el: box, input, refresh: (a: Author[]) => ((all = a), list.hidden || draw()) };
}

/** The inline "new author" form: name, slug (made from the name until typed), role; creates the file at once. */
function addForm(name: string, done: (a: Author | null) => void): HTMLElement {
  const box = h('div', 'ms-author__add');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'New author');
  const row = (label: string, input: HTMLInputElement) => {
    const id = `ms-author-add-${++uid}`;
    input.id = id;
    const l = t('label', 'ms-field__label', label);
    l.htmlFor = id;
    const w = h('div', 'ms-author__addrow');
    w.append(l, input);
    return w;
  };
  const n = Object.assign(h('input', 'ms-input'), { type: 'text', value: name, autocomplete: 'off' });
  const s = Object.assign(h('input', 'ms-input'), { type: 'text', value: slugOf(name), autocomplete: 'off', spellcheck: false });
  const r = Object.assign(h('input', 'ms-input'), { type: 'text', autocomplete: 'off', placeholder: 'e.g. Editor' });
  let typed = false;
  n.addEventListener('input', () => typed || (s.value = slugOf(n.value)));
  s.addEventListener('input', () => (typed = true));
  const err = h('p', 'ms-field__error');
  err.setAttribute('role', 'alert');
  const go = t('button', 'ms-btn ms-btn--sm ms-btn--primary', 'Add author');
  go.type = 'button';
  const cancel = t('button', 'ms-btn ms-btn--sm', 'Cancel');
  cancel.type = 'button';
  const actions = h('div', 'ms-move__actions');
  actions.append(go, cancel);
  const note = t('p', 'ms-field__hint', 'Their profile file is made now. Add a photo, bio and links in Authors.');
  box.append(row('Name', n), row('Slug', s), row('Role (optional)', r), err, actions, note);
  const submit = async () => {
    if (go.disabled) return;
    go.disabled = true;
    err.textContent = '';
    try {
      const made = (await createAuthor({ name: n.value.trim(), slug: s.value.trim() || undefined, ...(r.value.trim() ? { role: r.value.trim() } : {}) })).author;
      authorsChanged();
      done(made);
    } catch (e) {
      err.textContent = e instanceof ApiError ? (e.fields ? Object.values(e.fields)[0] : e.message) : String(e);
      go.disabled = false;
    }
  };
  go.addEventListener('click', () => void submit());
  cancel.addEventListener('click', () => done(null));
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      done(null);
    }
  });
  queueMicrotask(() => n.focus());
  return box;
}

export function authorField(f: AuthorSetting, ctx: FieldCtx): DrawnField {
  const id = `ms-set-${++uid}`;
  const el = h('div', 'ms-field ms-author');
  const label = t('label', 'ms-field__label', f.label);
  label.htmlFor = id;
  const top = h('div', 'ms-field__top');
  top.append(label);
  const current = h('div', 'ms-author__current');
  const warn = h('p', 'ms-author__warn');
  warn.setAttribute('role', 'status');
  const coBox = h('div', 'ms-author__co');
  const adding = h('div');
  const after = h('div', 'ms-field__after');
  if (f.hint) after.append(t('span', 'ms-field__hint', f.hint));
  let known: Author[] | null = null;
  const by = (slug: string) => known?.find((a) => a.slug === slug) ?? null;
  const primary = () => str(ctx.edits.get(f.key));
  const co = () => (f.coAuthors ? listOf(ctx.edits.get(f.coAuthors)) : []);
  const setCo = (list: string[]) => f.coAuthors && ctx.edits.set(f.coAuthors, list.length ? list : null);
  /** "Add … as a new author": the form in place; a made author goes where it was asked for. */
  const startAdd = (name: string, into: 'primary' | 'co') =>
    adding.replaceChildren(
      addForm(name, (a) => {
        adding.replaceChildren();
        if (!a) return;
        if (into === 'primary') ctx.edits.set(f.key, a.slug);
        else setCo([...co(), a.slug]);
      }),
    );
  const main = picker({
    label: `${f.label}: search the authors`,
    placeholder: 'Search authors by name, role or slug',
    skip: () => [primary()],
    pick: (a) => ctx.edits.group(() => {
      ctx.edits.set(f.key, a.slug);
      // the new primary author is not also a co-author
      if (co().includes(a.slug)) setCo(co().filter((s) => s !== a.slug));
    }),
    add: (name) => startAdd(name, 'primary'),
  });
  main.input.id = id;
  const coPick = f.coAuthors
    ? picker({ label: 'Add a co-author', placeholder: 'Add a co-author', skip: () => [primary(), ...co()], pick: (a) => setCo([...co(), a.slug]), add: (name) => startAdd(name, 'co') })
    : null;
  el.append(top, current, main.el, warn, adding);
  if (coPick) {
    const coLabel = t('span', 'ms-field__label ms-author__colabel', 'Co-authors');
    el.append(coLabel, coBox, coPick.el);
  }
  el.append(after);

  const chip = (slug: string, remove?: () => void) => {
    const a = by(slug);
    const c = h('span', `ms-tag ms-author__chip${a && !a.archived ? '' : ' is-unknown'}`);
    c.append(copyable(a ? a.name : slug, { label: 'author slug', copy: slug, iconsOnly: false }));
    if (remove && ctx.edits.may(f.coAuthors ?? f.key)) c.append(iconBtn('x', `Remove co-author ${a?.name ?? slug}`, remove, 'ms-iconbtn ms-tag__x'));
    return c;
  };
  const sync = () => {
    const slug = primary();
    const a = by(slug);
    current.replaceChildren();
    if (slug) {
      const who = h('div', 'ms-author__who');
      who.append(t('strong', 'ms-author__name', a?.name ?? slug));
      if (a?.role) who.append(t('span', 'ms-author__meta', a.role));
      current.append(who, copyable(slug, { label: 'author slug', className: 'ms-author__slug' }));
    } else current.append(t('span', 'ms-author__none', 'No author yet.'));
    main.input.placeholder = slug ? 'Change the author: search by name, role or slug' : 'Search authors by name, role or slug';
    // an author the site does not have (an old free-text value), or one archived: say so, and how to put it right
    const bad = known ? [slug, ...co()].filter((s) => s && (!by(s) || by(s)!.archived)) : [];
    warn.textContent = bad
      .map((s) => (by(s) ? `${by(s)!.name} is archived: pick another author, or bring them back in Authors.` : `“${s}” is not one of the site's authors. Pick one, or add them as a new author.`))
      .join(' ');
    warn.hidden = !bad.length;
    el.classList.toggle('has-warning', bad.length > 0);
    coBox.replaceChildren(...co().map((s) => chip(s, () => setCo(co().filter((x) => x !== s)))));
  };
  const load = () =>
    void authors().then(
      (a) => {
        known = a;
        main.refresh(a);
        coPick?.refresh(a);
        sync();
      },
      () => undefined,
    );
  load();
  // the drawer draws its fields again for another entry: one no longer on the page stops listening
  const off = onAuthorsChanged(() => (el.isConnected ? load() : off()));
  sync();
  if (!ctx.edits.may(f.key)) lockField(el);
  return { el, sync, focus: () => main.input.focus() };
}
