// A plan's summary (docs/ENVIRONMENTS.md "Owner or reviewer"): the facts first, in plain words, always shown and
// always the source of truth; then, when config `ai` has a key, the same facts worded by a model.
//
// The model is given the facts JSON and the list of changed files only, never a page's text (pages and form data
// can hold personal data). Its answer is dropped, and the facts words stand alone, when it states any number that
// is not in the facts, when it refuses or fails, or when no key is set (no error: the AI wording is an extra).
// Raw HTTP (fetch) to the Messages API: the server has no dependencies, and tests pass their own fetch.
import fs from 'node:fs';

export const API_VERSION = '2026-10-21';
const MAX_FILES = 300;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The facts of a plan, as numbers and names (no page text). */
export function factsOf(plan) {
  const groups = {};
  for (const f of plan.files?.list ?? []) groups[f.group] = (groups[f.group] ?? 0) + 1;
  const checks = plan.checks ?? [];
  const pages = plan.pages ?? null;
  return {
    action: plan.action,
    from: plan.from.env,
    to: plan.to.env,
    files: plan.files?.list?.length ?? 0,
    groups,
    removedFiles: (plan.files?.list ?? []).filter((f) => f.status === 'removed').length,
    conflicts: (plan.conflicts ?? []).length,
    conflictsOpen: (plan.conflicts ?? []).filter((c) => !c.resolved).length,
    autoMerged: (plan.files?.autoMerged ?? []).length,
    pages: pages && { changed: pages.changed.length, added: pages.added.length, removed: pages.removed.length, removedWithoutRedirect: pages.removedWithoutRedirect.length },
    checks: { passed: checks.filter((c) => c.status === 'passed').length, failed: checks.filter((c) => c.status === 'failed').map((c) => c.label), warned: checks.filter((c) => c.status === 'warned').map((c) => c.label) },
  };
}

/** The facts in plain words: "3 templates changed; 41 pages look different; 1 page removed without a redirect (blocked)." */
export function factsWords(f) {
  const parts = [];
  const order = [['templates', 'template'], ['styles', 'stylesheet'], ['pages', 'content file'], ['config', 'config file'], ['media', 'media file'], ['other', 'other file']];
  const changed = order.filter(([g]) => f.groups[g]).map(([g, one]) => plural(f.groups[g], one));
  parts.push(changed.length ? `${changed.join(', ')} changed` : 'no files change');
  if (f.removedFiles) parts.push(`${plural(f.removedFiles, 'file')} removed`);
  if (f.autoMerged) parts.push(`${plural(f.autoMerged, 'file')} both sides edited, merged block by block`);
  if (f.conflictsOpen) parts.push(`${plural(f.conflictsOpen, 'conflict')} to decide`);
  else if (f.conflicts) parts.push(`${plural(f.conflicts, 'conflict')}, all decided`);
  if (f.pages) {
    if (f.pages.changed) parts.push(`${plural(f.pages.changed, 'page')} look${f.pages.changed === 1 ? 's' : ''} different`);
    if (f.pages.added) parts.push(`${plural(f.pages.added, 'new page')}`);
    if (f.pages.removed) parts.push(`${plural(f.pages.removed, 'page')} removed${f.pages.removedWithoutRedirect ? `, ${f.pages.removedWithoutRedirect} without a redirect (blocked)` : ''}`);
  }
  if (f.checks.failed.length) parts.push(`failed: ${f.checks.failed.join(', ')}`);
  else if (f.checks.passed) parts.push(`${plural(f.checks.passed, 'check')} passed`);
  if (f.checks.warned.length) parts.push(`warnings: ${f.checks.warned.join(', ')}`);
  const s = parts.join('; ');
  return `${s[0].toUpperCase()}${s.slice(1)}.`;
}

/** Every number written in `text` (digits, with their decimals), as strings. */
const numbersIn = (text) => [...String(text).matchAll(/\d+(?:\.\d+)?/g)].map((m) => String(Number(m[0])));

/** Does the AI text state only numbers the facts have? {ok, stray}. */
export function numbersHold(text, facts) {
  const known = new Set(numbersIn(JSON.stringify(facts)));
  const stray = numbersIn(text).filter((n) => !known.has(n));
  return { ok: !stray.length, stray };
}

export const PROMPT = [
  'You write a short summary of a website change for its owner, in plain English, 2 to 4 sentences.',
  'You get the facts as JSON and the list of changed files. Say only what the facts say. Do not add anything that is not in them: no guesses, no advice, no praise, no numbers that are not in the facts, no file names with digits.',
  'Name what changes (templates, styles, pages, config), what looks different, what was removed, the conflicts, and the checks. If something blocks the change, say so first.',
  'Write plain text with no headings, lists or markdown.',
].join('\n');

/** What the model is given for a plan: the facts JSON and the changed files' names (AI suggestions' summary too). */
export function planInput(plan, facts = factsOf(plan)) {
  const files = (plan.files?.list ?? []).slice(0, MAX_FILES).map((f) => `${f.status} ${f.group} ${f.path}`);
  return `Facts:\n${JSON.stringify(facts, null, 2)}\n\nChanged files:\n${files.join('\n') || '(none)'}`;
}

/**
 * The key, one rule for the summary and the AI suggestions: MARKSTAGE_AI_KEY, else the key file outside the repo (a
 * Docker secret), read now, so a new key works without a restart. None: null.
 */
export function keyOf(ai, env) {
  if (env.MARKSTAGE_AI_KEY?.trim()) return env.MARKSTAGE_AI_KEY.trim();
  if (!ai?.keyFile) return null;
  try {
    return fs.readFileSync(ai.keyFile, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/**
 * The summary {status, text, facts, words, ai: {model, dropped?, why?} | null}. `deps`: {fetch, env} for tests.
 * status: 'facts' (no AI wording), 'ai' (the model's words, checked), or 'dropped' (the model's words failed a check).
 */
export async function summarize(config, plan, deps = {}) {
  const facts = factsOf(plan);
  const words = factsWords(facts);
  const out = { status: 'facts', text: words, words, facts, ai: null };
  const ai = config.ai;
  // the test provider (AI suggestions' stub) words nothing: the facts stand
  if (!ai || ai.provider !== 'anthropic') return out;
  const key = keyOf(ai, deps.env ?? process.env);
  if (!key) return { ...out, ai: { model: ai.model, why: 'no key is set (ai.keyFile or MARKSTAGE_AI_KEY)' } };
  const doFetch = deps.fetch ?? fetch;
  let text = null;
  try {
    const res = await doFetch(ai.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': API_VERSION },
      body: JSON.stringify({ model: ai.model, max_tokens: 4000, system: PROMPT, messages: [{ role: 'user', content: planInput(plan, facts) }] }),
      signal: AbortSignal.timeout(ai.timeoutSeconds * 1000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { ...out, ai: { model: ai.model, why: `the model answered ${res.status}${body?.error?.type ? ` (${body.error.type})` : ''}` } };
    if (body?.stop_reason === 'refusal') return { ...out, ai: { model: ai.model, why: 'the model declined' } };
    text = (body?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  } catch (e) {
    return { ...out, ai: { model: ai.model, why: `the model was not reached: ${e.message}` } };
  }
  if (!text) return { ...out, ai: { model: ai.model, why: 'the model said nothing' } };
  const check = numbersHold(text, facts);
  if (!check.ok) return { ...out, status: 'dropped', ai: { model: ai.model, dropped: true, why: `it stated numbers the facts do not have (${check.stray.slice(0, 5).join(', ')})` } };
  return { ...out, status: 'ai', text: text.slice(0, 2000), ai: { model: ai.model } };
}
