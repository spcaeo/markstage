// The Import screen's first steps: choose where the site comes from, then upload its export or give its API's
// details. #/import, #/import?source=wordpress|ghost|prismic&from=file|api. A password, key or token typed here goes
// to the server for this one read and is kept nowhere; its field is masked, with the eye, and no copy button.
import { ApiError } from '../../api';
import type { ScreenCtx } from '../../host';
import { chips, el, failure, field, form, select, state, when } from '../ui';
import * as api from './api';
import { PRODUCT } from './words';

const ABOUT: Record<api.Product, { file: string | null; api: string; text: string }> = {
  wordpress: {
    file: 'The export file (.xml) from Tools › Export › All content. It holds the posts, pages, authors, categories, tags and the list of uploads.',
    api: 'The site’s REST API. Drafts and private posts need a user name and an application password (Users › Profile › Application Passwords).',
    text: 'Posts and pages (Gutenberg or classic), their images and files, authors, categories and tags, Yoast or Rank Math titles and descriptions, and every old address.',
  },
  ghost: {
    file: 'The export file (.json) from Settings › Labs › Export your content.',
    api: 'The Content API of a custom integration (Settings › Integrations): published posts and pages.',
    text: 'Posts and pages (Lexical or Mobiledoc) with their cards, feature images, tags, authors, meta titles and descriptions, and their old addresses.',
  },
  prismic: {
    file: null,
    api: 'The repository’s API. A private repository needs an access token (Settings › API & Security).',
    text: 'Documents of every custom type, their rich text, slices (as sections where you map them), images through the Prismic CDN, and tags.',
  },
};

/** An ApiError naming one field (the import's 422s) as the form's per-field message. */
function asFieldError(e: unknown): unknown {
  if (e instanceof ApiError && !e.fields && typeof e.data?.field === 'string') return new ApiError(e.message, e.status, e.version, e.code, { [String(e.data.field)]: e.message }, e.data);
  return e;
}

/** #/import: the three sources, and the imports made before. */
export function chooseSource(body: HTMLElement, ctx: ScreenCtx): void {
  const cards = el('div.ms-imp-sources');
  for (const p of ['wordpress', 'ghost', 'prismic'] as api.Product[]) {
    const a = el('a.ms-imp-source', { href: `#/import?source=${p}` }, el('strong', PRODUCT[p]), el('span', ABOUT[p].text));
    a.addEventListener('click', (e) => {
      e.preventDefault();
      ctx.go({ params: { source: p, from: null } }, true);
    });
    cards.append(a);
  }
  const before = el('div', state('loading', 'Loading earlier imports…'));
  body.replaceChildren(el('h2.ms-adm-h3', 'Where does the site come from?'), cards, el('h2.ms-adm-h3', 'Earlier imports'), before);
  api.listRuns().then(
    (r) => {
      const runs = r.items.filter((x) => x.kind === 'site');
      if (!runs.length) return void before.replaceChildren(el('p.ms-adm-none', 'None yet.'));
      const tb = el('tbody');
      for (const x of runs.slice(0, 20)) {
        const open = el('a.ms-adm-rowlink', { href: `#/import/${encodeURIComponent(x.id)}` }, x.product ? PRODUCT[x.product] : x.source);
        tb.append(el('tr', el('td', open), el('td', STATUS_WORD[x.status] ?? x.status), el('td', x.by?.name ?? '—'), el('td', when(x.createdAt))));
      }
      before.replaceChildren(el('section.ms-adm-card.ms-adm-card--flush', el('table.ms-adm-table', el('thead', el('tr', el('th', 'From'), el('th', 'Status'), el('th', 'By'), el('th', 'When'))), tb)));
    },
    (e) => before.replaceChildren(failure(e)),
  );
}

export const STATUS_WORD: Record<string, string> = { planned: 'Planned, not run', running: 'Running', done: 'Done', failed: 'Did not finish', expired: 'Plan expired', replaced: 'Planned again' };

/** The browser files a key or token under the source it is for: a hidden user name field (the password-field rule). */
const accountFor = (name: string) => el('input', { type: 'text', name: `${name}Account`, autocomplete: 'username', hidden: true, 'aria-hidden': 'true', tabindex: '-1', value: name });

/** The options every source shares: what to do with a taken address, and with drafts. */
const options = () => [
  select('onCollision', 'If an address is already taken', [['both', 'Keep both (the new one gets -2)'], ['skip', 'Skip the new one'], ['replace', 'Replace what is there']], 'both'),
  select('drafts', 'Drafts, in a collection without drafts', [['skip', 'Leave them out'], ['include', 'Bring them in too']], 'skip'),
];

