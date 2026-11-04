// The Inbox (docs/API-INBOX.md "Forms and the Inbox"): every message visitors sent through the site's forms, and the
// viewer's own alerts, in one list (editor and above). A message is handled or spam, given to a person, and gets notes
// for the team; each change is checked against its version (409 when someone changed it meanwhile) and kept in its
// history. An alert is the viewer's notice: handled = seen. Owners and administrators also delete, export and see the
// visitor's address and browser. Every change is audited, never with the message's words.
//   GET    /inbox?q=&kind=message|alert&status=new|handled|spam&form=&service=&assignee=<uid>|none&alert=failed&crm=failed&from=&to=&page=
//   GET    /inbox/:mid                   one, with its fields, where it came from, notes, history and version
//   PATCH  /inbox/:mid {status?, assigneeId?, version}
//   POST   /inbox/:mid/notes {text}
//   POST   /inbox/:mid/crm                "Send to Odoo again": one try now (a message whose form sends to a CRM)
//   DELETE /inbox/:mid                   owner, administrator (a message)
//   GET    /inbox.csv?…the same filters  owner, administrator (messages)
import { cell } from '../health.mjs';
import { can } from '../roles.mjs';
import { HttpError, badRequest, forbidden, newId, notFound, nowIso } from '../util.mjs';
import { META } from './config.mjs';

// 'held': a real message kept back while its form is past its hourly cap (forms/submit.mjs); it goes out on its own
export const STATUSES = ['new', 'handled', 'spam', 'held'];
const PAGE = 50;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const parse = (s) => {
  try {
    return JSON.parse(s) ?? {};
  } catch {
    return {};
  }
};
const like = (text) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
// 'read' and 'archived' (the first Inbox) are handled
const LEGACY = "('read', 'archived')";
const statusOf = (s) => (s === 'read' || s === 'archived' ? 'handled' : s);
const CRM_NAME = { odoo: 'Odoo' };
const STATUS_WORDS = { new: 'marked it as new', handled: 'marked it handled', spam: 'marked it as spam' };
const SETTABLE = ['new', 'handled', 'spam'];

