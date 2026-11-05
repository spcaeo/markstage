// The model behind the AI suggestions (docs/API-AI.md "Providers"): one interface over Anthropic (the default), any
// OpenAI-compatible endpoint, and Ollama for local models (providers.mjs has each one's wire format), over raw HTTP
// like the promotion summary (env/summary.mjs: the server has no dependencies, and tests pass their own fetch), or
// `stub` in tests (fixed answers, no network, NODE_ENV=test only: env/config.mjs).
//
// The site owner brings the key: MARKSTAGE_AI_KEY in the server's environment, else `ai.keyFile`, a file outside the
// repo (a Docker secret), the same rule as the plan summary (env/summary.mjs keyOf), read on each call (a new key
// works without a restart). It goes in the provider's key header and nowhere else: never in the database, a URL,
// the audit, an answer, an error or a log. Ollama takes no key, and an OpenAI-compatible server on this machine
// (loopback: a model server on the same machine) may run without one. A provider's failure becomes fixed words (502 ai-failed; a
// provider 429 is 429 ai-rate), never the provider's own text.
import { HttpError } from '../util.mjs';
import { keyOf } from '../env/summary.mjs';
import { ADAPTERS, DEFAULT_BASE, failed, statusWords } from './providers.mjs';

export const KEY_ENV = 'MARKSTAGE_AI_KEY';
const DEFAULT = Object.freeze({ provider: 'anthropic', model: 'claude-sonnet-5-5', endpoint: DEFAULT_BASE.anthropic, baseUrl: null, keyHeader: 'authorization', timeoutSeconds: 30, perMinute: 10, perDay: 200 });
const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];

const loopback = (url) => {
  try {
    return LOOPBACK.includes(new URL(url).hostname);
  } catch {
    return false;
  }
};

/**
 * The provider for this server: {status() -> {on, why, reason, provider, model}, limits, complete({system, content,
 * maxTokens}) -> {text, usage: {input, output}}, health() -> {ok, words, modelFound}}. `deps`: {fetch, env} for
 * tests. With no `ai` in the config, the key alone turns it on with the defaults.
 */
export function createProvider(config, deps = {}) {
  const ai = { ...DEFAULT, ...(config.ai ?? {}) };
  const env = () => deps.env ?? process.env;
  const key = () => keyOf(ai, env());
  /** Whether this provider needs a key: Anthropic always, an OpenAI-compatible one unless it is on this machine. */
  const needsKey = ai.provider === 'anthropic' || (ai.provider === 'openai' && !loopback(ai.baseUrl));
  const adapter = ADAPTERS[ai.provider] ?? null;

  /** On or off, and why in words; `reason` says what is missing: 'key', 'model', or null. */
  function status() {
    if (ai.provider === 'stub') return { on: true, why: null, reason: null, provider: 'stub', model: 'stub' };
    if (!ai.model) {
      const what = ai.provider === 'ollama' ? 'a model you have pulled there, such as one ollama list shows' : 'the model the endpoint serves';
      return { on: false, why: `AI suggestions are off: ai.provider is "${ai.provider}", which has no default model. The owner names ${what} in ai.model.`, reason: 'model', provider: ai.provider, model: null };
    }
    if (needsKey && !key()) return { on: false, why: `AI suggestions are off: ${KEY_ENV} is not set on the server${ai.keyFile ? ', and ai.keyFile cannot be read or is empty' : ' and there is no ai.keyFile'}.`, reason: 'key', provider: null, model: ai.model };
    return { on: true, why: null, reason: null, provider: ai.provider, model: ai.model };
  }

  /** The key this provider sends, or null: never one for Ollama. */
  const keyFor = () => (ai.provider === 'ollama' ? null : key());

  /** One HTTP call with the timeout; its failures in fixed words (a timeout, not reached, busy, an error status). */
  async function send(req, method = 'POST') {
    let res;
    let body;
    try {
      res = await (deps.fetch ?? fetch)(req.url, { method, headers: req.headers, ...(method === 'POST' ? { body: JSON.stringify(req.body) } : {}), signal: AbortSignal.timeout(ai.timeoutSeconds * 1000) });
      body = await res.json().catch(() => null);
    } catch (e) {
      throw failed(e?.name === 'TimeoutError' ? `The AI provider did not answer within ${ai.timeoutSeconds} seconds. Try again.` : 'The AI provider could not be reached. Try again in a moment.');
    }
    if (res.status === 429) {
      const after = Number(res.headers.get('retry-after'));
      throw new HttpError(429, 'ai-rate', 'The AI provider is busy with this site’s key. Try again in a little while.', { retryAfter: Number.isFinite(after) && after > 0 ? Math.ceil(after) : 30 });
    }
    if (!res.ok) throw failed(statusWords(ai, res.status));
    return body;
  }

  /** One request: the system words, the user content blocks (text and images), at most maxTokens out. */
  async function complete({ system, content, maxTokens = 4000, stub }) {
    const s = status();
    if (!s.on) throw new HttpError(503, 'ai-off', s.why, s.reason === 'key' ? { envVar: KEY_ENV } : { reason: s.reason });
    if (ai.provider === 'stub') return stubbed(content, stub);
    const body = await send(adapter.request(ai, { system, content, maxTokens }, keyFor()));
    return adapter.answer(body);
  }

  /**
   * Whether the provider answers now (GET ai?check=1, administrators): one call to its models list, which costs no
   * tokens. {ok, words, modelFound: true | false | null (the list does not say)}.
   */
  async function health() {
    const s = status();
    if (!s.on) return { ok: false, words: s.why, modelFound: null };
    if (ai.provider === 'stub') return { ok: true, words: 'The stub provider answers (tests only).', modelFound: true };
    try {
      const body = await send(adapter.health(ai, keyFor()), 'GET');
      const found = adapter.hasModel(ai, body);
      if (found === false) return { ok: false, words: statusWords(ai, 404), modelFound: false };
      return { ok: true, words: `The ${ai.provider} provider answers${found ? `, and it has ${ai.model}` : ''}.`, modelFound: found };
    } catch (e) {
      return { ok: false, words: e instanceof HttpError ? e.message : 'The AI provider could not be reached.', modelFound: null };
    }
  }

  /** The stub: `stub()` gives the answer (a string as it is, else as JSON); STUB-RATE and STUB-FAIL anywhere in the input make the failures. */
  function stubbed(content, make) {
    const texts = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    if (texts.includes('STUB-RATE')) throw new HttpError(429, 'ai-rate', 'The AI provider is busy with this site’s key. Try again in a little while.', { retryAfter: 30 });
    if (texts.includes('STUB-FAIL')) throw failed('The AI provider answered with an error (500). Try again in a moment.');
    const v = make();
    return { text: typeof v === 'string' ? v : JSON.stringify(v), usage: { input: Math.ceil(texts.length / 4), output: 10 } };
  }

  return { status, complete, health, limits: { perMinute: ai.perMinute ?? DEFAULT.perMinute, perDay: ai.perDay ?? DEFAULT.perDay } };
}
