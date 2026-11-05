// Translate the site with AI (docs/API-TRANSLATIONS.md "AI drafts of a whole site"): for one of the site's regions,
// a draft of every entry's title and description, for people to review. A plan first (a dry run: nothing written,
// nothing asked), then the run on the server (run.mjs), then its report. Drafts are kept beside the site, never in
// an entry (drafts.mjs): they are never published and never overwrite anyone's words.
//
//   GET    /translate                         {ai, locales, collections, may, runs}
//   POST   /translate                         {locale, collections?, skipExisting?} -> 201 {run, plan} (the dry run)
//   GET    /translate/:rid                    {run, plan, result}
//   POST   /translate/:rid/run                -> 202 {run}
//   POST   /translate/:rid/pause|resume|cancel -> {run}
//   GET    /translate/drafts/:c/:id           {drafts: [{locale, label, fields, before, source, by, at, run, model}]}
//   DELETE /translate/drafts/:c/:id/:locale   {ok, commit}: Discard, in Post settings
//
// Who: a person in the editor (a token, an agent's included, never starts one) who may write the region's words:
// editors and up, or a custom role whose edit covers them. Each entry is then checked as its save would be. Audited:
// translate.plan, .start, .pause, .resume, .cancel, .run, .discard, and each ask as ai.suggest (kind translate).
import { atLeast } from '../roles.mjs';
import { readable } from '../mcp/tools.mjs';
import { HttpError, conflict, forbidden, newId, notFound, nowIso } from '../util.mjs';
import { trackedLocales } from '../content/translations.mjs';
import { createDrafts } from './drafts.mjs';
import { localeOf, makePlan, mayWrite, offered, optionsOf, planLines } from './plan.mjs';
import { countsOf, createRunner, firstResult } from './run.mjs';

const EXPIRES_MS = 60 * 60 * 1000;
const RID = /^tr_[A-Za-z0-9_-]{16}$/;

