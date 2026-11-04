// The import API (docs/API-IMPORT.md): entries and media files from JSON, a plan first (a dry run, nothing written),
// then a run of that plan as a job. Idempotent on the source's ids: what was imported before is matched by its
// sourceId and updated, left alone when unchanged, and never overwritten after a person changed it (unless asked).
//
//   POST /import                 {source, entries, media?, overwrite?, mediaAs?} -> 201 {run, entries, media, counts}
//   POST /import/:rid/run        {} -> 202 {run, job}
//   GET  /import/:rid            {run, plan, result}
//   GET  /import                 {items: [run]}
//
// Each entry goes through the editor's own create and save (rights, links, raw HTML, locks, synced copies, the
// page's address, the site's validate; drafts in a status collection), each media file through the upload's pipeline
// after a fetch through the SSRF guard (library/fetch.mjs). Editors and up.
import path from 'node:path';
import { can } from '../roles.mjs';
import { HttpError, conflict, forbidden, newId, notFound, nowIso, sha1 } from '../util.mjs';
import { checkPayload, makePlan, planView } from './plan.mjs';

const EXPIRES_MS = 60 * 60 * 1000;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function createImport(app, entries) {
  const { db, store, audit } = app;

  const may = (ctx) => {
    if (!can(ctx.user, 'content.import')) throw forbidden('Importing is for editors and up.');
  };

  /** Where a media file of the plan would go: the upload's own folder for this month, under its name. */
  const mediaAt = (m) => {
    const now = new Date(app.clock());
    const name = String(m.url.split(/[?#]/)[0].split('/').pop() || 'image').replace(/[^A-Za-z0-9._-]+/g, '-').toLowerCase();
    return { path: path.posix.join(app.config.media.dir.split(path.sep).join('/'), String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'), name) };
  };

  const remember = (source, kind, sid, { collection = null, target, inputHash, written, runId }) =>
    db
      .prepare(
        `INSERT INTO import_map (source, kind, source_id, collection, target, input_hash, written, run_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (source, kind, source_id) DO UPDATE SET collection = excluded.collection, target = excluded.target, input_hash = excluded.input_hash, written = excluded.written, run_id = excluded.run_id, at = excluded.at`,
      )
      .run(source, kind, sid, collection, target, inputHash, written, runId, nowIso(app.clock()));

  const load = (id) => {
    const r = typeof id === 'string' ? db.prepare('SELECT * FROM import_runs WHERE id = ?').get(id) : null;
    if (!r) throw notFound('No such import.');
    return r;
  };

  const runView = (r) => {
    const by = r.created_by ? app.users.get(r.created_by) : null;
    const expired = r.status === 'planned' && app.clock() >= Date.parse(r.expires_at);
    return { id: r.id, source: r.source, status: expired ? 'expired' : r.status, createdAt: r.created_at, expiresAt: r.expires_at, by: by ? { id: by.id, name: by.name } : null, job: r.job_id, finishedAt: r.finished_at };
  };

  /** POST /import: the plan, kept for an hour to be run as it is by the person who made it. */
  async function plan(ctx) {
    may(ctx);
    const payload = checkPayload(ctx.body);
    const p = await makePlan(app, ctx, entries, payload, { mediaAt });
    const id = newId('im');
    const now = app.clock();
    const view = planView(p);
    db.prepare('INSERT INTO import_runs (id, source, created_by, created_at, expires_at, payload, plan, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, payload.source, ctx.user.id, nowIso(now), nowIso(now + EXPIRES_MS), JSON.stringify(payload), JSON.stringify(view), 'planned');
    audit.log(ctx, 'import.plan', { target: id, detail: { source: payload.source, entries: view.counts.entries, media: view.counts.media } });
    ctx.status = 201;
    return { run: runView(load(id)), ...view };
  }

  /** POST /import/:rid/run: the plan made again now, then carried out, as a job. */
  function start(ctx) {
    may(ctx);
    const r = load(ctx.params.rid);
    if (r.created_by !== ctx.user.id) throw forbidden('Only the person who made this plan runs it. Make your own plan first.');
    const v = runView(r);
    if (v.status === 'expired') throw new HttpError(410, 'expired', 'This plan is more than an hour old. Make it again, so it shows what an import would do now.');
    if (r.status !== 'planned') throw conflict(`This import is ${r.status} already.`, { status: r.status });
    const payload = JSON.parse(r.payload);
    db.prepare("UPDATE import_runs SET status = 'running' WHERE id = ?").run(r.id);
    const job = app.jobs.enqueue({
      kind: 'import',
      user: ctx.user,
      target: `import ${payload.source}`,
      notice: { text: (error) => `The import from ${payload.source} did not finish. ${error}` },
      run: async (step) => {
        let result = { entries: [], media: [] };
        try {
          await step('media', async (log) => {
            result.media = await importMedia(ctx, r.id, payload, log);
            return 0;
          });
          await step('entries', async (log) => {
            result.entries = await importEntries(ctx, r.id, payload, log);
            const failed = result.entries.filter((e) => e.problem).length;
            log(`\n${plural(result.entries.filter((e) => ['create', 'update'].includes(e.action) && !e.problem).length, 'entry', 'entries')} written, ${plural(failed, 'problem')}.\n`);
            return 0;
          });
        } finally {
          const counts = {};
          for (const e of result.entries) counts[e.problem ? 'problem' : e.action] = (counts[e.problem ? 'problem' : e.action] ?? 0) + 1;
          result = { ...result, counts };
          db.prepare('UPDATE import_runs SET status = ?, result = ?, finished_at = ? WHERE id = ?').run(result.entries.length || result.media.length ? 'done' : 'failed', JSON.stringify(result), nowIso(app.clock()), r.id);
          audit.log(ctx, 'import.run', { target: r.id, detail: { source: payload.source, counts } });
        }
      },
    });
    db.prepare('UPDATE import_runs SET job_id = ? WHERE id = ?').run(job, r.id);
    ctx.status = 202;
    return { run: runView(load(r.id)), job: { id: job } };
  }

  /** The media files to fetch, through the guard and the upload's pipeline, in one commit. */
  async function importMedia(ctx, runId, payload, log) {
    const p = await makePlan(app, ctx, entries, { ...payload, entries: [] }, { mediaAt });
    const fetch = p.media.filter((m) => m.action === 'fetch');
    const out = p.media.filter((m) => m.action !== 'fetch').map(({ sourceId, url, action, path: at, problem }) => ({ sourceId, url, action, ...(at ? { path: at } : {}), ...(problem ? { problem } : {}) }));
    if (!fetch.length) return out;
    const sources = fetch.map((m) => ({ label: m.sourceId, name: m.name, alt: m.alt, read: () => app.mediaImport.fetchImage(m.url) }));
    const r = await app.mediaImport.storeAll(ctx, sources, { message: (n) => `Import ${plural(n, 'media file')} from ${payload.source}`, source: payload.source, log });
    for (const m of fetch) {
      const row = r.byLabel.get(m.sourceId);
      if (row) remember(payload.source, 'media', m.sourceId, { target: row.id, inputHash: sha1(m.url), written: row.path, runId });
      out.push({ sourceId: m.sourceId, url: m.url, action: 'fetch', ...(row ? { path: row.path } : { problem: (r.problems.find((x) => x.startsWith(`${m.sourceId}: `)) ?? 'not stored').replace(`${m.sourceId}: `, '') }) });
    }
    return out;
  }

  /** Each entry as the plan says now: created or saved through the editor's own routes, then remembered. */
  async function importEntries(ctx, runId, payload, log) {
    const p = await makePlan(app, ctx, entries, payload, { mediaAt, stored: true });
    const out = [];
    for (const e of p.entries) {
      const row = { sourceId: e.sourceId, collection: e.collection, id: e.id, action: e.action, ...(e.problem ? { problem: e.problem } : {}) };
      out.push(row);
      if (!['create', 'update', 'unchanged'].includes(e.action) || !e.text) {
        log(`${e.sourceId}: ${e.action}${e.problem ? ` (${e.problem})` : ''}\n`);
        continue;
      }
      try {
        if (e.action === 'create') {
          await entries.createEntry(ctx, e.c, { id: e.id, source: e.text }, 'entry.import');
        } else if (e.action === 'update') {
          const current = store.read(e.c, e.id);
          await entries.saveEntry(ctx, e.c, e.id, { version: current.version, build: async () => ({ text: e.text }), message: `Import ${payload.source}: ${e.c.id}/${e.id}`, action: 'entry.import' });
        }
        remember(payload.source, 'entry', e.sourceId, { collection: e.c.id, target: e.id, inputHash: e.inputHash, written: sha1(store.read(e.c, e.id).text), runId });
        log(`${e.sourceId}: ${e.action} ${e.c.id}/${e.id}\n`);
      } catch (err) {
        if (!(err instanceof HttpError)) throw err;
        row.problem = err.message;
        log(`${e.sourceId}: ${err.message}\n`);
      }
    }
    return out;
  }

  function get(ctx) {
    may(ctx);
    const r = load(ctx.params.rid);
    return { run: runView(r), plan: JSON.parse(r.plan), result: r.result ? JSON.parse(r.result) : null };
  }

  function list(ctx) {
    may(ctx);
    return { items: db.prepare('SELECT * FROM import_runs ORDER BY created_at DESC LIMIT 50').all().map(runView) };
  }

  function routes(api) {
    api.add('POST', '/import', plan);
    api.add('GET', '/import', list);
    api.add('GET', '/import/:rid', get);
    api.add('POST', '/import/:rid/run', start);
  }

  return { routes };
}
