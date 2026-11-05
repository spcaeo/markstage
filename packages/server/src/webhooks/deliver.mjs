// Webhook deliveries (docs/API-WEBHOOKS.md "Deliveries"): each event a hook listens to is kept as a delivery, sent
// as a signed POST through the SSRF guard (library/fetch.mjs safePost: public addresses only, checked again at each
// send, no redirect followed), and tried again with backoff until it is taken or given up. The log keeps what was
// sent and the first part of each answer, scrubbed of the server's secrets and the hook's own.
import crypto from 'node:crypto';
import { safePost } from '../library/fetch.mjs';
import { createScrub } from '../mcp/answer.mjs';
import { newId, nowIso } from '../util.mjs';

// minutes after each failed try; after the last, the delivery is given up
export const BACKOFF_MINUTES = [1, 5, 30, 120, 360];
const ANSWER_CHARS = 500;
const KEEP_DAYS = 30;

/** The signature header: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>" with the hook's secret>`. */
export function sign(secret, body, at) {
  const t = Math.floor(at / 1000);
  return `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

/** An address as it may be shown: no sign-in, and each query value hidden (a token often rides there). */
export function maskUrl(url) {
  try {
    const u = new URL(url);
    u.username = '';
    u.password = '';
    for (const k of [...u.searchParams.keys()]) u.searchParams.set(k, 'hidden');
    return u.href.replace(/=hidden/g, '=[hidden]');
  } catch {
    return '[hidden]';
  }
}

export function createDeliveries(app) {
  const { db } = app;
  const scrubber = app.mcp?.scrubber ?? createScrub(app);
  let running = null;
  let closed = false;
  let timer = null;

  /** Outside production the hooks stay quiet unless `environment.keep` lists "webhooks" (docs/ENVIRONMENTS.md). */
  const quiet = () => {
    const env = app.config.environment;
    return Boolean(env && !env.production && !(env.keep ?? []).includes('webhooks'));
  };

  /** Queue one event for one hook. */
  function queue(hook, event, payload) {
    const id = newId('wd');
    const body = JSON.stringify({ id, event, at: nowIso(app.clock()), ...payload });
    db.prepare("INSERT INTO webhook_deliveries (id, hook_id, event, payload, status, attempts, next_at, created_at) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)").run(id, hook.id, event, body, nowIso(app.clock()), nowIso(app.clock()));
    return id;
  }

  /** One try of one delivery: taken (2xx), or tried again later, or given up after the last. */
  async function attempt(d) {
    const hook = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(d.hook_id);
    if (!hook) return db.prepare("UPDATE webhook_deliveries SET status = 'gave-up', last_error = ?, next_at = NULL WHERE id = ?").run('The webhook was removed.', d.id);
    if (quiet()) return db.prepare("UPDATE webhook_deliveries SET status = 'held', last_error = ?, next_at = NULL WHERE id = ?").run(`Not sent: this is ${app.config.environment.name}, and webhooks go out from production only (environment.keep can list "webhooks").`, d.id);
    const started = Date.now();
    const at = app.clock();
    let status = null;
    let error = null;
    let answer = '';
    try {
      const r = await safePost(hook.url, {
        body: d.payload,
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Markstage/1 (webhook)', 'Markstage-Event': d.event, 'Markstage-Delivery': d.id, 'Markstage-Signature': sign(hook.secret, d.payload, at) },
        outbound: app.outbound ?? {},
      });
      status = r.status;
      answer = r.body.toString('utf8').slice(0, ANSWER_CHARS);
      if (status < 200 || status >= 300) error = `The address answered ${status}.`;
    } catch (e) {
      error = e.message;
    }
    const tries = d.attempts + 1;
    const clean = (s) => (s ? scrubber.scrub(String(s)).split(hook.secret).join('[hidden]') : null);
    const done = !error;
    const last = tries > BACKOFF_MINUTES.length;
    const next = done || last ? null : nowIso(at + BACKOFF_MINUTES[tries - 1] * 60_000);
    db.prepare('UPDATE webhook_deliveries SET status = ?, attempts = ?, next_at = ?, last_status = ?, last_error = ?, answer = ?, last_at = ?, duration_ms = ?, delivered_at = ? WHERE id = ?').run(
      done ? 'delivered' : last ? 'gave-up' : 'pending',
      tries,
      next,
      status,
      clean(error),
      clean(answer),
      nowIso(at),
      Date.now() - started,
      done ? nowIso(at) : null,
      d.id,
    );
    if (!done && last) app.notices?.tell({ kind: 'webhook.failed', level: 'warn', text: `The webhook “${hook.name}” could not deliver ${d.event} after ${tries} tries. ${clean(error)}`, link: `#/settings/webhooks/${hook.id}`, to: 'administrators' });
    return null;
  }

  /**
   * Send what is due, one at a time (the order events happened in); old deliveries are let go. One server process
   * sends at a time (a lease in the database): the others leave it to that one, or to the next tick.
   */
  function tick() {
    if (closed) return Promise.resolve();
    if (!running && app.cluster && !app.cluster.take('webhooks.send', 'webhooks')) return Promise.resolve();
    running ??= (async () => {
      for (;;) {
        const d = closed ? null : db.prepare("SELECT * FROM webhook_deliveries WHERE status = 'pending' AND next_at <= ? ORDER BY next_at, created_at LIMIT 1").get(nowIso(app.clock()));
        if (!d) break;
        // fencing: still this process's turn to send (one paused while another took over stops here)
        if (app.cluster && !app.cluster.renew('webhooks.send')) {
          console.error('[markstage] webhooks: another server process took the sending over while this one was paused; this one stopped sending.');
          break;
        }
        await attempt(d);
      }
      if (!closed) db.prepare("DELETE FROM webhook_deliveries WHERE created_at < ? AND status != 'pending'").run(nowIso(app.clock() - KEEP_DAYS * 86_400_000));
    })().finally(() => {
      running = null;
      app.cluster?.release('webhooks.send');
    });
    return running;
  }

  return {
    queue,
    tick,
    start() {
      closed = false;
      timer = setInterval(() => void tick().catch((e) => console.error(`[markstage] webhooks: ${e.message}`)), 5_000);
      timer.unref();
    },
    /** No more sends; the one running finishes (the server waits for it before the database closes). */
    stop() {
      closed = true;
      clearInterval(timer);
      return running ?? Promise.resolve();
    },
  };
}