/** #/import?source=…&from=file|api: the upload or the API's details, then the plan (#/import/<rid>). */
export function sourceForm(body: HTMLElement, ctx: ScreenCtx, product: api.Product): void {
  const about = ABOUT[product];
  const from = about.file && ctx.params().get('from') !== 'api' ? 'file' : 'api';
  const done = (r: { run: api.RunInfo }) => ctx.open(`#/import/${encodeURIComponent(r.run.id)}`, true);
  const mappingOf = (v: Record<string, string>) => ({ onCollision: v.onCollision as api.Collision, drafts: v.drafts as 'skip' | 'include' });
  const parts: HTMLElement[] = [el('p.ms-adm-lead', about.text)];
  if (about.file) parts.push(chips(ctx, 'from', 'Read it from', [['', 'An export file'], ['api', 'The site’s API']]));

  let f: HTMLFormElement;
  if (from === 'file') {
    const input = el('input.ms-input', { type: 'file', name: 'file', accept: product === 'wordpress' ? '.xml,text/xml,application/xml' : '.json,application/json', 'aria-describedby': 'ms-imp-file-err', required: true });
    const fileField = el('div.ms-field.ms-adm-field', el('label.ms-field__label', 'Export file', input), el('p.ms-field__hint', about.file!), el('p.ms-adm-field__err', { id: 'ms-imp-file-err', 'data-err': 'file', role: 'alert' }));
    const fields = [fileField, ...(product === 'ghost' ? [field('siteUrl', 'The old site’s address', { type: 'url', placeholder: 'https://blog.example.com', required: true, hint: 'A Ghost export does not say where the site was; its pictures and links are found by it.' })] : []), ...options()];
    f = form(fields, 'Read it and make the plan', async (v) => {
      const file = input.files?.[0];
      if (!file) throw new ApiError('Choose the export file.', 422, undefined, 'invalid', { file: 'Choose the export file.' });
      try {
        done(await api.planFile(product, file, { siteUrl: v.siteUrl || undefined, mapping: mappingOf(v) }));
      } catch (e) {
        throw asFieldError(e);
      }
    });
  } else {
    const fields =
      product === 'wordpress'
        ? [
            field('url', 'The site’s address', { type: 'url', placeholder: 'https://www.example.com', required: true }),
            field('user', 'User name (for drafts and private posts)', { autocomplete: 'username' }),
            field('password', 'Application password', { type: 'password', autocomplete: 'current-password', hint: 'Used for this one read and kept nowhere. Delete it in WordPress when the import is done.' }),
          ]
        : product === 'ghost'
          ? [accountFor('ghost-content-api'), field('url', 'The site’s address', { type: 'url', placeholder: 'https://blog.example.com', required: true }), field('key', 'Content API key', { type: 'password', autocomplete: 'current-password', required: true, hint: 'Used for this one read and kept nowhere.' })]
          : [
              accountFor('prismic-api'),
              field('repo', 'Repository name', { placeholder: 'my-repo', required: true, hint: 'The first part of its address: my-repo in my-repo.prismic.io.' }),
              field('token', 'Access token (a private repository)', { type: 'password', autocomplete: 'current-password', hint: 'Used for this one read and kept nowhere.' }),
              field('siteUrl', 'The old site’s address (optional)', { type: 'url', placeholder: 'https://www.example.com' }),
              field('routes', 'Old addresses, per type (optional)', { placeholder: 'blog_post=/blog/{uid}/, page=/{uid}/', hint: 'So the old addresses can be sent to the new pages.' }),
            ];
    f = form([...fields, ...options()], 'Read it and make the plan', async (v) => {
      const routes = Object.fromEntries((v.routes ?? '').split(',').map((x) => x.split('=').map((s) => s.trim())).filter((x) => x.length === 2 && x[0] && x[1].startsWith('/')));
      const req: Record<string, unknown> = { source: product, mapping: mappingOf(v) };
      for (const k of ['url', 'user', 'password', 'key', 'repo', 'token', 'siteUrl']) if (v[k]) req[k] = v[k];
      if (Object.keys(routes).length) req.routes = routes;
      try {
        done(await api.planApi(req));
      } catch (e) {
        throw asFieldError(e);
      }
    });
  }
  parts.push(el('section.ms-adm-card', el('p.ms-adm-sub', from === 'file' ? 'Nothing is written yet: you see the whole plan first.' : `${about.api} Nothing is written yet: you see the whole plan first.`), f));
  body.replaceChildren(...parts);
}
