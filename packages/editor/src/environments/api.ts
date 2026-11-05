// The Environments routes (docs/API-ENV.md): this server's environment, the branches on the shared remote, the plans
// that promote or sync one into it, the rollback, the promotion rules, the personal tokens (the laptop CLI's and AI
// assistants') and the branch previews. Typed calls through the shell's request() (CSRF token, ApiError, the 401
// hand-off).
import { apiPath, request } from '../api';

export interface Peer {
  name: string;
  branch: string;
  origin: string | null;
}

/** What astro dev's `GET env` answers (packages/astro/src/api.mjs): a laptop, on the branch git has checked out
 * (null outside a git folder). It has no plans, rules or peers. */
export interface LocalEnv {
  name: 'local';
  local: true;
  production: false;
  configured: true;
  branch: string | null;
}

export interface EnvInfo {
  name: string;
  production: boolean;
  /** false: no `environment` in config.json (the server is production on the branch it has) */
  configured: boolean;
  branch: string;
  upstream: string | null;
  promoteTo: string | null;
  ribbon: string | null;
  head: string | null;
  live: string | null;
  upstreamHead: string | null;
  /** against the upstream: commits here only / to sync down */
  ahead: number | null;
  behind: number | null;
  remote: { name: string; ok: boolean; lastFetchAt: string | null; error: string | null; head: string | null; ahead: number | null; behind: number | null };
  /** may this person ask the server to check the remote now (?fetch=1): promote or sync rights */
  canFetch?: boolean;
  peers: Peer[];
  previews: { on: boolean; host: string | null } | null;
  mail: string | null;
  gate: boolean;
  handoff: { to: string; url: string } | null;
  canRollback: boolean;
}

export interface Branch {
  name: string;
  sha: string;
  at: string | null;
  author: string | null;
  subject: string | null;
  /** the peer it belongs to, this environment's name, or 'branch' */
  env: string;
  ahead: number | null;
  behind: number | null;
}

export type PlanStatus = 'preparing' | 'conflicts' | 'ready' | 'blocked' | 'running' | 'done' | 'failed' | 'cancelled' | 'stale' | 'expired';
export type FileGroup = 'pages' | 'templates' | 'styles' | 'config' | 'media' | 'other';
export const GROUPS: FileGroup[] = ['pages', 'templates', 'styles', 'config', 'media', 'other'];

export interface PlanFile {
  path: string;
  status: string;
  kinds: string[];
  group: FileGroup;
  from?: string;
}

export interface Conflict {
  id: string;
  path: string;
  entry: { collection: string; id: string; title: string; label: string } | null;
  kind: 'text' | 'blocks' | 'removed-here' | 'removed-incoming' | 'added-both';
  words: string;
  /** this environment's text and the incoming one (the full plan only) */
  ours?: string | null;
  theirs?: string | null;
  merged?: string | null;
  resolved: boolean;
  take: 'ours' | 'theirs' | 'text' | null;
}

export interface Check {
  id: string;
  label: string;
  blocking: boolean;
  status: 'passed' | 'failed' | 'warned' | 'skipped';
  words: string;
  entries?: string[];
}

export interface Shot {
  width: number;
  before: string | null;
  after: string | null;
}

export interface Missing {
  kind: string;
  words: string;
}

export interface Decision {
  effect: 'allow' | 'needs' | 'deny';
  rule: { id: string; name: string } | null;
  words: string;
  missing: Missing[];
}

export interface Approval {
  userId: string;
  name: string;
  role: string;
  sha: string;
  note: string | null;
  at: string;
  /** given for the plan's merge as it is now */
  current: boolean;
}

export interface Plan {
  id: string;
  action: 'promote' | 'sync';
  from: { env: string; branch: string; sha: string };
  to: { env: string; branch: string; sha: string };
  base: string | null;
  merged: string | null;
  author: { id: string; name: string } | null;
  createdAt: string;
  expiresAt: string | null;
  status: PlanStatus;
  note: string | null;
  error: string | null;
  version: string;
  reason: string | null;
  job: string | null;
  runJob: string | null;
  /** who ran it: their id (or {id, name}) */
  runBy: string | { id: string; name: string } | null;
  finishedAt: string | null;
  /** the source branch's newest commit, when it moved on since the plan was made (the plan keeps from.sha) */
  newer: string | null;
  /** the list's plans carry counts per group in place of the files */
  files: { count: number; groups: Partial<Record<FileGroup, PlanFile[] | number>>; autoMerged?: string[] } | null;
  conflicts: Conflict[];
  checks: Check[] | null;
  pages: { changed: string[]; added: string[]; removed: string[]; removedWithoutRedirect: string[] } | null;
  shots: { status: 'done' | 'not-available' | 'failed'; words: string; pages: { path: string; kind: string; shots: Shot[] }[] } | null;
  summary: { status: 'facts' | 'ai' | 'dropped'; text: string; words?: string; facts?: string[]; ai: { model: string; dropped?: boolean; why?: string } | null } | null;
  decision: Decision | null;
  approvals: Approval[];
  link: string;
}

