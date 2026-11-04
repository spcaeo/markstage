// Webhooks (docs/API-WEBHOOKS.md): named addresses told of the events they listen to, each POST signed with the
// hook's own secret (HMAC-SHA256), tried again with backoff, logged. Owner and administrator only.
//
//   GET    /webhooks                                  {items, events}
//   POST   /webhooks                                  {name, url, events, active?} -> 201 {webhook, secret} (shown once)
//   PATCH  /webhooks/:wid                             {name?, url?, events?, active?} -> {webhook}
//   DELETE /webhooks/:wid
//   POST   /webhooks/:wid/secret                      -> {secret} (a new one, shown once; the old one stops)
//   POST   /webhooks/:wid/test                        -> 202 {delivery} (a `ping`, sent now)
//   GET    /webhooks/:wid/deliveries?status=&page=    {items, total, page, perPage}
//   POST   /webhooks/:wid/deliveries/:did/retry       -> 202 {delivery}
//
// Events come from the audit, as things happen (audit.listen): what a person or the scheduler did, after it is done.
// A payload names what changed (collection and id, its page address, the commit, the job), never its text, a
// person's email or a secret. The address is checked by the SSRF guard when it is saved and again at every send,
// and shown with its query values and any sign-in hidden.
import crypto from 'node:crypto';
import { checkUrl } from '../library/fetch.mjs';
import { can } from '../roles.mjs';
import { HttpError, forbidden, newId, notFound, nowIso } from '../util.mjs';
import { BACKOFF_MINUTES, createDeliveries, maskUrl } from './deliver.mjs';

export const EVENTS = ['entry.created', 'entry.saved', 'entry.imported', 'entry.published', 'entry.unpublished', 'entry.scheduled', 'entry.moved', 'entry.deleted', 'entry.restored', 'release.published', 'media.added', 'media.deleted', 'site.live', 'site.failed'];
// audit action -> event (job.* are read by their detail below)
const FROM_AUDIT = {
  'entry.create': 'entry.created',
  'entry.duplicate': 'entry.created',
  'entry.save': 'entry.saved',
  'entry.source': 'entry.saved',
  'entry.import': 'entry.imported',
  'entry.publish': 'entry.published',
  'entry.unpublish': 'entry.unpublished',
  'entry.schedule': 'entry.scheduled',
  'entry.move': 'entry.moved',
  'entry.delete': 'entry.deleted',
  'entry.restore': 'entry.restored',
  'release.publish': 'release.published',
  'media.upload': 'media.added',
  'media.edit': 'media.added',
  'media.stock': 'media.added',
  'media.import': 'media.added',
  'media.delete': 'media.deleted',
  'media.delete.many': 'media.deleted',
};
const MAX_HOOKS = 20;
const invalid = (field, words) => new HttpError(422, 'invalid', words, { field });

