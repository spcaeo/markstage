// The site import's routes (docs/IMPORT.md, docs/API-IMPORT.md "A whole site"): a WordPress, Ghost or Prismic site
// read, planned (a dry run: nothing written, nothing fetched but the source itself), then run as a job through the
// same runs as the JSON import (POST import/:rid/run, GET import/:rid). Editors and up.
//   POST /import/site            multipart {file, source, mapping?, siteUrl?} (an export), or JSON {source, from:
//                                'api', url, user?, password? | url, key | repo, token?, endpoint?; mapping?}
//                                -> 201 {run, plan}
//   POST /import/:rid/replan     {mapping} -> 201 {run, plan}: the same source planned again with another mapping
// The source is read once, at the plan, and kept as a bundle with the run (no credential is kept: sources.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { readJson, readToFile } from '../../http.mjs';
import { DEFAULT_IMPORT_MAX } from '../../media/import.mjs';
import { parseMultipart } from '../../library/multipart.mjs';
import { HttpError, badRequest, conflict, forbidden, newId, nowIso } from '../../util.mjs';
import { defaultFields } from './mapping.mjs';
import { makeSitePlan, productName, sourceKey } from './plan.mjs';
import { idsFileOf } from './run.mjs';
import { readExportFile, readGhostApi, readPrismicApi, readWordpressApi, siteAddress } from './sources.mjs';

const EXPIRES_MS = 60 * 60 * 1000;
const SOURCES = ['wordpress', 'ghost', 'prismic'];
const SHOWN = { media: 2000, redirects: 1000 };

