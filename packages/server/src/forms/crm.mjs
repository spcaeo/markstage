// A form message also goes to a CRM as a lead (docs/API-INBOX.md "Odoo"), when its form says so (forms.<id>.crm).
// Only after it is stored, and never in the way of it: the visitor's answer depends on the database alone. A push
// that fails is tried again (5, 15, 60, 240, 720 minutes, then daily; given up after 12 tries), the Inbox and Site
// health say "not sent to Odoo", and "Send to Odoo again" tries at once. A lead that went keeps its Odoo id.
//
// Odoo, as the old WordPress theme did it (functions.php odooInsert), over XML-RPC:
//   common.authenticate(db, email, password, {}) -> uid
//   utm.source search [name = <crm.source>]               -> source_id (the first; none: false)
//   res.country search [code = <the visitor's country>]   -> country_id
//   res.country.state search [name = <the visitor's region>] -> state_id
//   crm.lead create {name, contact_name, email_from, phone, mobile_country_code, description, country_id, state_id,
//                    city, url, referred, source_id, landing_url, refering_domain, is_auto_created: true}
// It looks up, never creates, the source, country and state. The theme's file attachment is left out on purpose,
// and so is its search of res.users (its answer was never used).
// The address and sign-in are read from the environment when a push runs (<env>_URL, _DB, _EMAIL, _PASSWORD, and
// _ENABLE=true, the old ODOO_* names by default); they are never logged, audited or kept, and an error that holds
// one has it replaced before it is.
import { nowIso } from '../util.mjs';
import { call } from './xmlrpc.mjs';

const BACKOFF_MIN = [5, 15, 60, 240, 720];
const RETRIES = 12;
const NAME = { odoo: 'Odoo' };

/** The comment as WordPress sent it: tags out, one line, then esc_html (sanitize_text_field + esc_html). */
export function descriptionOf(text) {
  const one = String(text ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return one.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]);
}

/**
 * The lead's fields from a stored message, before the lookups: the PHP's names and values. `place` is
 * {city, region, countryCode} from the city file (forms/submit.mjs), or null.
 */
export function leadOf(form, values, meta, place) {
  const crm = form.crm;
  const v = (k) => (k ? String(values[k] ?? '') : '');
  return {
    name: v(form.name),
    contact_name: v(form.name),
    email_from: v(form.email),
    phone: v(crm.phone),
    // the visitor's country by their address, in capitals, as the theme sent it; nothing found: empty
    mobile_country_code: String(place?.countryCode ?? '').toUpperCase(),
    description: descriptionOf(v(crm.description)),
    city: place?.city ?? '',
    url: meta.page ?? '',
    referred: meta.referrer ?? '',
    landing_url: meta.landing ?? '',
    refering_domain: meta.referringDomain ?? '',
    is_auto_created: true,
  };
}

/** This form's connection from the environment: {on, problem, url, db, email, password}. */
export function settingsOf(crm, env = process.env) {
  const get = (k) => String(env[`${crm.env}_${k}`] ?? '').trim();
  const missing = ['URL', 'DB', 'EMAIL', 'PASSWORD'].filter((k) => !get(k)).map((k) => `${crm.env}_${k}`);
  if (get('ENABLE') !== 'true') return { on: false, problem: `${crm.env}_ENABLE is not "true", so nothing is sent to ${NAME[crm.kind]}.` };
  if (missing.length) return { on: false, problem: `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set, so nothing is sent to ${NAME[crm.kind]}.` };
  let url;
  try {
    url = new URL(get('URL'));
  } catch {
    return { on: false, problem: `${crm.env}_URL is not an address.` };
  }
  const local = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return { on: false, problem: `${crm.env}_URL must be https (http only on this machine).` };
  if (url.username || url.password) return { on: false, problem: `${crm.env}_URL must not hold a sign-in: use ${crm.env}_EMAIL and ${crm.env}_PASSWORD.` };
  return { on: true, problem: null, url: url.origin + url.pathname.replace(/\/+$/, ''), db: get('DB'), email: get('EMAIL'), password: get('PASSWORD') };
}

/** Push one lead to Odoo. Returns its id. Throws with words that hold no secret. */
export async function pushOdoo(s, crm, lead, place, { fetchImpl = fetch } = {}) {
  const common = `${s.url}/xmlrpc/2/common`;
  const object = `${s.url}/xmlrpc/2/object`;
  const uid = await call(common, 'authenticate', [s.db, s.email, s.password, {}], { fetchImpl });
  if (!Number.isInteger(uid) || uid <= 0) throw new Error('Odoo did not accept the sign-in (check the email and password in the environment).');
  const run = (model, method, args) => call(object, 'execute_kw', [s.db, uid, s.password, model, method, args], { fetchImpl });
  const first = async (model, field, value) => {
    if (!value) return false;
    const ids = await run(model, 'search', [[[field, '=', value]]]);
    return Array.isArray(ids) && Number.isInteger(ids[0]) ? ids[0] : false;
  };
  const sourceId = await first('utm.source', 'name', crm.source);
  const countryId = await first('res.country', 'code', place?.countryCode ?? '');
  const stateId = await first('res.country.state', 'name', place?.region ?? '');
  const id = await run('crm.lead', 'create', [{ ...lead, country_id: countryId, state_id: stateId, source_id: sourceId }]);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Odoo did not say which lead it made.');
  return id;
}

