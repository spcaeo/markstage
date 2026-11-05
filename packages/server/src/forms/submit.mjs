// A visitor sends a form on the site (docs/API-INBOX.md "Forms and the Inbox"): POST <basePath>/forms/<id> on the site's own host names
// (config siteHosts), form-encoded or JSON. Kept in the data dir (never in git), then the team hears of it (a notice
// in the editor and the alert channels: the team mail carries every field, Reply-To the visitor) and the visitor
// gets the thank-you mail. In this order:
//   Origin is one of the site's hosts -> the form exists -> body (64 KB, form or JSON) -> too many from this address
//   or its network today (429) -> spam checks (honeypot, filled in under minSeconds: kept as spam, answered 200 so a
//   bot learns nothing) -> the fields (400 with {fields}) -> too many for this email today (perDay, 429) -> stored ->
//   mails. Past the form's hourly cap (perHour, real messages only) a message is stored as `held`: the visitor is
//   answered as usual, nobody is mailed yet, the administrators hear of it, and retry() lets held messages through
//   once the hour is under the cap again. So a flood never turns the form off for real visitors.
// The visitor's address comes from the connection, or the hop a trusted proxy appended; never from the body.
import { clientIp, readRaw } from '../http.mjs';
import { tx } from '../db.mjs';
import { HttpError, netOf, newId, nowIso } from '../util.mjs';
import { addressOf, sendMail } from '../notify/smtp.mjs';
import { createCrm } from './crm.mjs';
import { createLeads } from './leads.mjs';

