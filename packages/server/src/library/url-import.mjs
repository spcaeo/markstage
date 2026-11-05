// The Library's import from a web page (docs/API-LIBRARY.md "From a web page"): the server fetches the page through
// the SSRF guard (fetch.mjs) when its robots.txt allows, and offers the page's parts to choose from (the dry run).
// The chosen parts become Library items in the "Imported" folder, their pictures fetched into Media through the
// upload pipeline, the items and the pictures in one commit, audited as library.import.
//   preview(ctx, url)                         {url, title, parts: [{id, label, html, images}]}
//   importParts(ctx, {url, parts, kind, folder, dry})   dry: {items, problems}; else {created, items, media, problems, commit}
import { HttpError, badRequest, forbidden, newId, nowIso } from '../util.mjs';
import { robotsAllow, safeFetch } from './fetch.mjs';
import { attrsOf, cleanHtml, imagesOf, parseHtml, partsOf, toMarkdown } from './html.mjs';
import { nameOfUrl } from '../media/import.mjs';

const PAGE_MAX = 5 * 1024 * 1024;
const PAGE_TIME = 10_000;
const MAX_IMAGES = 20;
const IMAGES_TIME = 60_000;
export const IMPORTED = 'Imported';

/** The <meta> tags of a page's text, read tag by tag with indexOf (a hostile page cannot make it slow). */
function metas(html, limit = 200) {
  const out = [];
  const low = html.toLowerCase();
  for (let at = low.indexOf('<meta'); at >= 0 && out.length < limit; at = low.indexOf('<meta', at + 5)) {
    const end = low.indexOf('>', at);
    if (end < 0) break;
    out.push(attrsOf(html.slice(at + 5, end)));
  }
  return out;
}