export function inboxRoutes(router, app) {
  const { db, audit, clock } = app;
  const formsOf = () => app.config.forms ?? {};
  const read = (ctx) => {
    if (!can(ctx.user, 'inbox.read')) throw forbidden('The Inbox is for editors, administrators and the owner.');
  };
  const manage = (ctx, what) => {
    if (!can(ctx.user, 'inbox.manage')) throw forbidden(`Only an owner or administrator can ${what}.`);
  };
  const person = (id) => {
    const u = id ? app.users.get(id) : null;
    return u ? { id: u.id, name: u.name } : null;
  };

  /** The words a list shows for a message: the form's first long field (or the first with a value). */
  function summaryOf(form, fields) {
    const keys = form ? [...form.fields.filter((f) => f.type === 'textarea'), ...form.fields].map((f) => f.key) : Object.keys(fields);
    const v = keys.map((k) => fields[k]).find((x) => typeof x === 'string' && x.trim()) ?? '';
    return v.replace(/\s+/g, ' ').trim().slice(0, 140);
  }

  /** The filters as SQL for messages (m) and for the viewer's alerts (a); either may be null (none of that kind). */
  function filtersOf(q, uid) {
    const get = (k) => (q.get(k) ?? '').trim();
    const kind = get('kind');
    if (kind && !['message', 'alert'].includes(kind)) throw badRequest('kind must be message or alert (or empty for both).');
    const status = get('status');
    if (status && !STATUSES.includes(status)) throw badRequest(`That is not a message status. Filter by ${STATUSES.join(', ')}, or leave it empty for any.`);
    const from = get('from');
    const to = get('to');
    if ((from && !DATE.test(from)) || (to && !DATE.test(to))) throw badRequest('from and to are dates, like 2026-10-28.');
    const m = { sql: [], args: [] };
    // a sign-in from a new device is the person's own account news: in the bar and under Alerts, not among the
    // messages (QA F27); the list of everything leaves it out
    const a = { sql: ['user_id = ?', "kind != 'form.message'", ...(kind === 'alert' ? [] : ["kind != 'signin.new-device'"])], args: [uid] };
    const both = (sql, ...args) => {
      m.sql.push(sql);
      m.args.push(...args);
      a.sql.push(sql);
      a.args.push(...args);
    };
    if (from) both('at >= ?', `${from}T00:00:00.000Z`);
    if (to) both('at < ?', new Date(Date.parse(`${to}T00:00:00.000Z`) + 86_400_000).toISOString());
    // spam stays out unless asked for
    if (status === 'handled') m.sql.push(`status IN ('handled', ${LEGACY.slice(1, -1)})`);
    else if (status) m.sql.push('status = ?'), m.args.push(status);
    else m.sql.push("status != 'spam'");
    if (status === 'new') a.sql.push('seen_at IS NULL');
    if (status === 'handled') a.sql.push('seen_at IS NOT NULL');
    const text = get('q').slice(0, 200);
    if (text) {
      m.sql.push("(name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR fields LIKE ? ESCAPE '\\' OR meta LIKE ? ESCAPE '\\')");
      m.args.push(like(text), like(text), like(text), like(text));
      a.sql.push("text LIKE ? ESCAPE '\\'");
      a.args.push(like(text));
    }
    // what only a message has: asking for it leaves the alerts out
    let messagesOnly = kind === 'message' || status === 'spam' || status === 'held';
    for (const [k, col] of [['form', 'form'], ['service', 'service']]) {
      const v = get(k);
      if (v) {
        m.sql.push(`${col} = ?`);
        m.args.push(v);
        messagesOnly = true;
      }
    }
    const alert = get('alert');
    if (alert && alert !== 'failed') throw badRequest('alert can only be failed (the messages whose team alert was not sent).');
    if (alert) m.sql.push("alert = 'failed'"), (messagesOnly = true);
    const crm = get('crm');
    if (crm && crm !== 'failed') throw badRequest('crm can only be failed (the messages not sent to the CRM).');
    if (crm) m.sql.push("crm = 'failed'"), (messagesOnly = true);
    const assignee = get('assignee');
    if (assignee) {
      if (assignee === 'none') m.sql.push('assignee_id IS NULL');
      else m.sql.push('assignee_id = ?'), m.args.push(assignee);
      messagesOnly = true;
    }
    const w = (x) => ({ sql: x.sql.length ? `WHERE ${x.sql.join(' AND ')}` : '', args: x.args });
    return { m: kind === 'alert' ? null : w(m), a: messagesOnly ? null : w(a) };
  }

  const messageItem = (r) => {
    const form = formsOf()[r.form];
    return {
      id: r.id,
      kind: 'message',
      at: r.at,
      status: statusOf(r.status),
      form: r.form,
      formLabel: form?.label ?? r.form,
      from: { name: r.name ?? undefined, email: r.email ?? undefined },
      service: r.service ?? null,
      summary: summaryOf(form, parse(r.fields)),
      assignee: person(r.assignee_id),
      imported: r.source ? { from: r.source, id: r.source_id } : null,
      // the team mail: null (no mail set up), pending, sent, none (nobody to mail) or failed (tried again)
      alert: r.alert ?? null,
      // the CRM (forms.<id>.crm): null (not for one), pending, sent (with the lead's id there) or failed (tried again)
      // (failed: with why, for the list's mark)
      crm: r.crm ? { state: r.crm, name: CRM_NAME[form?.crm?.kind] ?? 'Odoo', leadId: r.crm_id ?? null, error: r.crm === 'failed' ? r.crm_error ?? null : null } : null,
    };
  };
  const alertItem = (r) => ({ id: r.id, kind: 'alert', at: r.at, status: r.seen_at ? 'handled' : 'new', alertKind: r.kind, level: r.level, link: r.link, summary: r.text, assignee: null });

  function messageDetail(r, ctx) {
    const form = formsOf()[r.form];
    const values = parse(r.fields);
    const known = form ? form.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, value: values[f.key] ?? '' })) : [];
    // a field the form no longer has (or an imported one) still shows, under its own name
    const rest = Object.keys(values).filter((k) => !known.some((f) => f.key === k)).map((k) => ({ key: k, label: k, type: 'text', value: values[k] }));
    const meta = parse(r.meta);
    if (can(ctx.user, 'inbox.manage')) Object.assign(meta, { ip: r.ip ?? null, userAgent: r.user_agent ?? null });
    return {
      ...messageItem(r),
      fields: [...known, ...rest].filter((f) => f.value !== ''),
      meta,
      spam: r.spam,
      alertTries: r.alert_tries,
      alertError: r.alert === 'failed' ? r.alert_error : null,
      alertNextAt: r.alert === 'failed' ? r.alert_next_at : null,
      crmTries: r.crm_tries,
      crmError: r.crm === 'failed' ? r.crm_error : null,
      crmNextAt: r.crm === 'failed' ? r.crm_next_at : null,
      crmAt: r.crm_at ?? null,
      // the lead for analytics (forms.<id>.leads): null (not for one), or how it went (forms/leads.mjs)
      lead: app.forms?.leads?.of(r.id) ?? null,
      notes: db.prepare('SELECT * FROM form_notes WHERE message_id = ? ORDER BY at, rowid').all(r.id).map((n) => ({ id: n.id, at: n.at, by: { id: n.by_id, name: n.by_name }, text: n.text })),
      history: db.prepare('SELECT * FROM form_events WHERE message_id = ? ORDER BY id').all(r.id).map((e) => ({ at: e.at, by: e.by_name ? { id: e.by_id, name: e.by_name } : null, change: e.change })),
      version: `r${r.rev}`,
    };
  }
  const alertDetail = (r) => ({ ...alertItem(r), fields: [], meta: {}, notes: [], history: [], version: r.seen_at ? 'seen' : 'unseen' });

  /** A message (anyone who may read the Inbox) or one of the viewer's own alerts; 404 otherwise. */
  function find(id, ctx) {
    const m = db.prepare('SELECT * FROM form_messages WHERE id = ?').get(String(id));
    if (m) return { m };
    const a = db.prepare('SELECT * FROM notices WHERE id = ? AND user_id = ?').get(String(id), ctx.user.id);
    if (a) return { a };
    throw notFound('Nothing in the Inbox has this reference (it may have been deleted).');
  }
  const event = (id, ctx, change, at) => db.prepare('INSERT INTO form_events (message_id, at, by_id, by_name, change) VALUES (?, ?, ?, ?, ?)').run(id, at, ctx.user.id, ctx.user.name, change);

  router.add('GET', '/inbox', (ctx) => {
    read(ctx);
    const { m, a } = filtersOf(ctx.query, ctx.user.id);
    const parts = [];
    const args = [];
    if (m) parts.push(`SELECT 'message' AS k, id, at FROM form_messages ${m.sql}`), args.push(...m.args);
    if (a) parts.push(`SELECT 'alert' AS k, id, at FROM notices ${a.sql}`), args.push(...a.args);
    const union = parts.join(' UNION ALL ');
    const total = parts.length ? Number(db.prepare(`SELECT COUNT(*) AS n FROM (${union})`).get(...args).n) : 0;
    const pages = Math.max(1, Math.ceil(total / PAGE));
    const page = Math.min(Math.max(1, Number.parseInt(ctx.query.get('page') ?? '1', 10) || 1), pages);
    const rows = parts.length ? db.prepare(`SELECT k, id FROM (${union}) ORDER BY at DESC, id LIMIT ? OFFSET ?`).all(...args, PAGE, (page - 1) * PAGE) : [];
    const items = rows.map((r) => (r.k === 'message' ? messageItem(db.prepare('SELECT * FROM form_messages WHERE id = ?').get(r.id)) : alertItem(db.prepare('SELECT * FROM notices WHERE id = ?').get(r.id))));
    // for the filters: every form and service with how many messages (spam left out), and how many in each status
    const forms = new Map(Object.values(formsOf()).map((f) => [f.id, { id: f.id, label: f.label, count: 0 }]));
    for (const r of db.prepare("SELECT form, COUNT(*) AS n FROM form_messages WHERE status != 'spam' GROUP BY form").all()) forms.set(r.form, { id: r.form, label: formsOf()[r.form]?.label ?? r.form, count: Number(r.n) });
    const services = db.prepare("SELECT service AS value, COUNT(*) AS n FROM form_messages WHERE status != 'spam' AND service IS NOT NULL AND service != '' GROUP BY service ORDER BY n DESC, service").all().map((r) => ({ value: r.value, count: Number(r.n) }));
    const status = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM form_messages GROUP BY status').all()) if (statusOf(r.status) in status) status[statusOf(r.status)] += Number(r.n);
    for (const r of db.prepare("SELECT seen_at IS NULL AS fresh, COUNT(*) AS n FROM notices WHERE user_id = ? AND kind != 'form.message' GROUP BY fresh").all(ctx.user.id)) status[r.fresh ? 'new' : 'handled'] += Number(r.n);
    const alertFailed = Number(db.prepare("SELECT COUNT(*) AS n FROM form_messages WHERE alert = 'failed'").get().n);
    const crmFailed = Number(db.prepare("SELECT COUNT(*) AS n FROM form_messages WHERE crm = 'failed'").get().n);
    // DB-IP's free city file asks for its credit wherever its places are shown
    const credits = app.geo?.status().attribution ?? null;
    return { items, total, page, pages, perPage: PAGE, facets: { forms: [...forms.values()], services, status, alertFailed, crmFailed }, credits };
  });

  router.add('GET', '/inbox.csv', (ctx) => {
    manage(ctx, 'export the Inbox');
    const { m } = filtersOf(ctx.query, ctx.user.id);
    const rows = m ? db.prepare(`SELECT * FROM form_messages ${m.sql} ORDER BY at DESC, id`).all(...m.args) : [];
    const keys = [...new Set(rows.flatMap((r) => Object.keys(parse(r.fields))))];
    const metaKeys = [...META, 'location'];
    const lines = [['reference', 'form', 'at', 'status', 'assigned to', ...keys, ...metaKeys, 'notes', 'imported from', 'imported id']];
    for (const r of rows) {
      const f = parse(r.fields);
      const mm = parse(r.meta);
      const notes = db.prepare('SELECT by_name, at, text FROM form_notes WHERE message_id = ? ORDER BY at').all(r.id).map((n) => `${n.by_name} (${n.at}): ${n.text}`).join('\n');
      lines.push([r.id, r.form, r.at, statusOf(r.status), person(r.assignee_id)?.name ?? '', ...keys.map((k) => f[k] ?? ''), ...metaKeys.map((k) => mm[k] ?? ''), notes, r.source ?? '', r.source_id ?? '']);
    }
    audit.log(ctx, 'inbox.export', { target: ctx.query.get('form') || 'all', detail: { count: rows.length, filters: Object.fromEntries([...ctx.query].filter(([k, v]) => v && k !== 'q')), q: Boolean(ctx.query.get('q')) } });
    ctx.res.statusCode = 200;
    ctx.res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    ctx.res.setHeader('Cache-Control', 'no-store');
    ctx.res.setHeader('Content-Disposition', 'attachment; filename="inbox.csv"');
    ctx.res.end(`﻿${lines.map((l) => l.map(cell).join(',')).join('\r\n')}\r\n`);
  });

  router.add('GET', '/inbox/:mid', (ctx) => {
    read(ctx);
    const { m, a } = find(ctx.params.mid, ctx);
    return m ? messageDetail(m, ctx) : alertDetail(a);
  });

  router.add('PATCH', '/inbox/:mid', (ctx) => {
    read(ctx);
    const { status, assigneeId, version } = ctx.body;
    if (status !== undefined && !SETTABLE.includes(status)) throw badRequest(`A message can be marked ${SETTABLE.join(', ')}; nothing else (a held one is released by the server on its own).`);
    const { m, a } = find(ctx.params.mid, ctx);
    const at = nowIso(clock());
    if (a) {
      if (assigneeId !== undefined) throw badRequest('An alert is yours alone: it cannot be given to someone else.');
      if (status === 'spam') throw badRequest('An alert cannot be spam.');
      if (status) db.prepare('UPDATE notices SET seen_at = ? WHERE id = ?').run(status === 'handled' ? at : null, a.id);
      return alertDetail(db.prepare('SELECT * FROM notices WHERE id = ?').get(a.id));
    }
    if (version !== `r${m.rev}`) throw new HttpError(409, 'stale', 'Someone changed this message meanwhile. Here it is as it is now.', { current: messageDetail(m, ctx) });
    const changes = [];
    const was = statusOf(m.status);
    let nextStatus = was;
    let nextAssignee = m.assignee_id;
    if (status && status !== was) {
      nextStatus = status;
      changes.push(STATUS_WORDS[status]);
    }
    if (assigneeId !== undefined && (assigneeId ?? null) !== m.assignee_id) {
      const u = assigneeId === null ? null : app.users.get(String(assigneeId));
      if (assigneeId !== null && (!u || u.disabled || !can(app.users.toPublic(u), 'inbox.read'))) throw badRequest('A message can only be given to an editor, administrator or the owner of this site.');
      nextAssignee = u?.id ?? null;
      changes.push(u ? `gave it to ${u.name}` : `took it from ${person(m.assignee_id)?.name ?? 'someone'}`);
    }
    if (changes.length) {
      db.prepare('UPDATE form_messages SET status = ?, assignee_id = ?, rev = rev + 1, status_by = ?, status_at = ? WHERE id = ?').run(nextStatus, nextAssignee, ctx.user.name, at, m.id);
      for (const c of changes) event(m.id, ctx, c, at);
      audit.log(ctx, 'inbox.change', { target: m.id, detail: { form: m.form, ...(nextStatus !== was ? { status: { from: was, to: nextStatus } } : {}), ...(nextAssignee !== m.assignee_id ? { assignee: { from: m.assignee_id, to: nextAssignee } } : {}) } });
      if (nextAssignee && nextAssignee !== m.assignee_id && nextAssignee !== ctx.user.id) {
        app.notices?.tell({ kind: 'form.assigned', level: 'info', text: `${ctx.user.name} gave you a ${formsOf()[m.form]?.label ?? m.form} form message from ${m.name || m.email || 'a visitor'}.`, link: `#/inbox?open=${m.id}`, to: [nextAssignee] });
      }
    }
    return messageDetail(db.prepare('SELECT * FROM form_messages WHERE id = ?').get(m.id), ctx);
  });

  router.add('POST', '/inbox/:mid/notes', (ctx) => {
    read(ctx);
    const { m } = find(ctx.params.mid, ctx);
    if (!m) throw badRequest('Notes are for messages from the site, not alerts.');
    const text = String(ctx.body.text ?? '').replace(/\r\n?/g, '\n').trim();
    if (!text) throw badRequest('Write the note first.');
    if (text.length > 5000) throw badRequest('A note is at most 5000 characters.');
    const n = { id: newId('fn'), at: nowIso(clock()), by: { id: ctx.user.id, name: ctx.user.name }, text };
    db.prepare('INSERT INTO form_notes (id, message_id, at, by_id, by_name, text) VALUES (?, ?, ?, ?, ?, ?)').run(n.id, m.id, n.at, n.by.id, n.by.name, n.text);
    event(m.id, ctx, 'added a note', n.at);
    audit.log(ctx, 'inbox.note', { target: m.id, detail: { form: m.form, note: n.id } });
    ctx.status = 201;
    return n;
  });

  router.add('POST', '/inbox/:mid/crm', async (ctx) => {
    read(ctx);
    const { m } = find(ctx.params.mid, ctx);
    if (!m) throw badRequest('Only a message from the site goes to the CRM.');
    if (!m.crm) throw new HttpError(409, 'not-for-crm', m.source ? 'This message came from WordPress: it is not sent again.' : 'This message was not meant for the CRM (its form does not send there, or it was off when it came in).');
    if (m.crm === 'sent') throw new HttpError(409, 'sent', `It is in ${CRM_NAME[formsOf()[m.form]?.crm?.kind] ?? 'Odoo'} already (lead ${m.crm_id}).`);
    const r = await app.forms.crm.again(m, ctx);
    const fresh = db.prepare('SELECT * FROM form_messages WHERE id = ?').get(m.id);
    if (!r.ok) throw new HttpError(502, 'crm-failed', `Not sent: ${r.error}`, { item: messageDetail(fresh, ctx) });
    return messageDetail(fresh, ctx);
  });

  router.add('DELETE', '/inbox/:mid', (ctx) => {
    manage(ctx, 'delete form messages');
    const { m } = find(ctx.params.mid, ctx);
    if (!m) throw badRequest('An alert is not deleted here: mark it handled.');
    db.prepare('DELETE FROM form_messages WHERE id = ?').run(m.id);
    audit.log(ctx, 'inbox.delete', { target: m.id, detail: { form: m.form, at: m.at, status: statusOf(m.status) } });
    return { ok: true };
  });
}
