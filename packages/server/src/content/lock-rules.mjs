// The site's lock rules (docs/OPERATIONS.md "Locks"), changed in Settings → Locks: owner and administrator. The rules
// in markstage.config are code; when they are changed here they are kept as data in core's LOCK_RULES_FILE
// (markstage.locks.json) at the site's root, committed like an entry, and that file wins over the config from then
// on. Every save reads the rules as they are now.
//   GET /site/locks              (signed in) {rules, kinds: {pages, articles: [{type, label}]}, version, source, file}
//   PUT /site/locks {rules, version}  (owner, administrator) {rules, version, source, commit} | 409 stale | 400 shape
import { can } from '../roles.mjs';
import { HttpError, badRequest, conflict, forbidden, sha1 } from '../util.mjs';
import { core } from './locks.mjs';

const FILE = core?.LOCK_RULES_FILE ?? 'markstage.locks.json';
const EMPTY = { pages: {}, articles: {} };
/** "two-columns" -> "Two columns", "pullQuote" -> "Pull quote" */
const labelOf = (t) => {
  const s = t.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').toLowerCase();
  return s[0].toUpperCase() + s.slice(1);
};

export function createLockRules(app) {
  const { store, config } = app;

  /** The rules now: the file when there is one, else the config's. {rules, text, source}. */
  function current() {
    const text = store.readRel(FILE);
    if (text === null) return { rules: config.locks ?? EMPTY, text: null, source: 'config' };
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      throw new HttpError(500, 'locks-file', `${FILE} is not valid JSON (${e.message}). Fix it in the site repo.`);
    }
    // without core no save of a ruled entry goes through (content/locks.mjs), so the raw rules are enough here
    return { rules: core ? core.normalizeLockRules(raw) : raw, text, source: 'file' };
  }
  const versionOf = (cur) => sha1(cur.text ?? `config:${JSON.stringify(cur.rules)}`);

  /** The section types the pages use (Keystatic's `discriminant`) and the boxes the block packs define. */
  function kinds(rules) {
    const pages = new Set(Object.keys(rules.pages ?? {}));
    const walk = (v) => {
      if (Array.isArray(v)) for (const x of v) {
        if (x && typeof x === 'object' && typeof x.discriminant === 'string') pages.add(x.discriminant);
        walk(x);
      } else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
    };
    for (const c of store.collections.filter((x) => x.format === 'json')) {
      for (const id of store.ids(c)) {
        try {
          walk(JSON.parse(store.read(c, id).text));
        } catch {
          // an entry that does not parse has no section types to offer
        }
      }
    }
    const articles = new Set([...Object.keys(rules.articles ?? {}), ...(app.packs ?? []).flatMap((p) => (p.blocks ?? []).map((b) => b.name))]);
    const list = (set) => [...set].sort().map((type) => ({ type, label: labelOf(type) }));
    return { pages: list(pages), articles: list(articles) };
  }

  function routes(router) {
    router.add('GET', '/site/locks', () => {
      const cur = current();
      return { rules: cur.rules, kinds: kinds(cur.rules), version: versionOf(cur), source: cur.source, file: FILE };
    });

    router.add('PUT', '/site/locks', async (ctx) => {
      if (!can(ctx.user, 'site.locks')) throw forbidden('Only an owner or administrator can change the lock rules for every page.');
      if (!core) throw new HttpError(503, 'locks-unavailable', 'Changing the lock rules needs @markstage/core, which is not installed.');
      const { rules, version } = ctx.body ?? {};
      let text;
      try {
        text = core.lockRulesText(rules);
      } catch (e) {
        throw badRequest(e.message);
      }
      return app.repoLock.run(async () => {
        const cur = current();
        if (version !== versionOf(cur)) throw conflict('The lock rules changed since you opened them. Reload to see them.', { version: versionOf(cur) });
        const next = core.normalizeLockRules(JSON.parse(text));
        if (text === cur.text) return { rules: next, version: versionOf(cur), source: 'file', commit: null };
        store.writeRel(FILE, text);
        const commit = await app.git.commit([FILE], 'Lock rules for every page', { name: ctx.user?.name ?? 'Markstage', email: ctx.user?.email ?? config.git.committerEmail });
        app.audit.log(ctx, 'site.locks', { target: 'site', detail: { commit, from: cur.rules, to: next, was: cur.source } });
        app.notices?.tell({ kind: 'lock.changed', level: 'info', text: `${ctx.user?.name ?? 'Markstage'} changed the lock rules for every page (Settings → Locks).`, link: '#/settings/locks', to: 'administrators' });
        return { rules: next, version: sha1(text), source: 'file', commit };
      });
    });
  }

  return { rules: () => current().rules, routes };
}
