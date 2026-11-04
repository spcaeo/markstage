// The "New" sheet (#/new/<collection>?template=<id>&type=<page type>): a new draft asks only for what nothing can guess,
// its title and the settings the site's schema needs (config newEntry.ask, e.g. a topic), what it is (its page type,
// when the site has them: a type picks its Library template and is written in the entry) and what it starts from
// (Blank or one of the Library's page templates, reusable/pick-template.ts), then opens it on the canvas. The site's
// defaults (dates, an SEO title …) are written where the entry is made (newEntry.defaults: the server, or astro dev).
import './styles/new-entry.css';
import { ApiError, request, type Entry } from './api';
import { registerScreen, type ScreenCtx } from './host';
import { ic } from './icons';
import { typeOf, typesFor } from './page-types';
import { h } from './panel-form';
import { collection, editable, type SettingField } from './runtime';
import { drawField, type FieldCtx } from './settings/fields';
import { FrontmatterEdits } from './settings/state';
import type { LibItem } from './reusable/api';
import { templatePicker } from './reusable/pick-template';

export interface NewEntryDeps {
  /** [value, label] choices for a select field: the entries of a collection */
  choices(collection: string): Promise<[string, string][]>;
  /** the entry exists: the lists learn of it, then it opens */
  created(made: Entry): Promise<void>;
}

import { datedSlug, slugOf } from './slug';

export { slugOf };

/** The collections a writer can start a draft in (Markdown ones; pages are made in the pages editor). */
export const newable = () => editable().filter((c) => c.format === 'md');

export function registerNewScreen(d: NewEntryDeps): void {
  registerScreen({ name: 'new', label: 'New draft', icon: 'plus', nav: null, mount: (el, ctx) => mountNew(el, ctx, d) });
}

