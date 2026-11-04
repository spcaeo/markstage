// AI suggestions (docs/API.md "AI suggestions"): `GET ai` says whether they are on (and, when off, the env var that
// turns them on: its name only, never a value); `POST ai/suggest {kind, …}` answers one suggestion. Nothing is
// written by the server: the writer accepts a suggestion, and it goes through the editor's own save path.
import { request } from '../api';
import { ENV_VAR, offWords, trouble as words, type AiTrouble } from './words';

export { offWords, type AiTrouble };

export type AiKind = 'alt' | 'seo' | 'summary' | 'translate';

export interface AiInfo {
  on: boolean;
  /** the environment variable that holds the key (its name) */
  envVar: string;
  kinds: AiKind[];
}

/** What the suggestion is about, by kind (the server reads the rest itself). */
export type SuggestBody =
  | { kind: 'alt'; image: string; collection?: string; id?: string }
  | { kind: 'seo'; collection: string; id: string; title?: string; text?: string }
  | { kind: 'summary'; plan: string }
  | { kind: 'translate'; collection: string; id: string; locale: string; fields: Record<string, string> };

/** The suggested text, by field: alt, title and description, text. */
export type Suggestion = Record<string, string>;

let info: Promise<AiInfo> | null = null;

/** Whether suggestions are on (asked once per page load). A server without the route has them off; any other
 *  failure is not remembered, and asking says what it is. */
export function aiInfo(): Promise<AiInfo> {
  info ??= request<Partial<AiInfo>>('ai')
    .then((r) => ({ on: !!r.on, envVar: r.envVar || ENV_VAR, kinds: r.kinds ?? [] }))
    .catch((err: { status?: number }) => {
      if (err?.status !== 404) info = null;
      return { on: err?.status !== 404, envVar: ENV_VAR, kinds: [] };
    });
  return info;
}

/** One suggestion, and the model that wrote it. */
export async function suggest(body: SuggestBody): Promise<{ suggestion: Suggestion; model: string | null }> {
  const r = await request<{ suggestion: Suggestion; model?: string }>('ai/suggest', { method: 'POST', body: JSON.stringify(body) });
  return { suggestion: r.suggestion, model: r.model ?? null };
}

/** A refusal or failure of ai/suggest, in plain words; an "off" answer is remembered. */
export function trouble(err: unknown): AiTrouble {
  const t = words(err);
  if (t.state === 'off') info = Promise.resolve({ on: false, envVar: t.envVar!, kinds: [] });
  return t;
}
