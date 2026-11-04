// The Library (docs/API.md "Library"): page templates, sections and snippets to use again, in one store.
//   Shared items are files in the site repo, `<library.dir>/<kind>/<id>.json` (and `<id>.png`, its picture),
//   committed on every change, so they are promoted between environments and reviewed like content. A personal
//   snippet (not shared) stays in the server's database, with its picture in the data dir. The snippets and templates
//   the database held before move into files once (moveOld); /snippets and /templates still answer (library.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { unsafeUrls } from '../content/urls.mjs';
import { can } from '../roles.mjs';
import { HttpError, badRequest, conflict, forbidden, invalid, newId, notFound, nowIso, sha1 } from '../util.mjs';
import { canon, createSynced, syncVersion } from './synced.mjs';

export const KINDS = ['template', 'section', 'snippet'];
const ITEM_ID = /^(lib|sn|t)_[A-Za-z0-9_-]{8,40}$/;
const TYPE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const WHAT = ['move', 'remove', 'edit'];
const MAX_BODY = 1024 * 1024;
export const MAX_THUMB = 200 * 1024;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// what a template never carries into a new entry: that entry's own address, dates and author
const UNTEMPLATED = ['slug', 'id', 'date', 'pubDate', 'publishDate', 'publishedAt', 'publishAt', 'updated', 'updatedAt', 'modified', 'lastModified', 'author', 'authors'];
const FIELDS = ['name', 'description', 'folder', 'tags', 'order', 'synced', 'collection', 'sectionType', 'locks', 'body', 'shared'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isDoc = (d) => isObj(d) && d.type === 'doc' && Array.isArray(d.content ?? []);
const WORDS = { template: 'template', section: 'section', snippet: 'snippet' };

/** {move, remove, edit} with true only, or null. */
export function locksOf(v) {
  if (v === undefined || v === null) return null;
  if (!isObj(v) || Object.keys(v).some((k) => !WHAT.includes(k) || typeof v[k] !== 'boolean')) throw invalid({ locks: 'Locks are {move, remove, edit}, each true or false.' });
  const out = Object.fromEntries(WHAT.filter((w) => v[w]).map((w) => [w, true]));
  return Object.keys(out).length ? out : null;
}

/** A document's folder and place kept in its attrs (how the editor kept them before the Library had fields). */
export function placeInDoc(doc) {
  const attrs = isObj(doc?.attrs) ? doc.attrs : {};
  const { folder, order, ...rest } = attrs;
  const clean = { ...doc };
  if (Object.keys(rest).length) clean.attrs = rest;
  else delete clean.attrs;
  return { folder: typeof folder === 'string' ? folder.trim().slice(0, 100) : '', order: typeof order === 'number' && Number.isFinite(order) ? order : null, doc: clean };
}

export function createLibrary(app) {
  const { db, config, store, git, audit } = app;
  const dirRel = config.library.dir;
  const relOf = (kind, id, ext = 'json') => `${dirRel}/${kind}/${id}.${ext}`;
  const thumbDir = path.join(config.dataDir, 'library-thumbs');
  /** The files of these that are there (git refuses to add a path that never was). */
  const present = (rels) => rels.filter((r) => store.readRel(r) !== null);
  const who = (ctx) => ({ name: ctx?.user?.name ?? config.git.committerName, email: ctx?.user?.email ?? config.git.committerEmail });

  // ---------- reading ----------

  /** A shared item from its file text: the stored fields, or null when the file is not an item. */
  function fromFile(kind, text) {
    let v;
    try {
      v = JSON.parse(text);
    } catch {
      return null;
    }
    if (!isObj(v) || typeof v.id !== 'string' || !ITEM_ID.test(v.id)) return null;
    return { ...v, kind, shared: true, version: sha1(text) };
  }

  function sharedAll() {
    const out = [];
    for (const kind of KINDS) {
      const abs = path.join(config.contentRoot, dirRel, kind);
      if (!fs.existsSync(abs)) continue;
      for (const f of fs.readdirSync(abs).sort()) {
        if (!f.endsWith('.json') || !ITEM_ID.test(f.slice(0, -5))) continue;
        const it = fromFile(kind, store.readRel(`${dirRel}/${kind}/${f}`) ?? '');
        if (it && it.id === f.slice(0, -5)) out.push(it);
      }
    }
    return out;
  }

  function sharedOne(id) {
    if (!ITEM_ID.test(id)) return null;
    for (const kind of KINDS) {
      const text = store.readRel(relOf(kind, id));
      if (text !== null) return fromFile(kind, text);
    }
    return null;
  }

  const fromRow = (r) => ({
    id: r.id,
    kind: 'snippet',
    name: r.name,
    description: r.description ?? '',
    folder: r.folder ?? '',
    tags: JSON.parse(r.tags ?? '[]'),
    order: r.ord ?? null,
    synced: false,
    collection: null,
    sectionType: null,
    locks: null,
    body: { doc: JSON.parse(r.doc) },
    createdBy: { id: r.created_by, name: app.users.get(r.created_by)?.name ?? null },
    createdAt: r.created_at ?? r.updated_at,
    updatedAt: r.updated_at,
    shared: false,
    version: sha1(`${r.updated_at}\n${r.name}\n${r.doc}\n${r.folder}\n${r.tags}\n${r.ord}\n${r.description}`),
  });
  const personalAll = (user) => db.prepare('SELECT * FROM snippets WHERE shared = 0 AND created_by = ?').all(user.id).map(fromRow);
  const personalOne = (user, id) => {
    const r = db.prepare('SELECT * FROM snippets WHERE id = ? AND shared = 0').get(id);
    return r && r.created_by === user.id ? fromRow(r) : null;
  };

  /** Every item this person may see: the shared ones and their own. */
  const visible = (user) => [...sharedAll(), ...personalAll(user)];

  /** One item this person may see, or a 404 (someone else's personal snippet does not exist for you). */
  function get(user, id) {
    const it = sharedOne(String(id)) ?? personalOne(user, String(id));
    if (!it) throw notFound('No such item in the Library.');
    return it;
  }

  function thumbOf(it) {
    const file = it.shared ? path.join(config.contentRoot, relOf(it.kind, it.id, 'png')) : path.join(thumbDir, `${it.id}.png`);
    return fs.existsSync(file) ? file : null;
  }

  /** The item as the API answers it. */
  function toPublic(it, extra = {}) {
    const thumb = thumbOf(it);
    return {
      id: it.id,
      kind: it.kind,
      synced: Boolean(it.synced),
      name: it.name,
      description: it.description ?? '',
      folder: it.folder ?? '',
      tags: it.tags ?? [],
      order: it.order ?? null,
      collection: it.collection ?? null,
      sectionType: it.sectionType ?? null,
      locks: it.locks ?? null,
      body: it.body,
      thumb: thumb ? `${config.basePath}/api/library/${it.id}/thumb?v=${sha1(fs.readFileSync(thumb)).slice(0, 12)}` : null,
      usedOn: 0,
      shared: it.shared,
      createdBy: it.createdBy?.id ?? null,
      createdByName: it.createdBy?.name ?? null,
      createdAt: it.createdAt ?? null,
      updatedAt: it.updatedAt ?? null,
      version: it.version,
      // what a use's marker carries (`_synced.version`, frontmatter `synced[].version`)
      ...(it.synced ? { syncVersion: syncVersion(it.body) } : {}),
      ...(it.imported ? { imported: it.imported } : {}),
      ...extra,
    };
  }

  // ---------- rights ----------

  const manages = (user) => can(user, 'library.manage');
  /** Sections, templates and synced items are the site's (editors and up); a snippet also its creator's. */
  function mayChange(user, it) {
    if (!it.shared) return it.createdBy?.id === user.id;
    return manages(user) || (it.kind === 'snippet' && !it.synced && it.createdBy?.id === user.id);
  }
  function mayCreate(user, f) {
    if (!f.shared) return true;
    return manages(user) || (f.kind === 'snippet' && !f.synced);
  }

  // ---------- checking what is sent ----------

  /**
   * A template's values without what belongs to the entry it was kept from: slug, id, dates and authors, its place
   * (`order`), its address (the collection's address field: fields.url, or a url that is just '{field}') and
   * `seo.canonical`, so a new entry made from it never lands on that entry's address.
   */
  function untemplate(c, o) {
    if (!isObj(o)) return undefined;
    const out = structuredClone(Object.fromEntries(Object.entries(o).filter(([k]) => !UNTEMPLATED.includes(k) && k !== 'order')));
    const addressKey = c.fields?.url || (typeof c.url === 'string' && /^\{([A-Za-z_][\w.]*)\}$/.exec(c.url)?.[1]) || null;
    for (const p of [addressKey, 'seo.canonical'].filter(Boolean)) {
      const keys = p.split('.');
      const holder = keys.slice(0, -1).reduce((h, k) => (isObj(h) ? h[k] : undefined), out);
      if (isObj(holder)) delete holder[keys.at(-1)];
    }
    return out;
  }

  function cleanTemplate(body, collection) {
    if (!isObj(body)) throw invalid({ body: 'A template is {frontmatter, doc} for an article or {data} for a page.' });
    const c = (() => {
      try {
        return store.collection(String(collection ?? ''));
      } catch {
        throw invalid({ collection: 'Name the collection the template is for.' });
      }
    })();
    const strip = (o) => untemplate(c, o);
    const out = {};
    if (body.frontmatter !== undefined) {
      if (!isObj(body.frontmatter)) throw invalid({ body: 'frontmatter must be an object.' });
      out.frontmatter = strip(body.frontmatter);
    }
    if (body.doc !== undefined) {
      if (!isDoc(body.doc)) throw invalid({ body: 'doc must be a document.' });
      out.doc = body.doc;
    }
    if (body.data !== undefined) {
      if (!isObj(body.data)) throw invalid({ body: 'data must be an object.' });
      out.data = strip(body.data);
    }
    if (body._fill !== undefined) {
      if (!Array.isArray(body._fill) || body._fill.length > 50 || body._fill.some((p) => typeof p !== 'string' || !p.trim() || p.length > 200)) throw invalid({ body: '_fill is a list of field paths to fill in.' });
      out._fill = body._fill.map((p) => p.trim());
    }
    return { body: out, collection: c.id };
  }

  function cleanBody(kind, f) {
    if (kind === 'template') return cleanTemplate(f.body, f.collection);
    if (!isObj(f.body)) throw invalid({ body: kind === 'section' ? 'A section is {value} (a page section) or {doc} (a piece of an article).' : 'A snippet is {doc}, a piece of an article.' });
    if (kind === 'section' && f.body.value !== undefined) {
      if (!isObj(f.body.value)) throw invalid({ body: 'A page section is an object, one item of a page’s sections.' });
      const type = f.sectionType ?? f.body.value.discriminant ?? f.body.value.type ?? null;
      if (type !== null && !TYPE.test(String(type))) throw invalid({ sectionType: 'Not a section type.' });
      return { body: { value: f.body.value }, sectionType: type };
    }
    if (!isDoc(f.body.doc)) throw invalid({ body: kind === 'section' ? 'A section is {value} (a page section) or {doc} (a piece of an article).' : 'A snippet is {doc}, a piece of an article.' });
    return { body: { doc: f.body.doc } };
  }

  /** The fields of an item from what was sent, over `base` (an update). Throws 422 in words. */
  function clean(input, base) {
    const f = { ...base, ...Object.fromEntries(FIELDS.filter((k) => input[k] !== undefined).map((k) => [k, input[k]])) };
    if (!KINDS.includes(f.kind)) throw invalid({ kind: 'A Library item is a template, a section or a snippet.' });
    if (typeof f.name !== 'string' || !f.name.trim() || f.name.length > 100) throw invalid({ name: 'Give it a name (up to 100 characters).' });
    if (f.description !== undefined && f.description !== null && (typeof f.description !== 'string' || f.description.length > 500)) throw invalid({ description: 'A description is up to 500 characters.' });
    if (f.folder !== undefined && f.folder !== null && (typeof f.folder !== 'string' || f.folder.length > 100)) throw invalid({ folder: 'A folder name is up to 100 characters.' });
    if (f.tags !== undefined && f.tags !== null && (!Array.isArray(f.tags) || f.tags.length > 20 || f.tags.some((t) => typeof t !== 'string' || !t.trim() || t.length > 40))) throw invalid({ tags: 'Up to 20 tags of up to 40 characters.' });
    if (f.order !== undefined && f.order !== null && (typeof f.order !== 'number' || !Number.isFinite(f.order))) throw invalid({ order: 'The place is a number.' });
    const shared = f.shared === undefined ? true : Boolean(f.shared);
    const synced = Boolean(f.synced);
    if (synced && !shared) throw invalid({ synced: 'A synced item is shared: every page that uses it follows it.' });
    if (synced && f.kind === 'template') throw invalid({ synced: 'A template starts an entry; it is not kept in step with it. Make a section synced instead.' });
    if (f.kind === 'section' && f.collection) {
      try {
        store.collection(String(f.collection));
      } catch {
        throw invalid({ collection: 'No such collection.' });
      }
    }
    if (!shared && f.kind !== 'snippet') throw invalid({ shared: 'Only a snippet can be kept to yourself; templates and sections are the site’s.' });
    const b = cleanBody(f.kind, f);
    if (JSON.stringify(b.body).length > MAX_BODY) throw new HttpError(413, 'too-large', 'A Library item is at most 1 MB.');
    if (unsafeUrls(b.body).length) throw invalid({ body: 'Links must start with http, https, mailto or tel, or be relative.' }, 'Some links are not allowed.');
    return {
      kind: f.kind,
      name: f.name.trim(),
      description: (f.description ?? '').trim(),
      folder: (f.folder ?? '').trim(),
      tags: [...new Set((f.tags ?? []).map((t) => t.trim()))],
      order: f.order ?? null,
      synced,
      shared,
      collection: b.collection ?? (f.kind === 'section' && f.collection ? String(f.collection) : null),
      sectionType: b.sectionType ?? null,
      locks: locksOf(f.locks),
      body: b.body,
    };
  }

  // ---------- writing ----------

  /** The file's text: the same key order every time, so a change reads as a small diff. */
  function fileText(it) {
    const keep = {
      id: it.id,
      kind: it.kind,
      name: it.name,
      description: it.description,
      folder: it.folder,
      tags: it.tags,
      order: it.order,
      synced: it.synced,
      ...(it.collection ? { collection: it.collection } : {}),
      ...(it.sectionType ? { sectionType: it.sectionType } : {}),
      ...(it.locks ? { locks: it.locks } : {}),
      body: it.body,
      createdBy: it.createdBy,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
      ...(it.imported ? { imported: it.imported } : {}),
    };
    return `${JSON.stringify(keep, null, 2)}\n`;
  }

  /** Write a shared item's file (and its picture, when given) and commit. */
  async function commitShared(ctx, it, message, { removeRels = [], png } = {}) {
    const rel = relOf(it.kind, it.id);
    const text = fileText(it);
    store.writeRel(rel, text);
    const paths = [rel, ...removeRels];
    if (png) {
      store.writeRel(relOf(it.kind, it.id, 'png'), png);
      paths.push(relOf(it.kind, it.id, 'png'));
    }
    for (const r of removeRels) store.removeRel(r);
    const commit = await git.commit(paths, message, who(ctx));
    return { ...it, version: sha1(text), commit };
  }

  function writePersonal(it) {
    db.prepare(
      `INSERT INTO snippets (id, name, doc, created_by, shared, updated_at, description, folder, tags, ord, created_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, doc = excluded.doc, shared = 0, updated_at = excluded.updated_at, description = excluded.description, folder = excluded.folder, tags = excluded.tags, ord = excluded.ord`,
    ).run(it.id, it.name, JSON.stringify(it.body.doc), it.createdBy.id, it.updatedAt, it.description, it.folder, JSON.stringify(it.tags), it.order, it.createdAt);
  }

  const say = (it) => `the ${WORDS[it.kind]} “${it.name}”`;

  async function create(ctx, input, { action = 'library.create', imported, id } = {}) {
    if (!KINDS.includes(input?.kind)) throw invalid({ kind: 'A Library item is a template, a section or a snippet.' });
    const f = clean(input, { kind: input.kind });
    if (!mayCreate(ctx.user, f)) throw forbidden(f.synced ? 'Only editors can make synced items.' : `Only editors can add ${f.kind}s to the Library.`);
    const at = nowIso(app.clock());
    const it = { ...f, id: id ?? newId(f.shared ? 'lib' : 'sn'), createdBy: { id: ctx.user.id, name: ctx.user.name }, createdAt: at, updatedAt: at, ...(imported ? { imported } : {}) };
    if (!f.shared) {
      writePersonal(it);
      audit.log(ctx, action, { target: it.id, detail: { kind: it.kind, shared: false } });
      return get(ctx.user, it.id);
    }
    return app.repoLock.run(async () => {
      const saved = await commitShared(ctx, it, `Library: add ${say(it)}`);
      audit.log(ctx, action, { target: it.id, detail: { kind: it.kind, shared: true, synced: it.synced, commit: saved.commit } });
      return saved;
    });
  }

  async function update(ctx, id, input, { action = 'library.update', checkVersion = true } = {}) {
    return app.repoLock.run(async () => {
      const cur = get(ctx.user, id);
      if (!mayChange(ctx.user, cur)) throw forbidden(cur.shared ? 'Only editors can change this item.' : 'You can only change your own snippets.');
      if (checkVersion) {
        if (typeof input.version !== 'string') throw badRequest('Send the version you opened.');
        if (input.version !== cur.version) throw conflict('This item changed since you opened it.', { current: toPublic(cur) });
      }
      if (input.kind !== undefined && input.kind !== cur.kind) throw badRequest('An item keeps its kind. Duplicate it as another kind instead.');
      const f = clean(input, cur);
      if (f.synced !== Boolean(cur.synced) && !manages(ctx.user)) throw forbidden('Only editors can make an item synced or plain.');
      if (f.shared && !cur.shared && !mayCreate(ctx.user, f)) throw forbidden('Only editors can share this.');
      const next = { ...cur, ...f, updatedAt: nowIso(app.clock()) };
      delete next.version;
      // a synced item that changes what its pages show, or stops being synced: every copy follows in the same commit
      if (cur.synced && (canon(cur.body) !== canon(next.body) || canon(cur.locks) !== canon(next.locks) || !next.synced)) {
        if (!f.shared) throw invalid({ shared: 'A synced item is shared: make it plain first.' });
        return follow(ctx, cur, next, input);
      }
      let out;
      if (f.shared) {
        // shared now: the file (a personal snippet shared moves out of the database, its picture with it)
        const png = !cur.shared && thumbOf(cur) ? fs.readFileSync(thumbOf(cur)) : undefined;
        out = await commitShared(ctx, next, `Library: ${cur.shared ? 'change' : 'share'} ${say(next)}`, { png });
        if (!cur.shared) {
          db.prepare('DELETE FROM snippets WHERE id = ?').run(cur.id);
          fs.rmSync(path.join(thumbDir, `${cur.id}.png`), { force: true });
        }
      } else {
        if (cur.shared) {
          // back to its creator only
          if (cur.createdBy?.id !== ctx.user.id) throw forbidden('Only the person who made it can keep it to themselves.');
          const rels = present([relOf(cur.kind, cur.id), relOf(cur.kind, cur.id, 'png')]);
          const png = thumbOf(cur) ? fs.readFileSync(thumbOf(cur)) : null;
          for (const r of rels) store.removeRel(r);
          await git.commit(rels, `Library: ${say(next)} is no longer shared`, who(ctx));
          if (png) {
            fs.mkdirSync(thumbDir, { recursive: true });
            fs.writeFileSync(path.join(thumbDir, `${cur.id}.png`), png);
          }
        }
        writePersonal(next);
        out = get(ctx.user, cur.id);
      }
      audit.log(ctx, action, { target: cur.id, detail: { kind: cur.kind, shared: f.shared, changed: FIELDS.filter((k) => input[k] !== undefined), commit: out.commit ?? null } });
      return out;
    });
  }

  /**
   * A synced item changed (or made plain): the item's file and every page that uses it in one commit. A copy changed
   * in place is left as it is and listed. New content on a live page is built and deployed (put back on failure).
   */
  async function follow(ctx, cur, next, input) {
    const changed = [];
    const skipped = [];
    for (const e of synced.scan().get(cur.id) ?? []) {
      const r = synced.rewrite(e.c, e.text, cur, next, { detach: !next.synced });
      if (r.skipped) skipped.push({ collection: e.c.id, id: e.id, title: e.title, url: e.url });
      if (r.text === e.text) continue;
      changed.push({ c: e.c, id: e.id, before: e.text, after: app.many ? app.many.stamped(e.c, e.text, r.text) : r.text, title: e.title, status: e.status });
    }
    const rel = relOf(cur.kind, cur.id);
    const was = store.readRel(rel);
    const text = fileText(next);
    store.writeRel(rel, text);
    const rels = [rel, ...changed.map((h) => store.write(h.c, h.id, h.after).rel)];
    const n = changed.length;
    const pages = `${n} page${n === 1 ? '' : 's'}`;
    const commit = await git.commit(rels, next.synced ? `Library: change ${say(next)}${n ? ` on ${pages}` : ''}` : `Library: ${say(next)} is no longer synced (${pages} ${n === 1 ? 'keeps' : 'keep'} a plain copy)`, who(ctx));
    audit.log(ctx, 'library.update', { target: cur.id, detail: { kind: cur.kind, synced: next.synced, changed: FIELDS.filter((k) => input[k] !== undefined), commit, entries: changed.map((h) => `${h.c.id}/${h.id}`), skipped: skipped.map((u) => `${u.collection}/${u.id}`) } });
    // dropping markers changes no page the site shows; new content does
    const job = next.synced && app.many ? app.many.deploy(ctx, { kind: 'library-sync', target: `library/${cur.id}`, list: changed, commit, files: [{ rel, before: was, after: text }] }) : null;
    return { ...next, version: sha1(text), commit, follow: { changed: n, skipped, job } };
  }

  /**
   * Put the copies of a synced section on one page back to the item ("reset to the Library version"), after they were
   * changed there: one commit, built and deployed when the page is live. {commit, job}.
   */
  async function reset(ctx, id, c, entryId) {
    const it = get(ctx.user, id);
    if (!it.synced || !it.body?.value) throw badRequest('Only a synced page section can be reset on a page.');
    if (!manages(ctx.user)) throw forbidden('Only editors can reset a synced section.');
    return app.repoLock.run(async () => {
      const cur = store.read(c, entryId);
      const r = synced.rewrite(c, cur.text, it, it, { reset: true });
      if (r.text === cur.text) throw conflict('This page already shows the Library version.');
      const after = app.many ? app.many.stamped(c, cur.text, r.text) : r.text;
      const s = store.summarize(c, entryId, cur.text);
      const rel = store.write(c, entryId, after).rel;
      const commit = await git.commit([rel], `Library: reset ${say(it)} on “${s.title || entryId}”`, who(ctx));
      audit.log(ctx, 'library.reset', { target: it.id, detail: { entry: `${c.id}/${entryId}`, copies: r.done, commit } });
      const job = app.many ? app.many.deploy(ctx, { kind: 'library-sync', target: `library/${it.id}`, list: [{ c, id: entryId, before: cur.text, after, title: s.title || entryId, status: s.status ?? 'published' }], commit }) : null;
      return { commit, copies: r.done, job: job ? { id: job } : null };
    });
  }

  async function remove(ctx, id, { action = 'library.delete', detach = false } = {}) {
    return app.repoLock.run(async () => {
      const cur = get(ctx.user, id);
      if (!mayChange(ctx.user, cur)) throw forbidden(cur.shared ? 'Only editors can delete this item.' : 'You can only delete your own snippets.');
      let commit = null;
      if (cur.shared) {
        // a synced item still in use goes only with its copies made plain, in the same commit
        const uses = cur.synced ? (synced.scan().get(cur.id) ?? []) : [];
        if (uses.length && !detach) throw new HttpError(409, 'in-use', `“${cur.name}” is used on ${uses.length} page${uses.length === 1 ? '' : 's'}. Delete it with its copies made plain (detach), or remove it from those pages first.`, { pages: uses.map((e) => ({ collection: e.c.id, id: e.id, title: e.title, url: e.url })) });
        const detached = uses.map((e) => store.write(e.c, e.id, synced.rewrite(e.c, e.text, cur, cur, { detach: true }).text).rel);
        const rels = present([relOf(cur.kind, cur.id), relOf(cur.kind, cur.id, 'png')]);
        for (const r of rels) store.removeRel(r);
        commit = await git.commit([...rels, ...detached], `Library: delete ${say(cur)}${uses.length ? ` (${uses.length} page${uses.length === 1 ? ' keeps' : 's keep'} a plain copy)` : ''}`, who(ctx));
      } else {
        db.prepare('DELETE FROM snippets WHERE id = ?').run(cur.id);
        fs.rmSync(path.join(thumbDir, `${cur.id}.png`), { force: true });
      }
      audit.log(ctx, action, { target: cur.id, detail: { kind: cur.kind, name: cur.name, commit, ...(detach ? { detached: true } : {}) } });
      return { ok: true, commit };
    });
  }

  async function setThumb(ctx, id, png) {
    if (png !== null) {
      if (png.length > MAX_THUMB) throw new HttpError(413, 'too-large', `A picture is at most ${MAX_THUMB / 1024} KB.`);
      if (!png.subarray(0, 8).equals(PNG)) throw new HttpError(415, 'unsupported-type', 'Send a PNG picture.');
    }
    return app.repoLock.run(async () => {
      const cur = get(ctx.user, id);
      if (!mayChange(ctx.user, cur)) throw forbidden('Only editors can change this item’s picture.');
      let commit = null;
      if (cur.shared) {
        const rel = relOf(cur.kind, cur.id, 'png');
        const had = present([rel]).length > 0;
        if (png) store.writeRel(rel, png);
        else store.removeRel(rel);
        if (png || had) commit = await git.commit([rel], `Library: ${png ? 'picture of' : 'no picture for'} ${say(cur)}`, who(ctx));
      } else if (png) {
        fs.mkdirSync(thumbDir, { recursive: true });
        fs.writeFileSync(path.join(thumbDir, `${cur.id}.png`), png);
      } else fs.rmSync(path.join(thumbDir, `${cur.id}.png`), { force: true });
      audit.log(ctx, 'library.thumb', { target: cur.id, detail: { set: Boolean(png), commit } });
      return toPublic(get(ctx.user, cur.id));
    });
  }

  // ---------- the move out of the database (once) ----------

  let moving = null;
  /** The shared snippets and the templates the database held become files, in one commit; personal snippets get
   * their folder and place out of their document. Runs once; a failure is tried again at the next start. */
  function moveOld() {
    moving ??= (async () => {
      if (db.prepare("SELECT value FROM kv WHERE key = 'library.moved'").get()) return null;
      return app.repoLock.run(async () => {
        const nameOf = (uid) => app.users.get(uid)?.name ?? null;
        const shared = db.prepare('SELECT * FROM snippets WHERE shared = 1').all();
        const templates = db.prepare('SELECT * FROM templates').all();
        const rels = [];
        for (const r of shared) {
          const p = placeInDoc(JSON.parse(r.doc));
          const it = { id: r.id, kind: 'snippet', name: r.name, description: '', folder: p.folder, tags: [], order: p.order, synced: false, body: { doc: p.doc }, createdBy: { id: r.created_by, name: nameOf(r.created_by) }, createdAt: r.updated_at, updatedAt: r.updated_at };
          store.writeRel(relOf('snippet', r.id), fileText(it));
          rels.push(relOf('snippet', r.id));
        }
        for (const r of templates) {
          const p = JSON.parse(r.payload);
          const body = Object.fromEntries(['frontmatter', 'doc', 'data'].filter((k) => p[k] !== undefined && p[k] !== null).map((k) => [k, p[k]]));
          const it = { id: r.id, kind: 'template', name: r.name, description: '', folder: '', tags: [], order: null, synced: false, collection: r.collection, body, createdBy: { id: r.created_by, name: nameOf(r.created_by) }, createdAt: r.updated_at, updatedAt: r.updated_at };
          store.writeRel(relOf('template', r.id), fileText(it));
          rels.push(relOf('template', r.id));
        }
        const commit = rels.length ? await git.commit(rels, `Move ${rels.length} Library item${rels.length === 1 ? '' : 's'} into the repo`, who(null)) : null;
        db.exec('BEGIN');
        try {
          for (const r of db.prepare('SELECT * FROM snippets WHERE shared = 0').all()) {
            const p = placeInDoc(JSON.parse(r.doc));
            if (p.folder || p.order !== null || JSON.stringify(p.doc) !== r.doc) db.prepare('UPDATE snippets SET doc = ?, folder = ?, ord = ? WHERE id = ?').run(JSON.stringify(p.doc), p.folder, p.order, r.id);
          }
          db.prepare('DELETE FROM snippets WHERE shared = 1').run();
          db.prepare('DELETE FROM templates').run();
          db.prepare("INSERT INTO kv (key, value) VALUES ('library.moved', ?)").run(JSON.stringify({ at: nowIso(app.clock()), commit, count: rels.length }));
          db.exec('COMMIT');
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
        if (rels.length) audit.log({ user: null, ip: null }, 'library.move', { target: 'library', detail: { commit, count: rels.length } });
        return commit;
      });
    })().catch((e) => {
      moving = null;
      console.error(`[markstage] moving the Library into the repo failed (tried again next start): ${e.message}`);
      return null;
    });
    return moving;
  }

  /** A template for a new entry of collection c: its body without the fill list, or a 404. */
  function templateFor(user, id, c) {
    const it = get(user, id);
    if (it.kind !== 'template' || it.collection !== c.id) throw notFound('No such template for this collection.');
    const { _fill, ...body } = it.body;
    // a template kept before the server took these out still gives a clean start
    return { ...body, ...(body.frontmatter ? { frontmatter: untemplate(c, body.frontmatter) } : {}), ...(body.data ? { data: untemplate(c, body.data) } : {}) };
  }

  const api = { shared: sharedOne };
  const synced = createSynced(app, api);

  return { KINDS, synced, shared: sharedOne, all: sharedAll, clean, manages, visible, get, toPublic, create, update, remove, reset, setThumb, thumbOf, moveOld, templateFor, mayChange, relOf, fileText };
}
