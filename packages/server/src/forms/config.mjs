// The site's forms (docs/API-INBOX.md "Forms and the Inbox"): what a visitor may send, what is kept, and the mail it sends. From the
// site's markstage.config `forms`, or config.json `forms` for a site without one; the site's own wins.
//   forms: {
//     contact: {
//       label: 'Contact',
//       fields: { name: { label, type?: 'text'|'email'|'tel'|'textarea'|'url', required?, min?, max?, options? } },
//       name: 'name', email: 'email',          the fields that are the sender's name and address
//       service: 'service_type',               the field the Inbox filters by (what was asked about)
//       meta: { page: 'pageUrl', referrer: 'referrerURL', utmSource: 'u_source', … },   visitor context
//       honeypot: 'hp_website', started: 'started', minSeconds: 3,
//       perDay: 3, limitMessage: '…', message: '…', thanks: '/thank-you/',
//       reply: { subject, text },              the thank-you mail to the visitor ({name}, {siteName}); none if absent
//       team: { subject },                     the team mail's subject ({name}, {form}, {siteName})
//       keepDays: 1095,                         opt-in: messages older than this are deleted (none: kept forever)
//       crm: { kind: 'odoo', env: 'ODOO', source: 'Example Website', phone: 'number', description: 'comment' },
//                                           opt-in: each message also goes to Odoo as a lead (forms/crm.mjs); its
//                                           address and sign-in come from the environment (<env>_URL, _DB, _EMAIL,
//                                           _PASSWORD, and _ENABLE=true), never from a file in the repo
//       leads: { kind: 'skald', url: 'https://app.skaldanalytics.com/traffic-hooks/<site>/lead', action: 'contact',
//                env: 'SKALD_LEAD', vid: 'skald_vid', test: 'skald_test' },
//                                           opt-in: each real message also goes to an analytics tool as a lead
//                                           (forms/leads.mjs), signed with <env>_SECRET from the environment; vid and
//                                           test name posted values (the visitor id the page sends, and "1" for a
//                                           team's own test lead)
//     },
//   }
const FORM_ID = /^[a-z][a-z0-9-]{0,39}$/;
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const TYPES = ['text', 'email', 'tel', 'textarea', 'url'];
export const META = ['page', 'referrer', 'landing', 'referringDomain', 'utmSource', 'utmMedium', 'utmCampaign'];
const LIMIT = "You've already submitted a request today. Please try again tomorrow.";
const ENV_PREFIX = /^[A-Z][A-Z0-9_]{0,30}$/;

/** forms.<id>.crm: where its messages go as leads (Odoo only for now). The secrets are named here, never given. */
function crmOf(c, where, has, fields, fail) {
  if (c === undefined || c === null) return null;
  if (typeof c !== 'object' || Array.isArray(c)) fail(`${where}.crm must be an object: { kind: 'odoo', source }.`);
  const known = ['kind', 'env', 'source', 'phone', 'description'];
  for (const k of Object.keys(c)) if (!known.includes(k)) fail(`${where}.crm.${k}: unknown (${known.join(', ')}). The address and sign-in come from the environment.`);
  if (c.kind !== 'odoo') fail(`${where}.crm.kind must be 'odoo'.`);
  const env = c.env ?? 'ODOO';
  if (typeof env !== 'string' || !ENV_PREFIX.test(env)) fail(`${where}.crm.env must be the prefix of the environment variables (capitals, digits and _), e.g. "ODOO" for ODOO_URL.`);
  const source = text(c.source, `${where}.crm.source`, fail, 100);
  const field = (k, dflt) => {
    const v = c[k] === undefined ? dflt : c[k];
    if (v !== null && (typeof v !== 'string' || !has(v))) fail(`${where}.crm.${k}: "${v}" is not one of its fields.`);
    return v;
  };
  return {
    kind: 'odoo',
    env,
    source,
    phone: field('phone', has('phone') ? 'phone' : has('number') ? 'number' : null),
    description: field('description', fields.find((f) => f.type === 'textarea')?.key ?? null),
  };
}

/** forms.<id>.leads: where its real messages go as leads for analytics (Skald only for now). No secret here. */
function leadsOf(c, where, has, fail) {
  if (c === undefined || c === null) return null;
  if (typeof c !== 'object' || Array.isArray(c)) fail(`${where}.leads must be an object: { kind: 'skald', url }.`);
  const known = ['kind', 'url', 'action', 'env', 'vid', 'test'];
  for (const k of Object.keys(c)) if (!known.includes(k)) fail(`${where}.leads.${k}: unknown (${known.join(', ')}). The secret comes from the environment.`);
  if (c.kind !== 'skald') fail(`${where}.leads.kind must be 'skald'.`);
  let url;
  try {
    url = new URL(String(c.url ?? ''));
  } catch {
    fail(`${where}.leads.url must be the lead hook's address.`);
  }
  const local = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) fail(`${where}.leads.url must be https (http only on this machine).`);
  if (url.username || url.password || url.search) fail(`${where}.leads.url must be a plain address: the secret comes from the environment.`);
  const action = c.action ?? 'contact';
  if (typeof action !== 'string' || !/^[a-z][a-z0-9_-]{0,19}$/.test(action)) fail(`${where}.leads.action must be a short lowercase word, e.g. "contact".`);
  const env = c.env ?? 'SKALD_LEAD';
  if (typeof env !== 'string' || !ENV_PREFIX.test(env)) fail(`${where}.leads.env must be the prefix of the environment variable (capitals, digits and _), e.g. "SKALD_LEAD" for SKALD_LEAD_SECRET.`);
  const posted = (k) => {
    const v = c[k] ?? null;
    if (v !== null && (typeof v !== 'string' || !KEY.test(v) || has(v))) fail(`${where}.leads.${k} must be the name of a posted value that is not a field.`);
    return v;
  };
  return { kind: 'skald', url: url.href, action, env, vid: posted('vid'), test: posted('test') };
}