function mountNew(el: HTMLElement, ctx: ScreenCtx, d: NewEntryDeps) {
  const list = newable();
  const c = collection(ctx.args[0] ?? '') ?? list[0] ?? null;
  // a page (a JSON entry with an address) starts here only from one of its page templates: the picker has no Blank
  // and Create waits for one (a blank page is made in the pages editor)
  const page = c?.format === 'json' && !!c.hasUrl;
  if (!c || (c.format !== 'md' && !page)) {
    el.append(Object.assign(h('p', 'ms-new__none'), { textContent: 'There is nothing to start here.' }));
    return;
  }
  if (ctx.args[0] !== c.id) ctx.go({ args: [c.id] });
  ctx.setTitle(`New in ${c.label}`);

  const form = h('form', 'ms-new');
  form.noValidate = true;
  const head = h('div', 'ms-new__head');
  head.append(h('h1', 'ms-new__title', 'Start a new draft'), h('p', 'ms-new__intro', 'Give it a title. It opens as a draft, which nobody outside the editor sees until it is published.'));
  form.append(head);

  // where it goes, when there is more than one place
  if (list.length > 1 && !page) {
    const seg = h('div', 'ms-seg ms-new__where');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', 'Where');
    for (const x of list) {
      const b = h('button', 'ms-seg__btn');
      b.textContent = x.label;
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(x.id === c.id));
      b.classList.toggle('is-on', x.id === c.id);
      b.addEventListener('click', () => x.id !== c.id && ctx.go({ args: [x.id] }));
      seg.append(b);
    }
    form.append(seg);
  }

  const titleField = h('div', 'ms-field');
  const titleLabel = h('label', 'ms-field__label', 'Title');
  titleLabel.htmlFor = 'ms-new-title';
  const title = h('input', 'ms-input ms-new__name');
  title.id = 'ms-new-title';
  title.type = 'text';
  title.autocomplete = 'off';
  title.required = true;
  title.maxLength = 300;
  const address = h('div', 'ms-field__hint ms-new__address');
  titleField.append(titleLabel, title, address);
  form.append(titleField);

  // a page's address, when it is one of its fields (`url: '{uri}'`): from the title until typed over
  const addressKey = page ? (c.addressKey ?? null) : null;
  const where = h('input', 'ms-input');
  let whereTyped = false;
  if (addressKey) {
    const f = h('div', 'ms-field');
    const l = h('label', 'ms-field__label', 'Address');
    l.htmlFor = where.id = 'ms-new-address';
    where.autocomplete = 'off';
    where.addEventListener('input', () => (whereTyped = !!where.value.trim()));
    f.append(l, where, h('div', 'ms-field__hint', 'Where the page is on the site, such as /services/new-page/.'));
    form.append(f);
  }

  // what the page is (config pageTypes): a type brings its Library template, and the new entry has the type
  const types = typesFor(c.id);
  const chosenType = () => typeOf(c.id, ctx.params().get('type'));
  const typeBox = h('fieldset', 'ms-new__types');
  const drawTypes = () => {
    typeBox.replaceChildren(Object.assign(h('legend', 'ms-field__label'), { textContent: 'Page type' }));
    const now = chosenType();
    for (const t of [null, ...types]) {
      const on = (t?.id ?? null) === (now?.id ?? null);
      const b = h('button', `ms-new__type${on ? ' is-on' : ''}`);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(on));
      b.append(Object.assign(h('strong'), { textContent: t?.label ?? 'No type' }), Object.assign(h('span', 'ms-adm-sub'), { textContent: t ? t.description : 'A page with no type: no checks, no locks of a type.' }));
      // a type with a template starts from it (the writer may still pick another one below)
      b.addEventListener('click', () => ctx.go({ params: { type: t?.id ?? null, ...(t?.template ? { template: t.template } : {}) } }));
      typeBox.append(b);
    }
  };
  if (types.length) {
    typeBox.setAttribute('role', 'radiogroup');
    drawTypes();
    form.append(typeBox);
  }

  // Blank, or a page template from the Library (its title shows as the example to replace)
  const exampleTitle = (it: LibItem | null) => {
    const t = it?.body.frontmatter?.title ?? (it?.body.data as Record<string, unknown> | undefined)?.title;
    return typeof t === 'string' ? t : '';
  };
  // draw() is called by the picker and by a field's choices() before the full draw exists (QA pass 2, F-new 1):
  // a no-op until it is assigned below, so an early call never throws
  let draw: () => void = () => {};
  const picker = templatePicker(c.id, ctx.params().get('template'), (id) => ctx.go({ params: { template: id } }), (it) => {
    title.placeholder = exampleTitle(it);
    draw();
  }, { blank: !page });
  form.append(picker.el);

  // the settings the site needs from the writer (the same fields as in Post settings)
  const edits = new FrontmatterEdits();
  edits.reset({});
  type Keyed = Extract<SettingField, { key: string }>;
  const asked = (c.newEntry?.ask ?? []).map((key) => c.settings?.find((f): f is Keyed => 'key' in f && f.key === key)).filter((f): f is Keyed => !!f);
  // what is still on its way (the topics): said under the button, and Create waits for it (QA F22)
  const pending = new Set<string>();
  const fctx: FieldCtx = {
    edits,
    url: () => null,
    media: (src) => src,
    choices: (from) => {
      pending.add(from);
      draw();
      return d.choices(from).finally(() => {
        pending.delete(from);
        draw();
      });
    },
    tags: async () => [],
  };
  for (const f of asked) {
    const drawn = drawField(f, fctx);
    if (drawn) form.append(drawn.el);
  }

  const error = h('p', 'ms-new__error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const waiting = h('p', 'ms-field__hint ms-new__waiting');
  waiting.setAttribute('role', 'status');
  waiting.hidden = true;
  const actions = h('div', 'ms-new__actions');
  const create = h('button', 'ms-btn ms-btn--primary');
  create.type = 'submit';
  create.innerHTML = `${ic('plus', 15)}<span>Create draft</span>`;
  const cancel = h('button', 'ms-btn', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', () => (history.length > 1 ? history.back() : ctx.open('#/')));
  actions.append(create, cancel);
  form.append(error, waiting, actions);
  el.append(form);

  const missing = () => [!title.value.trim() && 'a title', addressKey && !/^\/\S*$/.test(where.value.trim()) && 'an address starting with /', page && !picker.chosen() && 'a template', ...asked.filter((f) => !edits.get(f.key)).map((f) => f.label.toLowerCase())].filter(Boolean) as string[];
  draw = () => {
    const names = asked.map((f) => f.label.toLowerCase());
    waiting.hidden = !pending.size;
    waiting.textContent = pending.size ? `Loading the ${names.length ? names.join(' and ') : 'choices'}… Create is ready as soon as the list is in.` : '';
    const typed = !!title.value.trim();
    const slug = slugOf(title.value);
    // a title with no letters a-z or digits (Arabic, emoji): the entry is named by the day, and the sheet says so
    const fallback = typed && !slug ? datedSlug(page ? 'page' : 'post') : '';
    if (addressKey && !whereTyped) where.value = slug ? `/${slug}/` : fallback ? `/${fallback}/` : '';
    address.textContent = addressKey
      ? ''
      : slug
        ? `Its address ends in /${slug}/ (you can change it later in Post settings).`
        : fallback
          ? `Its address will end in /${fallback}/: the title has no letters a–z or digits to make one from. You can change it later in Post settings.`
          : 'Its address comes from the title.';
    address.classList.toggle('is-note', !!fallback);
    const need = missing();
    create.disabled = !!need.length || pending.size > 0;
    create.title = pending.size ? 'Waiting for the list to load…' : need.length ? `Needs ${need.join(' and ')}` : '';
  };
  where.addEventListener('input', () => draw());
  title.addEventListener('input', () => {
    error.hidden = true;
    draw();
  });
  edits.onChange(() => draw());
  draw();
  let made = false;
  ctx.guard(() => !made && (!!title.value.trim() || edits.changedPaths().length > 0));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (missing().length || create.disabled) return;
    create.disabled = true;
    error.hidden = true;
    try {
      const entry = await request<Entry>(`collections/${encodeURIComponent(c.id)}/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.value.trim(), frontmatter: edits.changes() ?? {}, ...(picker.chosen() ? { template: picker.chosen()!.id } : {}), ...(chosenType() ? { pageType: chosenType()!.id } : {}), ...(addressKey ? { data: { [addressKey]: where.value.trim() } } : {}) }),
      });
      made = true;
      ctx.toast(slugOf(title.value) ? `Draft "${title.value.trim()}" created` : `Draft "${title.value.trim()}" created at ${entry.url ?? `/${entry.id}/`}`, 'ok');
      await d.created(entry);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : null;
      error.textContent =
        err instanceof ApiError && err.status === 409
          ? 'There is already an entry with this address. Change the title a little, or open that one with ⌘K.'
          : (err as Error).message;
      if (code === 'no-author') error.textContent += ' (Your account, Author.)';
      error.hidden = false;
      create.disabled = false;
      title.focus();
    }
  });
  requestAnimationFrame(() => title.focus());
  return {
    update: (now: ScreenCtx) => {
      picker.set(now.params().get('template'));
      if (types.length) drawTypes();
    },
    destroy() {},
  };
}
