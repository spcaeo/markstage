// Code injection on one entry (Ghost's per-post code injection): `codeInjection: {head, foot}` in its frontmatter
// (Markdown) or at the top of its JSON. The site puts it in that page's head and foot at build and allows it in its
// CSP (site contract, docs/DEPLOY.md). Only an owner or administrator sets it; every other save path refuses a change
// to it from anyone else (content/entries.mjs guard), and it never runs in the CMS, only on the preview origin and
// the built site.
import { can } from '../roles.mjs';
import { HttpError, badRequest, forbidden } from '../util.mjs';
import { LIMITS } from './css.mjs';

export const INJECTION_KEY = 'codeInjection';

/** The entry's code injection as stored, for comparing two texts ('' when it has none). */
export const injectionOf = (store, c, text) => JSON.stringify(store.fieldsOf(c, text)?.[INJECTION_KEY] ?? null);

export function injectRoutes(router, app, entries, deployJob) {
  const { store, converter } = app;

  function clean(v, where) {
    if (v === undefined || v === null) return '';
    if (typeof v !== 'string') throw badRequest(`${where} must be text.`);
    if (Buffer.byteLength(v) > LIMITS.inject) throw new HttpError(413, 'too-large', `The ${where} code is larger than ${LIMITS.inject / 1024} KB.`);
    if (v.includes('\u0000')) throw badRequest(`The ${where} code contains a NUL character.`);
    return v.trim() ? v : '';
  }

  router.add('PUT', '/collections/:c/entries/:id/code-injection', async (ctx) => {
    const c = store.collection(ctx.params.c);
    if (!can(ctx.user, 'code.inject')) throw forbidden('Only an owner or administrator can add code to a page.');
    const head = clean(ctx.body.head, 'head');
    const foot = clean(ctx.body.foot, 'foot');
    const value = head || foot ? { ...(head ? { head } : {}), ...(foot ? { foot } : {}) } : null;
    const out = await entries.saveEntry(ctx, c, ctx.params.id, {
      version: ctx.body.version,
      message: `Code injection for ${c.id}/${ctx.params.id}`,
      action: 'code.inject',
      build: (cur) => ({
        text:
          c.format === 'md'
            ? // nested keys merge in frontmatter: null takes out the part left empty
              converter.setFrontmatter(cur.text, { [INJECTION_KEY]: value && { head: value.head ?? null, foot: value.foot ?? null } })
            : converter.applyJsonChanges(cur.text, [value === null ? { path: INJECTION_KEY, delete: true } : { path: INJECTION_KEY, value }], c),
        changedBlocks: 0,
      }),
    });
    // a live page gets the code with a build and deploy now, not with the next unrelated publish
    const live = out.commit && (!c.hasStatus || out.summary.status === 'published');
    if (live) ctx.status = 202;
    return { ok: true, version: out.version, commit: out.commit, job: live ? deployJob(ctx, c, ctx.params.id, 'code-injection', out) : null };
  });
}