// ---------- rules ----------
export interface Rule {
  id: string;
  name: string;
  who?: { roles?: string[]; users?: string[]; groups?: string[] };
  action: string[];
  from?: string[];
  to?: string[];
  what?: { only?: string[]; not?: string[]; any?: string[] };
  when?: { windows?: { days?: string[]; from?: string; to?: string; tz?: string }[]; freezes?: { from: string; until?: string | null; words?: string }[] };
  requires?: { approvals?: { count: number; roles?: string[]; users?: string[] }; checks?: 'all' | string[]; stagingMinutes?: number; reason?: boolean };
  effect: 'allow' | 'allow-with-approval' | 'deny';
}

export interface RulesDoc {
  groups: Record<string, string[]>;
  rules: Rule[];
}

export interface RulesView extends RulesDoc {
  version: string;
  /** false: the starter rules, never saved here */
  saved: boolean;
  starter: RulesDoc;
  kinds: string[];
  actions: string[];
  envs: string[];
  people: { id: string; name: string; role: string }[];
}

export interface RuleCheck {
  effect: 'allow' | 'needs' | 'deny';
  rule: { id: string; name: string } | null;
  words: string;
  missing: Missing[];
  trace: { rule: string; matched: boolean; why: string }[];
  user: { id: string; name: string; role: string } | null;
  files: { path: string; kinds: string[] }[] | null;
}

// ---------- tokens and previews ----------
export interface Token {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  status: 'active' | 'expired' | 'revoked';
}

export interface Preview {
  slug: string;
  branch: string;
  sha: string;
  status: 'building' | 'ready' | 'failed';
  url: string | null;
  createdAt: string;
  builtAt: string | null;
  job: string | null;
  error: string | null;
}

const json = (method: string, body: unknown = {}): RequestInit => ({ method, body: JSON.stringify(body) });
const enc = encodeURIComponent;

export const env = (fetchRemote = false) => request<EnvInfo>(`env${fetchRemote ? '?fetch=1' : ''}`);
/** The header badge's question: the full answer from a server, or a laptop's from astro dev. */
export const where = () => request<EnvInfo | LocalEnv>('env');
export const branches = () => request<{ branches: Branch[]; remote: string; lastFetch: string | null }>('env/branches');
export const plans = (status = '') => request<{ plans: Plan[] }>(`env/plans${status ? `?status=${enc(status)}` : ''}`);
export const plan = (id: string) => request<Plan>(`env/plans/${enc(id)}`);
export const makePlan = (body: { action: 'promote' | 'sync'; source?: string; reason?: string }) => request<{ plan: Plan; job: string }>('env/plans', json('POST', body));
export const resolve = (id: string, body: { conflictId: string; take: 'ours' | 'theirs' | 'text'; text?: string; version: string }) => request<{ plan: Plan; job: string | null }>(`env/plans/${enc(id)}/resolve`, json('POST', body));
export const approve = (id: string, body: { sha: string; note?: string }) => request<{ plan: Plan }>(`env/plans/${enc(id)}/approve`, json('POST', body));
export const run = (id: string, body: { version: string; reason?: string }) => request<{ plan: Plan; job: string }>(`env/plans/${enc(id)}/run`, json('POST', body));
export const cancel = (id: string, version: string) => request<{ plan: Plan }>(`env/plans/${enc(id)}/cancel`, json('POST', { version }));
export const rollback = (reason?: string) => request<{ job: string; from: string; to: string }>('env/rollback', json('POST', reason ? { reason } : {}));
/** A screenshot's address (a plain <img>: the browser sends the session cookie). */
export const shotUrl = (id: string, file: string) => apiPath(`env/plans/${enc(id)}/shots/${enc(file)}`);

export const rules = () => request<RulesView>('env/rules');
export const saveRules = (body: RulesDoc & { version: string }) => request<RulesView>('env/rules', json('PUT', body));
export const checkRules = (body: { action: string; from?: string; to?: string; userId?: string; files?: string[]; at?: string; reason?: string; checks?: { done: boolean; passed: string[]; failed: string[] }; rules?: RulesDoc }) => request<RuleCheck>('env/rules/check', json('POST', body));

/** A token is for the command line (`scopes`, reaching /env) or for an AI assistant (`mcpScopes`, reaching /mcp), never both. */
export interface TokenGroup {
  scopes: string[];
  reaches: string;
}
export const tokens = () => request<{ tokens: Token[]; scopes: string[]; mcpScopes: string[]; groups: { cli: TokenGroup; mcp: TokenGroup }; maxDays: number; canMcpPublish?: boolean }>('me/tokens');
export const makeToken = (body: { name: string; scopes: string[]; days: number }) => request<{ token: Token; secret: string }>('me/tokens', json('POST', body));
export const revokeToken = (id: string) => request<{ token: Token }>(`me/tokens/${enc(id)}`, json('DELETE'));

export const previews = () => request<{ on: boolean; host: string | null; previews: Preview[] }>('env/previews');
export const makePreview = (branch: string) => request<{ preview: Preview; job: string }>('env/previews', json('POST', { branch }));
export const dropPreview = (slug: string) => request<{ removed: string }>(`env/previews/${enc(slug)}`, json('DELETE'));
