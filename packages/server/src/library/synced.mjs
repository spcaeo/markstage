// Synced Library items (docs/API-LIBRARY.md "Synced"). A page that uses one keeps an ordinary copy with a marker, so
// the site's build reads plain content and its HTML is the same as an inline copy's:
//   pages:    `_synced: {id, version}` on the section (the site ignores it, as it does `_lock`);
//   articles: frontmatter `synced: [{id, version}]`; the use is the item's blocks as Markdown, found by exact text.
// `version` is the hash of the item's body the copy was made from. Changing the item rewrites every copy that still
// matches it, in one commit; a copy changed in place is left alone and listed. A save that changes a synced copy
// without detaching it is refused (409 synced); dropping the marker is the detach (403 below editor when the item is
// locked); deleting a copy of an item locked against removal is refused (423). Pages carry the item's locks where
// the site keeps a section's lock, in its value (`value._lock`; a section without a value object: `_lock` on it), so
// the lock rules apply there as to any locked section. `_synced` stays on the section itself (the site never
// flattens it into the value); a copy built byte for byte as an inline one proves neither reaches a page.
import { atLeast } from '../roles.mjs';
import { HttpError, sha1 } from '../util.mjs';

const FM = /^---\r?\n([\s\S]*?)\r?\n?---(\r?\n|$)/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** JSON with object keys sorted: two copies are the same whatever order their keys were written in. */
export const canon = (v) => JSON.stringify(v, (_k, x) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const without = (v, keys) => Object.fromEntries(Object.entries(v).filter(([k]) => !keys.includes(k)));
/** A section without the markers the Library and the lock rules keep on it (its lock in either place). */
export const plain = (v) => {
  if (!isObj(v)) return v;
  const out = without(v, ['_synced', '_lock']);
  return isObj(out.value) && '_lock' in out.value ? { ...out, value: without(out.value, ['_lock']) } : out;
};
/** A section's lock marker: in its value (where the site keeps it), else on it. */
const lockIn = (v) => (isObj(v?.value) && v.value._lock !== undefined ? v.value._lock : (v?._lock ?? null));
/** Where a section's lock goes: its value when it has one. */
const lockPath = (p, v) => (isObj(v?.value) ? `${p}.value._lock` : `${p}._lock`);
/** The version of an item's body a copy is made from. */
export const syncVersion = (body) => sha1(canon(body)).slice(0, 12);
const bodyOf = (text) => {
  const m = FM.exec(text ?? '');
  return m ? text.slice(m[0].length) : (text ?? '');
};
/** Where `chunk` stands in `body` as whole blocks (a blank line, or the start or end, on each side). */
export function blocksAt(body, chunk) {
  const out = [];
  if (!chunk) return out;
  for (let i = body.indexOf(chunk); i >= 0; i = body.indexOf(chunk, i + 1)) {
    const before = body.slice(0, i);
    const after = body.slice(i + chunk.length);
    if ((/^\n*$/.test(before) || before.endsWith('\n\n')) && (/^\n*$/.test(after) || after.startsWith('\n\n'))) out.push(i);
  }
  return out;
}

export function createSynced(app, lib) {
  const { store, converter } = app;
  const syncedItem = (id) => {
    const it = lib.shared(String(id));
    return it?.synced ? it : null;
  };

  /** An article piece as Markdown, the way the entry's file holds it. */
  const chunkOf = (it) => converter.docToMd({ type: 'doc', content: it.body.doc?.content ?? [] }, '').trim();

  /** The synced sections in a page's data: [{path, id, version, value, lock}] (a copy's inside is the item's). */
  function jsonUses(data) {
    const out = [];
    const walk = (v, p) => {
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, p ? `${p}.${i}` : String(i)));
      else if (isObj(v)) {
        if (isObj(v._synced) && typeof v._synced.id === 'string') return void out.push({ path: p, id: v._synced.id, version: v._synced.version ?? null, value: plain(v), lock: lockIn(v), raw: v });
        for (const [k, x] of Object.entries(v)) if (k !== '_lock') walk(x, p ? `${p}.${k}` : k);
      }
    };
    walk(data, '');
    return out;
  }
  /** Every section of a page's data with no marker, as canon text (a detached copy is one of these). */
  function unmarked(data) {
    const out = new Set();
    const walk = (v) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (isObj(v)) {
        if (!isObj(v._synced)) out.add(canon(plain(v)));
        Object.values(v).forEach(walk);
      }
    };
    walk(data);
    return out;
  }
  const markers = (fields) => (Array.isArray(fields?.synced) ? fields.synced.filter((m) => isObj(m) && typeof m.id === 'string') : []);
  const dataOf = (c, text) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };

  /** The uses in one entry's text: [{id, path?, state: 'synced' | 'changed'}] (items that are not synced left out). */
  function usesIn(c, text) {
    if (c.format === 'json') {
      if (!text.includes('"_synced"')) return [];
      return jsonUses(dataOf(c, text))
        .map((u) => ({ u, it: syncedItem(u.id) }))
        .filter((x) => x.it)
        .map(({ u, it }) => ({ id: u.id, path: u.path, state: canon(u.value) === canon(it.body.value) ? 'synced' : 'changed' }));
    }
    if (!/^synced:/m.test(text)) return [];
    const body = bodyOf(text);
    return markers(converter.parseFrontmatter(text))
      .map((m) => ({ m, it: syncedItem(m.id) }))
      .filter((x) => x.it)
      .map(({ m, it }) => ({ id: m.id, state: blocksAt(body, chunkOf(it)).length ? 'synced' : 'changed' }));
  }

  /** Every entry that uses a synced item: Map id -> [{c, id, title, url, status, text, uses}]. */
  function scan() {
    const out = new Map();
    for (const c of store.collections) {
      for (const id of store.ids(c)) {
        let text;
        try {
          text = store.read(c, id).text;
        } catch {
          continue;
        }
        const uses = usesIn(c, text);
        if (!uses.length) continue;
        const s = store.summarize(c, id, text);
        for (const itemId of new Set(uses.map((u) => u.id))) {
          if (!out.has(itemId)) out.set(itemId, []);
          out.get(itemId).push({ c, id, title: s.title || id, url: s.url ?? null, status: s.status ?? 'published', text, uses: uses.filter((u) => u.id === itemId) });
        }
      }
    }
    return out;
  }
  const useOf = (e) => ({ collection: e.c.id, id: e.id, title: e.title, url: e.url, status: e.status, uses: e.uses.length, state: e.uses.every((u) => u.state === 'synced') ? 'synced' : 'changed' });

  /** The pages that use this item, as the API answers them. */
  const pagesOf = (id, all = scan()) => (all.get(id) ?? []).map(useOf);

  /**
   * A save of one entry against the synced copies in it; throws in words. Returns {lockPaths} (the lock markers a
   * new copy brings with it from its item: not a lock change of the person saving) and whether markers need stamping.
   */
  function check(ctx, c, beforeText, afterText, { fa, fb }) {
    const lockPaths = new Set();
    let stamp = false;
    const refuse = (it) => {
      throw new HttpError(409, 'synced', `“${it.name}” is synced from the Library: change it there (every page that uses it follows), or detach it here first.`, { id: it.id, name: it.name });
    };
    const editor = atLeast(ctx.user, 'editor');
    if (c.format === 'json') {
      if (!afterText.includes('"_synced"') && !(beforeText ?? '').includes('"_synced"')) return { lockPaths, stamp };
      const after = dataOf(c, afterText);
      const before = beforeText === null ? null : dataOf(c, beforeText);
      const ua = jsonUses(after);
      const ub = before ? jsonUses(before) : [];
      for (const u of ua) {
        const it = syncedItem(u.id);
        if (!it) continue;
        const known = ub.filter((x) => x.id === u.id);
        if (canon(u.value) === canon(it.body.value)) {
          if (u.version !== syncVersion(it.body)) stamp = true;
          if (!known.length && it.locks && canon(Object.fromEntries(Object.entries(u.lock ?? {}).filter(([k]) => ['move', 'remove', 'edit'].includes(k)))) === canon(it.locks)) lockPaths.add(u.path.replace(/\.(\d+)(?=\.|$)/g, '[$1]'));
          if (!known.length && it.locks && !u.lock) stamp = true;
          continue;
        }
        // not the item's content: fine only when this copy was already like that before the save
        if (known.some((x) => canon(x.value) === canon(u.value))) continue;
        refuse(it);
      }
      if (!editor) {
        const free = unmarked(after);
        for (const x of ub) {
          const it = syncedItem(x.id);
          if (it?.locks && ua.filter((u) => u.id === x.id).length < ub.filter((u) => u.id === x.id).length && free.has(canon(x.value))) throw new HttpError(403, 'forbidden', `“${it.name}” is locked: only an editor can detach it from the Library.`);
        }
      }
      return { lockPaths, stamp };
    }
    const ma = markers(fa);
    const mb = markers(fb);
    if (!ma.length && !mb.length) return { lockPaths, stamp };
    const bodyA = bodyOf(afterText);
    const bodyB = bodyOf(beforeText);
    for (const x of mb) {
      const it = syncedItem(x.id);
      if (!it?.locks) continue;
      const chunk = chunkOf(it);
      const was = blocksAt(bodyB, chunk).length;
      const now = blocksAt(bodyA, chunk).length;
      if (it.locks.remove && was > now) throw new HttpError(423, 'locked', `“${it.name}” is locked by an editor: it can't be deleted.`, { blocks: [{ what: 'remove', label: it.name, by: 'an editor' }] });
      if (!editor && !ma.some((m) => m.id === x.id) && now) throw new HttpError(403, 'forbidden', `“${it.name}” is locked: only an editor can detach it from the Library.`);
    }
    for (const m of ma) {
      const it = syncedItem(m.id);
      if (!it) continue;
      const chunk = chunkOf(it);
      if (blocksAt(bodyA, chunk).length) {
        if (m.version !== syncVersion(it.body)) stamp = true;
        continue;
      }
      if (mb.some((x) => x.id === m.id) && !blocksAt(bodyB, chunk).length) continue;
      refuse(it);
    }
    return { lockPaths, stamp };
  }

  /** The markers of a saved text as the server keeps them: each matching copy's version, a page copy's locks. */
  function stamp(c, text) {
    if (c.format === 'json') {
      const ops = [];
      for (const u of jsonUses(dataOf(c, text))) {
        const it = syncedItem(u.id);
        if (!it || canon(u.value) !== canon(it.body.value)) continue;
        if (u.version !== syncVersion(it.body)) ops.push({ path: `${u.path}._synced.version`, value: syncVersion(it.body) });
        if (it.locks && !u.lock) ops.push({ path: lockPath(u.path, u.raw), value: { ...it.locks } });
      }
      return ops.length ? converter.applyJsonChanges(text, ops, c) : text;
    }
    const fm = converter.parseFrontmatter(text);
    const body = bodyOf(text);
    let changed = false;
    const list = (fm.synced ?? []).map((m) => {
      const it = isObj(m) ? syncedItem(m.id) : null;
      if (!it || !blocksAt(body, chunkOf(it)).length || m.version === syncVersion(it.body)) return m;
      changed = true;
      return { ...m, version: syncVersion(it.body) };
    });
    return changed ? converter.setFrontmatter(text, { synced: list }) : text;
  }

  /**
   * One entry's text with every copy of `from` (the item as it was) made `to` (as it is now): {text, done, skipped}.
   * `detach`: drop the markers instead (the copies stay as plain content). `reset`: a page's copies changed in place
   * become the item again too (an article's changed copy cannot be found by its text, so it stays).
   */
  function rewrite(c, text, from, to, { detach = false, reset = false } = {}) {
    let done = 0;
    let skipped = 0;
    if (c.format === 'json') {
      const ops = [];
      for (const u of jsonUses(dataOf(c, text)).filter((x) => x.id === from.id)) {
        if (detach) {
          ops.push({ path: `${u.path}._synced`, op: 'remove' });
          done++;
          continue;
        }
        // a copy changed in place is left alone, unless it is being reset to the item on purpose
        if (!reset && canon(u.value) !== canon(from.body.value)) {
          skipped++;
          continue;
        }
        const keep = isObj(u.lock) ? Object.fromEntries(Object.entries(u.lock).filter(([k]) => !['move', 'remove', 'edit'].includes(k))) : {};
        const lock = to.locks ? { ...to.locks, ...keep } : null;
        const copy = plain(to.body.value);
        const locked = !lock ? copy : isObj(copy.value) ? { ...copy, value: { ...copy.value, _lock: lock } } : { ...copy, _lock: lock };
        ops.push({ path: u.path, value: { ...locked, _synced: { id: to.id, version: syncVersion(to.body) } } });
        done++;
      }
      return { text: ops.length ? converter.applyJsonChanges(text, ops, c) : text, done, skipped };
    }
    const fm = converter.parseFrontmatter(text);
    const list = markers(fm);
    if (!list.some((m) => m.id === from.id)) return { text, done, skipped };
    if (detach) {
      const rest = (fm.synced ?? []).filter((m) => !(isObj(m) && m.id === from.id));
      return { text: converter.setFrontmatter(text, { synced: rest.length ? rest : null }), done: 1, skipped };
    }
    const m = FM.exec(text);
    const head = m ? m[0] : '';
    let body = text.slice(head.length);
    const old = chunkOf(from);
    const now = chunkOf(to);
    const at = blocksAt(body, old);
    if (!at.length) return { text, done, skipped: 1 };
    for (const i of [...at].reverse()) body = body.slice(0, i) + now + body.slice(i + old.length);
    done = at.length;
    const synced = (fm.synced ?? []).map((x) => (isObj(x) && x.id === from.id ? { ...x, version: syncVersion(to.body) } : x));
    return { text: converter.setFrontmatter(head + body, { synced }), done, skipped };
  }

  return { usesIn, scan, pagesOf, check, stamp, rewrite, chunkOf };
}
