// Translate the site with AI (docs/API-TRANSLATIONS.md "AI drafts of a whole site"): the plan (a dry run), the run on
// the server with pause, resume and cancel, its report, and the drafts an entry has waiting for review.
import { request } from '../api';

export type RunStatus = 'planned' | 'expired' | 'running' | 'paused' | 'cancelled' | 'done';

export interface SiteLocale {
  code: string;
  label: string;
  sameLanguage: boolean;
  fields: string[];
}

export interface OfferedCollection {
  id: string;
  label: string;
  offered: boolean;
  /** why it cannot be included, in plain words */
  why: string | null;
  chosen?: boolean;
}

export interface PlanItem {
  collection: string;
  id: string;
  title: string;
  url: string | null;
  entryStatus: string;
  action: 'draft' | 'skip';
  reason?: string;
  why?: string;
  fields?: string[];
  chars?: number;
}

export interface Plan {
  locale: SiteLocale;
  options: { locale: string; collections: string[] | null; skipExisting: boolean };
  collections: OfferedCollection[];
  items: PlanItem[];
  counts: { entries: number; draft: number; skip: number; chars: number; tokens: { input: number; output: number }; skipped: Record<string, number> };
  time: { asks: number; perMinute: number; perDay: number; leftToday: number; minutes: number; words: string };
  /** the plan in plain words, as the command line says it */
  lines: string[];
}

export interface RunInfo {
  id: string;
  locale: SiteLocale;
  status: RunStatus;
  reason: string | null;
  createdAt: string;
  expiresAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  by: { id: string; name: string } | null;
  options: Plan['options'];
  counts: Plan['counts'];
  progress: { total: number; done: number; pending: number; waiting: { until: string; why: string } | null; created: number; skipped: number; failed: number };
}

export interface ResultItem {
  collection: string;
  id: string;
  title: string;
  action: 'created' | 'skipped' | 'failed';
  reason?: string;
  why?: string;
  fields?: string[];
  /** a created draft still waits for review */
  open?: boolean;
}

export interface RunState {
  run: RunInfo;
  plan: Plan;
  result: { items: ResultItem[]; commits: string[] } | null;
}

export interface StartInfo {
  ai: { on: boolean; why: string | null; reason: string | null; limits: { perMinute: number; perDay: number } };
  locales: SiteLocale[];
  collections: OfferedCollection[];
  runs: RunInfo[];
}

/** An AI draft an entry has waiting in one region. */
export interface WaitingDraft {
  locale: string;
  label: string;
  fields: Record<string, string>;
  before: Record<string, string>;
  source: Record<string, string>;
  by: string | null;
  at: string | null;
  run: string | null;
  model: string | null;
}

const rid = (id: string) => encodeURIComponent(id);
export const startInfo = () => request<StartInfo>('translate');
export const makePlan = (body: { locale: string; collections: string[] | null; skipExisting: boolean }) => request<{ run: RunInfo; plan: Plan }>('translate', { method: 'POST', body: JSON.stringify(body) });
export const getRun = (id: string) => request<RunState>(`translate/${rid(id)}`);
export const act = (id: string, what: 'run' | 'pause' | 'resume' | 'cancel') => request<{ run: RunInfo }>(`translate/${rid(id)}/${what}`, { method: 'POST', body: '{}' });
export const waitingDrafts = (c: string, id: string) => request<{ drafts: WaitingDraft[] }>(`translate/drafts/${encodeURIComponent(c)}/${encodeURIComponent(id)}`);
export const discardDraft = (c: string, id: string, locale: string) => request<{ ok: boolean; commit: string | null }>(`translate/drafts/${encodeURIComponent(c)}/${encodeURIComponent(id)}/${encodeURIComponent(locale)}`, { method: 'DELETE' });
