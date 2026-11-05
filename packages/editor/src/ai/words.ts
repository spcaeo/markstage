// Why there is no AI suggestion, in plain words, from the server's answer (ai/api.ts; pure, so it is unit-tested).
// Off names the env var to set (its name only, never a value); too many says when to try again; a failure says
// nothing was changed.

export const ENV_VAR = 'MARKSTAGE_AI_KEY';

/** Why there is no suggestion, in plain words. */
export interface AiTrouble {
  state: 'off' | 'rate' | 'failed' | 'denied';
  words: string;
  /** off: the env var to set */
  envVar?: string;
  /** rate: seconds until it may be asked again */
  wait?: number;
}

export const offWords = (envVar: string) =>
  `AI suggestions are off on this server. To turn them on, set ${envVar} where the server runs (the key itself stays out of the content repo), then restart it.`;

/** A refusal or failure (an ApiError: status, code, the answer's data), in plain words. */
export function trouble(err: unknown): AiTrouble {
  const e = err && typeof err === 'object' && 'status' in err ? (err as { status: number; code?: string; message: string; data?: Record<string, unknown> }) : null;
  const data = (e?.data ?? {}) as { envVar?: string; retryAfter?: number };
  if (e?.status === 503 || e?.code === 'ai-off') {
    // off for another reason than the key (no model named for an OpenAI-compatible endpoint or Ollama): the server's
    // own words say what the owner does, and there is no variable to set
    if ((data as { reason?: string }).reason && !data.envVar && e?.message) return { state: 'off', words: e.message };
    const envVar = data.envVar || ENV_VAR;
    return { state: 'off', words: offWords(envVar), envVar };
  }
  if (e?.status === 429) {
    const wait = Math.max(1, Math.ceil(Number(data.retryAfter) || 30));
    return { state: 'rate', words: e.message?.trim() || `Too many suggestions asked for in a short time. Try again in ${wait} second${wait === 1 ? '' : 's'}.`, wait };
  }
  if (e?.status === 403) return { state: 'denied', words: e.message || 'You can’t ask for suggestions here.' };
  if (e?.status === 404) return { state: 'failed', words: e.message || 'What the suggestion is for was not found: it may have been moved or deleted.' };
  const said = (err as Error)?.message?.trim();
  return { state: 'failed', words: said ? `${/[.!?]$/.test(said) ? said : `${said}.`} Nothing was changed.` : 'No suggestion this time: the AI did not answer. Nothing was changed.' };
}
