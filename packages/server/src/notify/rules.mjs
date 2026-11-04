// Who hears about what (docs/API-INBOX.md "Alerts"). The site's rules (Settings → Alerts, owner and administrator) say for
// each kind whether it is on, which roles and people it reaches, extra addresses (a sales inbox), and the channels it
// leaves by (email, Slack, webhook; the editor always shows it); plus the name mail is sent under. They are kept in
// <dataDir>/alert-rules.json (addresses are people's: never in the repo). Each person then chooses, per kind that can
// reach them (My alerts), on or off and how: mail at once, a daily digest, or only in the editor. Safety alerts can't
// be turned off and always come by mail. Every change is audited.
//   GET /site/alerts  {version, channels, kinds: [{kind, label, group, safety, on, roles, users, extra, channels}], people, digestHour}
//   PUT /site/alerts  {version, senderName?, kinds: [{kind, on, roles, userIds, extra, channels}]}
//   GET /me/alerts    {version, digestHour, kinds: [{kind, label, group, on, delivery, locked}]}
//   PUT /me/alerts    {version?, kinds: [{kind, on, delivery}]}
import fs from 'node:fs';
import path from 'node:path';
import { ROLES, atLeast, can } from '../roles.mjs';
import { HttpError, badRequest, forbidden, sha256 } from '../util.mjs';
import { CHANNELS, DELIVERIES, KIND, KINDS } from './kinds.mjs';
import { addressOf } from './smtp.mjs';

