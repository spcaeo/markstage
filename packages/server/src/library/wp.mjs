// The Library's import from WordPress (docs/API-LIBRARY.md "From WordPress"): the reusable blocks (patterns, post type
// `wp_block`) of a WordPress export (.xml, WXR) or a database dump (.sql, .sql.gz, mysqldump), read only. Each
// published block becomes a section in "Imported" (`imported: {from: 'wordpress', source, wpId}`), its Gutenberg HTML
// read into Markdown and then the site's own blocks (library/html.mjs). Pictures: an address the media map names (the
// migration's {urls: {old address: repo path}}) or one whose /wp-content/uploads/ path is already in the media folder
// points at that file; any other is fetched through the SSRF guard into Media. A dry run first; then one commit,
// audited as library.import. A block imported before from the same WordPress id is skipped.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import { isInside } from '../config.mjs';
import { parseValues } from '../forms/import-wp.mjs';
import { HttpError, badRequest, forbidden, newId, nowIso } from '../util.mjs';
import { imagesOf, parseHtml, toMarkdown } from './html.mjs';
import { nameOfUrl } from '../media/import.mjs';
import { IMPORTED } from './url-import.mjs';

const MAX_BLOCKS = 500;
const MAX_FETCH = 50;

/** Where `close` is, from `from`, not counting one inside a CDATA section; -1 when absent. Linear: indexOf only. */
function closeOf(xml, close, from) {
  let at = from;
  for (;;) {
    const c = xml.indexOf(close, at);
    const d = xml.indexOf('<![CDATA[', at);
    if (c < 0) return -1;
    if (d < 0 || c < d) return c;
    const e = xml.indexOf(']]>', d + 9);
    if (e < 0) return -1;
    at = e + 3;
  }
}

const unescapeXml = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** The text inside a WXR element (the first one), its CDATA sections joined; null when absent. */
const field = (xml, tag) => {
  let open = -1;
  for (let at = 0; ; at = open + 1) {
    open = xml.indexOf(`<${tag}`, at);
    if (open < 0) return null;
    const next = xml[open + tag.length + 1];
    if (next === '>' || next === ' ' || next === '\t' || next === '\n') break;
  }
  const head = xml.indexOf('>', open);
  if (head < 0) return null;
  const end = closeOf(xml, `</${tag}>`, head + 1);
  if (end < 0) return null;
  const raw = xml.slice(head + 1, end);
  if (!raw.includes('<![CDATA[')) return unescapeXml(raw.trim());
  let out = '';
  for (let at = raw.indexOf('<![CDATA['); at >= 0; at = raw.indexOf('<![CDATA[', at)) {
    const e = raw.indexOf(']]>', at + 9);
    if (e < 0) break;
    out += raw.slice(at + 9, e);
    at = e + 3;
  }
  return out;
};

/** The reusable blocks of a WXR export: [{id, title, status, html}]. Read with indexOf only (no backtracking). */
export function blocksOfWxr(xml) {
  if (!/<rss[\s>]/.test(xml) || !xml.includes('xmlns:wp=')) throw badRequest('This is not a WordPress export (Tools › Export gives an .xml file with <rss> and the wp: fields).');
  const out = [];
  for (let at = xml.indexOf('<item>'); at >= 0; at = xml.indexOf('<item>', at)) {
    const end = closeOf(xml, '</item>', at + 6);
    if (end < 0) break;
    const item = xml.slice(at + 6, end);
    at = end + 7;
    if (field(item, 'wp:post_type') !== 'wp_block') continue;
    out.push({ id: String(field(item, 'wp:post_id') ?? ''), title: field(item, 'title') ?? '', status: field(item, 'wp:status') ?? '', html: field(item, 'content:encoded') ?? '' });
  }
  return out;
}

