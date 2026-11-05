// Post settings, "Languages and regions" (a site with `locales`): the entry's address in every locale with copy and
// open, and the hreflang links its pages emit (each locale, then x-default; the same set on every copy, so search
// engines pair them). Read-only: one source file serves every locale. A locale may allow its own title, description
// or slug (`overrides` in the config); those fields write <overridesKey>.<code>.<field> in the frontmatter, and
// "Draft translation" asks the AI for that region's title and description (ai/editor.ts, ?suggest=translate&loc=);
// it says "Review the AI draft" when the site translation left one there, which its card then shows first.
import { alternates, emitsHreflang, localePath } from '@markstage/core';
import { suggestButton } from '../ai/card';
import { copyable, siteUrl } from '../copy';
import { h } from '../panel-form';
import type { LocalesConfig } from '../runtime';
import { config } from '../runtime';
import { textInput, type DrawnField, type FieldCtx } from './fields';

const FIELD_LABEL: Record<string, string> = { title: 'Title', description: 'Description', slug: 'URL slug' };

export function localesField(locales: LocalesConfig, ctx: FieldCtx, status: () => string | undefined, keys: { title: string; description?: string }): DrawnField {
  const box = h('section', 'ms-setgroup ms-locales');
  box.append(Object.assign(h('h3', 'ms-setgroup__title'), { textContent: 'Languages and regions' }));
  const list = h('div', 'ms-locales__list');
  const tags = h('div', 'ms-locales__tags');
  const draft = Object.assign(h('p', 'ms-field__hint ms-locales__draft'), { hidden: true });
  box.append(
    Object.assign(h('p', 'ms-setgroup__sub'), { textContent: 'Addresses' }),
    list,
    Object.assign(h('p', 'ms-setgroup__sub'), { textContent: 'hreflang the page emits' }),
    tags,
    draft,
    Object.assign(h('p', 'ms-field__hint'), {
      textContent: 'One text serves every region; the site sets these links on each copy. Use the screen check’s Region switch to see each one.',
    }),
  );
  // per-locale fields, only where the config allows them; the title and description can be drafted by the AI
  const own: DrawnField[] = [];
  const drafts: { slot: HTMLElement; card(): HTMLElement | null }[] = [];
  for (const l of locales.list) {
    const texts: { name: string; key: string; label: string; from(): string }[] = [];
    for (const f of l.overrides) {
      const base = f === 'title' ? keys.title : f === 'description' ? keys.description : undefined;
      const key = `${locales.overridesKey}.${l.code}.${f}`;
      const from = () => (base ? String(ctx.edits.get(base) ?? '') : '');
      const field = textInput({ key, label: `${FIELD_LABEL[f]} on ${l.label}`, hint: 'Empty: the same as everywhere.' }, ctx, f === 'description', from);
      // a draft only for what the person may change (a translator's own region)
      if (base && ctx.edits.may(key)) texts.push({ name: f, key, label: FIELD_LABEL[f], from });
      own.push(field);
      box.append(field.el);
    }
    if (!ctx.ai || !texts.length) continue;
    const ai = ctx.ai.translate(l, texts);
    const slot = h('div', 'ms-locales__ai');
    slot.dataset.locale = l.code;
    const ask = suggestButton('Draft translation', ai.ask, 'ms-btn--sm');
    ask.setAttribute('aria-label', `Draft translation for ${l.label}`);
    // a draft the site translation left here (translations/site.ts) waits for review: the button opens it
    void ai.waiting().then((yes) => {
      if (!yes) return;
      ask.querySelector('span')!.textContent = 'Review the AI draft';
      ask.setAttribute('aria-label', `Review the AI draft for ${l.label}`);
      ask.dataset.waiting = '';
    });
    box.append(ask, slot);
    drafts.push({ slot, card: ai.card });
  }
  const site = () => (config().siteUrl || location.origin).replace(/\/+$/, '');

  const sync = () => {
    for (const f of own) f.sync();
    for (const d of drafts) {
      const card = d.card();
      if (card && card.parentElement !== d.slot) d.slot.replaceChildren(card);
      if (!card) d.slot.replaceChildren();
    }
    const url = ctx.url();
    list.replaceChildren();
    tags.replaceChildren();
    if (!url) {
      list.append(Object.assign(h('p', 'ms-field__hint'), { textContent: 'This entry has no page.' }));
      return;
    }
    for (const l of locales.list) {
      const row = h('div', 'ms-locale');
      const name = h('div', 'ms-locale__name');
      name.append(Object.assign(h('span'), { textContent: l.label }), Object.assign(h('code', 'ms-locale__code'), { textContent: l.code }));
      if (l.code === locales.xDefault) name.append(Object.assign(h('span', 'ms-locale__tag'), { textContent: 'x-default', title: 'Where search engines send people whose language or region has no copy' }));
      const path = localePath(l, url);
      row.append(name, copyable(path, { label: `${l.label} address`, copy: `${site()}${path}`, open: siteUrl(path), className: 'ms-copyable--url' }));
      list.append(row);
    }
    // the page's own robots and canonical, as edited (unsaved changes count: the drawer shows what a save gives)
    const data: Record<string, unknown> = {};
    for (const key of [locales.hreflang?.robots, locales.hreflang?.canonical]) {
      if (!key) continue;
      const parts = key.split('.');
      let o = data;
      for (const k of parts.slice(0, -1)) o = (o[k] ??= {}) as Record<string, unknown>;
      o[parts.at(-1)!] = ctx.edits.get(key);
    }
    const emits = emitsHreflang(locales, data, url, site());
    if (!emits.ok) tags.append(Object.assign(h('p', 'ms-field__hint ms-locales__none'), { textContent: emits.reason }));
    for (const a of emits.ok ? alternates(locales, url) : []) {
      const row = h('div', 'ms-locale__alt');
      row.append(Object.assign(h('code', 'ms-locale__code'), { textContent: a.hreflang }), copyable(`${site()}${a.path}`, { label: `hreflang ${a.hreflang}`, className: 'ms-copyable--url' }));
      tags.append(row);
    }
    const s = status();
    draft.hidden = s !== 'draft' && s !== 'scheduled';
    draft.textContent = 'Not published yet: until it is, no page lists it in hreflang, and its copies are not in the sitemaps.';
  };
  sync();
  return { el: box, sync, focus: () => (box.querySelector('input, textarea, button') as HTMLElement | null)?.focus() };
}