export function createTranslate(app, entries, deps = {}) {
  const { db, audit } = app;
  const drafts = createDrafts(app, entries);
  const kit = { app, entries, drafts };
  const rows = {
    get: (id) => (typeof id === 'string' && RID.test(id) ? db.prepare('SELECT * FROM translate_runs WHERE id = ?').get(id) : null) ?? null,
    set(id, fields) {
      const keys = Object.keys(fields);
      db.prepare(`UPDATE translate_runs SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => fields[k]), nowIso(app.clock()), id);
    },
  };
  const runner = createRunner(kit, rows, deps);

  // a restart, or a server process that stopped, stops a run that was going: it waits, paused, for its person to
  // resume it (on any process). A run whose process still runs is left alone.
  app.cluster.onReap(({ startup }) => {
    const why = startup ? 'The server restarted during the run.' : 'The server process running it stopped.';
    db.prepare("UPDATE translate_runs SET status = 'paused', reason = ?, live = NULL, stop_asked = NULL, updated_at = ? WHERE status = 'running' AND (owner IS NULL OR owner NOT IN (SELECT id FROM server_processes))").run(`${why} Resume it to carry on with the entries not done yet.`, nowIso(app.clock()));
  });

  /** A person in the editor, never a token; editors and up, or a custom role (each entry decides then). */
  function may(ctx) {
    if (ctx.token || ctx.via) throw forbidden('Translating the site is started by a person in the editor, not with a token or by an agent.');
    if (!atLeast(ctx.user, 'editor') && !ctx.user?.custom) throw forbidden('Translating the site is for editors and up, or a role that writes a region’s words.');
  }

  /** May this person write the region's words in any collection that can be translated? (403 when not) */
  function mayLocale(ctx, l) {
    if (atLeast(ctx.user, 'editor')) return;
    const key = app.config.locales.overridesKey;
    const role = ctx.user.custom;
    const fine = offered(app).some((o) => {
      if (!o.offered) return false;
      const c = app.store.collections.find((x) => x.id === o.id);
      const d = role.decide('entry.edit', { collection: c, entry: { id: '', author: ctx.user.authorSlug ?? null, status: 'published' }, user: ctx.user });
      return d?.effect === 'allow' && role.outside(d, l.fields.map((f) => `${key}.${l.code}.${f}`)).length === 0;
    });
    if (!fine) throw forbidden(`Your role cannot write ${l.label}’s words, so it cannot translate the site into it.`);
  }

  /** 503 while AI is off, in the same words as every AI button. */
  function aiOn() {
    const s = app.ai.provider.status();
    if (!s.on) throw new HttpError(503, 'ai-off', s.why, s.reason === 'key' ? { envVar: 'MARKSTAGE_AI_KEY' } : { reason: s.reason });
  }

  const load = (ctx) => {
    const r = rows.get(ctx.params.rid);
    if (!r || (r.created_by !== ctx.user.id && !atLeast(ctx.user, 'editor'))) throw notFound('No such translation run, or it is not yours to see.');
    return r;
  };

  function runView(r) {
    const by = app.users.get(r.created_by);
    const plan = JSON.parse(r.plan);
    const items = r.result ? JSON.parse(r.result).items : [];
    // where it is: from this process when it runs here, else from its row (written by the process that runs it)
    const live = runner.live(r.id) ?? (r.status === 'running' && r.live ? JSON.parse(r.live) : null);
    const status = r.status === 'planned' && app.clock() >= Date.parse(r.expires_at) ? 'expired' : r.status;
    return {
      id: r.id,
      locale: plan.locale,
      status,
      reason: r.reason,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      by: by ? { id: by.id, name: by.name } : null,
      options: plan.options,
      counts: plan.counts,
      progress: { total: plan.counts.entries, done: items.length + (live?.pending ?? 0), pending: live?.pending ?? 0, waiting: live?.waiting ?? null, ...countsOf(items) },
    };
  }

  /** GET /translate: what the start screen needs. */
  function info(ctx) {
    may(ctx);
    const s = app.ai.provider.status();
    const mine = atLeast(ctx.user, 'editor') ? db.prepare('SELECT * FROM translate_runs ORDER BY created_at DESC, rowid DESC LIMIT 20').all() : db.prepare('SELECT * FROM translate_runs WHERE created_by = ? ORDER BY created_at DESC, rowid DESC LIMIT 20').all(ctx.user.id);
    return {
      ai: { on: s.on, why: s.why, reason: s.reason, limits: app.ai.provider.limits },
      locales: trackedLocales(app.config.locales).map(({ code, label, sameLanguage, fields }) => ({ code, label, sameLanguage, fields })),
      collections: offered(app),
      runs: mine.map(runView),
    };
  }

  /** POST /translate: the plan, a dry run, kept for an hour for its person to run as it is. */
  function plan(ctx) {
    may(ctx);
    aiOn();
    const options = optionsOf(app, ctx.body);
    mayLocale(ctx, localeOf(app, options.locale));
    const p = makePlan(kit, ctx, options);
    const id = newId('tr');
    const now = app.clock();
    db.prepare('INSERT INTO translate_runs (id, locale, created_by, created_at, expires_at, plan, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, options.locale, ctx.user.id, nowIso(now), nowIso(now + EXPIRES_MS), JSON.stringify(p), 'planned', nowIso(now));
    audit.log(ctx, 'translate.plan', { target: id, detail: { locale: options.locale, collections: options.collections, skipExisting: options.skipExisting, draft: p.counts.draft, skip: p.counts.skip } });
    ctx.status = 201;
    return { run: runView(rows.get(id)), plan: { ...p, lines: planLines(p) } };
  }

  /** GET /translate/:rid: the run, its plan, and what it did (each draft still open marked `open`). */
  function get(ctx) {
    may(ctx);
    const r = load(ctx);
    const p = JSON.parse(r.plan);
    let result = r.result ? JSON.parse(r.result) : null;
    if (result) {
      const open = drafts.openDrafts(p.locale.code);
      result = { ...result, items: result.items.map((i) => (i.action === 'created' ? { ...i, open: open.has(`${i.collection}/${i.id}`) } : i)) };
    }
    return { run: runView(r), plan: { ...p, lines: planLines(p) }, result };
  }

  /** Only the person who made it runs, resumes, pauses or cancels it (administrators may pause or cancel it too). */
  const own = (ctx, r, admins = false) => {
    if (r.created_by !== ctx.user.id && !(admins && atLeast(ctx.user, 'administrator'))) throw forbidden('Only the person who made this run does that. Make your own plan first.');
  };
  /**
   * Claim the run in the database: it becomes running, this process's, unless another run is running (409 busy) or
   * it is not `from` any more (two starts at once, two clicks or two server processes: one runs).
   */
  function claim(r, from, fields) {
    const out = app.cluster.exclusive(() => {
      const other = db.prepare("SELECT id FROM translate_runs WHERE status = 'running' AND id != ?").get(r.id);
      if (other) return { other };
      const keys = Object.keys(fields);
      const changed = db.prepare(`UPDATE translate_runs SET status = 'running', reason = NULL, owner = ?, stop_asked = NULL, live = NULL, ${keys.map((k) => `${k} = ?, `).join('')}updated_at = ? WHERE id = ? AND status = ?`).run(app.cluster.id, ...keys.map((k) => fields[k]), nowIso(app.clock()), r.id, from).changes;
      return { ok: Number(changed) === 1 };
    });
    if (out.other) throw new HttpError(409, 'busy', 'Another translation of the site is running. Wait for it, or pause it first.', { run: out.other.id });
    if (!out.ok) {
      const now = rows.get(r.id);
      throw conflict(`This run is ${now?.status ?? 'gone'} already.`, { status: now?.status ?? null });
    }
  }

  /** POST /translate/:rid/run, and resume: in the background, by its person. */
  function start(ctx, resume = false) {
    may(ctx);
    const r = load(ctx);
    own(ctx, r);
    const v = runView(r);
    if (!resume && v.status === 'expired') throw new HttpError(410, 'expired', 'This plan is more than an hour old. Plan it again, so it shows what a run would do now.');
    if (r.status !== (resume ? 'paused' : 'planned')) throw conflict(`This run is ${v.status}${resume ? ', not paused' : ' already'}.`, { status: v.status });
    aiOn();
    mayLocale(ctx, localeOf(app, r.locale));
    claim(r, resume ? 'paused' : 'planned', resume ? {} : { started_at: nowIso(app.clock()), result: JSON.stringify(firstResult(JSON.parse(r.plan))) });
    audit.log(ctx, resume ? 'translate.resume' : 'translate.start', { target: r.id, detail: { locale: r.locale } });
    void runner.drive(r.id);
    ctx.status = 202;
    return { run: runView(rows.get(r.id)) };
  }

  /** POST /translate/:rid/pause and cancel: between two asks; what was drafted stays. */
  async function stop(ctx, what) {
    may(ctx);
    const r = load(ctx);
    own(ctx, r, true);
    if (what === 'pause' && r.status !== 'running') throw conflict(`This run is ${r.status}, not running.`, { status: r.status });
    if (what === 'cancel' && !['running', 'paused'].includes(r.status)) throw conflict(`This run is ${r.status}: there is nothing to cancel.`, { status: r.status });
    audit.log(ctx, `translate.${what}`, { target: r.id, detail: { locale: r.locale } });
    if (runner.signal(r.id, what)) await runner.drive(r.id);
    else if (r.status === 'running' && r.owner && r.owner !== app.cluster.id && app.cluster.alive(r.owner)) await askOther(r, what);
    else if (what === 'cancel') rows.set(r.id, { status: 'cancelled', reason: 'Cancelled. The drafts made before are kept for review.', finished_at: nowIso(app.clock()) });
    else rows.set(r.id, { status: 'paused', reason: 'Paused. Resume it to carry on with the entries not done yet.' });
    return { run: runView(rows.get(r.id)) };
  }

  /**
   * Pause or cancel a run going on another server process: asked on its row, which that process reads between two
   * asks (a wait is cut short within a second); this answers once it has stopped (or after 30 s, still running).
   */
  async function askOther(r, what) {
    db.prepare("UPDATE translate_runs SET stop_asked = ? WHERE id = ? AND status = 'running'").run(what, r.id);
    for (let i = 0; i < 150 && rows.get(r.id)?.status === 'running'; i++) {
      if (!app.cluster.alive(r.owner)) {
        app.cluster.reap();
        break;
      }
      await new Promise((res) => setTimeout(res, 200));
    }
    // its process stopped meanwhile (the run was paused for it): a cancel still cancels
    if (what === 'cancel' && rows.get(r.id)?.status === 'paused') rows.set(r.id, { status: 'cancelled', reason: 'Cancelled. The drafts made before are kept for review.', finished_at: nowIso(app.clock()) });
  }

  /** The entry, when this person may read it (else 404, as if it were not there). */
  function entryOf(ctx) {
    const c = app.store.collections.find((x) => x.id === ctx.params.c);
    let summary = null;
    try {
      summary = c ? app.store.summarize(c, ctx.params.id, app.store.read(c, ctx.params.id).text) : null;
    } catch {
      summary = null;
    }
    if (!summary || !readable(ctx.user, c, summary)) throw notFound('That entry is not available to you.');
    return { c, summary, ref: `${c.id}/${ctx.params.id}` };
  }

  /** GET /translate/drafts/:c/:id: the open AI drafts of an entry, one per region. */
  function draftsOf(ctx) {
    if (ctx.token || ctx.via) throw forbidden('AI drafts are reviewed by a person in the editor.');
    const { ref } = entryOf(ctx);
    const out = [];
    for (const l of trackedLocales(app.config.locales)) {
      const d = drafts.openDraft(l.code, ref);
      if (d) out.push({ locale: l.code, label: l.label, fields: d.fields, before: d.before ?? {}, source: d.source ?? {}, by: d.by ?? null, at: d.at ?? null, run: d.run ?? null, model: d.model ?? null });
    }
    return { drafts: out };
  }

  /** DELETE /translate/drafts/:c/:id/:locale: Discard, by someone who may write that region's words of the entry. */
  async function discard(ctx) {
    if (ctx.token || ctx.via) throw forbidden('AI drafts are reviewed by a person in the editor.');
    const { c, summary, ref } = entryOf(ctx);
    const l = localeOf(app, ctx.params.locale);
    if (!mayWrite(kit, ctx, c, summary, l.code, l.fields)) throw forbidden(`Your role cannot change this entry’s ${l.label} words.`);
    const commit = await drafts.discard(ctx, l.code, ref);
    audit.log(ctx, 'translate.discard', { target: ref, detail: { locale: l.code, commit } });
    return { ok: true, commit };
  }

  function routes(api) {
    api.add('GET', '/translate', info);
    api.add('POST', '/translate', plan);
    api.add('GET', '/translate/drafts/:c/:id', draftsOf);
    api.add('DELETE', '/translate/drafts/:c/:id/:locale', discard);
    api.add('GET', '/translate/:rid', get);
    api.add('POST', '/translate/:rid/run', (ctx) => start(ctx));
    api.add('POST', '/translate/:rid/resume', (ctx) => start(ctx, true));
    api.add('POST', '/translate/:rid/pause', (ctx) => stop(ctx, 'pause'));
    api.add('POST', '/translate/:rid/cancel', (ctx) => stop(ctx, 'cancel'));
  }

  return { routes, plan, start, get, drafts, idle: runner.idle, stop: runner.stopAll };
}
