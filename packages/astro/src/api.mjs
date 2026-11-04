// The dev API: the routes of docs/API.md the editor uses, without sign-in, for `astro dev` on this machine only.
// Every request must come from a loopback address with a loopback Host (no DNS rebinding); a write must also carry
// an Origin of this server (no cross-site form posts).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { localePath } from '@markstage/core';
import { newEntryFrontmatter } from './config.mjs';
import { authorsRoute } from './api-authors.mjs';
import { checkEntry, pageChecksOf, typedFrontmatter } from './api-pages.mjs';
import { jsonRoute } from './api-json.mjs';
import { mediaRoute } from './media.mjs';
import {
  HttpError,
  ID,
  checkMarkdown,
  checkVersion,
  entryOf,
  fileOf,
  listItems,
  queryItems,
  readFile,
  sha1,
  urlOf,
  writeText,
} from './content.mjs';
import { forwardRoute, forwardTarget } from './api-forward.mjs';

const LOOPBACK_ADDR = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/;
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;
const MAX_BODY = 4 * 1024 * 1024;

function send(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      raw += c;
      if (raw.length > MAX_BODY) reject(new HttpError(413, 'too-large', 'The request is too large.'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new HttpError(400, 'bad-request', 'The request body is not JSON.'));
      }
    });
    req.on('error', reject);
  });
}

/** Rejects requests that are not from this machine, and writes from another origin. */
export function checkRequest(req) {
  if (!LOOPBACK_ADDR.test(req.socket?.remoteAddress ?? '')) throw new HttpError(403, 'forbidden', 'The dev editor only answers this machine.');
  const host = req.headers.host ?? '';
  if (!LOOPBACK_HOST.test(host)) throw new HttpError(403, 'forbidden', 'The dev editor only answers on 127.0.0.1 or localhost.');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.origin;
    if (!origin || new URL(origin).host !== host) throw new HttpError(403, 'forbidden', 'This request did not come from the editor page.');
  }
}

/**
 * The git branch the site's folder is on (symbolic-ref: also before the first commit; a detached HEAD: its short
 * commit), or null outside a repository.
 */
function gitBranch(root) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();
  for (const args of [['symbolic-ref', '--short', '-q', 'HEAD'], ['rev-parse', '--short', 'HEAD']]) {
    try {
      const b = git(...args);
      if (b) return b;
    } catch {
      // not this way (detached, or not a repository)
    }
  }
  return null;
}

/** A new draft's file text: `draft: true` added to the frontmatter of a status collection. */
function asDraft(text, c) {
  if (!c.hasStatus) return text;
  if (/^---\r?\n[\s\S]*?^draft:\s*\S+\s*$[\s\S]*?\r?\n---\r?\n/m.test(text)) return text.replace(/^(---\r?\n[\s\S]*?^)draft:\s*\S+(\s*)$/m, '$1draft: true$2');
  return text.replace(/^---\r?\n/, (open) => `${open}draft: true\n`);
}

const slugify = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);

/**
 * The API as connect middleware. `tools()` gives { md, readFrontmatter } (loaded through Vite on every call, so
 * pack edits apply at once).
 */
