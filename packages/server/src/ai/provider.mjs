// The model behind the AI suggestions (docs/API-AI.md "Provider"): Anthropic's Messages API by default, over raw
// HTTP like the promotion summary (env/summary.mjs: the server has no dependencies, and tests pass their own fetch),
// or `stub` in tests (fixed answers, no network, NODE_ENV=test only: env/config.mjs).
//
// The site owner brings the key: MARKSTAGE_AI_KEY in the server's environment, else `ai.keyFile`, a file outside the
// repo (a Docker secret), the same rule as the plan summary (env/summary.mjs keyOf), read on each call (a new key
// works without a restart). It goes in the x-api-key header and nowhere else: never in the database, a URL, the audit, an
// answer or an error. A provider's failure becomes fixed words (502 ai-failed; a provider 429 is 429 ai-rate), never
// the provider's own text.
import { HttpError } from '../util.mjs';
import { API_VERSION, keyOf } from '../env/summary.mjs';

export const KEY_ENV = 'MARKSTAGE_AI_KEY';
const DEFAULT = Object.freeze({ provider: 'anthropic', model: 'claude-sonnet-5-5', endpoint: 'https://api.anthropic.com/v1/messages', timeoutSeconds: 30, perMinute: 10, perDay: 200 });

const failed = (words) => new HttpError(502, 'ai-failed', words);

/**
 * The provider for this server: {status() -> {on, why, provider, model}, limits, complete({system, content, maxTokens})
 * -> {text, usage: {input, output}}}. `deps`: {fetch, env} for tests. With no `ai` in the config, the key alone turns
 * it on with the defaults.
 */
export function createProvider(config, deps = {}) {
  const ai = config.ai ?? DEFAULT;
  const env = () => deps.env ?? process.env;
  const key = () => keyOf(ai, env());

  function status() {
    if (ai.provider === 'stub') return { on: true, why: null, provider: 'stub', model: 'stub' };
    if (!key()) return { on: false, why: `AI suggestions are off: ${KEY_ENV} is not set on the server${ai.keyFile ? ', and ai.keyFile cannot be read or is empty' : ' and there is no ai.keyFile'}.`, provider: null, model: ai.model };
    return { on: true, why: null, provider: 'anthropic', model: ai.model };
  }

  /** One request: the system words, the user content blocks (text and images), at most maxTokens out. */
  async function complete({ system, content, maxTokens = 4000, stub }) {
    const s = status();
    if (!s.on) throw new HttpError(503, 'ai-off', s.why, { envVar: KEY_ENV });
    if (ai.provider === 'stub') return stubbed(content, stub);
    let res;
    let body;
    try {
      res = await (deps.fetch ?? fetch)(ai.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key(), 'anthropic-version': API_VERSION },
        // short, scoped answers: little thinking is needed (effort low), and the answer is JSON in text
        body: JSON.stringify({ model: ai.model, max_tokens: maxTokens, output_config: { effort: 'low' }, system, messages: [{ role: 'user', content }] }),
        signal: AbortSignal.timeout(ai.timeoutSeconds * 1000),
      });
      body = await res.json().catch(() => null);
    } catch (e) {
      throw failed(e?.name === 'TimeoutError' ? `The AI provider did not answer within ${ai.timeoutSeconds} seconds. Try again.` : 'The AI provider could not be reached. Try again in a moment.');
    }
    if (res.status === 429) {
      const after = Number(res.headers.get('retry-after'));
      throw new HttpError(429, 'ai-rate', 'The AI provider is busy with this site’s key. Try again in a little while.', { retryAfter: Number.isFinite(after) && after > 0 ? Math.ceil(after) : 30 });
    }
    if (res.status === 401 || res.status === 403) throw failed('The AI provider did not take the server’s key. The owner checks MARKSTAGE_AI_KEY or ai.keyFile.');
    if (!res.ok) throw failed(`The AI provider answered with an error (${res.status}). Try again in a moment.`);
    if (body?.stop_reason === 'refusal') throw failed('The model declined to suggest anything for this.');
    const text = (body?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    if (!text) throw failed('The model said nothing. Try again.');
    return { text, usage: { input: body?.usage?.input_tokens ?? 0, output: body?.usage?.output_tokens ?? 0 } };
  }

  /** The stub: `stub()` gives the answer (a string as it is, else as JSON); STUB-RATE and STUB-FAIL anywhere in the input make the failures. */
  function stubbed(content, make) {
    const texts = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    if (texts.includes('STUB-RATE')) throw new HttpError(429, 'ai-rate', 'The AI provider is busy with this site’s key. Try again in a little while.', { retryAfter: 30 });
    if (texts.includes('STUB-FAIL')) throw failed('The AI provider answered with an error (500). Try again in a moment.');
    const v = make();
    return { text: typeof v === 'string' ? v : JSON.stringify(v), usage: { input: Math.ceil(texts.length / 4), output: 10 } };
  }

  return { status, complete, limits: { perMinute: ai.perMinute ?? DEFAULT.perMinute, perDay: ai.perDay ?? DEFAULT.perDay } };
}