export function createWebhooks(app) {
  const { db, audit, store } = app;
  const deliveries = createDeliveries(app);

  const may = (ctx) => {
    if (!can(ctx.user, 'site.webhooks')) throw forbidden('Webhooks are for owners and administrators.');
  };
  const hookOf = (id) => {
    const h = typeof id === 'string' ? db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) : null;
    if (!h) throw notFound('No such webhook.');
    return h;
  };
  const newSecret = () => `whsec_${crypto.randomBytes(32).toString('base64url')}`;

  const view = (h) => {
    const last = db.prepare('SELECT status, last_status, last_at FROM webhook_deliveries WHERE hook_id = ? AND last_at IS NOT NULL ORDER BY last_at DESC LIMIT 1').get(h.id);
    const failing = db.prepare("SELECT COUNT(*) AS n FROM webhook_deliveries WHERE hook_id = ? AND status IN ('pending', 'gave-up') AND attempts > 0").get(h.id).n;
    return { id: h.id, name: h.name, url: maskUrl(h.url), host: new URL(h.url).host, events: JSON.parse(h.events), active: h.active === 1, createdAt: h.created_at, updatedAt: h.updated_at, last: last ? { status: last.status, answer: last.last_status, at: last.last_at } : null, failing };
  };

  /** A hook's fields from a request: each checked, the address through the SSRF guard. */
  function fields(b, was = null) {
    const out = {};
    if (b.name !== undefined || !was) {
      if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 80) throw invalid('name', 'Give it a name (at most 80 characters), e.g. "Search index".');
      out.name = b.name.trim();
    }
    if (b.url !== undefined || !was) {
      if (typeof b.url !== 'string' || b.url.length > 2000) throw invalid('url', 'url is the address to tell.');
      let u;
      try {
        u = checkUrl(b.url, app.outbound ?? {});
      } catch (e) {
        throw invalid('url', e.message);
      }
      // signed events carry what changed: https only (a test's own loopback site aside, through the test seam)
      if (u.protocol !== 'https:' && !app.outbound?.allow) throw invalid('url', 'Use an https address: the events say what changed on the site.');
      if (u.port && u.port !== '443' && !app.outbound?.allow) throw invalid('url', 'Use the https port (443).');
      out.url = u.href;
    }
    if (b.events !== undefined || !was) {
      if (!Array.isArray(b.events) || !b.events.length || b.events.some((e) => !EVENTS.includes(e))) throw invalid('events', `events is a list of: ${EVENTS.join(', ')}.`);
      out.events = JSON.stringify([...new Set(b.events)]);
    }
    if (b.active !== undefined) {
      if (typeof b.active !== 'boolean') throw invalid('active', 'active is true or false.');
      out.active = b.active ? 1 : 0;
    }
    return out;
  }

  /** What an event says: who, what, where, never text or an email. */
  function payloadOf({ ctx, action, target, detail }) {
    const actor = ctx?.user ? { id: ctx.user.id, name: ctx.user.name } : ctx?.actorName ? { id: null, name: ctx.actorName } : null;
    const out = { site: { name: app.config.siteName ?? null, url: app.config.siteUrl ?? null }, actor };
    // a move is told by where the entry is now, and where it was
    const moved = action === 'entry.move' && typeof detail?.to === 'string';
    const [cid, id] = String(moved ? detail.to : (target ?? '')).split('/');
    const c = store.collections.find((x) => x.id === cid);
    if (moved) out.from = { collection: String(target).split('/')[0], id: String(target).split('/')[1] ?? null };
    if (c && id && action.startsWith('entry.')) {
      let url = null;
      try {
        url = store.summarize(c, id, store.read(c, id).text).url ?? null;
      } catch {
        url = null;
      }
      out.entry = { collection: c.id, id, url };
    } else if (action.startsWith('release.')) out.release = { id: target };
    else if (action.startsWith('job.')) out.job = { id: target, kind: detail?.kind ?? null, ...(detail?.step ? { step: detail.step } : {}) };
    else if (action.startsWith('media.')) out.media = { id: target && target !== 'media' ? String(target) : null, paths: (detail?.path ? [detail.path] : (detail?.files ?? [])).slice(0, 200), ...(detail?.count ? { count: detail.count } : {}) };
    else if (target) out.target = String(target).slice(0, 300);
    if (detail?.commit) out.commit = detail.commit;
    return out;
  }

  /** The audit's every action: the hooks listening to its event get a delivery. */
  function hear(e) {
    if (!e.ok) return;
    let event = FROM_AUDIT[e.action] ?? null;
    if (e.action === 'job.succeeded' && e.detail?.deployed) event = 'site.live';
    if (e.action === 'job.failed' && ['build', 'deploy'].includes(e.detail?.step)) event = 'site.failed';
    if (!event) return;
    const hooks = db.prepare('SELECT * FROM webhooks WHERE active = 1').all().filter((h) => JSON.parse(h.events).includes(event));
    if (!hooks.length) return;
    const payload = payloadOf(e);
    for (const h of hooks) deliveries.queue(h, event, payload);
    setImmediate(() => void deliveries.tick().catch((err) => console.error(`[markstage] webhooks: ${err.message}`)));
  }
  audit.listen((e) => {
    // job.failed is audited with ok: false; it is still an event
    if (e.action === 'job.failed') return hear({ ...e, ok: true });
    return hear(e);
  });

  function routes(api) {
    api.add('GET', '/webhooks', (ctx) => {
      may(ctx);
      return { items: db.prepare('SELECT * FROM webhooks ORDER BY created_at').all().map(view), events: EVENTS };
    });
    api.add('POST', '/webhooks', (ctx) => {
      may(ctx);
      if (db.prepare('SELECT COUNT(*) AS n FROM webhooks').get().n >= MAX_HOOKS) throw new HttpError(409, 'too-many', `A site has at most ${MAX_HOOKS} webhooks.`);
      const f = fields(ctx.body ?? {});
      const id = newId('wh');
      const secret = newSecret();
      const now = nowIso(app.clock());
      db.prepare('INSERT INTO webhooks (id, name, url, events, secret, active, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, f.name, f.url, f.events, secret, f.active ?? 1, ctx.user.id, now, now);
      audit.log(ctx, 'webhook.create', { target: id, detail: { name: f.name, host: new URL(f.url).host, events: JSON.parse(f.events) } });
      ctx.status = 201;
      return { webhook: view(hookOf(id)), secret };
    });
    api.add('PATCH', '/webhooks/:wid', (ctx) => {
      may(ctx);
      const h = hookOf(ctx.params.wid);
      const f = fields(ctx.body ?? {}, h);
      const next = { ...h, ...f, updated_at: nowIso(app.clock()) };
      db.prepare('UPDATE webhooks SET name = ?, url = ?, events = ?, active = ?, updated_at = ? WHERE id = ?').run(next.name, next.url, next.events, next.active, next.updated_at, h.id);
      audit.log(ctx, 'webhook.update', { target: h.id, detail: { changed: Object.keys(f), host: new URL(next.url).host } });
      return { webhook: view(hookOf(h.id)) };
    });
    api.add('DELETE', '/webhooks/:wid', (ctx) => {
      may(ctx);
      const h = hookOf(ctx.params.wid);
      db.prepare('DELETE FROM webhooks WHERE id = ?').run(h.id);
      db.prepare("UPDATE webhook_deliveries SET status = 'gave-up', last_error = 'The webhook was removed.', next_at = NULL WHERE hook_id = ? AND status = 'pending'").run(h.id);
      audit.log(ctx, 'webhook.delete', { target: h.id, detail: { name: h.name } });
      return { ok: true };
    });
    api.add('POST', '/webhooks/:wid/secret', (ctx) => {
      may(ctx);
      const h = hookOf(ctx.params.wid);
      const secret = newSecret();
      db.prepare('UPDATE webhooks SET secret = ?, updated_at = ? WHERE id = ?').run(secret, nowIso(app.clock()), h.id);
      audit.log(ctx, 'webhook.secret', { target: h.id });
      return { secret };
    });
    api.add('POST', '/webhooks/:wid/test', (ctx) => {
      may(ctx);
      const h = hookOf(ctx.params.wid);
      const id = deliveries.queue(h, 'ping', { site: { name: app.config.siteName ?? null, url: app.config.siteUrl ?? null }, actor: { id: ctx.user.id, name: ctx.user.name }, words: 'A test from Markstage.' });
      audit.log(ctx, 'webhook.test', { target: h.id });
      setImmediate(() => void deliveries.tick().catch(() => {}));
      ctx.status = 202;
      return { delivery: { id } };
    });
    api.add('GET', '/webhooks/:wid/deliveries', (ctx) => {
      may(ctx);
      const h = hookOf(ctx.params.wid);
      const status = ctx.query.get('status') || null;
      if (status && !['pending', 'delivered', 'gave-up', 'held'].includes(status)) throw invalid('status', 'status is pending, delivered, gave-up or held.');
      const page = Math.max(1, Number.parseInt(ctx.query.get('page') ?? '1', 10) || 1);
      const perPage = Math.min(200, Math.max(1, Number.parseInt(ctx.query.get('perPage') ?? '50', 10) || 50));
      const where = status ? 'hook_id = ? AND status = ?' : 'hook_id = ?';
      const args = status ? [h.id, status] : [h.id];
      const total = db.prepare(`SELECT COUNT(*) AS n FROM webhook_deliveries WHERE ${where}`).get(...args).n;
      const rows = db.prepare(`SELECT * FROM webhook_deliveries WHERE ${where} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`).all(...args, perPage, (page - 1) * perPage);
      return {
        items: rows.map((d) => ({ id: d.id, event: d.event, status: d.status, attempts: d.attempts, nextAt: d.next_at, answer: d.last_status, error: d.last_error, answerText: d.answer, lastAt: d.last_at, durationMs: d.duration_ms, deliveredAt: d.delivered_at, createdAt: d.created_at, payload: JSON.parse(d.payload) })),
        total,
        page,
        perPage,
      };
    });
    api.add('POST', '/webhooks/:wid/deliveries/:did/retry', (ctx) => {
      may(ctx);
      const h = hookOf(ctx.params.wid);
      const d = db.prepare('SELECT * FROM webhook_deliveries WHERE id = ? AND hook_id = ?').get(ctx.params.did, h.id);
      if (!d) throw notFound('No such delivery.');
      if (d.status === 'delivered') throw new HttpError(409, 'delivered', 'This one was delivered already.');
      // one more try now; a further failure is given up (the backoff is spent)
      db.prepare("UPDATE webhook_deliveries SET status = 'pending', next_at = ?, attempts = MIN(attempts, ?) WHERE id = ?").run(nowIso(app.clock()), BACKOFF_MINUTES.length, d.id);
      audit.log(ctx, 'webhook.retry', { target: h.id, detail: { delivery: d.id } });
      setImmediate(() => void deliveries.tick().catch(() => {}));
      ctx.status = 202;
      return { delivery: { id: d.id } };
    });
  }

  return { routes, tick: () => deliveries.tick(), start: () => deliveries.start(), stop: () => deliveries.stop(), events: EVENTS };
}