/** The page's text in its own character set (the header's, else a <meta charset>, else UTF-8). */
function textOf(r) {
  const head = r.body.subarray(0, 4096).toString('latin1');
  const fromMeta = () => {
    for (const m of metas(head)) {
      const v = m.charset ?? /charset=["']?([\w-]+)/i.exec(m.content ?? '')?.[1];
      if (v) return v;
    }
    return null;
  };
  const label = /charset=["']?([\w-]+)/i.exec(String(r.headers['content-type'] ?? ''))?.[1] ?? fromMeta() ?? 'utf-8';
  try {
    return new TextDecoder(label).decode(r.body);
  } catch {
    return new TextDecoder('utf-8').decode(r.body);
  }
}

/** The page's title: og:title, else <title>; found with indexOf. */
export const titleOf = (html) => {
  const og = metas(html).find((m) => (m.property ?? '').toLowerCase() === 'og:title')?.content;
  let t = og ?? '';
  if (!og) {
    const low = html.toLowerCase();
    const open = low.indexOf('<title');
    const head = open < 0 ? -1 : low.indexOf('>', open);
    const close = head < 0 ? -1 : low.indexOf('</title', head);
    if (close > 0) t = html.slice(head + 1, close);
  }
  return parseHtml(t).children.map((n) => n.text ?? '').join('').replace(/\s+/g, ' ').trim().slice(0, 200);
};

export function createUrlImport(app, lib) {
  const { store, git, audit } = app;
  const outbound = () => app.outbound ?? {};

  function mayImport(ctx) {
    if (!lib.manages(ctx.user)) throw forbidden('Only editors can import into the Library.');
  }

  /** The page, read: robots.txt first, then the page itself (HTML only). */
  async function load(url) {
    const robots = await robotsAllow(url, { outbound: outbound() });
    if (!robots.allowed) throw new HttpError(422, 'robots', robots.why);
    const r = await safeFetch(url, { maxBytes: PAGE_MAX, timeoutMs: PAGE_TIME, accept: 'text/html,application/xhtml+xml;q=0.9', outbound: outbound() });
    if (r.status < 200 || r.status >= 300) throw new HttpError(502, 'fetch-failed', `${new URL(r.url).host} answered ${r.status} for this page.`);
    if (r.type !== 'text/html' && r.type !== 'application/xhtml+xml') throw new HttpError(415, 'unsupported-type', `This address is ${r.type || 'not a web page'}, not a web page. Import pictures in Media, packs and WordPress files with Import….`);
    const html = textOf(r);
    return { url: r.url, title: titleOf(html), parts: partsOf(parseHtml(html)) };
  }

  async function preview(ctx, url) {
    mayImport(ctx);
    if (typeof url !== 'string' || !url.trim() || url.length > 2000) throw badRequest('Paste the address of the page.');
    const page = await load(url);
    if (!page.parts.length) throw new HttpError(422, 'empty', 'This page has no parts with text to import.');
    return { url: page.url, title: page.title, parts: page.parts.map((p) => ({ id: p.id, label: p.label, html: cleanHtml(p.node, page.url), images: imagesOf(p.node, page.url).length })) };
  }

  async function importParts(ctx, { url, parts, kind = 'section', folder = IMPORTED, dry = false } = {}) {
    mayImport(ctx);
    if (typeof url !== 'string' || !url.trim() || url.length > 2000) throw badRequest('Say which page (url).');
    if (!Array.isArray(parts) || !parts.length || parts.length > 100 || !parts.every((p) => typeof p === 'string' && /^p\d{1,3}$/.test(p))) throw badRequest('Say which parts to import (parts: ["p1", …]).');
    if (kind !== 'section' && kind !== 'snippet') throw badRequest('Parts of a page become sections or snippets.');
    if (typeof folder !== 'string' || !folder.trim() || folder.length > 100) throw badRequest('A folder name is up to 100 characters.');
    const page = await load(url);
    const byId = new Map(page.parts.map((p) => [p.id, p]));
    const missing = parts.filter((id) => !byId.has(id));
    if (missing.length) throw new HttpError(409, 'conflict', 'The page has changed since it was read. Read it again and choose the parts.');
    const chosen = [...new Set(parts)].map((id) => byId.get(id));
    const problems = [];
    const images = [...new Set(chosen.flatMap((p) => imagesOf(p.node, page.url)))];
    if (images.length > MAX_IMAGES) problems.push(`${images.length} pictures; the first ${MAX_IMAGES} are brought in, the rest left out`);
    const fetched = images.slice(0, MAX_IMAGES);
    const brought = new Set(fetched);
    if (dry) return { url: page.url, items: chosen.map((p) => ({ id: p.id, name: p.label, kind, images: imagesOf(p.node, page.url).filter((u) => brought.has(u)).length })), media: fetched.length, problems };

    // the pictures, through the upload pipeline (not committed yet: they go in the items' commit)
    const deadline = Date.now() + IMAGES_TIME;
    const mi = app.mediaImport;
    const sources = fetched.map((u) => ({
      label: u,
      name: nameOfUrl(u),
      read: () => {
        if (Date.now() > deadline) throw new Error('left out: the pictures took more than a minute in all');
        return mi.fetchImage(u, { timeoutMs: Math.max(1000, Math.min(15_000, deadline - Date.now())) });
      },
    }));
    const stored = sources.length ? await mi.storeAll(ctx, sources, { commit: false }) : { rows: [], byLabel: new Map(), problems: [] };
    problems.push(...stored.problems);
    const src = new Map([...stored.byLabel].map(([u, row]) => [u, mi.toPublic(row).url]));

    const at = nowIso(app.clock());
    const items = [];
    for (const p of chosen) {
      try {
        const md = toMarkdown(p.node, { base: page.url, src: (u) => src.get(u) ?? null });
        const doc = app.converter.mdToDoc(md).doc;
        if (!doc?.content?.length) {
          problems.push(`${p.label}: nothing left to import once cleaned, left out`);
          continue;
        }
        const f = lib.clean({ kind, name: p.label, folder: folder.trim(), body: { doc }, shared: true }, { kind });
        items.push({ ...f, id: newId('lib'), createdBy: { id: ctx.user.id, name: ctx.user.name }, createdAt: at, updatedAt: at, imported: { from: 'url', source: page.url } });
      } catch (e) {
        if (e.status === 503) throw e;
        problems.push(`${p.label}: ${e.extra?.fields ? Object.values(e.extra.fields)[0] : e.message}`);
      }
    }
    if (!items.length) {
      mi.undo(stored.rows);
      throw new HttpError(422, 'empty', 'None of the chosen parts could be imported.', { problems });
    }
    return app.repoLock.run(async () => {
      const rels = [];
      for (const it of items) {
        const rel = lib.relOf(it.kind, it.id);
        store.writeRel(rel, lib.fileText(it));
        rels.push(rel);
      }
      let commit;
      try {
        commit = await git.commit([...rels, ...stored.rows.map((r) => r.path)], `Library: import ${items.length} item${items.length === 1 ? '' : 's'} from ${new URL(page.url).host}`, { name: ctx.user.name, email: ctx.user.email });
      } catch (e) {
        for (const rel of rels) store.removeRel(rel);
        mi.undo(stored.rows);
        throw e;
      }
      const created = items.map((it) => it.id);
      audit.log(ctx, 'library.import', { target: 'library', detail: { from: 'url', source: page.url, commit, created, media: stored.rows.map((r) => r.path), problems: problems.length } });
      return { created, items: items.map((it) => ({ id: it.id, kind: it.kind, name: it.name, folder: it.folder })), media: stored.rows.length, problems, commit };
    });
  }

  return { preview, importParts };
}