// the same message from the same address again within this long is one message
const SAME_AGAIN_MS = 5 * 60_000;
const MAX_BODY = 64 * 1024;
const DAY = 86_400_000;
// spam is kept too (to look at), so a flood from one address, or from one network (an IPv4 /24, an IPv6 /64: one
// person usually holds a whole /64), is cut off before it is stored
const MAX_PER_IP_DAY = 20;
const MAX_PER_NET_DAY = 60;
// held messages let through per retry() tick (every minute) once the hour is under the cap
const RELEASE_BATCH = 20;
// a team alert that did not go is tried again after these minutes (then once a day), and given up after RETRIES tries:
// the message itself is in the Inbox either way
const BACKOFF_MIN = [5, 15, 60, 240, 720];
const RETRIES = 12;
const EMAIL = /^[^\s<>@,;"()[\]\\]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const PHONE = /^\+?[\d\s().-]{7,20}$/;

/** Text as it may be kept: no control characters; one line unless it is a long text. */
export function cleanText(v, multiline = false) {
  let s = String(v ?? '').normalize('NFC').replace(/\r\n?/g, '\n');
  s = s.replace(/[\u0000-\u0008\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '');
  if (!multiline) s = s.replace(/\s*\n\s*/g, ' ');
  return s.replace(/[ \t]+$/gm, '').trim();
}

/** The field's value, or its problem in plain words. */
export function checkField(f, raw) {
  const v = cleanText(raw, f.type === 'textarea');
  if (!v) return f.required ? { error: `${f.label} is required.` } : { value: '' };
  if (v.length > f.max) return { error: `${f.label} is too long (at most ${f.max} characters).` };
  if (v.length < f.min) return { error: `${f.label} is too short (at least ${f.min} characters).` };
  if (f.type === 'email' && (!EMAIL.test(v) || v.length > 254)) return { error: `${f.label} is not an email address.` };
  if (f.type === 'tel') {
    const digits = v.replace(/\D/g, '').length;
    if (!PHONE.test(v) || digits < 7 || digits > 15) return { error: `${f.label} is not a phone number.` };
  }
  if (f.type === 'url') {
    try {
      if (!/^https?:$/.test(new URL(v).protocol)) throw new Error('scheme');
    } catch {
      return { error: `${f.label} is not a web address.` };
    }
  }
  if (f.options && !f.options.includes(v)) return { error: `${f.label}: choose one of the options.` };
  return { value: v };
}

/** The posted values as a Map of strings (the last one wins for a repeated name). */
function valuesOf(req, buf) {
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  const text = buf.toString('utf8');
  if (type === 'application/x-www-form-urlencoded' || type === 'text/plain' || !type) return new Map(new URLSearchParams(text));
  if (type === 'application/json') {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new HttpError(400, 'bad-request', 'The form could not be read.');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'bad-request', 'The form could not be read.');
    return new Map(Object.entries(data).filter(([, v]) => ['string', 'number'].includes(typeof v)).map(([k, v]) => [k, String(v)]));
  }
  throw new HttpError(415, 'unsupported', 'Send the form as a form or as JSON.');
}

/** A name to greet a visitor by: none when it looks like a link or an address (the reply must not carry spam). */
export function greetingName(name) {
  const n = cleanText(name).slice(0, 60);
  if (!n || /https?:|www\.|:\/\/|@|\.[a-z]{2,}\b/i.test(n)) return '';
  return n.charAt(0).toUpperCase() + n.slice(1);
}

const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

export { netOf };

const TEST_WORDS = 'Test form: not sent. This is not the live site; the message is kept here and nobody was mailed.';

export function createFormSubmit(app, deps = {}) {
  const { db, config, clock, audit } = app;
  // a form with crm: its messages also go to Odoo, after they are stored (forms/crm.mjs)
  const crm = createCrm(app, deps.crm);
  // a form with leads: its real messages also go to an analytics tool as leads, after they are stored (forms/leads.mjs)
  const leads = createLeads(app, deps.leads);
  const forms = () => app.config.forms ?? {};
  const siteName = typeof config.siteName === 'string' && config.siteName.trim() ? config.siteName.trim() : 'the site';
  const origins = new Set(config.siteHosts.flatMap((h) => [`https://${h}`, ...(/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(h) ? [`http://${h}`] : [])]));
  const route = new RegExp(`^${config.basePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/forms/([a-z][a-z0-9-]{0,39})/?$`);

  const count = (sql, ...args) => Number(db.prepare(sql).get(...args).n);
  const testOnly = config.environment ? !config.environment.production : false;
  /** Real messages (never spam; held ones count, they are real) of this form stored in the last hour. */
  const hourCount = (form, now) => count("SELECT COUNT(*) AS n FROM form_messages WHERE form = ? AND status != 'spam' AND at > ?", form.id, nowIso(now - DAY / 24));
  /** Messages (spam too) from the visitor's network today. */
  const netCount = (ip, since) => {
    const net = netOf(ip);
    if (!net) return 0;
    return db.prepare('SELECT ip FROM form_messages WHERE at > ? AND ip IS NOT NULL').all(since).filter((r) => netOf(r.ip) === net).length;
  };
  // the administrators hear once an hour per form that its messages are being held (once across every server process)

  /** The team mail: every field and where the visitor came from; replying answers the visitor. */
  function teamMail(form, row, values, meta) {
    const lines = form.fields.filter((f) => values[f.key]).map((f) => (f.type === 'textarea' ? `${f.label}:\n${values[f.key]}\n` : `${f.label}: ${values[f.key]}`));
    const where = [['Sent from', meta.page], ['Came from', meta.referrer], ['Landing page', meta.landing], ['Referring domain', meta.referringDomain], ['UTM source', meta.utmSource], ['UTM medium', meta.utmMedium], ['UTM campaign', meta.utmCampaign], ['Location (approximate)', meta.location]].filter(([, v]) => v);
    const name = values[form.name] || values[form.email] || 'a visitor';
    return {
      subject: fill(form.team.subject, { name, form: form.label, siteName }),
      text: [`${form.label} form on ${config.siteUrl ?? siteName}`, '', ...lines, '', ...where.map(([k, v]) => `${k}: ${v}`), `When: ${row.at}`].join('\n'),
      replyTo: values[form.email] || null,
    };
  }

  const notice = (form, values) => {
    const who = (form.name && values[form.name]) || (form.email && values[form.email]) || 'a visitor';
    const first = cleanText(form.fields.filter((f) => f.type === 'textarea').map((f) => values[f.key]).find(Boolean) ?? '').slice(0, 140);
    return `New ${form.label} form message from ${who}.${first ? ` “${first}”` : ''}`;
  };

  /** The form's hourly cap is reached: tell the administrators (once an hour per form). */
  function tellHeld(form, now) {
    if (!app.cluster.hits.once('forms.held', form.id, DAY / 24, now)) return;
    audit.log(null, 'forms.held', { target: `form.${form.id}`, ok: false, detail: { perHour: form.perHour } });
    app.notices.tell({ kind: 'form.held', level: 'warn', text: `The ${form.label} form got more than ${form.perHour} messages in an hour. New ones are kept in the Inbox as held (nobody is mailed, nothing goes to the CRM) and let through once the hour calms down. Check the Inbox for spam that got past the checks.`, link: `#/inbox?status=held`, to: 'administrators' });
  }

  /** A stored real message goes out: the team alert and thank-you mail, then the CRM and the lead. */
  function deliver(form, row, values, meta, lead) {
    try {
      alertTeam(form, row, values, meta);
      void reply(form, values);
    } catch (err) {
      console.error(`[markstage] form ${form.id}: the team was not told of ${row.id}: ${err?.stack ?? err}`);
      alertResult(row.id, [{ channel: 'email', ok: false, detail: err?.message ?? String(err) }]);
    }
    // to the CRM after the answer is settled: its outcome is kept on the row, never the visitor's concern
    if (crm.mark(form, row.id)) setImmediate(() => void crm.push(row.id).catch((e) => console.error(`[markstage] form ${form.id}: the CRM push of ${row.id} failed: ${e?.message ?? e}`)));
    // the lead for analytics, likewise
    if (lead && leads.mark(form, row.id, lead)) setImmediate(() => void leads.push(row.id).catch((e) => console.error(`[markstage] form ${form.id}: the lead of ${row.id} was not sent: ${e?.message ?? e}`)));
  }

  /** Held messages, oldest first, go out while the form's hour is under its cap. Returns how many went. */
  function releaseHeld() {
    let n = 0;
    const now = clock();
    for (const form of Object.values(forms())) {
      const held = db.prepare("SELECT * FROM form_messages WHERE form = ? AND status = 'held' ORDER BY at, rowid LIMIT ?").all(form.id, RELEASE_BATCH);
      if (!held.length) continue;
      // the held rows themselves count in the hour: the hour is calm once the real ones that went out are under the cap
      const went = count("SELECT COUNT(*) AS n FROM form_messages WHERE form = ? AND status NOT IN ('spam', 'held') AND at > ?", form.id, nowIso(now - DAY / 24));
      let room = form.perHour - went;
      for (const row of held) {
        if (room-- <= 0) break;
        const meta = JSON.parse(row.meta);
        const { lead = null, ...rest } = meta;
        const at = nowIso(now);
        db.prepare("UPDATE form_messages SET status = 'new', meta = ?, rev = rev + 1 WHERE id = ? AND status = 'held'").run(JSON.stringify(rest), row.id);
        db.prepare('INSERT INTO form_events (message_id, at, change) VALUES (?, ?, ?)').run(row.id, at, 'let through: the hour is under the limit again; the team is told now');
        deliver(form, { id: row.id, at: row.at }, JSON.parse(row.fields), rest, lead);
        n++;
      }
    }
    return n;
  }

  /** Tell the team (a notice, and the team mail through the alert channels); the mail's outcome is kept on the row. */
  function alertTeam(form, row, values, meta) {
    const mailed = Boolean(config.notify?.email);
    if (mailed) db.prepare("UPDATE form_messages SET alert = 'pending' WHERE id = ?").run(row.id);
    app.notices.tell({ kind: 'form.message', level: 'info', text: notice(form, values), link: `#/inbox?open=${row.id}`, to: 'editors', mail: teamMail(form, row, values, meta), onSent: mailed ? (r) => alertResult(row.id, r) : null });
  }

  /** Keep how the team mail went: sent, nobody to mail, or failed (tried again later, with the reason). */
  function alertResult(id, results) {
    const r = results.find((x) => x.channel === 'email');
    const m = db.prepare('SELECT alert, alert_tries FROM form_messages WHERE id = ?').get(id);
    if (!m) return;
    const at = nowIso(clock());
    if (!r || r.ok) {
      db.prepare('UPDATE form_messages SET alert = ?, alert_next_at = NULL, alert_error = NULL WHERE id = ?').run(r ? 'sent' : 'none', id);
      if (r && m.alert === 'failed') db.prepare('INSERT INTO form_events (message_id, at, change) VALUES (?, ?, ?)').run(id, at, `the team alert went out (try ${m.alert_tries + 1})`);
      return;
    }
    const tries = m.alert_tries + 1;
    const wait = tries >= RETRIES ? null : (BACKOFF_MIN[tries - 1] ?? 1440) * 60_000;
    db.prepare("UPDATE form_messages SET alert = 'failed', alert_tries = ?, alert_next_at = ?, alert_error = ? WHERE id = ?").run(tries, wait === null ? null : nowIso(clock() + wait), String(r.detail).slice(0, 500), id);
    if (m.alert !== 'failed') db.prepare('INSERT INTO form_events (message_id, at, change) VALUES (?, ?, ?)').run(id, at, `the team alert was not sent: ${String(r.detail).slice(0, 200)}`);
    if (wait === null) db.prepare('INSERT INTO form_events (message_id, at, change) VALUES (?, ?, ?)').run(id, at, `gave up sending the team alert after ${tries} tries`);
  }

  /** Send again the team mails and CRM pushes that failed and are due (every minute). Returns how many were tried. */
  async function retry() {
    const pushed = (await crm.retry()) + (await leads.retry());
    return pushed + (await retryMail()) + releaseHeld();
  }

  async function retryMail() {
    const n = config.notify;
    if (!n?.email || !app.alerts) return 0;
    const due = db.prepare("SELECT * FROM form_messages WHERE alert = 'failed' AND alert_next_at IS NOT NULL AND alert_next_at <= ? ORDER BY at LIMIT 20").all(nowIso(clock()));
    for (const row of due) {
      const form = forms()[row.form];
      const values = JSON.parse(row.fields);
      const emails = app.notices.mailTo('form.message');
      // the form left the config: its words are the fields as they are
      const f = form ?? { id: row.form, label: row.form, name: 'name', email: 'email', fields: Object.keys(values).map((key) => ({ key, label: key, type: 'text' })), team: { subject: '{siteName}: a message from {name} ({form})' } };
      const results = await app.alerts.send({ kind: 'form.message', level: 'info', text: notice(f, values), link: `#/inbox?open=${row.id}`, at: row.at, mail: teamMail(f, row, values, JSON.parse(row.meta)) }, { emails, slack: false, webhook: false }, { only: 'email' });
      alertResult(row.id, results);
    }
    return due.length;
  }

  async function reply(form, values) {
    const to = values[form.email];
    const mail = config.notify?.email;
    const r = app.formSettings ? app.formSettings.replyOf(form) : form.reply;
    if (!r || !to || !mail) return;
    const vars = { name: greetingName(values[form.name]), siteName };
    const text = fill(r.text, vars).replace(/^Hi ,/m, 'Hi,');
    // from the name set in Settings → Alerts, as the team's alerts are
    const sender = app.alertRules?.senderName();
    try {
      await sendMail({ ...mail, from: sender ? `${sender} <${addressOf(mail.from)}>` : mail.from, to: [to], subject: fill(r.subject, vars), text });
    } catch (e) {
      console.error(`[markstage] the thank-you mail for a ${form.id} form message was not sent: ${e.message}`);
    }
  }

  function answer(req, res, status, body, form) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'no-store');
    // a plain HTML form (no script): on to the thank-you page, or the problem in plain words
    if (req.headers['sec-fetch-mode'] === 'navigate') {
      if (status === 200 && form?.thanks) {
        res.statusCode = 303;
        res.setHeader('Location', form.thanks);
        return res.end();
      }
      res.statusCode = status;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.end(`${body.message ?? body.error}\n\nGo back to the page to ${status === 200 ? 'continue' : 'try again'}.`);
    }
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ status, ...body }));
  }

  /** Handle a request on a site host; false when it is not a form post (the caller answers it). */
  async function handle(req, res, url) {
    const m = route.exec(url.pathname);
    if (!m) return false;
    const ctx = { user: null, ip: clientIp(req, config.trustProxy), userAgent: String(req.headers['user-agent'] ?? '') };
    const form = forms()[m[1]];
    try {
      if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'Send the form with POST.');
      if (!origins.has(String(req.headers.origin ?? ''))) {
        audit.log(ctx, 'security.origin', { ok: false, target: `form.${m[1]}`, detail: { origin: req.headers.origin ?? null } });
        throw new HttpError(403, 'forbidden', 'This form can only be sent from the site.');
      }
      if (!form) throw new HttpError(404, 'not-found', 'There is no such form.');
      const posted = valuesOf(req, await readRaw(req, MAX_BODY));
      const now = clock();
      // the counts and the store are one write transaction: two server processes (or two quick posts) cannot both
      // pass a limit with one message left (docs/SCALING.md)
      const out = tx(db, () => {
        const since = nowIso(now - DAY);
        if (ctx.ip && count('SELECT COUNT(*) AS n FROM form_messages WHERE ip = ? AND at > ?', ctx.ip, since) >= MAX_PER_IP_DAY) throw new HttpError(429, 'too-many', form.limitMessage);
        if (ctx.ip && netCount(ctx.ip, since) >= MAX_PER_NET_DAY) throw new HttpError(429, 'too-many', form.limitMessage);

        // spam: kept aside (as far as it can be read), answered as if it went through
        const started = Number(form.started ? posted.get(form.started) : NaN);
        const spam = form.honeypot && cleanText(posted.get(form.honeypot)) ? 'honeypot' : Number.isFinite(started) && started > 0 && now - started < form.minSeconds * 1000 ? 'too-fast' : null;

        const values = {};
        const problems = {};
        for (const f of form.fields) {
          const r = checkField(f, posted.get(f.key));
          if (r.error && !spam) problems[f.key] = r.error;
          values[f.key] = r.value ?? cleanText(posted.get(f.key), f.type === 'textarea').slice(0, f.max);
        }
        if (Object.keys(problems).length) throw new HttpError(400, 'invalid', Object.values(problems)[0], { fields: problems });
        const email = form.email ? values[form.email] || null : null;
        if (!spam) {
          const seen = count("SELECT COUNT(*) AS n FROM form_messages WHERE form = ? AND status != 'spam' AND at > ? AND (ip = ? OR (? IS NOT NULL AND email = ?))", form.id, since, ctx.ip, email, email);
          if (seen >= form.perDay) throw new HttpError(429, 'too-many', form.limitMessage);
        }
        const meta = {};
        for (const [k, key] of Object.entries(form.meta)) {
          const v = cleanText(posted.get(key)).slice(0, 2000);
          if (v) meta[k] = v;
        }
        // where the visitor is, roughly: from their address and the city file here (never what the browser says)
        const where = spam ? null : app.geo?.where(ctx.ip);
        if (where) meta.location = where.place;
        // the place's parts, for a CRM's own fields (city, state by name, country by code)
        const place = where && (where.city || where.region || where.countryCode) ? JSON.stringify({ city: where.city, region: where.region, countryCode: where.countryCode }) : null;
        // the lead for analytics: the visitor id and the test mark are posted values, kept with the send
        const lead = form.leads ? { vid: form.leads.vid ? cleanText(posted.get(form.leads.vid)) : null, test: form.leads.test ? cleanText(posted.get(form.leads.test)) === '1' : false } : null;
        // past the form's hourly cap (real messages only) the message is held: stored, the visitor answered, nobody
        // mailed until the hour calms down (releaseHeld)
        const held = !spam && !testOnly && hourCount(form, now) >= form.perHour;
        // the same message again from the same place within a few minutes (a double click, a retry): kept once, the
        // visitor thanked again (QA pass 2, N12)
        if (!spam) {
          const again = db.prepare("SELECT id FROM form_messages WHERE form = ? AND ip IS ? AND fields = ? AND at > ? AND status != 'spam' ORDER BY at DESC LIMIT 1").get(form.id, ctx.ip, JSON.stringify(values), nowIso(now - SAME_AGAIN_MS));
          if (again) {
            db.prepare('INSERT INTO form_events (message_id, at, change) VALUES (?, ?, ?)').run(again.id, nowIso(now), 'sent again from the site within a few minutes: kept once');
            return { again: true };
          }
        }
        const row = { id: newId('fm'), at: nowIso(now) };
        db.prepare('INSERT INTO form_messages (id, form, at, status, name, email, service, fields, meta, ip, user_agent, spam, place) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
          row.id, form.id, row.at, spam ? 'spam' : held ? 'held' : 'new', form.name ? values[form.name] || null : null, email, form.service ? values[form.service] || null : null, JSON.stringify(values), JSON.stringify(held && lead ? { ...meta, lead } : meta), ctx.ip, ctx.userAgent.slice(0, 300) || null, spam, place,
        );
        db.prepare('INSERT INTO form_events (message_id, at, change) VALUES (?, ?, ?)').run(row.id, row.at, spam ? `put aside as spam (${spam === 'honeypot' ? 'a field people never see was filled in' : `sent within ${form.minSeconds} seconds of the page opening`})` : held ? `held: the form got more than ${form.perHour} messages in an hour; the team is told once it calms down` : 'sent from the site');
        return { row, held, spam, values, meta, lead };
      });
      if (out.again) {
        answer(req, res, 200, testOnly ? { message: TEST_WORDS, test: true } : { message: form.message }, testOnly ? null : form);
        return true;
      }
      const { row, held, spam, values, meta, lead } = out;
      // stored: from here on the visitor's answer is a success, whatever the mail does
      if (held) tellHeld(form, now);
      else if (!spam && testOnly) {
        // outside production: kept in this environment's Inbox, nobody mailed, no thank-you (env/config.mjs)
        db.prepare("UPDATE form_messages SET alert = 'none' WHERE id = ?").run(row.id);
        db.prepare('INSERT INTO form_events (message_id, at, change) VALUES (?, ?, ?)').run(row.id, row.at, `a test form on ${config.environment.name}: nobody was mailed`);
        app.notices.tell({ kind: 'form.message', level: 'info', text: `Test form on ${config.environment.name}: ${notice(form, values)}`, link: `#/inbox?open=${row.id}`, to: 'editors', editorOnly: true });
      } else if (!spam) deliver(form, row, values, meta, lead);
      answer(req, res, 200, testOnly ? { message: TEST_WORDS, test: true } : { message: form.message }, testOnly ? null : form);
    } catch (e) {
      if (!(e instanceof HttpError)) {
        console.error(`[markstage] form ${m[1]}:`, e?.stack ?? e);
        e = new HttpError(500, 'server-error', 'Something went wrong. Please try again later.');
      }
      if (e.status === 413) req.resume();
      answer(req, res, e.status, { error: e.message, ...(e.extra?.fields ? { fields: e.extra.fields } : {}) }, form);
    }
    return true;
  }

  /**
   * Retention: messages are kept forever unless their form sets keepDays (a form no longer in the config: kept);
   * spam goes after 30 days, and the visitor's address and browser are cleared after 30 days.
   */
  function sweep() {
    const now = clock();
    const month = nowIso(now - 30 * DAY);
    let gone = 0;
    for (const f of Object.values(forms())) if (f.keepDays) gone += Number(db.prepare('DELETE FROM form_messages WHERE form = ? AND at < ?').run(f.id, nowIso(now - f.keepDays * DAY)).changes);
    gone += Number(db.prepare("DELETE FROM form_messages WHERE status = 'spam' AND at < ?").run(month).changes);
    const cleared = Number(db.prepare('UPDATE form_messages SET ip = NULL, user_agent = NULL WHERE at < ? AND (ip IS NOT NULL OR user_agent IS NOT NULL)').run(month).changes);
    if (gone || cleared) audit.log(null, 'forms.retention', { detail: { deleted: gone, cleared } });
    return { deleted: gone, cleared };
  }

  return { handle, sweep, retry, releaseHeld, crm, leads };
}