export function createSiteImport(app, entries, { mediaAt, load, runView, may }) {
  const { db, store, audit, config } = app;

  const mappingFrom = (v) => {
    if (v === undefined || v === null || v === '') return {};
    if (typeof v === 'object') return v;
    try {
      return JSON.parse(String(v));
    } catch {
      throw new HttpError(422, 'invalid', 'The mapping is not JSON.', { field: 'mapping' });
    }
  };

  /** The plan as the API and the Import screen show it: no texts, no internals. */
  function view(p, meta) {
    return {
      kind: 'site',
      product: meta.product,
      from: meta.from,
      name: meta.name,
      site: { url: meta.bundle.site.url || null, title: meta.bundle.site.title || null },
      source: p.source,
      mapping: p.mapping,
      collections: store.collections.map((c) => ({ id: c.id, label: c.label, format: c.format, hasStatus: c.hasStatus, defaults: defaultFields(c) })),
      counts: p.counts,
      items: p.items,
      media: p.media.slice(0, SHOWN.media),
      authors: p.authors,
      redirects: p.redirects.slice(0, SHOWN.redirects),
      review: p.review,
      hook: Boolean(config.redirects),
      idsFile: idsFileOf(p.source),
      placeholder: p.placeholder,
    };
  }

  /** Plan a bundle and keep it as a run: {run, plan}. */
  async function keep(ctx, { bundle, mapping, product, from, name }) {
    if (!bundle.items.length) throw new HttpError(422, 'nothing', `There is nothing to import: the ${productName(product)} source has no posts or pages we can read.`);
    const stored = { kind: 'site', bundle, mapping, product, from, name };
    let p;
    try {
      p = await makeSitePlan(app, ctx, entries, stored, { mediaAt });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (/more than \d+/.test(e.message)) throw new HttpError(413, 'too-large', e.message);
      throw e;
    }
    const id = newId('im');
    const now = app.clock();
    const v = view(p, stored);
    db.prepare('INSERT INTO import_runs (id, source, created_by, created_at, expires_at, payload, plan, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, sourceKey(bundle), ctx.user.id, nowIso(now), nowIso(now + EXPIRES_MS), JSON.stringify(stored), JSON.stringify(v), 'planned');
    audit.log(ctx, 'import.plan', { target: id, detail: { product, from, host: bundle.site.hosts[0] ?? null, entries: p.items.length, media: p.media.length } });
    ctx.status = 201;
    return { run: runView(load(id)), plan: v };
  }

  /**
   * Read a source and plan it: {run, plan}. `input` is {source, data (a Buffer: an export), name, siteUrl, mapping}
   * for a file, or {source, url, user, password | url, key | repo, token, endpoint, siteUrl, routes, fields;
   * mapping} for an API. The routes and the command line (markstage-server import) both come here.
   */
  async function planSource(ctx, input) {
    const product = input.source;
    if (!SOURCES.includes(product)) throw new HttpError(422, 'invalid', 'Say where it comes from: wordpress, ghost or prismic.', { field: 'source' });
    const mapping = mappingFrom(input.mapping);
    if (input.data) {
      const opts = {};
      if (product === 'ghost') {
        if (!input.siteUrl) throw new HttpError(422, 'invalid', 'A Ghost export does not say where the site was: give its address, so its pictures and links can be found.', { field: 'siteUrl' });
        opts.siteUrl = siteAddress(input.siteUrl);
        opts.permalink = mapping.permalink ?? {};
      }
      const bundle = readExportFile(product, String(input.name ?? ''), input.data, opts);
      return keep(ctx, { bundle, mapping, product, from: 'file', name: String(input.name ?? '').slice(0, 200) });
    }
    let bundle;
    if (product === 'wordpress') bundle = await readWordpressApi(app, { url: input.url, user: input.user, password: input.password });
    else if (product === 'ghost') bundle = await readGhostApi(app, { url: input.url, key: input.key, permalink: mapping.permalink });
    else bundle = await readPrismicApi(app, { repo: input.repo, token: input.token, endpoint: input.endpoint, siteUrl: input.siteUrl, fields: input.fields, routes: input.routes, slices: mapping.slices });
    const name = product === 'prismic' ? `${input.repo} (Prismic API)` : `${new URL(siteAddress(input.url)).host} (${product === 'ghost' ? 'Content API' : 'REST API'})`;
    return keep(ctx, { bundle, mapping, product, from: 'api', name });
  }

  /** POST /import/site: an upload (multipart: file, source, siteUrl?, mapping?) or an API's details (JSON). */
  async function start(ctx) {
    may(ctx);
    const type = String(ctx.req.headers['content-type'] ?? '');
    if (!/^multipart\//i.test(type)) return planSource(ctx, (await readJson(ctx.req, config.maxBodyBytes)) ?? {});
    const release = app.importLock.take('site import');
    if (!release) throw new HttpError(409, 'busy', 'Another import is reading a file. Try again when it is done.');
    let tmp = null;
    try {
      ({ file: tmp } = await readToFile(ctx.req, config.library?.importMaxBytes ?? DEFAULT_IMPORT_MAX, path.join(config.dataDir, 'tmp')));
      const form = parseMultipart(fs.readFileSync(tmp), type);
      const file = form.files.find((f) => f.name === 'file') ?? form.files[0];
      if (!file) throw badRequest('Send the export file (field "file").');
      return await planSource(ctx, { ...form.fields, data: file.data, name: file.filename });
    } finally {
      if (tmp) fs.rmSync(tmp, { force: true });
      release();
    }
  }

  /** POST /import/:rid/replan: the kept source, planned again with another mapping (by the person who made it). */
  async function replan(ctx) {
    may(ctx);
    const r = load(ctx.params.rid);
    if (r.created_by !== ctx.user.id) throw forbidden('Only the person who made this plan changes it. Make your own plan first.');
    if (r.status !== 'planned') throw conflict(`This import is ${r.status} already.`, { status: r.status });
    const stored = JSON.parse(r.payload);
    if (stored.kind !== 'site') throw badRequest('Only a site import has a mapping to change.');
    const out = await keep(ctx, { ...stored, mapping: mappingFrom(ctx.body?.mapping) });
    db.prepare("UPDATE import_runs SET status = 'replaced' WHERE id = ?").run(r.id);
    return out;
  }

  function routes(api) {
    api.add('POST', '/import/site', start, { rawBody: true });
    api.add('POST', '/import/:rid/replan', replan);
  }

  return { routes, planSource };
}
