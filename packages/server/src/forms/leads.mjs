// A real form message also goes to an analytics tool as a lead (docs/API-INBOX.md "Leads for analytics"), when its
// form says so (forms.<id>.leads). Skald only for now: its lead hook, as Skald's own skald-lead.cjs sends it.
// Only after the message is stored, never for spam, and never in the way of the visitor's answer. A send that fails is
// tried again like the CRM push (5, 15, 60, 240, 720 minutes, then daily; given up after 12 tries); each outcome is in
// the message's history in the Inbox, and Site health counts the ones that did not go.
//
// Skald's lead hook: POST <url> with the JSON lead, signed with the hook's secret:
//   X-Skald-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>
//   {external_ref: <the message id>, action, email?, name?, ip?, vid?, test?}
// external_ref is the message's id, so a repeat is never counted twice. ip is the visitor's address as Markstage
// recorded it (the connection, or the hop a trusted proxy appended): Skald looks up the country and drops it. vid is
// the visitor id the page sent (forms.<id>.leads.vid, Skald's skald('id')), kept with the send until it goes.
// The secret is read from the environment when a send runs (<env>_SECRET, SKALD_LEAD_SECRET by default); it is never
// logged, audited or kept.
import crypto from 'node:crypto';
import net from 'node:net';
import { nowIso } from '../util.mjs';

const BACKOFF_MIN = [5, 15, 60, 240, 720];
const RETRIES = 12;
const NAME = { skald: 'Skald' };
const VID = /^skv_[A-Za-z0-9_-]{22}$/;
const TIMEOUT_MS = 5000;

/** The visitor's address as Skald takes it: the first of a list, without a port; anything else: null. */
export function visitorIp(value) {
  let got = String(value ?? '').split(',')[0].trim();
  const m = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(got) || /^\[([0-9A-Fa-f:.]+)\](?::\d{1,5})?$/.exec(got);
  if (m) got = m[1];
  return net.isIP(got) ? got : null;
}

/** A Skald visitor id when `v` is one, else null. */
export const visitorId = (v) => (VID.test(String(v ?? '')) ? String(v) : null);

/** The signature header for `body` at unix second `t`. */
export const signatureOf = (secret, body, t) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

/** The lead Skald is sent for a stored message: its id, the action, who, and the visitor's address and id. */
export function leadOf(form, msg, extra = {}) {
  const lead = { external_ref: String(msg.id), action: form.leads.action };
  if (msg.email) lead.email = String(msg.email);
  if (msg.name) lead.name = String(msg.name);
  const ip = visitorIp(msg.ip);
  if (ip) lead.ip = ip;
  const vid = visitorId(extra.vid);
  if (vid) lead.vid = vid;
  if (extra.test) lead.test = true;
  return lead;
}

/** This form's hook from the environment: {on, problem, secret}. */
export function settingsOf(leads, env = process.env) {
  const secret = String(env[`${leads.env}_SECRET`] ?? '').trim();
  if (!secret) return { on: false, problem: `${leads.env}_SECRET is not set, so no lead is sent to ${NAME[leads.kind]}.` };
  return { on: true, problem: null, secret };
}

/** Send one lead. Resolves when the tool kept it; throws with words that hold no secret. */
export async function sendSkald(url, secret, lead, { fetchImpl = fetch, now = Date.now() } = {}) {
  const body = JSON.stringify(lead);
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'markstage-leads/1', 'X-Skald-Signature': signatureOf(secret, body, Math.floor(now / 1000)) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(e?.name === 'TimeoutError' ? `no answer within ${TIMEOUT_MS / 1000} s` : `could not reach it (${e?.cause?.code ?? e?.message ?? e})`);
  }
  if (!res.ok) {
    let why = '';
    try {
      const j = await res.json();
      why = String(j?.error ?? j?.message ?? j?.detail ?? '').slice(0, 200);
    } catch {
      // no words in the answer
    }
    throw new Error(`it answered ${res.status}${why ? `: ${why}` : ''}`);
  }
}

