// The site translation's run: each planned entry is checked again, asked of the AI with the translate kind (the same
// rights, limits, scrubber and audit row as the editor's "Draft translation"), and its answer kept as a draft
// (drafts.mjs), 25 to a commit in the name of the person who ran it. It runs on the server, not as a build job (a
// long run must not hold up a publish), so leaving the page does not stop it.
//
// - Pacing: before each ask it looks at the person's AI limits (ai/index.mjs room). The minute's limit: it waits.
//   The day's: it pauses, saying when to resume. A busy provider: it waits as long as the provider asks.
// - Pause, Resume and Cancel act between two asks (a wait is cut short). What was drafted stays, committed.
// - A restart pauses a run that was going (index.mjs); Resume carries on with the entries not done yet.
import { HttpError, nowIso } from '../util.mjs';
import { SKIP_WORDS, decide, localeOf } from './plan.mjs';

export const BATCH = 25;
/** A wait longer than this pauses the run instead (the day's limit, a provider that asks for a long break). */
const LONGEST_WAIT_S = 15 * 60;
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const utc = (ms) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The runner. `kit`: {app, entries, drafts}; `rows`: {get(id), set(id, fields)} on translate_runs; `sleep(ms)`: how
 * a wait waits (tests: one that moves their clock).
 */
