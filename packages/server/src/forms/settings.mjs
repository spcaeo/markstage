// The thank-you mail a form sends the visitor (docs/API-INBOX.md "Forms and the Inbox"), as Settings → Forms changes it. The site's config
// (`forms.<id>.reply`) gives the first words; a change made here is kept in <dataDir>/forms-settings.json and wins
// until it is put back. Owner and administrator; every change is audited.
//   GET    /site/forms               {version, siteName, forms: [{id, label, canReply, reply, fromConfig, changed}]}
//   PUT    /site/forms/:fid/reply    {version, on, subject, text}
//   DELETE /site/forms/:fid/reply    {version}: back to the site's config
import fs from 'node:fs';
import path from 'node:path';
import { can } from '../roles.mjs';
import { HttpError, badRequest, forbidden, notFound, sha256 } from '../util.mjs';

export function createFormSettings(app) {
  const { config, audit } = app;
  const file = path.join(config.dataDir, 'forms-settings.json');
  const forms = () => app.config.forms ?? {};

  function stored() {
    try {
      const text = fs.readFileSync(file, 'utf8');
      return { text, doc: JSON.parse(text) };
    } catch (e) {
      if (e.code !== 'ENOENT') console.error(`[markstage] ${file}: ${e.message}; the forms' own thank-you mail applies`);
      return { text: null, doc: {} };
    }
  }
  const versionOf = (text) => (text ? sha256(text).slice(0, 16) : 'default');

  /** The thank-you mail this form sends now: {subject, text} or null (none). */
  function replyOf(form, doc = stored().doc) {
    const own = doc[form.id]?.reply;
    if (own === undefined) return form.reply;
    return own && form.email ? { subject: own.subject, text: own.text } : null;
  }

  function view() {
    const { text, doc } = stored();
    return {
      version: versionOf(text),
      siteName: config.siteName ?? null,
      variables: ['{name}', '{siteName}'],
      forms: Object.values(forms()).map((f) => ({
        id: f.id,
        label: f.label,
        canReply: Boolean(f.email),
        reply: replyOf(f, doc),
        fromConfig: f.reply,
        changed: doc[f.id]?.reply !== undefined,
      })),
    };
  }

  function write(doc) {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  function guard(ctx) {
    if (!can(ctx.user, 'site.alerts')) throw forbidden("Only an owner or administrator can change a form's thank-you mail.");
    const form = forms()[ctx.params.fid];
    if (!form) throw notFound(`This site has no form "${ctx.params.fid}".`);
    const cur = stored();
    if (ctx.body.version !== versionOf(cur.text)) throw new HttpError(409, 'stale', 'The forms settings changed since you opened them. Here they are as they are now.', { current: view() });
    return { form, cur };
  }

  function routes(router) {
    router.add('GET', '/site/forms', (ctx) => {
      if (!can(ctx.user, 'site.alerts')) throw forbidden("Only an owner or administrator can see the forms' settings.");
      return view();
    });
    // the version check and the write hold the database's write lock (two server processes: one wins, one gets 409)
    const locked = (fn) => (ctx) => app.cluster.exclusive(() => fn(ctx));
    router.add('PUT', '/site/forms/:fid/reply', locked((ctx) => {
      const { form, cur } = guard(ctx);
      const { on, subject, text } = ctx.body;
      if (typeof on !== 'boolean') throw badRequest('on must be true (send a thank-you mail) or false (send none).');
      let next = null;
      if (on) {
        if (!form.email) throw badRequest(`The ${form.label} form has no email field to send a thank-you mail to.`);
        const s = typeof subject === 'string' ? subject.replace(/[\r\n]+/g, ' ').trim() : '';
        const t = typeof text === 'string' ? text.replace(/\r\n?/g, '\n').trim() : '';
        if (!s || s.length > 200) throw badRequest('The subject is required (at most 200 characters).');
        if (!t || t.length > 10000) throw badRequest('The text is required (at most 10000 characters).');
        next = { subject: s, text: t };
      }
      const was = replyOf(form, cur.doc);
      if (JSON.stringify(was) !== JSON.stringify(next) || cur.doc[form.id]?.reply === undefined) {
        write({ ...cur.doc, [form.id]: { ...cur.doc[form.id], reply: next } });
        audit.log(ctx, 'forms.reply', { target: form.id, detail: { from: was, to: next } });
      }
      return view();
    }));
    router.add('DELETE', '/site/forms/:fid/reply', locked((ctx) => {
      const { form, cur } = guard(ctx);
      if (cur.doc[form.id]?.reply !== undefined) {
        const was = replyOf(form, cur.doc);
        const { reply: _, ...rest } = cur.doc[form.id];
        const doc = { ...cur.doc };
        if (Object.keys(rest).length) doc[form.id] = rest;
        else delete doc[form.id];
        write(doc);
        audit.log(ctx, 'forms.reply', { target: form.id, detail: { from: was, to: form.reply, reset: true } });
      }
      return view();
    }));
  }

  return { replyOf, routes };
}