export function devApi(cfg, tools, log = console, { forward = process.env.MARKSTAGE_DEV_SERVER } = {}) {
  const prefix = `${cfg.basePath}/api/`;
  // the links and topics screens, from a Markstage server on this machine when one is named (api-forward.mjs)
  const target = forwardTarget(forward);
  const byId = new Map(cfg.collections.map((c) => [c.id, c]));
  const collectionOf = (id) => {
    const c = byId.get(id);
    if (!c) throw new HttpError(404, 'not-found', `There is no collection "${id}".`);
    return c;
  };
  const entryFile = (c, id) => {
    const file = fileOf(c, id);
    if (!file) throw new HttpError(404, 'not-found', 'This entry does not exist.');
    return file;
  };

  async function route(req, res, url) {
    const parts = url.pathname.slice(prefix.length).replace(/\/+$/, '').split('/').map(decodeURIComponent);
    const m = req.method;
    const { md, readFrontmatter, setFrontmatter } = await tools();

    if (parts[0] === 'auth' && parts[1] === 'me' && m === 'GET') {
      return send(res, 200, { user: { id: 'u_dev', name: 'Dev mode', role: 'owner' }, devMode: true, csrfToken: null });
    }
    // the environment (docs/ENVIRONMENTS.md): this laptop, on the branch the site's folder is on (the LOCAL badge)
    if (parts[0] === 'env' && parts.length === 1 && m === 'GET') return send(res, 200, { name: 'local', local: true, production: false, configured: true, branch: gitBranch(cfg.root) });
    // the device frame and "Open preview": in dev mode the page as this dev server draws the saved file
    if (parts[0] === 'preview' && parts.length === 3 && m === 'GET') {
      const pc = collectionOf(parts[1]);
      const page = urlOf(pc, readFile(pc, entryFile(pc, parts[2]), readFrontmatter));
      if (!page) throw new HttpError(409, 'no-page', 'This collection has no page address.');
      // ?locale=<code>: that locale's copy of the page
      const code = url.searchParams.get('locale');
      const locale = code ? cfg.locales?.list.find((l) => l.code === code) : null;
      if (code && !locale) throw new HttpError(400, 'bad-request', `"${code}" is not one of the site's locales.`);
      return send(res, 200, { url: new URL(locale ? localePath(locale, page) : page, `http://${req.headers.host}`).href, devServer: true });
    }
    if (await mediaRoute({ parts, method: m, req, res, cfg, send, HttpError, readFrontmatter })) return;
    // what the shared screens (the media library) ask for besides: one person, and no stock photo provider
    if (parts[0] === 'users' && parts.length === 1 && m === 'GET' && url.searchParams.get('brief') === '1') return send(res, 200, [{ id: 'u_dev', name: 'Dev mode', authorSlug: null }]);
    if (parts[0] === 'stock' && parts.length === 1 && m === 'GET') return send(res, 200, { enabled: false });
    // the site's authors (config `authors`): api-authors.mjs; true when it answered
    if (await authorsRoute({ parts, method: m, req, res, url, cfg, readBody, send, HttpError, readFrontmatter, setFrontmatter })) return;
    if (await forwardRoute({ target, parts, req, res, url, HttpError })) return;
    // the light index of every entry (the editor's palette, Home and link targets): docs/API.md "The light index"
    if (parts[0] === 'index' && parts.length === 1 && m === 'GET') {
      return send(res, 200, { items: cfg.collections.flatMap((c) => listItems(c, readFrontmatter).map((i) => ({ collection: c.id, id: i.id, title: i.title, url: i.url ?? null, status: i.status, modified: i.modified ?? null, ...(i.group ? { group: i.group } : {}) }))) });
    }
    if (parts[0] !== 'collections') throw new HttpError(404, 'not-found', 'Dev mode has no such route (sign-in, users and publishing come with the Markstage server).');
    if (parts.length === 1 && m === 'GET') {
      return send(
        res,
        200,
        cfg.collections.map((c) => {
          const items = listItems(c, readFrontmatter);
          const counts = { all: items.length, draft: 0, scheduled: 0, published: 0, trash: 0 };
          for (const i of items) counts[i.status]++;
          return { id: c.id, label: c.label, format: c.format, hasStatus: c.hasStatus, counts, can: { create: true } };
        }),
      );
    }
    const c = collectionOf(parts[1]);
    // JSON entries (schema, structured saves): api-json.mjs, owned by the pages editor; true when it answered
    if (c.format === 'json' && (await jsonRoute({ c, parts, method: m, req, res, url, cfg, readBody, send, HttpError, checkVersion, writeText, entryFile }))) return;

    if (parts[2] === 'import' && parts.length === 3 && m === 'POST') {
      if (c.format !== 'md') throw new HttpError(400, 'bad-request', 'Only Markdown collections import .md files.');
      const { filename, source } = await readBody(req);
      if (typeof source !== 'string' || !source.trim()) throw new HttpError(400, 'bad-request', 'The file is empty.');
      checkMarkdown(source, md, readFrontmatter);
      const fm = readFrontmatter(source);
      const title = fm[c.fields.title];
      if (!title) throw new HttpError(422, 'invalid', `The file has no ${c.fields.title} in its frontmatter.`, { fields: { [c.fields.title]: 'Required.' } });
      const id = slugify(fm.slug ?? path.basename(String(filename ?? ''), path.extname(String(filename ?? ''))) ?? title) || slugify(title);
      if (!ID.test(id)) throw new HttpError(422, 'invalid', 'No usable id: give the file a name or a slug in its frontmatter.');
      const file = path.join(c.absDir, `${id}${c.ext}`);
      if (fs.existsSync(file)) throw new HttpError(409, 'conflict', `An entry "${id}" already exists.`);
      fs.writeFileSync(file, asDraft(source.endsWith('\n') ? source : `${source}\n`, c), { flag: 'wx' });
      return send(res, 201, entryOf(c, readFile(c, file, readFrontmatter), md));
    }
    if (parts[2] !== 'entries') throw new HttpError(404, 'not-found', 'Unknown route.');
    if (parts.length === 3 && m === 'GET') return send(res, 200, queryItems(listItems(c, readFrontmatter), url.searchParams));
    // a new entry (the "New" sheet): its title, the values the sheet asked (config newEntry.ask) and the site's
    // defaults (newEntry.defaults); a draft in a status collection. No user in dev: the collection's defaultAuthor.
    if (parts.length === 3 && m === 'POST') {
      if (c.format !== 'md') throw new HttpError(400, 'bad-request', 'New pages are made in the pages editor.');
      const body = await readBody(req);
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title) throw new HttpError(422, 'invalid', 'A new entry needs a title.', { fields: { [c.fields.title]: 'Required.' } });
      const asked = body.frontmatter ?? {};
      if (asked === null || typeof asked !== 'object' || Array.isArray(asked)) throw new HttpError(400, 'bad-request', 'frontmatter must be an object.');
      // asked for by its page type (api-pages.mjs): the type's key set
      const given = typedFrontmatter(cfg, c, body, asked, HttpError);
      const id = body.id === undefined ? slugify(title) : String(body.id);
      if (!ID.test(id)) throw new HttpError(422, 'invalid', 'The address must be lowercase letters, digits and hyphens.', { fields: { id: 'Use a-z, 0-9 and hyphens.' } });
      const file = path.join(c.absDir, `${id}${c.ext}`);
      if (fs.existsSync(file)) throw new HttpError(409, 'id-taken', `An entry "${id}" already exists.`);
      const fm = newEntryFrontmatter(c, { title, id, values: given });
      const text = `${setFrontmatter('---\n---\n', fm)}\n`;
      checkMarkdown(text, md, readFrontmatter);
      checkEntry(cfg, c, null, fm, HttpError);
      fs.mkdirSync(c.absDir, { recursive: true });
      fs.writeFileSync(file, text, { flag: 'wx' });
      return send(res, 201, entryOf(c, readFile(c, file, readFrontmatter), md));
    }

    const id = parts[3];
    const file = entryFile(c, id);
    const tail = parts.slice(4).join('/');
    if (!tail && m === 'GET') return send(res, 200, entryOf(c, readFile(c, file, readFrontmatter), md));
    // the page's type, frame and what its type still needs (api-pages.mjs)
    if (tail === 'page-checks' && m === 'GET') return send(res, 200, pageChecksOf(cfg, c, readFile(c, file, readFrontmatter), { md, readFrontmatter }));
    if (!tail && m === 'PUT') {
      const body = await readBody(req);
      if (c.format !== 'md') throw new HttpError(400, 'bad-request', 'Dev mode edits JSON entries through their source.');
      if (body.doc !== undefined && body.doc?.type !== 'doc') throw new HttpError(400, 'bad-request', 'The document is not a doc.');
      const fm = body.frontmatter;
      if (fm !== undefined && (fm === null || typeof fm !== 'object' || Array.isArray(fm))) throw new HttpError(400, 'bad-request', 'frontmatter must be an object of key changes.');
      if (body.doc === undefined && fm === undefined) throw new HttpError(400, 'bad-request', 'Nothing to save (no doc, no frontmatter).');
      const before = checkVersion(file, body.version);
      // the document surgically, then the frontmatter key changes surgically (docs/API.md "Save")
      let text = body.doc ? md.docToMd(body.doc, before) : before;
      if (fm) text = setFrontmatter(text, fm);
      checkMarkdown(text, md, readFrontmatter);
      checkEntry(cfg, c, readFrontmatter(before), readFrontmatter(text), HttpError);
      const changed = text === before || !body.doc ? 0 : md.changedBlocks(body.doc, before);
      return send(res, 200, { ok: true, version: writeText(file, before, text), changedBlocks: changed, commit: null });
    }
    if (tail === 'source' && m === 'GET') {
      const text = fs.readFileSync(file, 'utf8');
      return send(res, 200, { source: text, version: sha1(text), format: c.format });
    }
    if (tail === 'source' && m === 'PUT') {
      const { source, version } = await readBody(req);
      if (typeof source !== 'string') throw new HttpError(400, 'bad-request', 'No source in the request.');
      const before = checkVersion(file, version);
      if (c.format === 'md') checkMarkdown(source, md, readFrontmatter);
      else {
        try {
          JSON.parse(source);
        } catch (e) {
          throw new HttpError(422, 'invalid', `Not valid JSON: ${e.message}`);
        }
      }
      const dataOf = (t) => (c.format === 'md' ? readFrontmatter(t) : JSON.parse(t));
      checkEntry(cfg, c, dataOf(before), dataOf(source), HttpError);
      const changed = c.format === 'md' && source !== before ? md.changedBlocks(md.mdToDoc(source).doc, before) : Number(source !== before);
      return send(res, 200, { ok: true, version: writeText(file, before, source), changedBlocks: changed, commit: null });
    }
    if (tail === 'download' && m === 'GET') {
      res.statusCode = 200;
      res.setHeader('Content-Type', c.format === 'md' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${id}${c.ext}"`);
      res.setHeader('Cache-Control', 'no-store');
      return res.end(fs.readFileSync(file));
    }
    throw new HttpError(404, 'not-found', 'Dev mode has no such route.');
  }

  return async (req, res, next) => {
    const url = new URL(req.url || '/', 'http://dev');
    // /markstage and the config's older addresses for the editor (editor.aliases) open it
    if (url.pathname === cfg.basePath || cfg.editor.aliases.some((a) => url.pathname === a || url.pathname === `${a}/`)) {
      res.statusCode = 302;
      res.setHeader('Location', `${cfg.basePath}/${url.search}`);
      return res.end();
    }
    if (!url.pathname.startsWith(prefix)) return next();
    try {
      checkRequest(req);
      await route(req, res, url);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.error, message: e.message, ...e.extra });
      log.error(`[markstage] ${e?.stack || e}`);
      return send(res, 500, { error: 'server', message: String(e?.message || e) });
    }
  };
}
