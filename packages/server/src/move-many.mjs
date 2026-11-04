// Move many entries at once, for the Pages tree (docs/OPERATIONS.md "Page hierarchy"): pages dragged to another
// parent or another place among their siblings. Each move may give an entry a new name (newId, newSlug) and set
// fields (`order`, the parent or group field); when its address changes, every link to the old address follows and
// the site's redirects hook records old -> new, as for one move (move.mjs). All of it is checked first and nothing is
// written unless every move may be made; then one commit, and one build and deploy job when a live entry moved (a
// failed build puts every file back that nobody changed since).
//   POST /site/move {moves: [{collection, id, version, newId?, newSlug?, parent?: '<page id>'|''|'/', set?: {field: value|null}}]}
//     `parent` (a collection whose address is a field of its own, such as `uri`): the page and every page under it
//     move under that page ('' or '/': the top level), each with its own redirect; the home page stays, a page never
//     goes under itself, and a page other collections' entries live under is not moved until they are
//     `dry: true`: the same checks, nothing written: {dry, moved, linksUpdated, links, redirects} (links: how many
//     entries would have a link rewritten)
//     {commit, moved: [{collection, id, from, version, url, oldUrl}], linksUpdated, redirects, job}
//     422 {error: 'invalid', problems: [{collection, id, message}]} when any move may not be made
import { ID } from './config.mjs';
import { FIELD_NAME, fieldSetter, fixedFields, isScalar } from './content/bulk.mjs';
import { linkRewriter, movePairs, rewriteEntry } from './content/links.mjs';
import { revertMoveCommit, slugSetter } from './move.mjs';
import { HttpError, badRequest } from './util.mjs';

const MAX_MOVES = 200;
const MOVE_KEYS = new Set(['collection', 'id', 'version', 'newId', 'newSlug', 'parent', 'set', '_uri']);

