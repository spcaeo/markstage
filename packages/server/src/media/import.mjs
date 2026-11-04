// Many media files at once (docs/API.md "Importing media"): a list of picture addresses fetched by the server, a .zip,
// or (on the command line) a folder. Each file goes through the same pipeline as an upload (sniffed, never SVG, HEIC
// read, re-encoded, under <media.dir>/<year>/<month>/), and all of them land in one commit. A dry run says what
// would come in first. Addresses are fetched through the SSRF guard (library/fetch.mjs).
//   POST /media/import/urls {urls, dry?}      dry: {items: [{url, problem?}]}; else {job} (the fetching runs as a job)
//   POST /media/import/zip  (the .zip, ?dry=1)  dry: {items: [{name, bytes, problem?}]}; else {job}
// The zip is streamed to a file under <dataDir>/tmp and read in place (never whole in memory), at most
// media.importMaxBytes (64 MB); one import (media or Library) runs at a time per server (409 busy otherwise).
import fs from 'node:fs';
import path from 'node:path';
import { readToFile } from '../http.mjs';
import { can } from '../roles.mjs';
import { HttpError, badRequest, flag, forbidden } from '../util.mjs';
import { checkUrl, safeFetch } from '../library/fetch.mjs';
import { TYPES, sniff } from './sniff.mjs';
import { fileSource, readZip } from './zip.mjs';

export const MAX_URLS = 50;
export const DEFAULT_IMPORT_MAX = 64 * 1024 * 1024;
const ZIP_ENTRIES = 500;
const IMAGE_ACCEPT = 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/heic,application/pdf;q=0.8,*/*;q=0.1';
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A file name for a fetched address: the last part of its path, or "image". */
export const nameOfUrl = (u) => {
  try {
    return decodeURIComponent(path.posix.basename(new URL(u).pathname)) || 'image';
  } catch {
    return 'image';
  }
};

