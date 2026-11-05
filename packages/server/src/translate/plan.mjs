// The site translation's plan (a dry run: nothing written, nothing asked of the AI): which entries would get an AI
// draft for one locale, which are skipped and why, how many characters and tokens that is about, and how long it
// takes under this person's AI limits. The run (run.mjs) checks each entry again just before it asks.
import { searchText } from '../publish-rules.mjs';
import { trackedLocales } from '../content/translations.mjs';
import { HttpError } from '../util.mjs';
import { FIELDS } from './drafts.mjs';

/** The translate kind takes a title or description up to this many characters (ai/shared.mjs CAPS.field). */
export const FIELD_MAX = 1000;
/** About how many tokens the translate kind's own instructions take, per ask. */
const PROMPT_TOKENS = 160;
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const get = (o, key) => key.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), o);
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const wrong = (field, words) => new HttpError(422, 'invalid', words, { field });

/** Why an entry is left out, in plain words. */
export const SKIP_WORDS = {
  translated: (l) => `It has its own ${l.label} words already.`,
  nothing: () => 'It has no title or description to translate.',
  waiting: () => 'An AI draft is already waiting for review.',
  rights: (l) => `Your role cannot change its ${l.label} words.`,
  'too-long': () => `Its title or description is over ${FIELD_MAX.toLocaleString('en-US')} characters, more than the AI translates at once. Translate it by hand.`,
  changed: (l) => `Someone wrote its ${l.label} words after the plan was made.`,
  gone: () => 'It is not there any more.',
};

/** The collections a site translation may include: Markdown ones with pages (Post settings shows their regions). */
export function offered(app) {
  return app.config.collections.map((c) => {
    const why = c.format !== 'md' ? 'Its entries are not edited in the text editor, where drafts are reviewed.' : (c.url ?? null) === null ? 'Its entries have no page of their own.' : null;
    return { id: c.id, label: c.label ?? c.id, offered: !why, why };
  });
}

/** The locale a run is for: one the site tracks (it takes its own title or description), with its words. */
export function localeOf(app, code) {
  const tracked = trackedLocales(app.config.locales);
  if (!tracked.length) throw new HttpError(422, 'locale', 'This site has no region with its own title or description, so there is nothing to translate into.');
  const l = tracked.find((x) => x.code === code);
  if (!l) throw new HttpError(422, 'locale', `Choose one of this site's regions with their own words: ${tracked.map((x) => `${x.label} (${x.code})`).join(', ')}.`, { field: 'locale', locales: tracked.map((x) => x.code) });
  return l;
}

/** The options as given: {locale, collections: [ids] | null (all offered), skipExisting (default true)}. */
export function optionsOf(app, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw wrong('locale', 'Send {locale, collections?, skipExisting?}.');
  const locale = localeOf(app, body.locale);
  const can = offered(app).filter((c) => c.offered);
  let collections = null;
  if (body.collections !== undefined && body.collections !== null) {
    if (!Array.isArray(body.collections) || !body.collections.length || body.collections.some((x) => typeof x !== 'string')) throw wrong('collections', 'collections is a list of collection ids, or left out for all of them.');
    const bad = body.collections.filter((x) => !can.some((c) => c.id === x));
    if (bad.length) throw wrong('collections', `${bad.map((x) => `"${x}"`).join(', ')} cannot be translated here. Choose from: ${can.map((c) => c.id).join(', ') || 'none'}.`);
    collections = [...new Set(body.collections)];
  }
  if (body.skipExisting !== undefined && typeof body.skipExisting !== 'boolean') throw wrong('skipExisting', 'skipExisting is true or false.');
  return { locale: locale.code, collections, skipExisting: body.skipExisting !== false };
}

/**
 * Whether this person may write the locale's words of this entry: the entry save's own rule (a live entry needs the
 * publish right, or a custom role's own allow), and a role that changes some fields only must cover these.
 */
export function mayWrite(kit, ctx, c, summary, code, fields) {
  try {
    kit.entries.assertEditable(ctx, c, summary);
  } catch {
    return false;
  }
  const role = ctx.user?.custom;
  if (!role) return true;
  const d = role.decide('entry.edit', { collection: c, entry: summary, user: ctx.user });
  const key = kit.app.config.locales?.overridesKey ?? 'locales';
  return role.outside(d, fields.map((f) => `${key}.${code}.${f}`)).length === 0;
}

/**
 * One entry as the run would take it now: {action: 'draft', fields: {title?, description?} (the source words),
 * before} or {action: 'skip', reason}. `waiting`: the refs with an open draft (else the drafts file is read).
 */
