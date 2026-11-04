// Site health, addresses (docs/API.md "Site health"): what the host serves for every address the last build knows,
// from the site's own health hook (markstage.config `health: {command: [argv]}`), which reads the build output and
// prints {pages: [{path, status, redirectsTo?}], chains: [[path, …]], broken: [{path, linkedFrom: [path, …]}]}.
// It runs after each deploy once the job queue is idle (never during a build), and on "Check again"; the last answer
// is kept. Each broken address and each page that links to one is matched with its entry, so it can be opened and
// fixed. Owner and administrators, like the rest of Site health.
//   GET  /site/health/addresses?show=broken|chains|redirects|pages&q=&page=   one list, a page at a time
//   POST /site/health/addresses                                                run the hook now; the summary
import { runCommand } from './jobs.mjs';
import { pageKey } from './preflight.mjs';
import { can } from './roles.mjs';
import { badRequest, forbidden } from './util.mjs';

const KEY = 'health.addresses';
const MAX_OUT = 64 * 1024 * 1024;
const PER_PAGE = 100;
const SHOWS = ['broken', 'chains', 'redirects', 'pages'];

/** The hook's answer, checked: {pages, chains, broken}; throws in plain words when it is not that. */
export function readAnswer(text) {
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error('The health hook did not print JSON.');
  }
  const isPath = (p) => typeof p === 'string' && p.length > 0 && p.length < 4096;
  if (!j || !Array.isArray(j.pages) || !Array.isArray(j.chains ?? []) || !Array.isArray(j.broken ?? [])) throw new Error('The health hook must print {pages: [...], chains: [...], broken: [...]}.');
  const pages = j.pages.filter((p) => isPath(p?.path) && Number.isInteger(p.status)).map((p) => ({ path: p.path, status: p.status, ...(isPath(p.redirectsTo) ? { redirectsTo: p.redirectsTo } : {}) }));
  const chains = (j.chains ?? []).filter((c) => Array.isArray(c) && c.length > 1 && c.every(isPath));
  const broken = (j.broken ?? []).filter((b) => isPath(b?.path)).map((b) => ({ path: b.path, linkedFrom: Array.isArray(b.linkedFrom) ? b.linkedFrom.filter(isPath) : [] }));
  return { pages, chains, broken };
}