/** The reusable blocks of a mysqldump, from its posts table (any prefix): [{id, title, status, html}]. */
export async function blocksOfDump(stream) {
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let table = null;
  let columns = null;
  let inCreate = false;
  const out = [];
  for await (const line of lines) {
    if (!table) {
      const c = /^CREATE TABLE `(\w*?posts)` \(/.exec(line);
      if (c) {
        table = c[1];
        columns = [];
        inCreate = true;
      }
      continue;
    }
    if (inCreate) {
      const col = /^\s*`([^`]+)`\s/.exec(line);
      if (col) columns.push(col[1]);
      else if (/^\)/.test(line)) inCreate = false;
      continue;
    }
    if (!line.startsWith(`INSERT INTO \`${table}\``)) continue;
    const m = /^INSERT INTO `[^`]+`\s*(\(([^)]*)\))?\s*VALUES\s*/.exec(line);
    const cols = m[2] ? m[2].split(',').map((c) => c.trim().replace(/^`|`$/g, '')) : columns;
    for (const r of parseValues(line, m[0].length)) {
      const row = Object.fromEntries(cols.map((c, k) => [c, r[k]]));
      if (row.post_type === 'wp_block') out.push({ id: String(row.ID ?? ''), title: row.post_title ?? '', status: row.post_status ?? '', html: row.post_content ?? '' });
    }
  }
  if (!table) throw badRequest('This dump has no WordPress posts table.');
  return out;
}

export function createWpImport(app, lib) {
  const { config, store, db, git, audit } = app;
  const media = config.media;

  /** Read the file's blocks: {blocks, kind: 'export'|'dump'}. `open()` gives the bytes as a stream. */
  async function blocksOf(name, open) {
    if (/\.xml$/i.test(name)) {
      const chunks = [];
      for await (const c of open()) chunks.push(c);
      return blocksOfWxr(Buffer.concat(chunks).toString('utf8'));
    }
    if (/\.sql(\.gz)?$/i.test(name)) {
      const s = open();
      return blocksOfDump(/\.gz$/i.test(name) ? s.pipe(zlib.createGunzip()) : s);
    }
    throw new HttpError(415, 'unsupported-type', 'Import a Markstage pack (.json), a WordPress export (.xml) or a WordPress database dump (.sql or .sql.gz).');
  }

  /** The media map's addresses ({urls: {address: repo path}}, as the migration writes it), or an empty map. */
  function readMap(text) {
    if (!text) return new Map();
    let v;
    try {
      v = JSON.parse(text);
    } catch {
      throw badRequest('The media map is not JSON.');
    }
    const urls = v && typeof v === 'object' ? (v.urls ?? v) : null;
    if (!urls || typeof urls !== 'object') throw badRequest('The media map is {urls: {old address: file in the repo}}.');
    return new Map(Object.entries(urls).filter(([k, p]) => typeof k === 'string' && typeof p === 'string'));
  }

  /** A picture address as a file already in the media folder (repo path), or null. */
  function onHand(url, map) {
    const dir = media.dir.split(path.sep).join('/');
    let up = /\/wp-content\/uploads\/([^?#]+)/.exec(url)?.[1] ?? null;
    try {
      up = up && decodeURIComponent(up);
    } catch {
      up = null;
    }
    // the map is keyed by the old address or the old upload path; its values are repo paths or paths in the media folder
    const named = [url, up, up && `/wp-content/uploads/${up}`].filter(Boolean).map((k) => map.get(k)).filter(Boolean);
    const candidates = [...named.flatMap((v) => [v, path.posix.join(dir, v)]), ...(up ? [path.posix.join(dir, up)] : [])];
    for (const rel of candidates) {
      const abs = path.join(config.contentRoot, rel);
      if (isInside(media.absDir, abs) && fs.existsSync(abs) && fs.statSync(abs).isFile()) return rel.split(path.sep).join('/');
    }
    return null;
  }
  const urlOf = (rel) => media.url.replace('{path}', path.posix.relative(media.dir.split(path.sep).join('/'), rel));

  /** Earlier imports of this site's blocks, by WordPress id. */
  const seen = () => new Map(lib.all().filter((it) => it.imported?.from === 'wordpress' && it.imported.wpId).map((it) => [String(it.imported.wpId), it.id]));

  async function run(ctx, name, open, { dry = false, source = name, mediaMap = null, folder = IMPORTED } = {}) {
    if (!lib.manages(ctx.user)) throw forbidden('Only editors can import into the Library.');
    const map = readMap(mediaMap);
    const all = await blocksOf(name, open);
    const problems = [];
    const blocks = all.filter((b) => {
      if (b.status === 'publish') return true;
      problems.push(`“${b.title || b.id}” (WordPress ${b.id}): ${b.status || 'not published'} in WordPress, left out`);
      return false;
    });
    if (blocks.length > MAX_BLOCKS) throw badRequest(`This file has ${blocks.length} reusable blocks; at most ${MAX_BLOCKS} are taken at once.`);
    const before = seen();
    const plan = blocks.map((b) => {
      const node = parseHtml(b.html);
      const images = imagesOf(node, undefined);
      return { b, node, images, exists: before.get(b.id) ?? null, mapped: images.filter((u) => onHand(u, map)), fetch: images.filter((u) => !onHand(u, map)) };
    });
    const toFetch = [...new Set(plan.filter((p) => !p.exists).flatMap((p) => p.fetch))];
    if (toFetch.length > MAX_FETCH) problems.push(`${toFetch.length} pictures are not in the media folder; the first ${MAX_FETCH} are fetched, the rest left out`);
    if (dry) {
      return {
        items: plan.map((p) => ({ wpId: p.b.id, kind: 'section', name: p.b.title || `WordPress block ${p.b.id}`, images: p.images.length, ...(p.exists ? { exists: true } : {}) })),
        media: toFetch.slice(0, MAX_FETCH).length,
        found: plan.reduce((n, p) => n + p.mapped.length, 0),
        problems,
      };
    }
    const mi = app.mediaImport;
    const sources = toFetch.slice(0, MAX_FETCH).map((u) => ({ label: u, name: nameOfUrl(u), read: () => mi.fetchImage(u) }));
    const stored = sources.length ? await mi.storeAll(ctx, sources, { commit: false }) : { rows: [], byLabel: new Map(), problems: [] };
    problems.push(...stored.problems);
    const src = (u) => {
      const rel = onHand(u, map);
      if (rel) return urlOf(rel);
      const row = stored.byLabel.get(u);
      return row ? mi.toPublic(row).url : null;
    };
    const at = nowIso(app.clock());
    const items = [];
    const skipped = [];
    for (const p of plan) {
      const label = p.b.title || `WordPress block ${p.b.id}`;
      if (p.exists) {
        skipped.push({ id: p.exists, name: label, reason: 'imported before' });
        continue;
      }
      try {
        const doc = app.converter.mdToDoc(toMarkdown(p.node, { src })).doc;
        if (!doc?.content?.length) {
          problems.push(`${label}: nothing left to import once cleaned, left out`);
          continue;
        }
        const f = lib.clean({ kind: 'section', name: label.slice(0, 100), folder, body: { doc }, shared: true }, { kind: 'section' });
        items.push({ ...f, id: newId('lib'), createdBy: { id: ctx.user.id, name: ctx.user.name }, createdAt: at, updatedAt: at, imported: { from: 'wordpress', source: String(source).slice(0, 200), wpId: p.b.id } });
      } catch (e) {
        if (e.status === 503) throw e;
        problems.push(`${label}: ${e.extra?.fields ? Object.values(e.extra.fields)[0] : e.message}`);
      }
    }
    if (!items.length) {
      mi.undo(stored.rows);
      return { created: [], skipped, media: 0, problems, commit: null };
    }
    return app.repoLock.run(async () => {
      const rels = items.map((it) => {
        const rel = lib.relOf(it.kind, it.id);
        store.writeRel(rel, lib.fileText(it));
        return rel;
      });
      let commit;
      try {
        commit = await git.commit([...rels, ...stored.rows.map((r) => r.path)], `Library: import ${items.length} item${items.length === 1 ? '' : 's'} from ${String(source).slice(0, 80)}`, { name: ctx.user.name, email: ctx.user.email });
      } catch (e) {
        for (const rel of rels) store.removeRel(rel);
        mi.undo(stored.rows);
        throw e;
      }
      const created = items.map((it) => it.id);
      audit.log(ctx, 'library.import', { target: 'library', detail: { from: 'wordpress', source: String(source).slice(0, 200), commit, created, skipped: skipped.map((s) => s.id), media: stored.rows.map((r) => r.path), problems: problems.length } });
      return { created, skipped, media: stored.rows.length, problems, commit };
    });
  }

  return {
    /** An uploaded file ({filename, data}) from the import route; `mediaMap`: the map's text, when sent along. */
    importFile: (ctx, file, opts) => run(ctx, String(file.filename ?? ''), () => Readable.from([file.data]), opts),
    /** A file on the server (the command line). */
    importPath: (ctx, abs, opts) => run(ctx, path.basename(abs), () => fs.createReadStream(abs), opts),
  };
}
