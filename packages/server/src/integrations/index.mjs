// Integration fields (docs/API-INTEGRATIONS.md): a Post settings field (`{type: 'select', key, integration: <name>}`)
// whose options come from a JSON address, fetched by the server on a schedule and kept in the database. Editors pick
// from the list as it was last fetched; a failed fetch keeps the last good list (marked stale) and tells the
// administrators once. A save that sets a bound key to a value not in the list is refused.
//
//   GET  /integrations                            {items: [integration]}
//   GET  /integrations/:name/options?q=&value=    {items: [{value, text, detail}], total, missing, fetchedAt, stale, status}
//   POST /integrations/:name/refresh              {integration}: fetched again now (editors and up, once a minute)
//
// The address goes through the SSRF guard (library/fetch.mjs: public addresses only, after DNS and at each redirect;
// a sign-in header only to the first address's origin), the answer is capped (maxKB, 15 s, 5000 items, 200
// characters a value), and a sign-in comes from the environment or a file outside the repo, never the config.
import crypto from 'node:crypto';
import { safeFetch } from '../library/fetch.mjs';
import { createScrub } from '../mcp/answer.mjs';
import { can } from '../roles.mjs';
import { HttpError, forbidden, notFound, nowIso } from '../util.mjs';
import { secretOf } from './config.mjs';

export const MAX_ITEMS = 5000;
const MAX_CHARS = 200;
const TIMEOUT_MS = 15_000;
const RETRY_MINUTES = 15;
const REFRESH_GAP_MS = 60_000;
const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/** A dotted path's value inside parsed JSON (own keys only), or undefined. */
export function pick(obj, dotted) {
  let node = obj;
  for (const k of String(dotted).split('.')) {
    if (node === null || typeof node !== 'object' || BAD_KEYS.has(k) || !Object.hasOwn(node, k)) return undefined;
    node = node[k];
  }
  return node;
}

// one line of words: no control characters, at most 200 characters
const word = (v) => (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v).replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, MAX_CHARS) : '');

/** The options in an answer: {items: [{value, text, detail}], skipped}; refused in words when it has no list. */
export function optionsOf(cfg, data) {
  const list = cfg.list ? pick(data, cfg.list) : data;
  if (!Array.isArray(list)) throw new Error(cfg.list ? `The answer has no list at "${cfg.list}".` : 'The answer is not a list (set list to the key that holds it).');
  const items = [];
  const seen = new Set();
  let skipped = 0;
  for (const it of list) {
    if (items.length >= MAX_ITEMS) {
      skipped += 1;
      continue;
    }
    const value = word(pick(it, cfg.value));
    if (!value || seen.has(value)) {
      skipped += 1;
      continue;
    }
    seen.add(value);
    const text = word(pick(it, cfg.text)) || value;
    const detail = cfg.detail ? word(pick(it, cfg.detail)) || null : null;
    items.push({ value, text, detail });
  }
  return { items, skipped };
}

const shapeOf = (cfg) => crypto.createHash('sha1').update(JSON.stringify([cfg.url, cfg.list, cfg.value, cfg.text, cfg.detail])).digest('hex');