const text = (v, what, fail, max = 2000) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) fail(`${what} must be text (at most ${max} characters).`);
  return v;
};

function fieldOf(key, f, where, fail) {
  if (!KEY.test(key)) fail(`${where}: "${key}" is not a field name (letters, digits and _).`);
  if (!f || typeof f !== 'object' || Array.isArray(f)) fail(`${where}.${key} must be an object: { label, type, required }.`);
  const type = f.type ?? (key === 'email' ? 'email' : 'text');
  if (!TYPES.includes(type)) fail(`${where}.${key}.type must be one of ${TYPES.join(', ')}.`);
  const max = f.max ?? (type === 'textarea' ? 5000 : 200);
  const min = f.min ?? 0;
  if (!Number.isInteger(max) || max < 1 || max > 20000) fail(`${where}.${key}.max must be a length from 1 to 20000.`);
  if (!Number.isInteger(min) || min < 0 || min > max) fail(`${where}.${key}.min must be a length up to max.`);
  const options = f.options ?? null;
  if (options !== null && (!Array.isArray(options) || options.some((o) => typeof o !== 'string'))) fail(`${where}.${key}.options must be a list of the values allowed.`);
  return { key, label: f.label === undefined ? key : text(f.label, `${where}.${key}.label`, fail, 80), type, required: f.required === true, min, max, options };
}

function formOf(id, f, fail) {
  const where = `forms.${id}`;
  if (!FORM_ID.test(id)) fail(`forms: "${id}" is not a form id (lowercase letters, digits and dashes).`);
  if (!f || typeof f !== 'object' || Array.isArray(f)) fail(`${where} must be an object: { label, fields }.`);
  if (!f.fields || typeof f.fields !== 'object' || !Object.keys(f.fields).length) fail(`${where}.fields must name at least one field.`);
  const fields = Object.entries(f.fields).map(([k, v]) => fieldOf(k, v, `${where}.fields`, fail));
  const has = (k) => fields.some((x) => x.key === k);
  const pick = (k, dflt) => {
    const v = f[k] ?? (has(dflt) ? dflt : null);
    if (v !== null && !has(v)) fail(`${where}.${k}: "${v}" is not one of its fields.`);
    return v;
  };
  const meta = {};
  for (const [k, v] of Object.entries(f.meta ?? {})) {
    if (!META.includes(k)) fail(`${where}.meta.${k}: unknown (${META.join(', ')}).`);
    if (typeof v !== 'string' || !KEY.test(v)) fail(`${where}.meta.${k} must be the name of the posted value.`);
    meta[k] = v;
  }
  const num = (k, dflt, lo, hi) => {
    const v = f[k] ?? dflt;
    if (!Number.isInteger(v) || v < lo || v > hi) fail(`${where}.${k} must be a whole number from ${lo} to ${hi}.`);
    return v;
  };
  const extra = (k) => {
    const v = f[k] ?? null;
    if (v !== null && (typeof v !== 'string' || !KEY.test(v) || has(v))) fail(`${where}.${k} must be the name of a posted value that is not a field.`);
    return v;
  };
  const thanks = f.thanks ?? null;
  if (thanks !== null && (typeof thanks !== 'string' || !/^\/[A-Za-z0-9/_.~-]*$/.test(thanks))) fail(`${where}.thanks must be a path on the site, e.g. "/thank-you/".`);
  let reply = null;
  if (f.reply !== undefined && f.reply !== null) {
    if (!pick('email', 'email')) fail(`${where}.reply needs an email field to answer to.`);
    reply = { subject: text(f.reply.subject, `${where}.reply.subject`, fail, 200), text: text(f.reply.text, `${where}.reply.text`, fail, 10000) };
  }
  const label = f.label === undefined ? id : text(f.label, `${where}.label`, fail, 80);
  return {
    id,
    label,
    fields,
    name: pick('name', 'name'),
    email: pick('email', 'email'),
    service: f.service !== undefined ? pick('service', null) : has('service') ? 'service' : has('service_type') ? 'service_type' : null,
    meta,
    honeypot: extra('honeypot'),
    started: extra('started'),
    minSeconds: num('minSeconds', 3, 0, 600),
    perDay: num('perDay', 3, 1, 1000),
    perHour: num('perHour', 300, 10, 100000),
    limitMessage: f.limitMessage === undefined ? LIMIT : text(f.limitMessage, `${where}.limitMessage`, fail, 300),
    message: f.message === undefined ? 'Thank you. Your message was sent.' : text(f.message, `${where}.message`, fail, 300),
    thanks,
    reply,
    team: { subject: f.team?.subject === undefined ? '{siteName}: a message from {name} ({form})' : text(f.team.subject, `${where}.team.subject`, fail, 200) },
    keepDays: f.keepDays === undefined || f.keepDays === null ? null : num('keepDays', null, 1, 36500),
    crm: crmOf(f.crm, where, has, fields, fail),
    leads: leadsOf(f.leads, where, has, fail),
  };
}

/** Check `forms`; `fail(message)` throws the config error. Returns a frozen map id -> form, or null. */
export function formsOf(raw, fail) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) fail('forms must be an object: { <id>: { label, fields } }.');
  const out = {};
  for (const [id, f] of Object.entries(raw)) out[id] = Object.freeze(formOf(id, f, fail));
  return Object.keys(out).length ? Object.freeze(out) : null;
}