export function createRunner(kit, rows, { sleep = realSleep } = {}) {
  const { app } = kit;
  const active = new Map();

  /** Pause or cancel a run that is going: true when it was. */
  function signal(id, what) {
    const a = active.get(id);
    if (!a) return false;
    a.stop = what;
    a.wake?.();
    return true;
  }

  /** What a going run is doing now: {pending, waiting} (drafts not committed yet, and a wait), else null. */
  const live = (id) => {
    const a = active.get(id);
    return a ? { pending: a.pending.length, waiting: a.waiting } : null;
  };

  /** A wait that Pause and Cancel cut short. */
  function waitFor(a, ms, why) {
    a.waiting = { until: nowIso(app.clock() + ms), why };
    return new Promise((resolve) => {
      let done = false;
      const end = () => {
        if (done) return;
        done = true;
        a.wake = null;
        a.waiting = null;
        resolve();
      };
      a.wake = end;
      void sleep(ms).then(end);
    });
  }

  /** The person who started it, as a request would have them (their role and custom role now). */
  function personOf(userId) {
    const row = app.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!row || row.disabled) return null;
    return { user: app.users.toPublic(row), ip: null, userAgent: 'markstage translate', status: 200, query: new URLSearchParams(), params: {}, req: { headers: {} } };
  }

  /** One entry: {created} (a draft to commit), {row} (skipped or failed), {retry: seconds} or {stop: words}. */
  async function draftOne(ctx, l, plan, item) {
    const row = { collection: item.collection, id: item.id, title: item.title };
    const c = app.store.collections.find((x) => x.id === item.collection);
    let text;
    try {
      text = app.store.read(c, item.id).text;
    } catch {
      return { row: { ...row, action: 'skipped', reason: 'gone', why: SKIP_WORDS.gone(l) } };
    }
    const d = decide(kit, ctx, l, c, item.id, text, plan.options.skipExisting);
    row.title = d.summary.title;
    if (d.action === 'skip') {
      const reason = d.reason === 'translated' ? 'changed' : d.reason;
      return { row: { ...row, action: 'skipped', reason, why: SKIP_WORDS[reason](l) } };
    }
    try {
      const r = await app.ai.ask(ctx, { kind: 'translate', collection: c.id, id: item.id, locale: l.code, fields: d.fields });
      const fields = Object.fromEntries(Object.keys(d.fields).filter((k) => typeof r.suggestion?.[k] === 'string' && r.suggestion[k].trim()).map((k) => [k, r.suggestion[k].trim()]));
      if (!Object.keys(fields).length) return { row: { ...row, action: 'failed', why: 'The AI answered with nothing to use.' } };
      return { created: { ref: `${c.id}/${item.id}`, fields, before: d.before, source: d.fields, model: r.model, row: { ...row, action: 'created', fields: Object.keys(fields) } } };
    } catch (e) {
      if (!(e instanceof HttpError)) return { row: { ...row, action: 'failed', why: 'Something went wrong on the server. Its log says what.' } };
      if (e.status === 429) return { retry: Number(e.extra?.retryAfter) || 30 };
      if (e.status === 503) return { stop: e.message };
      return { row: { ...row, action: 'failed', why: e.message } };
    }
  }

  async function loop(id, a) {
    const r = rows.get(id);
    const plan = JSON.parse(r.plan);
    const result = r.result ? JSON.parse(r.result) : { items: [], commits: [] };
    const ctx = personOf(r.created_by);
    const pause = (reason) => rows.set(id, { status: 'paused', reason, result: JSON.stringify(result) });
    if (!ctx) return pause('The person who started it can no longer sign in. Someone else plans and runs it again.');
    let l;
    try {
      l = localeOf(app, plan.locale.code);
    } catch (e) {
      return pause(`${e.message} The site's regions changed since the plan; plan it again.`);
    }
    const done = new Set(result.items.map((i) => `${i.collection}/${i.id}`));
    const todo = plan.items.filter((i) => i.action === 'draft' && !done.has(`${i.collection}/${i.id}`));
    const batches = Math.max(1, Math.ceil(plan.counts.draft / BATCH));
    const save = () => rows.set(id, { result: JSON.stringify(result) });

    const flush = async () => {
      if (!a.pending.length) return;
      const list = a.pending;
      a.pending = [];
      const n = result.commits.length + 1;
      const message = `Draft ${plural(list.length, `${l.label} translation`)} with AI${batches > 1 ? ` (batch ${Math.min(n, batches)} of ${batches})` : ''}`;
      try {
        const commit = await kit.drafts.add(ctx, l.code, list, id, message);
        if (commit) result.commits.push(commit);
        for (const x of list) result.items.push(x.row);
      } catch (e) {
        for (const x of list) result.items.push({ ...x.row, action: 'failed', fields: undefined, why: `The draft could not be saved: ${e.message}` });
      }
      save();
    };

    let stopWords = null;
    for (let i = 0; i < todo.length; ) {
      if (a.stop) break;
      const s = app.ai.provider.status();
      if (!s.on) {
        stopWords = `AI is off now: ${s.why} Resume it once AI is on again.`;
        break;
      }
      const room = app.ai.room(ctx.user.id);
      if (room) {
        if (room.window === 'day' || room.wait > LONGEST_WAIT_S) {
          stopWords = `You have used your ${plural(room.max, 'AI ask')} for ${room.window === 'day' ? 'today' : 'now'}. Resume it after ${utc(app.clock() + room.wait * 1000)}.`;
          break;
        }
        await waitFor(a, room.wait * 1000, `At most ${plural(room.max, 'ask')} a minute: waiting ${plural(room.wait, 'second')}.`);
        continue;
      }
      const out = await draftOne(ctx, l, plan, todo[i]);
      if (out.retry) {
        if (out.retry > LONGEST_WAIT_S) {
          stopWords = `The AI provider asked for a break of ${plural(Math.ceil(out.retry / 60), 'minute')}. Resume it later.`;
          break;
        }
        await waitFor(a, out.retry * 1000, `The AI provider is busy: waiting ${plural(out.retry, 'second')}.`);
        continue;
      }
      if (out.stop) {
        stopWords = `${out.stop} Resume it once AI is on again.`;
        break;
      }
      i++;
      if (out.created) {
        a.pending.push(out.created);
        if (a.pending.length >= BATCH) await flush();
      } else {
        result.items.push(out.row);
        save();
      }
    }
    await flush();
    const now = nowIso(app.clock());
    const counts = countsOf(result.items);
    if (a.stop === 'cancel') rows.set(id, { status: 'cancelled', reason: 'Cancelled. The drafts made before are kept for review.', finished_at: now });
    else if (a.stop === 'pause' || stopWords) rows.set(id, { status: 'paused', reason: stopWords ?? 'Paused. Resume it to carry on with the entries not done yet.' });
    else rows.set(id, { status: 'done', reason: null, finished_at: now });
    app.audit.log(ctx, 'translate.run', { target: id, detail: { locale: l.code, status: rows.get(id).status, ...counts, commits: result.commits.length } });
    if (a.stop !== 'cancel' && !a.stop) {
      const words = rows.get(id).status === 'done' ? `The ${l.label} drafts are ready: ${counts.created} to review, ${counts.skipped} skipped, ${counts.failed} failed.` : `The ${l.label} translation paused: ${stopWords}`;
      app.notices?.tell({ kind: 'translate.done', level: rows.get(id).status === 'done' ? 'info' : 'warn', text: words, link: `#/translate/${id}`, to: [ctx.user.id] });
    }
  }

  /** Run (or carry on with) a run in the background; the promise resolves when it stops. */
  function drive(id) {
    if (active.has(id)) return active.get(id).promise;
    const a = { stop: null, wake: null, waiting: null, pending: [], promise: null };
    active.set(id, a);
    a.promise = (async () => {
      try {
        await loop(id, a);
      } catch (e) {
        rows.set(id, { status: 'paused', reason: `It stopped on an error (${e.message}). Resume it to try again.` });
      } finally {
        active.delete(id);
      }
    })();
    return a.promise;
  }

  const idle = () => Promise.all([...active.values()].map((a) => a.promise));
  /** Every run going pauses between two asks (the server is stopping); resolves when they have. */
  function stopAll() {
    for (const id of active.keys()) signal(id, 'pause');
    return idle();
  }

  return { drive, signal, live, running: (id) => active.has(id), idle, stopAll };
}

/**
 * A run's result as it starts: the entries the plan skipped, with their reasons, so the report accounts for every
 * entry the plan considered (created + skipped + failed = the plan's entries once it is done).
 */
export function firstResult(plan) {
  const items = plan.items.filter((i) => i.action === 'skip').map((i) => ({ collection: i.collection, id: i.id, title: i.title, action: 'skipped', reason: i.reason, why: i.why }));
  return { items, commits: [] };
}

/** created, skipped and failed, from a run's items. */
export function countsOf(items) {
  const out = { created: 0, skipped: 0, failed: 0 };
  for (const i of items) out[i.action] = (out[i.action] ?? 0) + 1;
  return out;
}