export function createAddressCheck(app) {
  const { config, db, jobs } = app;
  const get = () => JSON.parse(db.prepare('SELECT value FROM kv WHERE key = ?').get(KEY)?.value ?? 'null');
  const put = (v) => db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(v));
  const head = () => db.prepare('SELECT value FROM kv WHERE key = ?').get('deploy.head')?.value ?? null;
  let running = null;

  /** Run the hook on the build output (after any job in the queue), keep its answer. One at a time. */
  function refresh() {
    if (!config.health) return Promise.resolve(null);
    running ??= (async () => {
      await jobs.idle();
      const started = app.clock();
      let stdout = '';
      let output = '';
      const { code, timedOut } = await runCommand(config.health.command, {
        cwd: config.contentRoot,
        env: { ...config.commands.env, MARKSTAGE_DIST: config.verify?.public ?? 'dist' },
        timeoutSeconds: config.health.timeoutSeconds,
        onStdout: (s) => {
          if (stdout.length < MAX_OUT) stdout += s;
        },
        onOutput: (s) => {
          if (output.length < 20_000) output += s;
        },
      });
      const was = get();
      const at = new Date(app.clock()).toISOString();
      const ms = app.clock() - started;
      let next;
      try {
        if (timedOut) throw new Error(`The health hook took longer than ${config.health.timeoutSeconds} s.`);
        if (code !== 0) throw new Error(`The health hook stopped with code ${code}: ${output.replace(stdout, '').trim().slice(-500) || 'no message'}`);
        next = { ...readAnswer(stdout), at, head: head(), ms, error: null };
      } catch (e) {
        // the last good answer stays, with what went wrong this time; the same message is logged once, not every
        // minute (QA F20: "no build" until the first publish)
        next = { ...(was ?? { pages: [], chains: [], broken: [] }), error: { at, message: e.message } };
        if (was?.error?.message !== e.message) console.error(`[markstage] site health hook: ${e.message}`);
      }
      put(next);
      // addresses broken now that were not at the last good check: tell (never on the first check, nor on a failure)
      if (was?.at && !next.error) {
        const before = new Set((was.broken ?? []).map((b) => b.path));
        const fresh = next.broken.filter((b) => !before.has(b.path)).map((b) => b.path);
        if (fresh.length) {
          const list = fresh.slice(0, 5).join(', ') + (fresh.length > 5 ? ` and ${fresh.length - 5} more` : '');
          app.notices?.tell({ kind: 'health.broken', level: 'warn', text: `${fresh.length === 1 ? 'A page or link is' : `${fresh.length} pages or links are`} broken on the live site since the last check: ${list}.`, link: '#/health?show=broken', to: 'administrators' });
        }
      }
      return next;
    })().finally(() => {
      running = null;
    });
    return running;
  }

  /** After a deploy: check again once the queue is idle (in the background). */
  const soon = () => {
    if (config.health) setImmediate(() => void refresh().catch(() => {}));
  };

  /** For GET /site/health: counts and when, not the lists. */
  function status() {
    if (!config.health) return { on: false };
    const v = get();
    if (!v && !running) soon();
    return {
      on: true,
      running: Boolean(running) || !v,
      at: v?.at ?? null,
      stale: Boolean(v?.head && head() && v.head !== head()),
      counts: v ? { pages: v.pages.filter((p) => p.status === 200).length, redirects: v.pages.filter((p) => p.status >= 300 && p.status < 400).length, chains: v.chains.length, broken: v.broken.length } : null,
      error: v?.error ?? null,
    };
  }

  function routes(router) {
    const need = (ctx) => {
      if (!can(ctx.user, 'site.health')) throw forbidden('Only owners and administrators can see the site’s health.');
    };
    router.add('GET', '/site/health/addresses', (ctx) => {
      need(ctx);
      const show = ctx.query.get('show') ?? 'broken';
      if (!SHOWS.includes(show)) throw badRequest(`show must be one of ${SHOWS.join(', ')}.`);
      const v = get();
      if (!v) return { ...status(), show, items: [], total: 0, page: 1, perPage: PER_PAGE };
      const known = app.preflight.knownPages();
      const entryOf = (p) => (p.startsWith('/') ? known.get(pageKey(p)) ?? null : null);
      const q = (ctx.query.get('q') ?? '').toLowerCase();
      let items;
      if (show === 'broken') items = v.broken.map((b) => ({ path: b.path, linkedFrom: b.linkedFrom.map((p) => ({ path: p, entry: entryOf(p) })) }));
      else if (show === 'chains') items = v.chains.map((hops) => ({ hops, from: hops[0], to: hops.at(-1) }));
      else if (show === 'redirects') items = v.pages.filter((p) => p.status >= 300 && p.status < 400);
      else items = v.pages.filter((p) => p.status === 200).map((p) => ({ ...p, entry: entryOf(p.path) }));
      if (q) items = items.filter((x) => JSON.stringify(x).toLowerCase().includes(q));
      const page = Math.max(Number(ctx.query.get('page')) || 1, 1);
      return { ...status(), show, items: items.slice((page - 1) * PER_PAGE, page * PER_PAGE), total: items.length, page, perPage: PER_PAGE };
    });
    router.add('POST', '/site/health/addresses', async (ctx) => {
      need(ctx);
      if (!config.health) throw badRequest('This site has no health hook (health in markstage.config).');
      await refresh();
      app.audit.log(ctx, 'site.health.addresses', { target: 'site', ok: !get()?.error });
      return status();
    });
  }

  return { refresh, soon, status, routes };
}