export function moveManyRoutes(router, app, entries) {
  const { store, git, jobs, repoLock, audit, converter, config, db } = app;
  const withSlug = slugSetter(converter);
  const setField = fieldSetter(converter);

  /** Every entry with a page address: [{c, id, url}]. */
  function allUrls() {
    const out = [];
    for (const c of store.collections) {
      for (const id of store.ids(c)) {
        try {
          const url = store.summarize(c, id, store.read(c, id).text).url;
          if (url) out.push({ c, id, url });
        } catch {
          // vanished between list and read
        }
      }
    }
    return out;
  }
  const under = (url, prefix) => url !== prefix && url.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
  const plural = (n, c) => `${n} ${n === 1 ? (c.label ?? c.id).replace(/s$/i, '').toLowerCase() : (c.label ?? c.id).toLowerCase()}`;
  /** "3 posts live under /blog/; move them first." */
  const livesUnder = (stays, url) => {
    const byC = new Map();
    for (const u of stays) byC.set(u.c, (byC.get(u.c) ?? 0) + 1);
    return `${[...byC].map(([cc, n]) => plural(n, cc)).join(' and ')} ${stays.length === 1 ? 'lives' : 'live'} under ${url}; move ${stays.length === 1 ? 'it' : 'them'} first.`;
  };

  /**
   * The moves with each `parent` worked out: the page's new address (`_uri`), and one more move for every page of
   * its collection under it, which follows. Problems named; an address sent by the browser is never taken.
   */
  function withParents(moves, problems) {
    const out = moves.map(({ _uri, ...m }) => ({ ...m }));
    const asked = new Set(out.map((m) => `${m?.collection}/${m?.id}`));
    let urls = null;
    for (const m of [...out]) {
      if (m?.parent === undefined) continue;
      const ref = { collection: String(m.collection ?? ''), id: String(m.id ?? '') };
      const fail = (message) => problems.push({ ...ref, message });
      let c;
      let cur;
      try {
        c = store.collection(ref.collection);
        cur = store.read(c, ref.id);
      } catch {
        fail('It is no longer there.');
        continue;
      }
      const key = c.fields.url;
      if (!key) {
        fail('Pages of this collection get their address from their name: move them by name.');
        continue;
      }
      if (typeof m.parent !== 'string') {
        fail('Say the page to move it under (its id), or "" for the top level.');
        continue;
      }
      const from = store.fieldsOf(c, cur.text)[key];
      if (typeof from !== 'string' || !from.startsWith('/')) {
        fail('It has no address to move.');
        continue;
      }
      if (from === '/') {
        fail('The home page stays where it is.');
        continue;
      }
      let base = '/';
      if (m.parent && m.parent !== '/') {
        let p;
        try {
          p = store.read(c, m.parent);
        } catch {
          fail(`There is no page “${m.parent}” to move it under.`);
          continue;
        }
        if (m.parent === ref.id) {
          fail('A page cannot go under itself or a page under it.');
          continue;
        }
        if (asked.has(`${c.id}/${m.parent}`) && out.some((x) => x.id === m.parent && x.collection === c.id && x.parent !== undefined)) {
          fail(`“${m.parent}” moves too: move them one after the other.`);
          continue;
        }
        base = store.fieldsOf(c, p.text)[key];
        if (typeof base !== 'string' || !base.startsWith('/')) {
          fail(`“${m.parent}” has no address to move it under.`);
          continue;
        }
        if (!base.endsWith('/')) base += '/';
      }
      if (base === from || under(base, from)) {
        fail('A page cannot go under itself or a page under it.');
        continue;
      }
      const slash = from.endsWith('/');
      const leaf = from.replace(/\/+$/, '').split('/').pop();
      const to = `${base}${leaf}${slash ? '/' : ''}`;
      m._uri = to;
      urls ??= allUrls();
      // the pages of its own collection under it follow; another collection's entries under it must move first
      const stays = urls.filter((u) => u.c.id !== c.id && under(u.url, from));
      if (stays.length) {
        fail(livesUnder(stays, from));
        continue;
      }
      // in address order, so a page comes before the pages under it
      for (const u of urls.filter((x) => x.c.id === c.id && under(x.url, from)).sort((a, b) => (a.url < b.url ? -1 : 1))) {
        const child = store.read(c, u.id);
        const cu = store.fieldsOf(c, child.text)[key];
        if (typeof cu !== 'string' || !cu.startsWith(from.endsWith('/') ? from : `${from}/`)) continue;
        if (asked.has(`${c.id}/${u.id}`)) {
          problems.push({ collection: c.id, id: u.id, message: `It moves with “${ref.id}”, the page it is under: leave it out.` });
          continue;
        }
        const rest = cu.slice(from.length + (from.endsWith('/') ? 0 : 1));
        out.push({ collection: c.id, id: u.id, version: child.version, _uri: `${slash ? to : `${to}/`}${rest}`, _with: ref.id });
      }
    }
    return out;
  }

  /** Each move checked and worked out ({c, id, newId, before, text, summary, after, live}); problems named. */
  async function planOf(ctx, asked) {
    const plan = [];
    const problems = [];
    const taken = new Set();
    // a key a move does not know (a misspelt one, or `dry` put on a move) is refused, never left out
    for (const m of asked) {
      const odd = m && typeof m === 'object' ? Object.keys(m).find((k) => !MOVE_KEYS.has(k)) : undefined;
      if (odd !== undefined) problems.push({ collection: String(m.collection ?? ''), id: String(m.id ?? ''), message: `“${odd}” is not part of a move.` });
    }
    const moves = withParents(asked, problems);
    let urls = null;
    for (const m of moves) {
      const ref = { collection: String(m?.collection ?? ''), id: String(m?.id ?? '') };
      const fail = (message) => problems.push({ ...ref, message });
      if (problems.some((x) => x.collection === ref.collection && x.id === ref.id)) continue;
      let c;
      let cur;
      try {
        c = store.collection(ref.collection);
        cur = store.read(c, ref.id);
      } catch {
        fail('It is no longer there.');
        continue;
      }
      if (m.version !== cur.version) {
        fail('It changed since the tree was loaded. Load it again.');
        continue;
      }
      const newId = m.newId ?? ref.id;
      if (typeof newId !== 'string' || !ID.test(newId)) {
        fail('A new name uses lowercase letters, digits and hyphens.');
        continue;
      }
      if (m.newSlug !== undefined && (typeof m.newSlug !== 'string' || !ID.test(m.newSlug))) {
        fail('A new slug uses lowercase letters, digits and hyphens.');
        continue;
      }
      const set = m.set ?? {};
      const bad = Object.entries(set).find(([k, v]) => !FIELD_NAME.test(k) || fixedFields(c).includes(k) || !(v === null || isScalar(v)));
      if (typeof set !== 'object' || Array.isArray(set) || bad) {
        fail(bad ? `“${bad[0]}” cannot be set here.` : 'Fields to set are {name: value}.');
        continue;
      }
      const summary = store.summarize(c, ref.id, cur.text);
      let can;
      try {
        can = entries.assertEditable(ctx, c, summary);
      } catch (e) {
        fail(e.message);
        continue;
      }
      const key = `${c.id}/${newId}`;
      if ((newId !== ref.id && store.exists(c, newId)) || taken.has(key)) {
        fail(`Another entry is called “${newId}” already.`);
        continue;
      }
      taken.add(key);
      const oldSlug = c.fields.slug ? store.fieldsOf(c, cur.text)[c.fields.slug] : undefined;
      let text = withSlug(c, cur.text, m.newSlug ?? (oldSlug === ref.id && newId !== ref.id ? newId : undefined));
      for (const [k, v] of Object.entries(set)) text = setField(c, text, k, v);
      // the address worked out from `parent` (withParents), never one sent
      if (m._uri !== undefined) text = setField(c, text, c.fields.url, m._uri);
      const after = store.summarize(c, newId, text);
      const live = summary.status === 'published';
      const relocates = Boolean(summary.url && after.url && summary.url !== after.url);
      // a live page's address changes for visitors (and search engines): an editor's decision
      if (live && (relocates || newId !== ref.id) && !can.publish) {
        fail('It is live; moving it needs the publish right.');
        continue;
      }
      try {
        await entries.validate(c, newId, text);
      } catch (e) {
        fail(e.message);
        continue;
      }
      // a page whose address changes takes its own collection's pages under it along (by `parent`); another
      // collection's entries under it would be left at addresses under a page that moved
      if (relocates && m._with === undefined) {
        urls ??= allUrls();
        const stays = urls.filter((u) => !(u.c.id === c.id && m.parent !== undefined) && !(u.c.id === c.id && u.id === ref.id) && under(u.url, summary.url) && !moves.some((x) => x.collection === u.c.id && x.id === u.id));
        if (stays.length) {
          fail(livesUnder(stays, summary.url));
          continue;
        }
      }
      plan.push({ c, id: ref.id, newId, before: cur.text, text, summary, after, live, moves: relocates });
    }
    // a new address may not be one another move leaves (that would be a chain: move it in two steps), another page's
    // that stays, or one two moves both go to
    const leaving = new Set(plan.filter((p) => p.moves).map((p) => p.summary.url));
    const owners = plan.some((p) => p.moves) ? store.addresses() : new Map();
    const arriving = new Map();
    for (const p of plan) {
      if (!p.moves) continue;
      const where = { collection: p.c.id, id: p.id };
      if (leaving.has(p.after.url)) problems.push({ ...where, message: `${p.after.url} is the old address of another page moved here. Move them one after the other.` });
      else if (owners.has(p.after.url)) problems.push({ ...where, message: `${p.after.url} is the address of another page already (${owners.get(p.after.url)}).` });
      else if (arriving.has(p.after.url)) problems.push({ ...where, message: `${p.after.url} is where another move here goes too.` });
      arriving.set(p.after.url, p.id);
    }
    return { plan, problems };
  }

  router.add('POST', '/site/move', async (ctx) => {
    const moves = ctx.body?.moves;
    if (!Array.isArray(moves) || !moves.length || moves.length > MAX_MOVES) throw badRequest(`Say what to move (1 to ${MAX_MOVES} entries).`);
    const dry = ctx.body.dry === true;
    const out = await repoLock.run(async () => {
      const { plan, problems } = await planOf(ctx, moves);
      if (problems.length) throw new HttpError(422, 'invalid', problems.length === 1 ? problems[0].message : `${problems.length} of the moves cannot be made.`, { problems });
      const changed = plan.filter((p) => p.newId !== p.id || p.text !== p.before);
      if (!changed.length) return null;
      const pairs = changed.filter((p) => p.moves).flatMap((p) => movePairs(p.summary.url, p.after.url, { locales: config.locales, siteUrl: config.siteUrl }));
      const redirects = pairs.filter((p) => p.from.startsWith('/'));
      if (dry) {
        const linksUpdated = [];
        if (pairs.length) {
          const rw = linkRewriter(pairs);
          for (const cc of store.collections) {
            for (const eid of store.ids(cc)) {
              if (changed.some((p) => p.c.id === cc.id && p.id === eid)) continue;
              const t = store.read(cc, eid).text;
              if (rewriteEntry(converter, cc, t, rw) !== t) linksUpdated.push({ collection: cc.id, id: eid });
            }
          }
        }
        return { dry, changed, linksUpdated, redirects };
      }
      const written = new Map(); // rel -> text before (null: did not exist)
      const note = (rel, prev) => {
        if (!written.has(rel)) written.set(rel, prev);
      };
      const linksUpdated = [];
      let extra;
      try {
        // the old files go, then the new ones are written
        for (const p of changed) {
          if (p.newId === p.id) continue;
          note(store.remove(p.c, p.id).rel, p.before);
        }
        for (const p of changed) note(store.write(p.c, p.newId, p.text).rel, p.newId === p.id ? p.before : null);
        if (pairs.length) {
          const rw = linkRewriter(pairs);
          for (const cc of store.collections) {
            for (const eid of store.ids(cc)) {
              const t = store.read(cc, eid).text;
              const nt = rewriteEntry(converter, cc, t, rw);
              if (nt === t) continue;
              const w = store.write(cc, eid, nt);
              note(w.rel, t);
              if (!changed.some((p) => p.c.id === cc.id && p.newId === eid)) linksUpdated.push({ collection: cc.id, id: eid });
            }
          }
        }
        extra = await app.redirectsHook.recordMove(redirects, await git.dirty());
      } catch (e) {
        for (const [rel, prev] of written) {
          if (prev === null) store.removeRel(rel);
          else store.writeRel(rel, prev);
        }
        throw e;
      }
      const paths = [...written.keys(), ...extra.files];
      const n = changed.length;
      const commit = await git.commit(paths, n === 1 ? `Move ${changed[0].c.id}/${changed[0].id}` : `Move ${n} entries`, entries.authorOf(ctx.user));
      for (const p of changed) {
        if (p.newId === p.id) continue;
        db.prepare('UPDATE OR REPLACE autosaves SET entry_id = ? WHERE collection = ? AND entry_id = ?').run(p.newId, p.c.id, p.id);
        db.prepare('UPDATE autosave_snapshots SET entry_id = ? WHERE collection = ? AND entry_id = ?').run(p.newId, p.c.id, p.id);
      }
      audit.log(ctx, 'entries.move', { target: 'site', detail: { commit, count: n, moved: changed.map((p) => `${p.c.id}/${p.id}>${p.newId}`), links: linksUpdated.length, redirects: redirects.length } });
      return { changed, commit, paths, linksUpdated, redirects };
    });
    if (!out) return { ...(dry ? { dry, links: 0 } : {}), commit: null, moved: [], linksUpdated: [], redirects: [], job: null };
    if (out.dry) {
      return {
        dry,
        moved: out.changed.map((p) => ({ collection: p.c.id, id: p.newId, from: p.id, url: p.after.url, oldUrl: p.summary.url })),
        linksUpdated: out.linksUpdated,
        links: out.linksUpdated.length,
        redirects: out.redirects,
      };
    }
    const live = out.changed.filter((p) => p.live || p.after.status === 'published');
    const job = live.length && out.commit ? moveJob(ctx, out, live) : null;
    ctx.status = job ? 202 : 200;
    return {
      commit: out.commit,
      moved: out.changed.map((p) => ({ collection: p.c.id, id: p.newId, from: p.id, version: store.read(p.c, p.newId).version, url: p.after.url, oldUrl: p.summary.url })),
      linksUpdated: out.linksUpdated,
      redirects: out.redirects,
      job,
    };
  });

  /** Build and deploy; on failure every file of the commit nobody changed since goes back. */
  function moveJob(ctx, out, live) {
    return jobs.enqueue({
      kind: 'move',
      target: 'site',
      user: ctx.user,
      run: async (step) => {
        await step('commit', (log) => (log(`committed ${out.commit}: ${out.changed.length} entr${out.changed.length === 1 ? 'y' : 'ies'} moved, ${out.linksUpdated.length} linking, ${out.redirects.length} redirect(s)\n`), 0));
        const changed = [];
        const checks = [];
        for (const p of live) {
          const now = store.read(p.c, p.newId).text;
          changed.push(...app.afterDeploy.pagesOf(p.c, p.newId, now));
          checks.push(app.verify.expect(p.c, p.newId, now));
          if (p.moves) {
            changed.push(...(app.site?.pathsOf?.(p.summary.url) ?? [p.summary.url]));
            checks.push(app.verify.moved(p.c, p.newId, p.summary.url));
          }
        }
        for (const l of out.linksUpdated) {
          const lc = store.collection(l.collection);
          changed.push(...app.afterDeploy.pagesOf(lc, l.id, store.read(lc, l.id).text));
        }
        await jobs.buildAndDeploy(step, { afterBuild: app.verify.afterBuild(checks), changed });
      },
      onFail: (step) =>
        step('revert', (log) =>
          repoLock.run(async () => {
            const sha = await revertMoveCommit(app, { paths: out.paths, commit: out.commit, message: `Revert the move of ${out.changed.length} entries: build or deploy failed`, author: entries.authorOf(ctx.user), log });
            for (const p of out.changed) if (p.newId !== p.id) db.prepare('UPDATE OR REPLACE autosaves SET entry_id = ? WHERE collection = ? AND entry_id = ?').run(p.id, p.c.id, p.newId);
            log(`Reverted in ${sha ?? '(nothing to revert)'}; the pages are back where they were.\n`);
            return 0;
          }),
        ),
    });
  }
}