export function createLeads(app, { fetchImpl = fetch, env = process.env } = {}) {
  const { db, clock } = app;
  const forms = () => app.config.forms ?? {};
  // a message being sent: a lease in the database, so two server processes never send it twice at once
  const busy = { add: (id) => app.cluster.take(`lead:${id}`, 'lead'), delete: (id) => app.cluster.release(`lead:${id}`) };
  // kept apart from form_messages, one row per message sent on (a table of its own: no schema version of its own)
  db.exec(`CREATE TABLE IF NOT EXISTS form_leads (
    message_id TEXT PRIMARY KEY REFERENCES form_messages(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    state TEXT NOT NULL,
    tries INTEGER NOT NULL DEFAULT 0,
    next_at TEXT,
    error TEXT,
    sent_at TEXT,
    vid TEXT,
    test INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS form_leads_due ON form_leads (state, next_at);`);
  const event = (id, change, who = null) => db.prepare('INSERT INTO form_events (message_id, at, by_id, by_name, change) VALUES (?, ?, ?, ?, ?)').run(id, nowIso(clock()), who?.id ?? null, who?.name ?? null, change);
  const scrub = (text, s) => {
    let out = String(text ?? '').slice(0, 1000);
    if (s?.secret && s.secret.length >= 3) out = out.split(s.secret).join('[hidden]');
    return out.slice(0, 500);
  };

  /** Mark a just-stored real message for its form's lead hook (no send yet); false when the form has none. */
  function mark(form, id, { vid = null, test = false } = {}) {
    if (!form.leads) return false;
    db.prepare("INSERT OR IGNORE INTO form_leads (message_id, kind, state, vid, test) VALUES (?, ?, 'pending', ?, ?)").run(id, form.leads.kind, visitorId(vid), test ? 1 : 0);
    return true;
  }

  /** Try one message now. Returns {ok, error?}. `who`: the person who asked, else the server. */
  async function push(id, who = null) {
    if (!busy.add(id)) return { ok: false, error: 'It is being sent right now.' };
    // read after the claim: a send that just ended on another process has written its result
    const l = db.prepare('SELECT * FROM form_leads WHERE message_id = ?').get(id);
    if (!l || l.state === 'sent') {
      busy.delete(id);
      return { ok: l?.state === 'sent' };
    }
    const msg = db.prepare('SELECT id, form, name, email, ip FROM form_messages WHERE id = ?').get(id);
    const form = msg && forms()[msg.form];
    const name = NAME[l.kind] ?? l.kind;
    let s = null;
    try {
      if (!form?.leads) throw new Error('Its form no longer sends leads.');
      s = settingsOf(form.leads, env);
      if (!s.on) throw new Error(s.problem);
      await sendSkald(form.leads.url, s.secret, leadOf(form, msg, { vid: l.vid, test: l.test === 1 }), { fetchImpl, now: clock() });
      const tries = l.tries + 1;
      db.prepare("UPDATE form_leads SET state = 'sent', tries = ?, sent_at = ?, next_at = NULL, error = NULL WHERE message_id = ?").run(tries, nowIso(clock()), id);
      event(id, `sent to ${name} as a lead${l.test ? ' (a test lead)' : ''}${tries > 1 ? ` (try ${tries})` : ''}`, who);
      return { ok: true };
    } catch (e) {
      const words = scrub(e?.message ?? e, s);
      const tries = l.tries + 1;
      const wait = tries >= RETRIES ? null : (BACKOFF_MIN[tries - 1] ?? 1440) * 60_000;
      db.prepare("UPDATE form_leads SET state = 'failed', tries = ?, next_at = ?, error = ? WHERE message_id = ?").run(tries, wait === null ? null : nowIso(clock() + wait), words, id);
      if (l.state !== 'failed' || who) event(id, `not sent to ${name} as a lead: ${words.slice(0, 200)}`, who);
      if (wait === null) event(id, `gave up sending it to ${name} as a lead after ${tries} tries`);
      return { ok: false, error: words };
    } finally {
      busy.delete(id);
    }
  }

  /** The sends that are due (every minute, with the team mails and CRM pushes). */
  async function retry() {
    const due = db.prepare("SELECT message_id FROM form_leads WHERE (state = 'failed' AND next_at IS NOT NULL AND next_at <= ?) OR state = 'pending' ORDER BY rowid LIMIT 20").all(nowIso(clock()));
    for (const r of due) await push(r.message_id);
    return due.length;
  }

  /** A message's lead for the Inbox: null (not for one), or {state, name, tries, error, nextAt, sentAt, test}. */
  function of(id) {
    const l = db.prepare('SELECT * FROM form_leads WHERE message_id = ?').get(id);
    if (!l) return null;
    return { state: l.state, name: NAME[l.kind] ?? l.kind, tries: l.tries, error: l.state === 'failed' ? l.error : null, nextAt: l.state === 'failed' ? l.next_at : null, sentAt: l.sent_at ?? null, test: l.test === 1 };
  }

  /** Site health: each form that sends leads, whether it can, and how many did not go. */
  function status() {
    const list = Object.values(forms()).filter((f) => f.leads).map((f) => {
      const s = settingsOf(f.leads, env);
      return { form: f.id, label: f.label, kind: f.leads.kind, name: NAME[f.leads.kind], on: s.on, problem: s.problem };
    });
    const failed = Number(db.prepare("SELECT COUNT(*) AS n FROM form_leads WHERE state = 'failed'").get().n);
    return { forms: list, failed };
  }

  return { mark, push, retry, of, status };
}
