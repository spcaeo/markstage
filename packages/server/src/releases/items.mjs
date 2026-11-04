// What goes into a release (docs/API-RELEASES.md "Items"): an entry as it will go live, a shared Library item, a
// picture. Each is checked when it is added the way a save, a Library change or an upload would be (rights, locks,
// links, raw HTML, the site's validation; a picture sniffed and re-encoded), so what the release later writes is
// what those routes would have let through. Nothing is written to the repo here.
import path from 'node:path';
import { atLeast, can } from '../roles.mjs';
import { statusText } from '../publish.mjs';
import { stampLocks } from '../content/locks.mjs';
import { HttpError, conflict, forbidden, invalid, newId, notFound, nowIso, sha1 } from '../util.mjs';

const CONTENT_KEYS = ['doc', 'frontmatter', 'source', 'data', 'changes'];

/** A scheduled release publishes itself at its time, so nothing an AI agent sends may join it: a person schedules. */
export function notScheduled(r) {
  if (r.status === 'scheduled') throw new HttpError(409, 'scheduled', `“${r.name}” is scheduled: it goes live by itself at its time, so an AI agent cannot add to it. Add to a release that is not scheduled; a person schedules it.`);
}

export function createReleaseItems(app, { rs, entries }) {
  const { store, converter, clock, audit } = app;

  /**
   * An entry, as it goes live: its saved text (or the changes sent with it, over the saved text), status cleared.
   * A draft goes live with the release; a live page's changes wait in the release instead of on the site.
   */
  async function addEntry(ctx, r, body) {
    let c;
    try {
      c = store.collection(String(body.collection ?? ''));
    } catch {
      throw notFound('No such collection.');
    }
    const id = String(body.id ?? '');
    const cur = store.read(c, id);
    if (body.version !== cur.version) throw conflict('This entry changed since you opened it. Reload to see the latest.', { version: cur.version });
    const summary = store.summarize(c, id, cur.text);
    const rights = entries.permissions(ctx, c, summary);
    if (!rights.edit) throw forbidden('You cannot edit this entry.');
    if (c.hasStatus && !rights.publish) throw forbidden('An entry in a release goes live with it, and your role cannot publish it. Ask an editor.');
    let text = CONTENT_KEYS.some((k) => body[k] !== undefined) ? entries.textFromBody(c, cur.text, body).text : cur.text;
    text = statusText(converter, c, text, { draft: null, publishAt: null });
    // a password goes on and off through Protect only, never with a release
    if (JSON.stringify(store.fieldsOf(c, text).protected ?? null) !== JSON.stringify(store.fieldsOf(c, cur.text).protected ?? null)) throw new HttpError(422, 'invalid', '"protected" changes only through Protect.', { fields: { protected: 'Use Protect.' } });
    if (text === cur.text) throw new HttpError(422, 'nothing', 'This entry is live as it is: there is nothing to release. Change it first, or send the changes with it.');
    const checked = {};
    entries.guard(ctx, c, cur.text, text, rights, { allowStatus: true, out: checked, id });
    if (checked.lockChanges?.length) text = stampLocks(c, converter, text, checked.lockChanges, { by: ctx.user.name, at: nowIso(clock()).replace(/\.\d{3}Z$/, 'Z') });
    if (checked.synced?.stamp) text = app.library.synced.stamp(c, text);
    await entries.validate(c, id, text);
    // an AI agent adds to an open release only: a scheduled one goes live on its own. Asked again here, with no wait
    // before the item is kept, so a schedule made meanwhile is seen
    if (ctx.via) notScheduled(rs.must(r.id));
    const meta = ctx.via ? { via: ctx.via.kind, tokenId: ctx.via.tokenId, tokenName: ctx.via.tokenName } : {};
    const it = rs.putItem(r, { id: newId('ri'), kind: 'entry', rel: cur.rel, collection: c.id, entryId: id, title: summary.title || id, base: cur.version, addedBy: ctx.user.id, meta }, Buffer.from(text, 'utf8'));
    audit.log(ctx, 'release.item', { target: r.id, detail: { add: it.rel, kind: 'entry', was: summary.status, locks: checked.lockChanges?.length ?? 0 } });
    return it;
  }

  /** A shared Library item, new or changed: its file as the Library would write it. */
  function addLibrary(ctx, r, body) {
    const lib = app.library;
    if (!lib.manages(ctx.user)) throw forbidden('Only editors and above put Library items in a release.');
    const input = body.item && typeof body.item === 'object' ? body.item : {};
    let cur = null;
    if (body.libraryId !== undefined) {
      cur = lib.shared(String(body.libraryId));
      if (!cur) throw notFound('No such shared Library item.');
      if (body.version !== cur.version) throw conflict('This item changed since you opened it.', { version: cur.version });
      if (input.kind !== undefined && input.kind !== cur.kind) throw invalid({ kind: 'An item keeps its kind.' });
    }
    // a synced item rewrites every page that uses it when it changes (library/synced.mjs): that is its own publish
    if (cur?.synced || input.synced) throw new HttpError(422, 'synced', 'A synced item changes every page that uses it at once. Change it in the Library, not in a release.');
    if (input.shared === false) throw invalid({ shared: 'A release holds the site’s shared items; a personal snippet stays yours.' });
    const f = lib.clean({ ...input, shared: true }, cur ? { ...cur } : { kind: input.kind });
    const at = nowIso(clock());
    const next = cur ? { ...cur, ...f, updatedAt: at } : { ...f, id: newId('lib'), createdBy: { id: ctx.user.id, name: ctx.user.name }, createdAt: at, updatedAt: at };
    delete next.version;
    const text = lib.fileText(next);
    const it = rs.putItem(r, { id: newId('ri'), kind: 'library', rel: lib.relOf(next.kind, next.id), libId: next.id, title: next.name, base: cur ? cur.version : null, meta: { kind: next.kind }, addedBy: ctx.user.id }, Buffer.from(text, 'utf8'));
    audit.log(ctx, 'release.item', { target: r.id, detail: { add: it.rel, kind: 'library', isNew: !cur } });
    return it;
  }

  /**
   * A picture: made ready as an upload is (never SVG, re-encoded), its name in the media folder kept for it (an
   * upload meanwhile takes another), stored and listed in the media library when the release goes live.
   */
  async function addMedia(ctx, r, raw, name, alt) {
    if (!can(ctx.user, 'media.upload')) throw forbidden('Your role cannot upload files.');
    if (!app.mediaPrepare) throw new HttpError(503, 'unavailable', 'The media library is not running.');
    if (typeof alt !== 'string' || alt.length > 500) throw invalid({ alt: 'Alt text up to 500 characters.' });
    const { out, base, ext } = await app.mediaPrepare.prepare(raw, name);
    const now = new Date(clock());
    const dir = [app.config.media.dir.split(path.sep).join('/'), String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0')].join('/');
    let file = `${base}.${ext}`;
    const taken = (f) => store.readRelBytes(`${dir}/${f}`) !== null || rs.reserved(`${dir}/${f}`);
    for (let n = 2; taken(file); n++) file = `${base}-${n}.${ext}`;
    const it = rs.putItem(r, { id: newId('ri'), kind: 'media', rel: `${dir}/${file}`, title: file, base: null, meta: { type: out.type, width: out.width ?? null, height: out.height ?? null, alt: alt.trim(), filename: file, mediaId: newId('m') }, addedBy: ctx.user.id }, out.buffer);
    audit.log(ctx, 'release.item', { target: r.id, detail: { add: it.rel, kind: 'media', bytes: out.buffer.length } });
    return it;
  }

  /** Take an item out: who added it, or an editor and above. */
  function remove(ctx, r, it) {
    if (it.added_by !== ctx.user.id && !atLeast(ctx.user, 'editor')) throw forbidden('Only who added it, or an editor and above, takes it out.');
    rs.dropItem(r, it);
    audit.log(ctx, 'release.item', { target: r.id, detail: { remove: it.rel, kind: it.kind } });
  }

  /** The text an item writes, for review (an entry's source, a Library item's file). */
  function text(it) {
    if (it.kind === 'media') throw new HttpError(400, 'binary', 'A picture has no text; open its file.');
    const t = rs.bytesOf(it).toString('utf8');
    const now = store.readRel(it.rel);
    return { path: it.rel, text: t, current: now, version: sha1(t) };
  }

  return { addEntry, addLibrary, addMedia, remove, text };
}