const EMAIL = /^[^\s<>@,;"]+@[^\s<>@,;"]+\.[^\s<>@,;"]+$/;
const DIGEST_EVERY_MS = 5 * 60_000;

export function createAlertRules(app) {
  const { db, config, audit, clock } = app;
  const file = path.join(config.dataDir, 'alert-rules.json');
  const n = config.notify;
  // who got alert mail before there were rules (notify.email.roles) gets it by mail; everyone else in the editor
  const mailRoles = n?.email?.roles ?? ['owner', 'administrator'];
  const digestHour = n?.digestHour ?? 8;
  const configName = n?.email ? /^(.*?)\s*<[^<>]+>\s*$/.exec(n.email.from)?.[1]?.replace(/^"|"$/g, '') || null : null;

  const defaults = (k) => ({ on: true, roles: [...k.roles], people: [], addresses: k.personal ? [] : [...(n?.email?.to ?? [])], channels: [...CHANNELS] });

  /** The stored file: {senderName, kinds: {<kind>: rule}} (the first shape, the kinds alone, is read too). */
  function stored() {
    let text = null;
    let raw = {};
    try {
      text = fs.readFileSync(file, 'utf8');
      raw = JSON.parse(text);
    } catch (e) {
      if (e.code !== 'ENOENT') console.error(`[markstage] ${file}: ${e.message}; the default alert rules apply`);
    }
    const kinds = raw.kinds && typeof raw.kinds === 'object' ? raw.kinds : Object.fromEntries(Object.entries(raw).filter(([k]) => KIND.has(k)));
    return { text, senderName: typeof raw.senderName === 'string' ? raw.senderName : null, kinds };
  }
  const versionOf = (text) => (text ? sha256(text).slice(0, 16) : 'default');

  /** The rule for a kind (the stored one over the defaults); null for a kind this server does not know. */
  function ruleOf(kind, kinds = stored().kinds) {
    const k = KIND.get(kind);
    if (!k) return null;
    const s = kinds[kind] ?? {};
    // channels were once {editor, email, slack, webhook}: read either
    const ch = Array.isArray(s.channels) ? s.channels : s.channels && typeof s.channels === 'object' ? CHANNELS.filter((c) => s.channels[c] !== false) : null;
    const r = { ...defaults(k), ...s, channels: (ch ?? CHANNELS).filter((c) => CHANNELS.includes(c)) };
    // a safety alert stays on and goes by mail, whatever a hand-edited file says
    if (k.safety) Object.assign(r, { on: true, channels: [...new Set(['email', ...r.channels])] });
    return r;
  }

  /** The name mail is sent under: Settings → Alerts, else the name in notify.email.from. */
  const senderName = () => stored().senderName || configName;

  /** How this person gets this kind: 'now' | 'digest' | 'editor' | 'off'. */
  function deliveryOf(user, kind) {
    const k = KIND.get(kind);
    const own = db.prepare('SELECT delivery, enabled FROM alert_prefs WHERE user_id = ? AND kind = ?').get(user.id, kind);
    const fallback = k?.safety || mailRoles.includes(user.role) ? 'now' : 'editor';
    if (k?.safety) return own && ['now', 'digest'].includes(own.delivery) ? own.delivery : 'now';
    if (own && (!own.enabled || own.delivery === 'off')) return 'off';
    return own && DELIVERIES.includes(own.delivery) ? own.delivery : fallback;
  }

  /** The active users a rule reaches: the people it is about (`natural` ids), its roles and its people. */
  function audience(rule, natural = []) {
    const roles = new Set(rule.roles);
    const people = new Set([...natural, ...rule.people]);
    return app.users.list().filter((u) => !u.disabled && (people.has(u.id) || roles.has(u.role)));
  }

  /** May this kind reach this person at all (so My alerts lists it)? */
  function mayReach(user, k, r) {
    return r.on && (r.roles.includes(user.role) || r.people.includes(user.id) || Boolean(k.about && atLeast(user, k.about)));
  }

  function checkSite(body, before) {
    const list = body?.kinds;
    if (!Array.isArray(list)) throw badRequest('kinds must be a list: [{kind, on, roles, userIds, extra, channels}].');
    const users = new Map(app.users.list().map((u) => [u.id, u]));
    const out = { ...before };
    for (const r of list) {
      const k = KIND.get(r?.kind);
      if (!k) throw badRequest(`Alerts: "${r?.kind}" is not a kind of alert.`);
      const next = ruleOf(k.kind, out);
      if (r.on !== undefined) {
        if (typeof r.on !== 'boolean') throw badRequest(`Alerts: ${k.label}: on must be true or false.`);
        if (k.safety && !r.on) throw badRequest(`Alerts: “${k.label}” is a safety alert and can't be turned off.`);
        next.on = r.on;
      }
      if (r.roles !== undefined) {
        if (!Array.isArray(r.roles) || r.roles.some((x) => !ROLES.includes(x))) throw badRequest(`Alerts: ${k.label}: roles must be a list of roles (${ROLES.join(', ')}).`);
        next.roles = ROLES.filter((x) => r.roles.includes(x));
      }
      const ids = r.userIds ?? r.people;
      if (ids !== undefined) {
        if (!Array.isArray(ids) || ids.some((x) => !users.has(x))) throw badRequest(`Alerts: ${k.label}: the people must be users of this site.`);
        next.people = [...new Set(ids)];
      }
      const extra = r.extra ?? r.addresses;
      if (extra !== undefined) {
        const list2 = Array.isArray(extra) ? extra.map((a) => (typeof a === 'string' ? a.trim().toLowerCase() : a)).filter((a) => a !== '') : null;
        if (!list2 || list2.length > 20 || list2.some((a) => typeof a !== 'string' || a.length > 254 || !EMAIL.test(a))) throw badRequest(`Alerts: ${k.label}: other addresses must be up to 20 email addresses${list2?.find((a) => typeof a === 'string' && !EMAIL.test(a)) ? ` (“${list2.find((a) => !EMAIL.test(a))}” is not one)` : ''}.`);
        next.addresses = [...new Set(list2)];
      }
      if (r.channels !== undefined) {
        if (!Array.isArray(r.channels) || r.channels.some((c) => !CHANNELS.includes(c))) throw badRequest(`Alerts: ${k.label}: channels are a list of ${CHANNELS.join(', ')}.`);
        if (k.safety && !r.channels.includes('email')) throw badRequest(`Alerts: “${k.label}” is a safety alert: it always goes by email.`);
        next.channels = CHANNELS.filter((c) => r.channels.includes(c));
      }
      out[k.kind] = next;
    }
    return out;
  }

  /** The last send through each channel (kept by notify/send.mjs): {status: 'ok'|'error', detail, at} or nothing. */
  const lastOf = (c) => JSON.parse(db.prepare('SELECT value FROM kv WHERE key = ?').get(`alerts.channel.${c}`)?.value ?? 'null');
  const note = (c, ok, detail) => db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(`alerts.channel.${c}`, JSON.stringify({ status: ok ? 'ok' : 'error', detail, at: new Date(clock()).toISOString() }));
  const hostOf = (u) => {
    try {
      return new URL(u).host;
    } catch {
      return null;
    }
  };

  function channelsView() {
    const last = (c) => {
      const l = lastOf(c);
      return l ? { status: l.status, detail: l.detail, lastAt: l.at } : { status: null, detail: null, lastAt: null };
    };
    return {
      email: n?.email ? { on: true, from: addressOf(n.email.from), senderName: senderName(), host: n.email.host, ...last('email') } : { on: false },
      slack: n?.slack ? { on: true, host: hostOf(n.slack), ...last('slack') } : { on: false },
      webhook: n?.webhook ? { on: true, host: hostOf(n.webhook), ...last('webhook') } : { on: false },
    };
  }

  function siteView() {
    const { text, kinds } = stored();
    const users = app.users.list().filter((u) => !u.disabled);
    const name = (id) => users.find((u) => u.id === id)?.name ?? null;
    return {
      version: versionOf(text),
      channels: channelsView(),
      digestHour,
      kinds: KINDS.map((k) => {
        const r = ruleOf(k.kind, kinds);
        return { kind: k.kind, label: k.label, group: k.group, safety: k.safety, on: r.on, roles: r.roles, users: r.people.map((id) => ({ id, name: name(id) })).filter((u) => u.name), extra: r.addresses, channels: r.channels };
      }),
      people: users.map((u) => ({ id: u.id, name: u.name, role: u.role })),
    };
  }

  const myVersion = (user) => sha256(JSON.stringify(db.prepare('SELECT kind, delivery, enabled FROM alert_prefs WHERE user_id = ? ORDER BY kind').all(user.id))).slice(0, 16);

  function myView(user) {
    const { kinds } = stored();
    return {
      version: myVersion(user),
      digestHour,
      kinds: KINDS.filter((k) => mayReach(user, k, ruleOf(k.kind, kinds))).map((k) => {
        const d = deliveryOf(user, k.kind);
        const own = db.prepare('SELECT delivery FROM alert_prefs WHERE user_id = ? AND kind = ?').get(user.id, k.kind)?.delivery;
        // off keeps the way it came before, for when it is turned on again
        const delivery = d === 'off' ? (DELIVERIES.includes(own) ? own : mailRoles.includes(user.role) ? 'now' : 'editor') : d;
        return { kind: k.kind, label: k.label, group: k.group, on: d !== 'off', delivery, locked: k.safety };
      }),
    };
  }

  // ---- the daily digest: alerts a person chose to get once a day, in one mail at digestHour (server time)
  const queue = (user, a) => db.prepare('INSERT INTO alert_digest (user_id, at, kind, text, link) VALUES (?, ?, ?, ?, ?)').run(user.id, a.at, a.kind, a.text, a.link ?? null);

  /** Send every digest that is due (once a day per person, at or after digestHour). Returns how many went. */
  async function sendDigests() {
    const now = new Date(clock());
    if (now.getHours() < digestHour) return 0;
    const today = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    let sent = 0;
    for (const { user_id: uid } of db.prepare('SELECT DISTINCT user_id FROM alert_digest').all()) {
      const key = `alerts.digest.${uid}`;
      if (db.prepare('SELECT value FROM kv WHERE key = ?').get(key)?.value === today) continue;
      const user = app.users.get(uid);
      const items = db.prepare('SELECT * FROM alert_digest WHERE user_id = ? ORDER BY id').all(uid);
      if (user && !user.disabled && items.length) {
        const r = await app.alerts.digest(user, items);
        if (!r.ok) continue;
        sent++;
      }
      db.prepare('DELETE FROM alert_digest WHERE user_id = ? AND id <= ?').run(uid, items.at(-1)?.id ?? 0);
      db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, today);
    }
    return sent;
  }
  let timer = null;
  const start = () => {
    timer ??= setInterval(() => void sendDigests().catch((e) => console.error(`[markstage] alert digest: ${e.message}`)), DIGEST_EVERY_MS);
    timer.unref?.();
  };
  const stop = () => {
    clearInterval(timer);
    timer = null;
  };

  function routes(router) {
    router.add('GET', '/site/alerts', (ctx) => {
      if (!atLeast(ctx.user, 'editor')) throw forbidden("Only editors and above can see the site's alert rules.");
      return siteView();
    });
    router.add('PUT', '/site/alerts', (ctx) => {
      if (!can(ctx.user, 'site.alerts')) throw forbidden("Only an owner or administrator can change the site's alert rules.");
      const cur = stored();
      if (ctx.body.version !== versionOf(cur.text)) throw new HttpError(409, 'stale', 'The alert rules changed since you opened them. Here they are as they are now.', { current: siteView() });
      let name = cur.senderName;
      if (ctx.body.senderName !== undefined) {
        const s = ctx.body.senderName === null ? '' : String(ctx.body.senderName).trim();
        if (s.length > 80 || /[<>@\r\n",;:\\]/.test(s)) throw badRequest('The sender name is a plain name of at most 80 characters (no <, >, @, quotes, commas, colons or semicolons).');
        name = s && s !== configName ? s : null;
      }
      const next = checkSite(ctx.body, cur.kinds);
      const changed = (ctx.body.kinds ?? []).map((r) => r.kind).filter((k) => JSON.stringify(ruleOf(k, cur.kinds)) !== JSON.stringify(next[k]));
      const nameChanged = name !== cur.senderName;
      if (changed.length || nameChanged) {
        const doc = { ...(name ? { senderName: name } : {}), kinds: Object.fromEntries(Object.keys(next).sort().map((k) => [k, next[k]])) };
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
        fs.renameSync(tmp, file);
        audit.log(ctx, 'site.alerts', { target: 'alerts', detail: { changed: changed.map((k) => ({ kind: k, from: ruleOf(k, cur.kinds), to: next[k] })), ...(nameChanged ? { senderName: { from: cur.senderName, to: name } } : {}) } });
      }
      return { ...siteView(), changed: [...changed, ...(nameChanged ? ['senderName'] : [])] };
    });
    router.add('GET', '/me/alerts', (ctx) => myView(ctx.user));
    router.add('PUT', '/me/alerts', (ctx) => {
      if (ctx.body.version !== undefined && ctx.body.version !== myVersion(ctx.user)) throw new HttpError(409, 'stale', 'Your alert choices changed in another window. Here they are as they are now.', { current: myView(ctx.user) });
      const list = ctx.body.kinds;
      if (!Array.isArray(list)) throw badRequest('kinds must be a list: [{kind, on, delivery}].');
      const changes = [];
      for (const r of list) {
        const k = KIND.get(r?.kind);
        if (!k) throw badRequest(`"${r?.kind}" is not a kind of alert.`);
        const was = deliveryOf(ctx.user, k.kind);
        const on = r.on ?? was !== 'off';
        const delivery = r.delivery ?? (was === 'off' ? 'editor' : was);
        if (typeof on !== 'boolean') throw badRequest(`${k.label}: on must be true or false.`);
        if (!DELIVERIES.includes(delivery)) throw badRequest(`${k.label}: choose email at once (now), a daily digest (digest) or only in Markstage (editor).`);
        if (k.safety && !on) throw badRequest(`“${k.label}” is a safety alert and can't be turned off.`);
        if (k.safety && delivery === 'editor') throw badRequest(`“${k.label}” is a safety alert: it comes by email, at once or in the daily digest.`);
        const to = on ? delivery : 'off';
        if (was !== to) changes.push({ kind: k.kind, from: was, to, delivery, on });
      }
      const put = db.prepare('INSERT INTO alert_prefs (user_id, kind, delivery, enabled) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, kind) DO UPDATE SET delivery = excluded.delivery, enabled = excluded.enabled');
      for (const c of changes) put.run(ctx.user.id, c.kind, c.delivery, c.on ? 1 : 0);
      if (changes.length) audit.log(ctx, 'me.alerts', { target: ctx.user.id, detail: { changes: changes.map(({ kind, from, to }) => ({ kind, from, to })) } });
      return { ...myView(ctx.user), changed: changes.map((c) => c.kind) };
    });
  }

  return { ruleOf, deliveryOf, audience, queue, sendDigests, senderName, note, start, stop, routes };
}
