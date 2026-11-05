// AI suggestions (docs/API-AI.md): alt text for an image, a search title and description (or a fix of one of them),
// a promotion plan's summary, a rewrite of a selection (rewrite, shorten, fix, a tone), a translation draft of a title
// and description into one of the site's locales, internal links for an article from the site's link index, and a
// fix for a heading out of order or vague link words (seo-kinds.mjs). The model is Anthropic's, an OpenAI-compatible
// endpoint's or a local Ollama's (provider.mjs).
//
//   GET  /ai           {on, why, reason, envVar, provider, model, kinds, limits: {perMinute, perDay}}; ?check=1
//                      (administrators) also {health: {ok, words, modelFound}}: one call to the provider's models list
//   POST /ai/suggest   {kind, …} -> {kind, suggestion, provider, model}
//
// A suggestion never commits: it writes no file, no git and no content row, only its audit row. The person reads
// it, changes it and saves it through the editor's own routes (rights, versions, locks, the site's checks).
// - Who may ask: a signed-in person, in the editor (a session; the command line's and an agent's tokens are refused
//   before this runs). They see what they may read (the MCP server's `readable`); a plan's summary is for editors
//   and up.
// - What it costs: at most `ai.perMinute` and `ai.perDay` asks per person (counted from the audit, rolling), and
//   capped sizes (suggest.mjs CAPS).
// - What is kept: the audit row "ai.suggest" with the kind, the entry, image or plan, the provider, the model and
//   the token counts; never the prompt or the answer.
// - The key (MARKSTAGE_AI_KEY) and every other secret is scrubbed from what goes to the model and from every answer
//   and error (mcp/answer.mjs).
import { HttpError, nowIso } from '../util.mjs';
import { atLeast } from '../roles.mjs';
import { createScrub } from '../mcp/answer.mjs';
import { KEY_ENV, createProvider } from './provider.mjs';
import { KINDS, prepare, suggestKit } from './suggest.mjs';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** The AI suggestions of a server. `deps`: {fetch, env} (tests: a fake fetch, an environment with or without a key). */
export function createAi(app, deps = {}) {
  const provider = createProvider(app.config, deps);
  const scrubber = app.mcp?.scrubber ?? createScrub(app, deps.env ? { env: deps.env } : {});
  const busy = new Map();
  const limitedAt = new Map();

  // a summary is for editors and up; a translation needs a second locale; links need the site's link index (topics)
  const kindsFor = (user) => KINDS.filter((k) => (k !== 'summary' || atLeast(user, 'editor')) && (k !== 'translate' || (app.config.locales?.list.length ?? 0) > 1) && (k !== 'links' || !!app.links?.enabled));

  async function info(ctx) {
    const s = provider.status();
    const out = { on: s.on, why: s.why, reason: s.reason, envVar: KEY_ENV, provider: s.provider, model: s.model, kinds: kindsFor(ctx.user), limits: provider.limits };
    // the health check asks the provider itself: an administrator's, since it costs a call to the provider
    if (ctx.query?.get?.('check') === '1') {
      if (!atLeast(ctx.user, 'administrator')) throw new HttpError(403, 'forbidden', 'The AI health check is for owners and administrators.');
      out.health = scrubber.scrub(await provider.health());
      app.audit.log(ctx, 'ai.health', { ok: out.health.ok, detail: { provider: s.provider, model: s.model, modelFound: out.health.modelFound } });
    }
    return out;
  }

  /** This person's asks in the window (audit rows, plus any still running), and when the oldest leaves it. */
  function used(userId, ms) {
    const since = nowIso(app.clock() - ms);
    const r = app.db.prepare("SELECT COUNT(*) AS n, MIN(at) AS oldest FROM audit WHERE user_id = ? AND action = 'ai.suggest' AND at >= ?").get(userId, since);
    return { n: r.n + (busy.get(userId) ?? 0), oldest: r.oldest ? Date.parse(r.oldest) : app.clock() };
  }

  /**
   * Room for one more ask by this person now: null, or {window, wait (seconds), max} when the minute's or the day's
   * asks are used up. The site translation (translate/run.mjs) paces itself by it, so its asks never hit the 429.
   */
  function room(userId) {
    for (const [window, ms, max] of [['minute', MINUTE, provider.limits.perMinute], ['day', DAY, provider.limits.perDay]]) {
      const u = used(userId, ms);
      if (u.n < max) continue;
      return { window, max, wait: Math.max(1, Math.ceil((u.oldest + ms - app.clock()) / 1000)) };
    }
    return null;
  }

  /** How many asks this person has left today (the plan of a site translation says so). */
  const leftToday = (userId) => Math.max(0, provider.limits.perDay - used(userId, DAY).n);

  /** 429 when this person has had their asks for the minute or the day; logged at most once a minute. */
  function checkLimits(ctx) {
    for (const [window, ms, max] of [['minute', MINUTE, provider.limits.perMinute], ['day', DAY, provider.limits.perDay]]) {
      const u = used(ctx.user.id, ms);
      if (u.n < max) continue;
      const retryAfter = Math.max(1, Math.ceil((u.oldest + ms - app.clock()) / 1000));
      if (app.clock() - (limitedAt.get(ctx.user.id) ?? 0) >= MINUTE) {
        limitedAt.set(ctx.user.id, app.clock());
        app.audit.log(ctx, 'ai.limited', { ok: false, detail: { window, max } });
      }
      const when = window === 'minute' ? `in ${retryAfter} seconds` : `in about ${Math.ceil(retryAfter / 3600)} hours`;
      throw new HttpError(429, 'ai-rate', `You have asked for ${max} suggestions in the last ${window}, the most this site allows. Try again ${when}.`, { retryAfter, limit: window, max });
    }
  }

  async function suggest(ctx) {
    const body = ctx.body;
    try {
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(422, 'invalid', 'Send {kind, …}.');
      if (!KINDS.includes(body.kind)) throw new HttpError(422, 'invalid', `kind must be one of ${KINDS.join(', ')}.`, { field: 'kind' });
      const s = provider.status();
      if (!s.on) throw new HttpError(503, 'ai-off', s.why, s.reason === 'key' ? { envVar: KEY_ENV } : { reason: s.reason });
      const ask = await prepare(body.kind, body, ctx, suggestKit(app, ctx));
      checkLimits(ctx);
      return await run(ctx, body.kind, ask, s);
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      throw new HttpError(e.status, e.code, scrubber.scrub(e.message), scrubber.scrub(e.extra ?? {}));
    }
  }

  /** Ask the model (what it reads scrubbed first), read its answer, and log the ask either way. */
  async function run(ctx, kind, ask, s) {
    const list = scrubber.values();
    const content = ask.content.map((b) => (b.type === 'text' ? { ...b, text: scrubber.scrub(b.text, list) } : b));
    const detail = { kind, provider: s.provider, model: s.model, inputTokens: 0, outputTokens: 0 };
    busy.set(ctx.user.id, (busy.get(ctx.user.id) ?? 0) + 1);
    try {
      const out = await provider.complete({ system: ask.system, content, stub: ask.stub });
      detail.inputTokens = out.usage.input;
      detail.outputTokens = out.usage.output;
      const suggestion = scrubber.scrub(ask.answer(out.text), list);
      app.audit.log(ctx, 'ai.suggest', { target: ask.target, detail });
      return { kind, suggestion, provider: s.provider, model: s.model };
    } catch (e) {
      app.audit.log(ctx, 'ai.suggest', { ok: false, target: ask.target, detail: { ...detail, error: e instanceof HttpError ? e.code : 'server' } });
      throw e;
    } finally {
      busy.set(ctx.user.id, busy.get(ctx.user.id) - 1);
    }
  }

  function routes(api) {
    api.add('GET', '/ai', info);
    api.add('POST', '/ai/suggest', suggest);
  }

  /**
   * One ask as `ctx`'s person, from the server itself (the site translation): the same kinds, rights, limits, scrubber
   * and audit row as POST /ai/suggest.
   */
  const ask = (ctx, body) => suggest({ ...ctx, body });

  return { routes, info, provider, room, leftToday, ask };
}
