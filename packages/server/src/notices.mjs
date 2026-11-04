// Notices (docs/OPERATIONS.md "A publish failed"): something a person must hear about even when they were not
// watching, kept until they mark it seen. A failed publish goes to who started it; what the scheduler does (a
// scheduled entry held back by the publish rules, a late run after the server was down, giving up after three tries)
// goes to every editor and above. Who exactly, and by which channel, is the alert rules' and each person's choice
// (notify/rules.mjs): always the editor, and email (now or in a daily digest), Slack and a webhook (config `notify`).
//   GET  /notices            mine, not seen yet, newest first
//   POST /notices/:id/seen   one
//   POST /notices/seen       all of mine
import { atLeast } from './roles.mjs';
import { newId, notFound, nowIso } from './util.mjs';

const MAX_OPEN = 50;
// the kind shown as one line however many there are (every new browser is one)
const GROUPED = 'signin.new-device';

export function createNotices(app) {
  const { db, clock } = app;
  /**
   * Tell people, as the alert rules say (notify/rules.mjs): the kind's roles and people, plus `to` when it names the
   * people it is about (user ids); 'editors' or 'administrators' leave it to the rules (a kind without rules: that
   * group). Each person gets it as they chose (My alerts). `link`: a hash in the editor (#/jobs/j_…). `mail`:
   * {subject, text, replyTo} for the email instead of the notice's own words (a form message's team mail). `onSent`:
   * called with what each channel answered ([{channel, ok, detail}]). Returns how many notices were written.
   */
  function tell({ kind, level = 'error', text, link = null, to, mail = null, onSent = null, editorOnly = false }) {
    const at = nowIso(clock());
    const rule = app.alertRules?.ruleOf(kind) ?? null;
    // the people it is about (who started the job, whose role changed); a group ('editors') is the rules' roles
    const natural = Array.isArray(to) ? [...new Set(to.filter(Boolean))] : [];
    let reach;
    if (rule) {
      if (!rule.on) {
        onSent?.([]);
        return 0;
      }
      reach = app.alertRules.audience(rule, natural);
    } else {
      const group = { editors: 'editor', administrators: 'administrator' }[to];
      reach = app.users.list().filter((u) => !u.disabled && (group ? atLeast(u, group) : natural.includes(u.id)));
    }
    const insert = db.prepare('INSERT INTO notices (id, user_id, at, kind, level, text, link) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const emails = [];
    // outside production with mail 'actor', mail reaches only the people the alert is about (env/config.mjs)
    const actorOnly = app.config.environment?.mail === 'actor';
    const mayMail = (u) => !actorOnly || natural.includes(u.id);
    // editorOnly: shown in the editor and nowhere else (a test form outside production)
    const mailed = !editorOnly && Boolean(rule?.channels.includes('email'));
    let told = 0;
    for (const u of reach) {
      const how = rule ? app.alertRules.deliveryOf(u, kind) : 'editor';
      if (how === 'off') continue;
      // the editor always shows it; mail as the person chose
      insert.run(newId('n'), u.id, at, kind, level, text, link);
      told++;
      if (mailed && how === 'now' && mayMail(u)) emails.push(u.email);
      if (mailed && how === 'digest' && mayMail(u)) app.alertRules.queue(u, { kind, text, link, at });
    }
    if (mailed && !actorOnly) emails.push(...rule.addresses);
    const sent = editorOnly ? [] : app.alerts?.send({ kind, level, text, link, at, mail }, rule ? { emails, slack: rule.channels.includes('slack'), webhook: rule.channels.includes('webhook') } : null);
    if (onSent) void Promise.resolve(sent ?? []).then(onSent, () => onSent([{ channel: 'email', ok: false, detail: 'the alert could not be sent' }]));
    return told;
  }

  /** Who a kind is mailed to at once now (the rule's people who chose `now`, and its addresses): for a retry. */
  function mailTo(kind) {
    const rule = app.alertRules?.ruleOf(kind);
    if (!rule?.on || !rule.channels.includes('email')) return [];
    const now = app.alertRules.audience(rule).filter((u) => app.alertRules.deliveryOf(u, kind) === 'now').map((u) => u.email);
    return [...new Set([...now, ...rule.addresses])];
  }

  const toPublic = (r) => ({ id: r.id, at: r.at, kind: r.kind, level: r.level, text: r.text, link: r.link });

  function routes(router) {
    // new-device sign-ins (QA F27): however many, one line in the editor (the newest, with how many more), and
    // marking it seen marks them all
    router.add('GET', '/notices', (ctx) => {
      const rows = db.prepare('SELECT * FROM notices WHERE user_id = ? AND seen_at IS NULL ORDER BY at DESC, rowid DESC LIMIT ?').all(ctx.user.id, MAX_OPEN);
      const devices = rows.filter((r) => r.kind === GROUPED);
      const items = rows.filter((r) => r.kind !== GROUPED || r === devices[0]).map(toPublic);
      if (devices.length > 1) {
        const first = items.find((n) => n.kind === GROUPED);
        // the time as ISO: the editor shows it in the reader's own zone (QA N13)
        first.text = `${first.text} (${devices.length} new devices since ${devices[devices.length - 1].at.replace(/\.\d{3}Z$/, 'Z')}; Seen clears them all.)`;
        first.count = devices.length;
      }
      return { items };
    });
    router.add('POST', '/notices/seen', (ctx) => {
      const r = db.prepare('UPDATE notices SET seen_at = ? WHERE user_id = ? AND seen_at IS NULL').run(nowIso(clock()), ctx.user.id);
      return { ok: true, seen: Number(r.changes) };
    });
    router.add('POST', '/notices/:nid/seen', (ctx) => {
      const row = db.prepare('SELECT kind FROM notices WHERE id = ? AND user_id = ?').get(ctx.params.nid, ctx.user.id);
      if (!row) throw notFound('No such notice.');
      const r = row.kind === GROUPED
        ? db.prepare('UPDATE notices SET seen_at = COALESCE(seen_at, ?) WHERE user_id = ? AND kind = ? AND seen_at IS NULL').run(nowIso(clock()), ctx.user.id, GROUPED)
        : db.prepare('UPDATE notices SET seen_at = COALESCE(seen_at, ?) WHERE id = ? AND user_id = ?').run(nowIso(clock()), ctx.params.nid, ctx.user.id);
      return { ok: true, seen: Number(r.changes) };
    });
  }

  return { tell, mailTo, routes };
}