export function decide(kit, ctx, l, c, id, text, skipExisting, waiting = null) {
  const { store, config } = kit.app;
  const fields = store.fieldsOf(c, text);
  const summary = store.summarize(c, id, text);
  const src = searchText(c, fields);
  const key = config.locales.overridesKey;
  const source = {};
  const before = {};
  let had = 0;
  for (const f of l.fields) {
    if (!str(src[f])) continue;
    const now = str(get(fields, `${key}.${l.code}.${f}`));
    if (now) had++;
    if (now && skipExisting) continue;
    source[f] = str(src[f]);
    before[f] = now;
  }
  const base = { summary };
  if (!Object.keys(source).length) return { ...base, action: 'skip', reason: had ? 'translated' : 'nothing' };
  if (waiting ? waiting.has(`${c.id}/${id}`) : kit.drafts.openDraft(l.code, `${c.id}/${id}`)) return { ...base, action: 'skip', reason: 'waiting' };
  if (!mayWrite(kit, ctx, c, summary, l.code, Object.keys(source))) return { ...base, action: 'skip', reason: 'rights' };
  if (Object.values(source).some((v) => v.length > FIELD_MAX)) return { ...base, action: 'skip', reason: 'too-long' };
  return { ...base, action: 'draft', fields: source, before };
}

/** About how long `asks` take for this person under the limits: {asks, perMinute, perDay, leftToday, minutes, words}. */
export function timeOf(app, userId, asks) {
  const { perMinute, perDay } = app.ai.provider.limits;
  const leftToday = app.ai.leftToday(userId);
  const today = Math.min(asks, leftToday);
  const minutes = Math.ceil(today / perMinute);
  const words = [];
  if (!asks) words.push('Nothing to ask the AI.');
  else words.push(`${plural(asks, 'ask')} of the AI, at most ${plural(perMinute, 'ask')} a minute: about ${minutes <= 1 ? 'a minute' : `${minutes} minutes`}${today < asks ? ' today' : ''}.`);
  if (asks > leftToday) words.push(`You have ${plural(leftToday, 'ask')} left today (at most ${perDay.toLocaleString('en-US')} a day). The run pauses when they are used, and you resume it later; ${plural(asks - leftToday, 'ask')} wait for that.`);
  return { asks, perMinute, perDay, leftToday, minutes, words: words.join(' ') };
}

/** The dry run (kit: {app, entries, drafts}): every entry of the chosen collections, drafted or skipped, with the counts and the estimate. */
export function makePlan(kit, ctx, options) {
  const { app } = kit;
  const l = localeOf(app, options.locale);
  const cols = offered(app).filter((c) => c.offered && (!options.collections || options.collections.includes(c.id)));
  const items = [];
  const waiting = kit.drafts.openDrafts(l.code);
  let chars = 0;
  for (const o of cols) {
    const c = app.store.collections.find((x) => x.id === o.id);
    for (const id of app.store.ids(c).sort()) {
      let text;
      try {
        text = app.store.read(c, id).text;
      } catch {
        continue;
      }
      const d = decide(kit, ctx, l, c, id, text, options.skipExisting, waiting);
      const row = { collection: c.id, id, title: d.summary.title, url: d.summary.url ?? null, entryStatus: d.summary.status, action: d.action };
      if (d.action === 'skip') Object.assign(row, { reason: d.reason, why: SKIP_WORDS[d.reason](l) });
      else {
        row.fields = Object.keys(d.fields);
        row.chars = Object.values(d.fields).reduce((n, v) => n + v.length, 0);
        chars += row.chars;
      }
      items.push(row);
    }
  }
  const drafting = items.filter((i) => i.action === 'draft');
  const skipped = {};
  for (const i of items) if (i.reason) skipped[i.reason] = (skipped[i.reason] ?? 0) + 1;
  // a token is about four characters; the answer is about as long as what it translates, plus its JSON
  const tokens = { input: drafting.length * PROMPT_TOKENS + Math.ceil(chars / 4), output: Math.ceil((chars * 1.2) / 4) + drafting.length * 12 };
  return {
    locale: { code: l.code, label: l.label, sameLanguage: l.sameLanguage, fields: l.fields },
    options,
    collections: offered(app).map((c) => ({ ...c, chosen: cols.some((x) => x.id === c.id) })),
    items,
    counts: { entries: items.length, draft: drafting.length, skip: items.length - drafting.length, chars, tokens, skipped },
    time: timeOf(app, ctx.user.id, drafting.length),
  };
}

/** The plan in plain words, the same on the screen and the command line. */
export function planLines(plan) {
  const c = plan.counts;
  const lines = [`${plural(c.draft, 'entry', 'entries')} to draft in ${plan.locale.label}, ${plural(c.skip, 'skipped', 'skipped')} (of ${c.entries.toLocaleString('en-US')}).`];
  if (c.draft) lines.push(`${plural(c.chars, 'character')} to translate: about ${c.tokens.input.toLocaleString('en-US')} tokens in (with the instructions sent with each ask) and ${c.tokens.output.toLocaleString('en-US')} out.`);
  lines.push(plan.time.words);
  const l = { label: plan.locale.label };
  for (const [why, n] of Object.entries(c.skipped)) lines.push(`Skipped, ${n.toLocaleString('en-US')}: ${SKIP_WORDS[why]?.(l) ?? why}`);
  return lines;
}

export { FIELDS };