export function createIntegrations(app) {
  const { db, audit } = app;
  const all = app.config.integrations ?? {};
  const scrubber = app.mcp?.scrubber ?? createScrub(app);
  const inflight = new Map();
  const parsed = new Map();
  let running = null;
  let closed = false;
  let timer = null;

  const row = (name) => db.prepare('SELECT * FROM integration_cache WHERE name = ?').get(name) ?? null;
  const cfgOf = (name) => {
    const cfg = typeof name === 'string' && Object.hasOwn(all, name) ? all[name] : null;
    if (!cfg) throw notFound('No such integration.');
    return cfg;
  };
  // a row made for another address or other keys is not this integration's list
  const current = (cfg) => {
    const r = row(cfg.name);
    return r && r.shape === shapeOf(cfg) ? r : null;
  };

  /** The kept list, parsed once per fetch. */
  function itemsOf(cfg) {
    const r = current(cfg);
    if (!r?.items) return null;
    const hit = parsed.get(cfg.name);
    if (hit?.at === r.fetched_at) return hit.items;
    const items = JSON.parse(r.items);
    parsed.set(cfg.name, { at: r.fetched_at, items });
    return items;
  }

  function view(cfg) {
    const r = current(cfg);
    return {
      name: cfg.name,
      label: cfg.label,
      host: new URL(cfg.url).host,
      every: cfg.every,
      status: r?.status ?? 'never',
      fetchedAt: r?.fetched_at ?? null,
      triedAt: r?.tried_at ?? null,
      nextAt: r?.next_at ?? null,
      error: r?.error ?? null,
      count: r?.count ?? 0,
      skipped: r?.skipped ?? 0,
      // the list is older than two of its rounds, or the last try failed
      stale: Boolean(r?.fetched_at) && (r.status === 'failed' || app.clock() - Date.parse(r.fetched_at) > 2 * cfg.every * 60_000),
    };
  }

  /** Fetch one integration now (one fetch at a time each): its list kept, or why not. */
  function fetchOne(cfg) {
    if (inflight.has(cfg.name)) return inflight.get(cfg.name);
    const p = (async () => {
      const at = app.clock();
      const was = current(cfg);
      const secret = secretOf(cfg.auth);
      const clean = (m) => {
        let s = scrubber.scrub(String(m));
        if (secret && secret.length >= 4) s = s.split(secret).join('[hidden]');
        return s.slice(0, 500);
      };
      let error = null;
      let got = null;
      let bytes = null;
      try {
        if (cfg.auth && !secret) throw new Error(`The sign-in is not set: ${cfg.auth.env ? `the variable ${cfg.auth.env} is empty` : 'its keyFile cannot be read or is empty'}.`);
        const headers = secret ? { [cfg.auth.header]: cfg.auth.scheme ? `${cfg.auth.scheme} ${secret}` : secret } : {};
        const r = await safeFetch(cfg.url, { maxBytes: cfg.maxBytes, timeoutMs: TIMEOUT_MS, accept: 'application/json', outbound: app.outbound ?? {}, headers });
        if (r.status < 200 || r.status >= 300) throw new Error(`${new URL(r.url).host} answered ${r.status}.`);
        bytes = r.body.length;
        let data;
        try {
          data = JSON.parse(r.body.toString('utf8'));
        } catch {
          throw new Error(`${new URL(r.url).host} did not answer JSON.`);
        }
        got = optionsOf(cfg, data);
      } catch (e) {
        error = clean(e.message);
      }
      const now = nowIso(at);
      if (got) {
        db.prepare(
          `INSERT INTO integration_cache (name, shape, items, count, skipped, bytes, status, error, fetched_at, tried_at, next_at) VALUES (?, ?, ?, ?, ?, ?, 'ok', NULL, ?, ?, ?)
           ON CONFLICT (name) DO UPDATE SET shape = excluded.shape, items = excluded.items, count = excluded.count, skipped = excluded.skipped, bytes = excluded.bytes, status = 'ok', error = NULL, fetched_at = excluded.fetched_at, tried_at = excluded.tried_at, next_at = excluded.next_at`,
        ).run(cfg.name, shapeOf(cfg), JSON.stringify(got.items), got.items.length, got.skipped, bytes, now, now, nowIso(at + cfg.every * 60_000));
      } else {
        // the last good list stays; tried again sooner than its round
        const next = nowIso(at + Math.min(cfg.every, RETRY_MINUTES) * 60_000);
        if (was) db.prepare("UPDATE integration_cache SET status = 'failed', error = ?, tried_at = ?, next_at = ? WHERE name = ?").run(error, now, next, cfg.name);
        else db.prepare("INSERT INTO integration_cache (name, shape, status, error, tried_at, next_at) VALUES (?, ?, 'failed', ?, ?, ?) ON CONFLICT (name) DO UPDATE SET shape = excluded.shape, items = NULL, count = 0, skipped = 0, bytes = NULL, status = 'failed', error = excluded.error, fetched_at = NULL, tried_at = excluded.tried_at, next_at = excluded.next_at").run(cfg.name, shapeOf(cfg), error, now, next);
        // told once, when it goes from working (or never tried) to failing
        if (was?.status !== 'failed') app.notices?.tell({ kind: 'integration.failed', level: 'warn', text: `The list of ${cfg.label} could not be fetched from ${new URL(cfg.url).host}. ${error} ${was?.items ? 'Editors pick from the last list until it works again.' : 'Editors have no list to pick from yet.'}`, link: `#/settings/integrations/${cfg.name}`, to: 'administrators' });
      }
      return view(cfg);
    })().finally(() => inflight.delete(cfg.name));
    inflight.set(cfg.name, p);
    return p;
  }

  /** Fetch each integration that is due (never fetched, its config changed, or its round is up), one at a time. */
  function tick() {
    if (closed) return Promise.resolve();
    running ??= (async () => {
      for (const cfg of Object.values(all)) {
        if (closed) break;
        const r = current(cfg);
        if (!r || !r.next_at || Date.parse(r.next_at) <= app.clock()) await fetchOne(cfg);
      }
    })().finally(() => {
      running = null;
    });
    return running;
  }

  /**
   * A save's check (content/entries.mjs guard): a key bound to an integration may keep its value or be emptied, and
   * may be set to a value in the kept list. Before the first good fetch there is no list to check against.
   */
  function check(c, after, before) {
    for (const f of c.integrations ?? []) {
      const v = pick(after, f.key);
      if (v === undefined || v === null || v === '' || JSON.stringify(v) === JSON.stringify(pick(before, f.key))) continue;
      const cfg = all[f.source];
      const items = cfg ? itemsOf(cfg) : null;
      if (!items) continue;
      if (typeof v !== 'string' && typeof v !== 'number') throw new HttpError(422, 'invalid', `${f.label} is one value from ${cfg.label}.`, { fields: { [f.key]: 'One value.' } });
      if (!items.some((o) => o.value === String(v))) throw new HttpError(422, 'invalid', `“${word(v)}” is not one of the ${cfg.label} options now. Pick one from the list.`, { fields: { [f.key]: `Not one of the ${cfg.label} options now.` } });
    }
  }

  function routes(api) {
    api.add('GET', '/integrations', () => ({ items: Object.values(all).map(view) }));
    api.add('GET', '/integrations/:name/options', (ctx) => {
      const cfg = cfgOf(ctx.params.name);
      const q = String(ctx.query.get('q') ?? '').trim().toLowerCase().slice(0, 200);
      const limit = Math.min(200, Math.max(1, Number.parseInt(ctx.query.get('limit') ?? '50', 10) || 50));
      const asked = ctx.query.getAll('value').slice(0, 50);
      const items = itemsOf(cfg) ?? [];
      const hits = q ? items.filter((o) => o.text.toLowerCase().includes(q) || o.value.toLowerCase().includes(q) || o.detail?.toLowerCase().includes(q)) : items;
      const known = new Set(items.map((o) => o.value));
      const v = view(cfg);
      return {
        items: hits.slice(0, limit),
        total: hits.length,
        // the values asked for: shown with their words, or said to be gone from the list
        current: items.filter((o) => asked.includes(o.value)),
        missing: v.fetchedAt ? asked.filter((a) => !known.has(a)) : [],
        fetchedAt: v.fetchedAt,
        stale: v.stale,
        status: v.status,
      };
    });
    api.add('POST', '/integrations/:name/refresh', async (ctx) => {
      if (!can(ctx.user, 'integration.refresh')) throw forbidden('Fetching a list again is for editors and up.');
      const cfg = cfgOf(ctx.params.name);
      const r = row(cfg.name);
      const since = r?.refreshed_at ? app.clock() - Date.parse(r.refreshed_at) : Infinity;
      if (since < REFRESH_GAP_MS) throw new HttpError(429, 'too-soon', 'This list was fetched a moment ago. Try again in a minute.', { retryAfter: Math.ceil((REFRESH_GAP_MS - since) / 1000) });
      if (r) db.prepare('UPDATE integration_cache SET refreshed_at = ? WHERE name = ?').run(nowIso(app.clock()), cfg.name);
      const out = await fetchOne(cfg);
      if (!r) db.prepare('UPDATE integration_cache SET refreshed_at = ? WHERE name = ?').run(nowIso(app.clock()), cfg.name);
      audit.log(ctx, 'integration.refresh', { target: cfg.name, ok: out.status === 'ok', detail: { count: out.count, host: out.host } });
      return { integration: out };
    });
  }

  return {
    routes,
    tick,
    check,
    start() {
      if (!Object.keys(all).length) return;
      setImmediate(() => void tick().catch((e) => console.error(`[markstage] integrations: ${e.message}`)));
      timer = setInterval(() => void tick().catch((e) => console.error(`[markstage] integrations: ${e.message}`)), 30_000);
      timer.unref();
    },
    /** No more fetches; the one running finishes (the server waits for it before the database closes). */
    stop() {
      closed = true;
      clearInterval(timer);
      return Promise.allSettled([running ?? Promise.resolve(), ...inflight.values()]).then(() => undefined);
    },
  };
}