export function createMediaImport(app, { storeImage, toPublic }) {
  const { db, config, git, repoLock, audit, store } = app;
  const outbound = () => app.outbound ?? {};

  /** The addresses of a list, each checked (nothing fetched): [{url, problem?}]. */
  function checkUrls(urls) {
    if (!Array.isArray(urls) || !urls.length || urls.length > MAX_URLS || !urls.every((u) => typeof u === 'string' && u.length <= 2000)) throw badRequest(`Send the picture addresses (1 to ${MAX_URLS}).`);
    const seen = new Set();
    return urls.map((raw) => {
      const url = raw.trim();
      if (seen.has(url)) return { url, problem: 'listed twice, taken once' };
      seen.add(url);
      try {
        return { url: checkUrl(url, outbound()).href };
      } catch (e) {
        return { url, problem: e.message };
      }
    });
  }

  /** Fetch one picture through the guard: a Buffer. */
  async function fetchImage(url, { timeoutMs = 15_000 } = {}) {
    const r = await safeFetch(url, { maxBytes: config.media.maxBytes, timeoutMs, accept: IMAGE_ACCEPT, outbound: outbound() });
    if (r.status < 200 || r.status >= 300) throw new HttpError(502, 'fetch-failed', `${new URL(r.url).host} answered ${r.status}.`);
    return r.body;
  }

  /** Put stored-but-uncommitted files back as they were (an import that could not be committed). */
  function undo(rows) {
    for (const row of rows) {
      store.removeRel(row.path);
      db.prepare('DELETE FROM media WHERE id = ?').run(row.id);
    }
  }

  /**
   * Store each source ({label, name, alt?, read: async () => Buffer}) like an upload, without committing; a source
   * that fails is a problem, the rest go on. Then one commit of them all (`message(n)` says it), unless `commit: false` (the caller commits
   * the rows' paths with its own files). {rows, byLabel: Map(label -> row), problems, commit}.
   */
  async function storeAll(ctx, sources, { message, source, log = () => {}, commit: commitIt = true } = {}) {
    const rows = [];
    const byLabel = new Map();
    const problems = [];
    for (const s of sources) {
      try {
        const buf = await s.read();
        const row = await storeImage(ctx, buf, s.name, { alt: s.alt ?? '', action: 'media.import', commit: false });
        rows.push(row);
        byLabel.set(s.label, row);
        log(`${s.label}: ${row.path}\n`);
      } catch (e) {
        problems.push(`${s.label}: ${e.message}`);
        log(`${s.label}: ${e.message}\n`);
      }
    }
    if (!commitIt || !rows.length) return { rows, byLabel, problems, commit: null };
    let commit;
    try {
      commit = await repoLock.run(() => git.commit(rows.map((r) => r.path), message ? message(rows.length) : `Import ${plural(rows.length, 'media file')}`, { name: ctx.user.name, email: ctx.user.email }));
    } catch (e) {
      undo(rows);
      throw e;
    }
    audit.log(ctx, 'media.import', { target: 'media', detail: { source: String(source ?? '').slice(0, 200), commit, files: rows.map((r) => r.path), problems: problems.length } });
    return { rows, byLabel, problems, commit };
  }

  /** What a file's first bytes say about taking it: a problem in words, or null (the upload's own rules, in short). */
  function kindProblem(head) {
    const found = sniff(head);
    if (found.svg) return 'SVG is not accepted (it can carry scripts), left out';
    if (found.heic) return null;
    if (!found.type) return 'not an image or PDF, left out';
    if (TYPES[found.type].document && config.media.documents === false) return 'documents (PDF) are not accepted on this site, left out';
    return null;
  }

  /** The files of a zip (a Buffer, or a file source) that could come in: [{name, bytes, problem?, read}], each one's kind told from its first bytes. */
  function zipEntries(src) {
    return readZip(src, { maxEntries: ZIP_ENTRIES, maxEntryBytes: config.media.maxBytes }).map((e) => {
      let problem = e.problem;
      if (!problem) {
        try {
          problem = kindProblem(e.head());
        } catch (err) {
          problem = err.message;
        }
      }
      return { name: e.name, bytes: e.size, ...(problem ? { problem } : {}), read: e.read };
    });
  }

  /** The job that stores the sources and commits them; the log names each file. `done` runs when it ends. */
  function enqueue(ctx, kind, sources, { message, source, done = null }) {
    return app.jobs.enqueue({
      kind: 'media-import',
      user: ctx.user,
      target: source,
      notice: { text: (error) => `Importing media (${source}) did not finish. ${error}` },
      run: async (step) => {
        try {
          let r;
          await step(kind, async (log) => {
            r = await storeAll(ctx, sources, { message, source, log });
            log(`\n${plural(r.rows.length, 'file')} imported${r.commit ? ` in ${r.commit.slice(0, 7)}` : ''}${r.problems.length ? `, ${plural(r.problems.length, 'problem')}` : ''}.\n`);
            return r.rows.length ? 0 : { code: 1, reason: '(none of the files could be imported; the log says why for each)' };
          });
        } finally {
          done?.();
        }
      },
    });
  }

  function mayImport(ctx) {
    if (!can(ctx.user, 'media.import')) throw forbidden('Your role cannot import media files.');
  }

  function routes(router) {
    router.add('POST', '/media/import/urls', async (ctx) => {
      mayImport(ctx);
      const items = checkUrls(ctx.body?.urls);
      if (ctx.body?.dry) return { items };
      const good = items.filter((i) => !i.problem);
      if (!good.length) throw badRequest('None of these addresses can be fetched.', { items });
      const sources = good.map((i) => ({ label: i.url, name: nameOfUrl(i.url), read: () => fetchImage(i.url) }));
      return { job: { id: enqueue(ctx, 'fetch', sources, { message: (n) => `Import ${plural(n, 'media file')} from the web`, source: `${plural(good.length, 'address', 'addresses')}` }) }, items };
    });

    router.add(
      'POST',
      '/media/import/zip',
      async (ctx) => {
        mayImport(ctx);
        const release = app.importLock.take('media zip');
        if (!release) throw new HttpError(409, 'busy', 'Another import is running. Try again when it is done.');
        let zip = null;
        let file = null;
        let cleaned = false;
        const done = () => {
          if (cleaned) return;
          cleaned = true;
          zip?.close();
          if (file) fs.rmSync(file, { force: true });
          release();
        };
        try {
          ({ file } = await readToFile(ctx.req, config.media.importMaxBytes ?? DEFAULT_IMPORT_MAX, path.join(config.dataDir, 'tmp')));
          const name = String(ctx.query.get('filename') ?? 'media.zip').slice(0, 200);
          zip = fileSource(file);
          const entries = zipEntries(zip);
          const items = entries.map(({ read, ...rest }) => rest);
          if (flag(ctx.query, 'dry')) return { items };
          const good = entries.filter((e) => !e.problem);
          if (!good.length) throw badRequest('This zip holds no file that can be imported.', { items });
          const sources = good.map((e) => ({ label: e.name, name: path.posix.basename(e.name), read: async () => e.read() }));
          // the job reads the entries from the file; the file and the lock go when it ends, however it ends
          const id = enqueue(ctx, 'unzip', sources, { message: (n) => `Import ${plural(n, 'media file')} from ${name}`, source: name, done });
          return { job: { id }, items };
        } catch (e) {
          done();
          throw e;
        } finally {
          if (flag(ctx.query, 'dry')) done();
        }
      },
      { rawBody: true },
    );
  }

  return { checkUrls, fetchImage, storeAll, undo, zipEntries, routes, toPublic };
}
