// AI suggestions (docs/API.md "AI suggestions"): `GET ai` says whether they are on (and, when off, why: the env var
// that turns them on, its name only and never a value, or the server's own words when something else is missing,
// such as a model to name); `POST ai/suggest {kind, …}` answers one suggestion. Nothing is written by the server:
// the writer accepts a suggestion, and it goes through the editor's own save path.
import { request } from '../api';
import type { RewriteMode } from '../router';
import { ENV_VAR, offWords, trouble as words, type AiTrouble } from './words';

export { offWords, type AiTrouble };

export type AiKind = 'alt' | 'seo' | 'summary' | 'translate' | 'rewrite' | 'links' | 'fix';
/** seo's problems: the one field a fix is for (the SEO check's search result). */
export type SeoProblem = 'title-long' | 'title-short' | 'description-missing' | 'description-long' | 'description-short';

export interface AiInfo {
  on: boolean;
  /** the environment variable that holds the key (its name) */
  envVar: string;
  kinds: AiKind[];
  /** off: what is missing ('key', or 'model' for a provider with no default model), and the server's words */
  reason?: 'key' | 'model' | null;
  why?: string | null;
}

/** What the suggestion is about, by kind (the server reads the rest itself). */
export type SuggestBody =
  | { kind: 'alt'; image: string; collection?: string; id?: string }
  | { kind: 'seo'; collection: string; id: string; title?: string; text?: string; problem?: SeoProblem; searchTitle?: string; description?: string }
  | { kind: 'summary'; plan: string }
  | { kind: 'translate'; collection: string; id: string; locale: string; fields: Record<string, string> }
  | { kind: 'rewrite'; collection: string; id: string; mode: RewriteMode; text: string }
  | { kind: 'links'; collection: string; id: string; text: string; linked: string[]; max?: number }
  | { kind: 'fix'; collection: string; id: string; problem: 'heading'; headings: { level: number; text: string }[]; index: number; after?: string }
  | { kind: 'fix'; collection: string; id: string; problem: 'link-text'; sentence: string; words: string; href: string };

/** One AI link suggestion (kind `links`): the words of the article to link, and the page, checked by the server. */
export interface AiLink {
  words: string;
  /** the page: "<collection>/<id>" */
  to: string;
  title: string;
  url: string;
  status: 'published' | 'draft';
  reason: string;
}

/** The suggested text, by field: alt, title and description, text. */
export type Suggestion = Record<string, string>;

let info: Promise<AiInfo> | null = null;

/** Whether suggestions are on (asked once per page load). A server without the route has them off; any other
 *  failure is not remembered, and asking says what it is. */
export function aiInfo(): Promise<AiInfo> {
  info ??= request<Partial<AiInfo>>('ai')
    .then((r) => ({ on: !!r.on, envVar: r.envVar || ENV_VAR, kinds: r.kinds ?? [], reason: r.reason ?? null, why: r.why ?? null }))
    .catch((err: { status?: number }) => {
      if (err?.status !== 404) info = null;
      return { on: err?.status !== 404, envVar: ENV_VAR, kinds: [] };
    });
  return info;
}

/** Why suggestions are off, in plain words: the variable to set, or the server's own reason. */
export const offTrouble = (i: AiInfo): AiTrouble => (i.reason && i.reason !== 'key' && i.why ? { state: 'off', words: i.why } : { state: 'off', words: offWords(i.envVar), envVar: i.envVar });

/** One suggestion, and the model that wrote it. */
export async function suggest(body: SuggestBody): Promise<{ suggestion: Suggestion; model: string | null }> {
  const r = await request<{ suggestion: Suggestion; model?: string }>('ai/suggest', { method: 'POST', body: JSON.stringify(body) });
  return { suggestion: r.suggestion, model: r.model ?? null };
}

/** The AI's link suggestions for an article, and how many of its ideas the server left out. */
export async function suggestLinks(body: Extract<SuggestBody, { kind: 'links' }>): Promise<{ links: AiLink[]; dropped: number; model: string | null }> {
  const r = await request<{ suggestion: { links?: AiLink[]; dropped?: number }; model?: string }>('ai/suggest', { method: 'POST', body: JSON.stringify(body) });
  return { links: r.suggestion.links ?? [], dropped: r.suggestion.dropped ?? 0, model: r.model ?? null };
}

/** A refusal or failure of ai/suggest, in plain words; an "off" answer is remembered. */
export function trouble(err: unknown): AiTrouble {
  const t = words(err);
  if (t.state === 'off') info = Promise.resolve(t.envVar ? { on: false, envVar: t.envVar, kinds: [] } : { on: false, envVar: ENV_VAR, kinds: [], reason: 'model', why: t.words });
  return t;
}
