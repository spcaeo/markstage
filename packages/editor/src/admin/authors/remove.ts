// Deleting an author and changing their slug (the Authors screen, index.ts). An author who still has posts is never
// left behind by them: deleting gives the posts to another author first, a new slug moves the posts with it, each in
// one change (the server refuses the lot when any post cannot be changed). The other author and the new slug are in
// the URL (to=), so the step can be linked to and gone back to.
import { deleteAuthor, pageUrl, renameAuthor, type Author, type AuthorPost, type Moved } from '../../authors';
import type { ScreenCtx } from '../../host';
import { config } from '../../runtime';
import { el, field, form, link, select } from '../ui';
import { postRow } from './parts';

export interface Panel {
  el: HTMLElement;
  /** Back or a pasted link changed only `to` */
  sync(to: string): void;
}
interface Hooks {
  changed(): Promise<void>;
  back(): void;
  /** to another author or the list, with the note to show there */
  leave(change: { args: string[]; params: Record<string, string | null> }, note: () => void): void;
}
const list = { args: [], params: { action: null, to: null } };

const entries = (n: number) => `${n} ${n === 1 ? 'post' : 'posts'}`;
/** "1 post names", "2 posts name" */
const nameBy = (n: number) => `${entries(n)} ${n === 1 ? 'names' : 'name'}`;
const done = (m: Moved) => (m.moved.length ? ` ${entries(m.moved.length)} changed${m.job ? '; the live ones are being published' : ''}.` : '');
const postList = (posts: AuthorPost[]) => el('ul.ms-adm-authorposts', ...posts.map(postRow));

export function deletePanel(ctx: ScreenCtx, a: Author, posts: AuthorPost[], all: Author[], h: Hooks): Panel {
  const others = all.filter((x) => x.slug !== a.slug && !x.archived);
  const to = () => ctx.params().get('to') ?? '';
  if (!posts.length) {
    const f = form([el('p', `Delete ${a.name}? Their profile file is removed. No post names them, so nothing else changes.`)], 'Delete author', async () => {
      await deleteAuthor(a.slug, a.version);
      await h.changed();
      h.leave(list, () => ctx.toast(`Deleted ${a.name}.`, 'ok'));
    }, { kind: 'danger', extra: [cancel(h)] });
    return { el: f, sync: () => undefined };
  }
  if (!others.length)
    return {
      el: el('div.ms-adm-stack', el('p', `${nameBy(posts.length)} ${a.name}, and there is no other author to give them to. Add another author first, or archive ${a.name} to keep their posts and hide them from the pickers.`), postList(posts), cancel(h)),
      sync: () => undefined,
    };
  const pick = select('reassign', `Give their ${entries(posts.length)} to`, [['', 'Choose an author…'], ...others.map((o): [string, string] => [o.slug, `${o.name} (${o.slug})`])], to());
  const s = pick.querySelector('select')!;
  s.required = true;
  s.addEventListener('change', () => {
    pick.querySelector('[data-err]')!.textContent = '';
    ctx.go({ params: { to: s.value || null } });
  });
  const f = form(
    [el('p', `${nameBy(posts.length)} ${a.name}. They go to the author you choose, then ${a.name} is deleted, in one change. Their author page then leads nowhere, so add a redirect if it was linked to.`), postList(posts), pick],
    'Give the posts and delete',
    async (v) => {
      if (!v.reassign) {
        const slot = f.querySelector<HTMLElement>('[data-err="reassign"]');
        if (slot) slot.textContent = 'Choose who gets the posts.';
        return s.focus();
      }
      const r = await deleteAuthor(a.slug, a.version, v.reassign);
      await h.changed();
      const who = others.find((o) => o.slug === v.reassign)?.name ?? v.reassign;
      h.leave(list, () => ctx.toast(`Deleted ${a.name}; their posts are by ${who} now.${done(r)}`, 'ok'));
    },
    { kind: 'danger', extra: [cancel(h)] },
  );
  return { el: f, sync: (v) => (s.value = v) };
}

export function renamePanel(ctx: ScreenCtx, a: Author, posts: AuthorPost[], h: Hooks): Panel {
  const pattern = config().authors?.url;
  const box = field('to', 'New slug', { value: ctx.params().get('to') ?? '', required: true, pattern: '[a-z0-9]+(-[a-z0-9]+)*', maxlength: 100, hint: 'Lowercase letters, digits and hyphens.' });
  const input = box.querySelector('input')!;
  const preview = el('p.ms-adm-sub');
  const show = () => {
    const url = pattern && input.value ? pattern.replace('{slug}', input.value) : '';
    preview.replaceChildren(...(url ? [document.createTextNode('New author page: '), link(pageUrl(url), 'new author page URL')] : []));
  };
  let t = 0;
  input.addEventListener('input', () => {
    show();
    clearTimeout(t);
    t = window.setTimeout(() => ctx.go({ params: { to: input.value.trim() || null } }), 250);
  });
  show();
  const f = form(
    [
      el('p', pattern ? `The author page moves to the new address, and the old one redirects to it.` : `The slug is how posts name ${a.name}.`),
      ...(posts.length ? [el('p', `${nameBy(posts.length)} ${a.name}. They change to the new slug in the same change.`), postList(posts)] : []),
      box,
      preview,
    ],
    'Change slug',
    async (v) => {
      const r = await renameAuthor(a.slug, a.version, v.to, true);
      await h.changed();
      h.leave({ args: [r.author.slug], params: { action: null, to: null } }, () => ctx.toast(`${a.name}’s slug is ${r.author.slug} now.${done(r)}`, 'ok'));
    },
    { extra: [cancel(h)] },
  );
  return {
    el: f,
    sync: (v) => {
      if (v === input.value) return;
      input.value = v;
      show();
    },
  };
}

function cancel(h: Hooks): HTMLElement {
  const b = el('button.ms-btn.ms-btn--quiet', { type: 'button' }, 'Cancel');
  b.addEventListener('click', h.back);
  return b;
}