export function createCrm(app, { fetchImpl = fetch, env = process.env } = {}) {
  const { db, clock, audit } = app;
  const forms = () => app.config.forms ?? {};
  const busy = new Set();
  const event = (id, change, who = null) => db.prepare('INSERT INTO form_events (message_id, at, by_id, by_name, change) VALUES (?, ?, ?, ?, ?)').run(id, nowIso(clock()), who?.id ?? null, who?.name ?? null, change);

  /** Words with every secret of `s` taken out (an error from far away may quote what it was sent). */
  const scrub = (text, s) => {
    let out = String(text ?? '').slice(0, 1000);
    for (const secret of [s?.password, s?.email, s?.db]) if (secret && secret.length >= 3) out = out.split(secret).join('[hidden]');
    return out.slice(0, 500);
  };

  /** Mark a just-stored message for its form's CRM (no push yet); false when the form has none or it is off. */
  function mark(form, id) {
    // <env>_ENABLE not "true": nothing goes, as in the old theme (ODOO_ENABLE); anything else missing is a failure
    if (!form.crm || String(env[`${form.crm.env}_ENABLE`] ?? '').trim() !== 'true') return false;
    db.prepare("UPDATE form_messages SET crm = 'pending', crm_next_at = NULL WHERE id = ?").run(id);
    return true;
  }

  /** Try one message now. Returns {ok, id?, error?}. `who`: the person who asked (the Inbox), else the server. */
  async function push(id, who = null) {
    if (busy.has(id)) return { ok: false, error: 'It is being sent right now.' };
    const row = db.prepare('SELECT * FROM form_messages WHERE id = ?').get(id);
    if (!row || !row.crm || row.crm === 'sent') return { ok: row?.crm === 'sent', id: row?.crm_id ?? null };
    const form = forms()[row.form];
    if (!form?.crm) return { ok: false, error: 'Its form no longer sends messages to a CRM.' };
    const name = NAME[form.crm.kind];
    const s = settingsOf(form.crm, env);
    busy.add(id);
    try {
      if (!s.on) throw new Error(s.problem);
      const values = JSON.parse(row.fields);
      const meta = JSON.parse(row.meta);
      const place = row.place ? JSON.parse(row.place) : null;
      const leadId = await pushOdoo(s, form.crm, leadOf(form, values, meta, place), place, { fetchImpl });
      const tries = row.crm_tries + 1;
      db.prepare("UPDATE form_messages SET crm = 'sent', crm_id = ?, crm_at = ?, crm_tries = ?, crm_next_at = NULL, crm_error = NULL WHERE id = ?").run(String(leadId), nowIso(clock()), tries, id);
      event(id, `sent to ${name} (lead ${leadId}${tries > 1 ? `, try ${tries}` : ''})`, who);
      return { ok: true, id: String(leadId) };
    } catch (e) {
      const words = scrub(e?.message ?? e, s);
      const tries = row.crm_tries + 1;
      const wait = tries >= RETRIES ? null : (BACKOFF_MIN[tries - 1] ?? 1440) * 60_000;
      db.prepare("UPDATE form_messages SET crm = 'failed', crm_tries = ?, crm_next_at = ?, crm_error = ? WHERE id = ?").run(tries, wait === null ? null : nowIso(clock() + wait), words, id);
      if (row.crm !== 'failed' || who) event(id, `not sent to ${name}: ${words.slice(0, 200)}`, who);
      if (wait === null) event(id, `gave up sending it to ${name} after ${tries} tries ("Send to ${name} again" still works)`);
      return { ok: false, error: words };
    } finally {
      busy.delete(id);
    }
  }

  /** The person's "Send to Odoo again": one try now, audited. */
  async function again(row, ctx) {
    const r = await push(row.id, ctx.user);
    audit.log(ctx, 'inbox.crm', { target: row.id, ok: r.ok, detail: { form: row.form, lead: r.id ?? null } });
    return r;
  }

  /** The pushes that are due (every minute, with the team mails): failed ones whose wait is over, and pending ones. */
  async function retry() {
    const due = db.prepare("SELECT id FROM form_messages WHERE (crm = 'failed' AND crm_next_at IS NOT NULL AND crm_next_at <= ?) OR crm = 'pending' ORDER BY at LIMIT 20").all(nowIso(clock()));
    for (const r of due) await push(r.id);
    return due.length;
  }

  /** Site health: each form that sends to a CRM, whether it can, and how many messages did not go. */
  function status() {
    const list = Object.values(forms()).filter((f) => f.crm).map((f) => {
      const s = settingsOf(f.crm, env);
      return { form: f.id, label: f.label, kind: f.crm.kind, name: NAME[f.crm.kind], on: s.on, problem: s.problem };
    });
    const failed = Number(db.prepare("SELECT COUNT(*) AS n FROM form_messages WHERE crm = 'failed'").get().n);
    return { forms: list, failed };
  }

  return { mark, push, again, retry, status };
}
