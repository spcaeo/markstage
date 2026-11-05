// The AI providers' wire formats (docs/API-AI.md "Providers"), one adapter each, all plain HTTP with no SDK:
//   anthropic  Anthropic's Messages API (the default).
//   openai     any OpenAI-compatible Chat Completions endpoint: OpenAI, Azure OpenAI's v1 API, OpenRouter, Together,
//              a local server, … (`baseUrl` + /chat/completions).
//   ollama     a local Ollama server (`baseUrl` + /api/chat), http://127.0.0.1:11434 by default, no key.
//
// An adapter turns one ask ({system, content: [text | image blocks], maxTokens}) into a request, and the provider's
// answer into {text, usage: {input, output}}, or throws fixed words (never the provider's own text, which can echo a
// key). provider.mjs sends it: the timeout, the key, and the failures every provider shares (busy, key refused).
// Streaming is always off: one JSON answer.
import { HttpError } from '../util.mjs';
import { API_VERSION } from '../env/summary.mjs';

export const PROVIDERS = ['anthropic', 'openai', 'ollama'];
export const DEFAULT_BASE = Object.freeze({ anthropic: 'https://api.anthropic.com/v1/messages', openai: 'https://api.openai.com/v1', ollama: 'http://127.0.0.1:11434' });

export const failed = (words) => new HttpError(502, 'ai-failed', words);
const said = (text, input, output) => {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) throw failed('The model said nothing. Try again.');
  return { text: t, usage: { input: Number(input) || 0, output: Number(output) || 0 } };
};
const join = (base, tail) => `${base.replace(/\/+$/, '')}${tail}`;
const texts = (content) => content.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n');
const images = (content) => content.filter((b) => b.type === 'image').map((b) => b.source);

const anthropic = {
  /** The key in x-api-key, the API version, low effort: these are short, scoped answers. */
  request: (ai, { system, content, maxTokens }, key) => ({
    url: ai.endpoint,
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': API_VERSION },
    body: { model: ai.model, max_tokens: maxTokens, output_config: { effort: 'low' }, system, messages: [{ role: 'user', content }] },
  }),
  answer(body) {
    if (body?.stop_reason === 'refusal') throw failed('The model declined to suggest anything for this.');
    return said((body?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join(''), body?.usage?.input_tokens, body?.usage?.output_tokens);
  },
  // the models list answers with the key alone: whether the key is taken and the endpoint is there
  health: (ai, key) => ({ url: ai.endpoint.replace(/\/messages\/?$/, '/models'), headers: { 'x-api-key': key, 'anthropic-version': API_VERSION } }),
  hasModel: () => null,
};

const openai = {
  /**
   * Chat Completions. The key goes as `Authorization: Bearer` (or Azure's `api-key` header, `keyHeader`). No token
   * cap is sent: servers name it differently (max_tokens, max_completion_tokens); the prompts ask for short answers
   * and the timeout bounds the wait. Text-only asks send the content as one string, which every server takes.
   */
  request(ai, { system, content }, key) {
    const pics = images(content);
    const user = pics.length ? [...content.filter((b) => b.type === 'text').map((b) => ({ type: 'text', text: b.text })), ...pics.map((s) => ({ type: 'image_url', image_url: { url: `data:${s.media_type};base64,${s.data}` } }))] : texts(content);
    const headers = { 'content-type': 'application/json' };
    if (key) {
      if (ai.keyHeader === 'api-key') headers['api-key'] = key;
      else headers.authorization = `Bearer ${key}`;
    }
    return { url: join(ai.baseUrl, '/chat/completions'), headers, body: { model: ai.model, stream: false, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] } };
  },
  answer(body) {
    const choice = body?.choices?.[0];
    const msg = choice?.message;
    if (msg?.refusal || choice?.finish_reason === 'content_filter') throw failed('The model declined to suggest anything for this.');
    const text = Array.isArray(msg?.content) ? msg.content.filter((p) => p?.type === 'text').map((p) => p.text).join('') : msg?.content;
    return said(text, body?.usage?.prompt_tokens, body?.usage?.completion_tokens);
  },
  health(ai, key) {
    const r = openai.request(ai, { system: '', content: [] }, key);
    return { url: join(ai.baseUrl, '/models'), headers: Object.fromEntries(Object.entries(r.headers).filter(([k]) => k !== 'content-type')) };
  },
  /** Whether the models list names the model (some servers list none: then it is not known). */
  hasModel: (ai, body) => (Array.isArray(body?.data) && body.data.length ? body.data.some((m) => m?.id === ai.model) : null),
};

const ollama = {
  /** Ollama's own chat API: images go beside the text as base64; no key is ever sent. */
  request(ai, { system, content, maxTokens }) {
    const pics = images(content).map((s) => s.data);
    return {
      url: join(ai.baseUrl, '/api/chat'),
      headers: { 'content-type': 'application/json' },
      body: { model: ai.model, stream: false, options: { num_predict: maxTokens }, messages: [{ role: 'system', content: system }, { role: 'user', content: texts(content), ...(pics.length ? { images: pics } : {}) }] },
    };
  },
  answer: (body) => said(body?.message?.content, body?.prompt_eval_count, body?.eval_count),
  health: (ai) => ({ url: join(ai.baseUrl, '/api/tags'), headers: {} }),
  // a model is named with or without its ":latest" tag
  hasModel: (ai, body) => (Array.isArray(body?.models) ? body.models.some((m) => [m?.name, m?.model].some((n) => n === ai.model || n === `${ai.model}:latest`)) : null),
};

export const ADAPTERS = { anthropic, openai, ollama };

/** The words for a status the provider answered with, by provider (the model's name is config, never a secret). */
export function statusWords(ai, status) {
  if (status === 401 || status === 403) return ai.provider === 'ollama' ? `The Ollama server at ${ai.baseUrl} refused the request (${status}).` : 'The AI provider did not take the server’s key. The owner checks MARKSTAGE_AI_KEY or ai.keyFile.';
  if (status === 404 && ai.provider !== 'anthropic') return ai.provider === 'ollama' ? `The Ollama server has no model “${ai.model}”. The owner pulls it there (ollama pull ${ai.model}) or names another in ai.model.` : `The endpoint has no model “${ai.model}”, or no chat at ${ai.baseUrl}. The owner checks ai.model and ai.baseUrl.`;
  return `The AI provider answered with an error (${status}). Try again in a moment.`;
}
