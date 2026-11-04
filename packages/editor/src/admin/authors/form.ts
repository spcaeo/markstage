// The author profile form of the Authors screen (index.ts): a new author, or the one open. Only the fields the site
// keeps are shown (config().authors.profile); the photo comes from the media library, its chooser open while the URL
// says library=1. The server checks everything again (core authors.mjs profileProblems) and its words go under the
// field they are about.
import { createAuthor, slugOf, updateAuthor, type Author, type Profile } from '../../authors';
import type { ScreenCtx } from '../../host';
import { imagePicker } from '../../image-picker';
import { config } from '../../runtime';
import { button, el, field, form } from '../ui';
import { mediaUrl } from './parts';

const ALL = ['name', 'role', 'bio', 'photo', 'email', 'website', 'social', 'seoTitle', 'seoDescription'];
const keeps = (k: string) => (config().authors?.profile ?? ALL).includes(k);

function area(name: string, label: string, val: string, hint: string, rows: number, maxlength: number): HTMLElement {
  const id = `ms-adm-${name}-${Math.random().toString(36).slice(2, 7)}`;
  const t = el('textarea.ms-input.ms-input--area', { id, name, rows, maxlength, spellcheck: name === 'bio' ? 'true' : 'false', 'aria-describedby': `${id}-err` });
  t.value = val;
  return el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: id }, label), t, el('p.ms-field__hint', hint), el('p.ms-adm-field__err', { id: `${id}-err`, 'data-err': name, role: 'alert' }));
}

export interface AuthorForm {
  el: HTMLElement;
  /** the URL opened or closed the photo's library chooser (Back, a pasted link) */
  library(open: boolean): void;
}

/**
 * The form. `a` null: a new author (name, then a slug made from it unless one is typed). `done` gets the saved author.
 * Only what changed is sent for an author that exists, so a field the person did not touch is never rewritten.
 */
export function authorForm(ctx: ScreenCtx, a: Author | null, done: (saved: Author) => Promise<void>, cancel: () => void): AuthorForm {
  const photo = el('input', { type: 'hidden', name: 'photo' });
  photo.value = a?.photo ?? '';
  const picker = keeps('photo')
    ? imagePicker({
        label: 'Photo',
        hint: 'A square picture works best. It shows on the author page and next to their posts.',
        get: () => photo.value,
        set: (v) => {
          photo.value = v ?? '';
          picker?.sync();
        },
        url: mediaUrl,
        route: (open) => ctx.go({ params: { library: open ? '1' : null } }, open),
      })
    : null;

  const name = field('name', 'Name', { value: a?.name ?? '', required: true, maxlength: 120, autocomplete: 'off' });
  const slug = a ? null : field('slug', 'Slug', { hint: 'Part of the author page address. Made from the name when left empty; lowercase letters, digits and hyphens.', pattern: '[a-z0-9]+(-[a-z0-9]+)*', maxlength: 100 });
  if (slug) {
    const n = name.querySelector('input')!;
    const s = slug.querySelector('input')!;
    const follow = () => (s.placeholder = slugOf(n.value) || 'e.g. ana-ruiz');
    n.addEventListener('input', follow);
    follow();
  }
  const fields: (HTMLElement | null)[] = [
    name,
    slug,
    keeps('role') ? field('role', 'Role', { value: a?.role ?? '', maxlength: 200, placeholder: 'e.g. Senior editor', hint: 'Their job title or what they write about. Shown under their name.' }) : null,
    picker?.el ?? null,
    keeps('photo') ? photo : null,
    keeps('bio') ? area('bio', 'Bio', a?.bio ?? '', 'A few sentences about them. Markdown works: **bold**, [links](https://example.com).', 6, 20_000) : null,
    keeps('email') ? field('email', 'Email (private)', { type: 'email', value: a?.email ?? '', maxlength: 254, hint: 'Never shown on the site. Only editors and the person themselves can see it.' }) : null,
    keeps('website') ? field('website', 'Website', { type: 'url', value: a?.website ?? '', maxlength: 500, placeholder: 'https://' }) : null,
    keeps('social') ? area('social', 'Profile links', (a?.social ?? []).join('\n'), 'One address per line: LinkedIn, X, GitHub… Search engines use them to know these profiles are the same person.', 3, 5000) : null,
    keeps('seoTitle') ? field('seoTitle', 'Search title', { value: a?.seoTitle ?? '', maxlength: 200, hint: 'The author page’s title in search results. Empty: their name.' }) : null,
    keeps('seoDescription') ? area('seoDescription', 'Search description', a?.seoDescription ?? '', 'The line under the title in search results. Empty: the start of the bio.', 2, 500) : null,
  ];

  const f = form(
    fields.filter((x): x is HTMLElement => !!x),
    a ? 'Save profile' : 'Add author',
    async (v) => {
      const profile: Profile = {};
      for (const k of ALL) {
        if (!keeps(k) || !(k in v)) continue;
        const now = k === 'social' ? v.social.split(/\s*\n\s*/).filter(Boolean) : v[k];
        const was = a ? (k === 'social' ? a.social : (a[k as keyof Author] ?? '')) : k === 'social' ? [] : '';
        if (JSON.stringify(now) !== JSON.stringify(was)) (profile as Record<string, unknown>)[k] = now;
      }
      if (a) {
        if (!Object.keys(profile).length) return void (await done(a));
        const r = await updateAuthor(a.slug, a.version, profile);
        await done(r.author);
      } else {
        const r = await createAuthor({ ...profile, name: v.name, ...(v.slug ? { slug: v.slug } : {}) });
        await done(r.author);
      }
    },
    { extra: [button('Cancel', cancel, { kind: 'quiet' })] },
  );
  if (ctx.params().get('library') === '1' && picker) queueMicrotask(() => void picker.library());
  return {
    el: f,
    library: (open) => {
      if (open && picker) void picker.library();
    },
  };
}
