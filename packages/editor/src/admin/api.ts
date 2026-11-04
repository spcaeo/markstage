// The server's admin routes (docs/API.md "Auth", "Users", "Media", "Revisions", "Publish", "Audit log"), typed, through
// the shell's request() (CSRF token, ApiError, the 401 hand-off to the sign-in screen).
import { request } from '../api';
import { config } from '../runtime';
import type { PageChecks } from '../page-types';

export type Role = 'owner' | 'administrator' | 'editor' | 'author' | 'contributor';
export const ROLES: Role[] = ['owner', 'administrator', 'editor', 'author', 'contributor'];

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** a custom role (docs/API-ROLES.md): `role` is then its base */
  customRole: { id: string; name: string } | null;
  authorSlug: string | null;
  twoFactor: boolean;
  disabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface Me {
  user: User | null;
  csrfToken: string | null;
  setupRequired: boolean;
  devMode: boolean;
  /** what the server runs (signed in only): the menu and Your account show it */
  server?: { version: string; commit: string | null; build?: number | null; builtAt?: string | null; line?: string } | null;
}

export interface Session {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  ip: string | null;
  userAgent: string | null;
}

export interface AuditItem {
  id: number;
  at: string;
  userId: string | null;
  userName: string | null;
  ip: string | null;
  userAgent: string | null;
  action: string;
  target: string | null;
  ok: boolean;
  detail: unknown;
}

export interface Media {
  id: string;
  filename: string;
  path: string;
  url: string;
  type: string;
  width: number | null;
  height: number | null;
  bytes: number;
  alt: string;
  uploadedBy: string | null;
  uploadedAt: string;
  usedBy?: { collection: string; id: string; title: string }[];
  /** the image this one was edited from (crop, rotate, annotate); the original stays */
  derivedFrom?: string | null;
  /** its edits, newest first (GET media/:mid only) */
  derivatives?: { id: string; filename: string }[];
  /** a stock photo's source and photographer */
  credit?: { provider: string; label: string; id: string; author: string; authorUrl: string | null; sourceUrl: string | null } | null;
}

export interface StockPhoto {
  id: string;
  width: number | null;
  height: number | null;
  alt: string;
  author: string;
  authorUrl: string | null;
  sourceUrl: string | null;
  /** an API path (through this server: the CMS shows images from itself only) */
  thumb: string | null;
}

export interface Autosave {
  id: string;
  startedAt: string;
  savedAt: string;
  baseVersion: string | null;
}

/** One side of a compare: a revision, `current`, `live` or `autosave:<id>`; with docs=1 its parsed form too. */
export interface Side {
  sha: string;
  source: string | null;
  version?: string;
  savedAt?: string;
  /** live only: false when nothing was ever deployed */
  deployed?: boolean;
  doc?: Doc | null;
  frontmatter?: Record<string, unknown> | null;
  data?: Record<string, unknown> | null;
}

export interface Doc {
  type: 'doc';
  content?: DocNode[];
}
export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

export interface Preflight {
  version: string;
  status: string;
  validate: { ok: boolean; issues: { severity: string; message: string; line?: number }[]; unavailable?: boolean } | null;
  checks: { ok: boolean; results: CheckResult[] };
  /** checks that run on the fresh build during the publish (e.g. hreflang) */
  afterBuild: { id: string; label: string; blocking: boolean }[];
  /** every locale copy is checked in the build before it goes live */
  verify: boolean;
  altText: { src: string; where: string }[];
  /** sure: false when the server has no build output to look in (the page may exist: only a warning) */
  links: { href: string; where: string; problem: 'not-live' | 'unknown'; sure?: boolean; target?: { collection: string; id: string; title: string; status: string } }[];
  /** other live entries with the same search title or description */
  duplicates: { title: EntryRef[]; description: EntryRef[] };
  headings: { where: string; message: string }[];
  /** the page's type, frame and the type's checks (docs/API-PAGE-TYPES.md); null when the site or the page has none */
  page?: PageChecks | null;
  /** its topic links (docs/API-LINKS.md): pages that could link to it, links it should have; null without topics */
  topicLinks?: { ref: string; topic: string | null; in: number; incoming: number; outgoing: number; review: string } | null;
  /** the publish rules (docs/SEO.md): each one's level, the verdicts with findings, and whether publishing is refused */
  publishRules: Record<PublishRule, 'block' | 'warn' | 'off'>;
  /** a failed check of the page's type is the rule 'pageType' (its id in `check`) */
  rules: { rule: PublishRule | 'pageType' | 'synced'; level: 'block' | 'warn'; count: number; message: string; check?: string }[];
  blocked: boolean;
  addresses: Address[];
  /** the other entries a build puts live now (saved since the last deploy; never deployed: saved through Markstage) */
  alsoLive: { deployed: boolean; entries: { collection: string; id: string; title: string; by: string; at: string; deleted: boolean }[]; media: number; files: number };
}
export type Address = { locale: string | null; path: string; url: string | null };
export type PublishRule = 'altText' | 'links' | 'duplicates' | 'headings';
export type EntryRef = { collection: string; id: string; title: string };

export interface Revision {
  sha: string;
  author: { name: string; email: string };
  date: string;
  message: string;
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export interface Job {
  id: string;
  kind: string;
  status: JobStatus;
  collection: string | null;
  entryId: string | null;
  userId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  steps: { name: string; status: string; startedAt?: string; finishedAt?: string; exitCode?: number | null }[];
  log?: string;
  logOffset?: number;
  error: string | null;
  /** the entries this job's build broke on, while they still block every build */
  blocked?: BlockingEntry[];
}

/** An entry a failed build named: it blocks every build until it is fixed (or trashed). */
export interface BlockingEntry {
  collection: string;
  id: string;
  title: string;
  file: string;
}
export interface BuildBlocked {
  entries: BlockingEntry[];
  job: string | null;
  at: string;
}

export interface CheckResult {
  id: string;
  label: string;
  blocking: boolean;
  ok: boolean;
  issues: { severity: 'error' | 'warning'; message: string; line?: number }[];
  output: string;
}

const enc = encodeURIComponent;
const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });
const qs = (params: Record<string, string | number | boolean | null | undefined>) => {
  const p = new URLSearchParams();
  // a yes flag is "1", as the server's query flags read it
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '' && v !== false) p.set(k, v === true ? '1' : String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

// ---------- auth ----------
export const me = () => request<Me>('auth/me');
export const login = (email: string, password: string) =>
  request<{ user?: User; csrfToken?: string; twoFactorRequired?: boolean; challenge?: string }>('auth/login', json('POST', { email, password }));
/** `challenge` null after single sign-on: the server keeps that one in a cookie */
export const login2fa = (challenge: string | null, code: { code?: string; recoveryCode?: string }) => request<{ user: User }>('auth/login/2fa', json('POST', { ...(challenge ? { challenge } : {}), ...code }));
// single sign-on (docs/API-SSO.md): the providers for the sign-in screen, a person's links
export interface SsoProviders {
  providers: { id: string; label: string }[];
  passwordLogin: boolean;
}
export interface SsoLink {
  provider: string;
  label: string;
  email: string | null;
  createdAt: string;
  lastAt: string | null;
}
export const ssoProviders = () => request<SsoProviders>('auth/sso');
/** A plain link, not a request: the browser goes to the provider and comes back signed in. */
export const ssoStartUrl = (id: string, next: string) => apiUrl(`auth/sso/${enc(id)}/start?next=${encodeURIComponent(next)}`);
export const ssoLinks = (uid: string) => request<SsoLink[]>(`users/${enc(uid)}/sso`);
export const unlinkSso = (uid: string, provider: string) => request<{ ok: true }>(`users/${enc(uid)}/sso/${enc(provider)}`, json('DELETE'));
export const logout = () => request<{ ok: true }>('auth/logout', json('POST', {}));
export const setup = (body: { setupCode: string; email: string; name: string; password: string }) => request<{ user: User }>('auth/setup', json('POST', body));
export const acceptInvite = (body: { email: string; setupCode: string; password: string; name?: string }) => request<{ user: User }>('auth/accept-invite', json('POST', body));
export const changePassword = (currentPassword: string, newPassword: string) => request<{ ok: true }>('auth/password', json('POST', { currentPassword, newPassword }));
export const sessions = () => request<Session[]>('auth/sessions');
export const revokeSession = (sid: string) => request<{ ok: true }>(`auth/sessions/${enc(sid)}`, json('DELETE'));
export const twoFactorSetup = (password: string) => request<{ secret: string; otpauthUri: string }>('auth/2fa/setup', json('POST', { password }));
export const twoFactorEnable = (code: string) => request<{ recoveryCodes: string[] }>('auth/2fa/enable', json('POST', { code }));
export const twoFactorDisable = (password: string, code: string) => request<{ ok: true }>('auth/2fa/disable', json('POST', { password, code }));
export const newRecoveryCodes = (password: string, code: string) => request<{ recoveryCodes: string[] }>('auth/2fa/recovery-codes', json('POST', { password, code }));

// ---------- users ----------
export const users = () => request<User[]>('users');
export const user = (uid: string) => request<User>(`users/${enc(uid)}`);
/** Every signed-in user may read who is who (names for ids). */
export const usersBrief = () => request<{ id: string; name: string; authorSlug: string | null }[]>('users?brief=1');
export const invite = (body: { email: string; name: string; role: Role; authorSlug?: string }) => request<{ user: User; setupCode: string }>('users', json('POST', body));
export const updateUser = (uid: string, body: Partial<Pick<User, 'name' | 'role' | 'authorSlug' | 'disabled'>> & { customRole?: string | null }) => request<User>(`users/${enc(uid)}`, json('PATCH', body));

/** A custom role's rule (docs/API-ROLES.md): the promotion rules' shape, with collections, own and fields. */
export interface RoleRule {
  id: string;
  name: string;
  action: string[];
  effect: 'allow' | 'deny';
  collections?: string[];
  own?: true;
  what?: { only?: string[]; not?: string[]; any?: string[] };
  fields?: string[];
  when?: { windows?: { days?: string[]; from?: string; to?: string; tz?: string }[]; freezes?: { from: string; until?: string | null; words?: string }[] };
}
export type RoleBase = Exclude<Role, 'owner'>;
/** A custom role (docs/API-ROLES.md), as GET roles lists it. */
export interface CustomRole {
  id: string;
  name: string;
  base: RoleBase;
  rules: RoleRule[];
  version: string;
  people: number;
  updatedAt: string;
}
export interface RolesView {
  builtin: Role[];
  bases: RoleBase[];
  custom: CustomRole[];
  actions: { entry: string[]; abilities: { name: string; min: Role }[] };
  kinds: string[];
  collections: { id: string; label: string }[];
}
/** POST roles/check: what a person may do now, by their role's rules or its base, and each rule's part. */
export interface RoleCheck {
  user: { id: string; name: string; role: Role; customRole: { id: string; name: string } | null };
  action: string;
  /** null: it depends on the entry (name a collection and an entry) */
  allowed: boolean | null;
  by: 'rule' | 'base';
  rule: { id: string; name: string } | null;
  fields: string[] | null;
  words: string;
  trace: { rule: string; matched: boolean; why: string }[];
}
export const rolesView = () => request<RolesView>('roles');
export const customRoles = () => rolesView().then((r) => r.custom);
export const makeRole = (body: { id: string; name: string; base: RoleBase; rules: RoleRule[] }) => request<{ role: CustomRole }>('roles', json('POST', body));
export const saveRole = (id: string, body: { name: string; base: RoleBase; rules: RoleRule[]; version: string }) => request<{ role: CustomRole }>(`roles/${enc(id)}`, json('PUT', body));
export const removeRole = (id: string) => request<{ ok: true; people: number }>(`roles/${enc(id)}`, json('DELETE'));
export const checkRole = (body: { userId: string; action: string; collection?: string; id?: string }) => request<RoleCheck>('roles/check', json('POST', body));
export const resetUser = (uid: string) => request<{ setupCode: string }>(`users/${enc(uid)}/reset`, json('POST', {}));
export const reset2fa = (uid: string) => request<{ ok: true }>(`users/${enc(uid)}/2fa/reset`, json('POST', {}));
export const revokeUserSessions = (uid: string) => request<{ ok: true; revoked: number }>(`users/${enc(uid)}/revoke-sessions`, json('POST', {}));
export const deleteUser = (uid: string) => request<{ ok: true }>(`users/${enc(uid)}`, json('DELETE'));

// ---------- audit ----------
export const audit = (f: { user?: string; action?: string; from?: string; to?: string; before?: number; limit?: number }) =>
  request<{ items: AuditItem[]; next: number | null }>(`audit${qs(f)}`);

// ---------- media ----------
export const mediaList = (f: { q?: string; unused?: boolean; page?: number; perPage?: number }) =>
  request<{ items: Media[]; total: number; page: number; perPage: number }>(`media${qs(f)}`);
export const mediaItem = (mid: string) => request<Media>(`media/${enc(mid)}`);
/** The site's existing files under the media folder registered in place (owner and administrators). */
export interface MediaIndexed { found: number; added: { path: string; type: string; bytes: number; used: number }[]; known: number; skipped: { path: string; reason: string }[]; dry: boolean }
export const indexMedia = (dry = false) => request<MediaIndexed>('media/index', json('POST', { dry }));
/** The image bytes, for <img src> (which cannot go through request()). */
export const mediaFile = (mid: string) => `${config().api.replace(/\/+$/, '')}/media/${enc(mid)}/file`;
export const updateMedia = (mid: string, alt: string) => request<Media>(`media/${enc(mid)}`, json('PATCH', { alt }));
export const deleteMedia = (mid: string) => request<{ ok: true }>(`media/${enc(mid)}`, json('DELETE'));
export interface MediaDeleted {
  commit: string | null;
  deleted: { id: string; filename: string }[];
  skipped: { id: string; filename: string | null; reason: string; usedBy?: EntryRef[] }[];
}
/** Delete many files nothing uses, in one commit (Undo: undoChange). */
export const deleteMediaMany = (ids: string[]) => request<MediaDeleted>('media/delete', json('POST', { ids }));
export const upload = (file: File, from?: string) =>
  request<Media>(`media${qs({ filename: file.name, from })}`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } });
export const stockInfo = () => request<{ enabled: boolean; provider?: string; label?: string }>('stock');
export const stockSearch = (q: string, page = 1) => request<{ provider: string; label: string; page: number; perPage: number; total: number; items: StockPhoto[] }>(`stock/search${qs({ q, page })}`);
export const stockImport = (id: string, alt?: string) => request<Media>('stock/import', json('POST', { id, alt }));
/** A stock thumbnail's address for <img src>. */
export const apiUrl = (path: string) => `${config().api.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

// ---------- entries: revisions, status, checks ----------
/** A scheduled entry the publish rules stopped when it was due: still scheduled, live once nothing stops it. */
export type Held = { dueAt: string; reasons: string[] };
const entry = (c: string, id: string) => `collections/${enc(c)}/entries/${enc(id)}`;
export const getEntry = (c: string, id: string) =>
  request<{ id: string; title: string; version: string; status?: string; held?: Held; url: string | null; format: 'md' | 'json'; frontmatter?: Record<string, unknown>; doc?: Doc; data?: Record<string, unknown>; can?: { edit: boolean; publish: boolean; delete: boolean } }>(entry(c, id));
/** Save a document (md) or field changes (json) with the version it was made from; 409 when it changed since. */
export const saveEntry = (c: string, id: string, body: { version: string; doc?: Doc; frontmatter?: Record<string, unknown>; changes?: { path: string; value?: unknown; delete?: true }[]; message?: string }) =>
  request<{ ok: true; version: string }>(entry(c, id), json('PUT', body));
export const autosaves = (c: string, id: string) => request<Autosave[]>(`${entry(c, id)}/autosaves`);
export const restoreAutosave = (c: string, id: string, aid: string, version: string) => request<{ ok: true; version: string }>(`${entry(c, id)}/autosaves/${enc(aid)}/restore`, json('POST', { version }));
export const preflight = (c: string, id: string) => request<Preflight>(`${entry(c, id)}/preflight`);
export const addresses = (c: string, id: string) => request<{ title: string; status: string; addresses: Address[] }>(`${entry(c, id)}/addresses`);
export const previewUrl = (c: string, id: string) => request<{ url: string; devServer?: boolean }>(`preview/${enc(c)}/${enc(id)}`);
export const revisions = (c: string, id: string) => request<Revision[]>(`${entry(c, id)}/revisions`);
export const compare = (c: string, id: string, from: string, to: string, docs = false) =>
  request<{ from: Side; to: Side; diff: string | null }>(`${entry(c, id)}/compare${qs({ from, to, docs: docs ? 1 : null })}`);
export const restore = (c: string, id: string, sha: string, version: string) => request<{ ok: true; version: string; commit: string }>(`${entry(c, id)}/revisions/${enc(sha)}/restore`, json('POST', { version }));
export const runChecks = (c: string, id: string) => request<{ ok: boolean; results: CheckResult[] }>(`${entry(c, id)}/checks`, json('POST', {}));
/** `anyway`: past the publish rules (editors and above; audited). */
export const publish = (c: string, id: string, version: string, anyway = false) => request<{ job: string; version: string }>(`${entry(c, id)}/publish`, json('POST', anyway ? { version, anyway } : { version }));
export const unpublish = (c: string, id: string, version: string) => request<{ job: string | null; version: string; status?: string }>(`${entry(c, id)}/unpublish`, json('POST', { version }));
export const schedule = (c: string, id: string, version: string, publishAt: string) =>
  request<{ ok: true; version: string; status: 'scheduled' }>(`${entry(c, id)}/schedule`, json('POST', { version, publishAt }));
export const checksList = () => request<{ id: string; label: string; blocking: boolean; after?: string | null }[]>('checks');

// ---------- jobs ----------
export const jobs = (limit = 50) => request<Job[]>(`jobs${qs({ limit })}`);
export const job = (jid: string, since = 0) => request<Job>(`jobs/${enc(jid)}${qs({ since: since || null })}`);
export const rebuildSite = () => request<{ job: string }>('site/publish', json('POST', {}));

// ---------- Design & Code (owner/administrator write; everyone reads) ----------
export type DesignFile = { id: string; path: string; label: string; kind: 'tokens' | 'file' | 'custom' | 'script' | 'inject-head' | 'inject-foot'; lang: string; scope: string; editable: boolean; exists: boolean };
export type DesignToken = { name: string; value: string; type: 'color' | 'font' | 'size' | 'space' | 'other'; selector: string; context: string; group: string | null; line: number };
export type CodeSave = { ok: true; version: string; commit: string | null; job: string | null };
const dfile = (fid: string) => `design/files/${enc(fid)}`;
export const design = () => request<{ enabled: boolean; canEdit: boolean; order: string[]; files: DesignFile[] }>('design');
export const designFile = (fid: string) => request<Omit<DesignFile, 'scope'> & { source: string; version: string | null }>(dfile(fid));
export const saveDesignFile = (fid: string, version: string | null, source: string, message?: string) => request<CodeSave>(dfile(fid), json('PUT', { version, source, message }));
export const designDraft = (fid: string) => request<{ draft: { baseVersion: string | null; text: string; savedAt: string } | null }>(`${dfile(fid)}/draft`);
export const saveDesignDraft = (fid: string, baseVersion: string | null, source: string) => request<{ ok: true }>(`${dfile(fid)}/draft`, json('PUT', { baseVersion, source }));
export const dropDesignDraft = (fid: string) => request<{ ok: true }>(`${dfile(fid)}/draft`, json('DELETE', {}));
export const designRevisions = (fid: string) => request<Revision[]>(`${dfile(fid)}/revisions`);
export const designCompare = (fid: string, from: string, to = 'current') =>
  request<{ from: { sha: string | null; source: string | null }; to: { sha: string | null; source: string | null }; diff: string | null }>(`${dfile(fid)}/compare${qs({ from, to })}`);
export const restoreDesignFile = (fid: string, sha: string, version: string | null) => request<CodeSave>(`${dfile(fid)}/revisions/${enc(sha)}/restore`, json('POST', { version }));
export const designTokens = () => request<{ id: string; path: string; version: string | null; editable: boolean; tokens: DesignToken[]; issues: { line: number; message: string }[] }>('design/tokens');
export const saveDesignTokens = (version: string | null, values: { name: string; selector: string; context?: string; value: string }[]) => request<CodeSave>('design/tokens', json('PUT', { version, values }));
export const saveCodeInjection = (c: string, id: string, version: string, head: string, foot: string) => request<CodeSave>(`${entry(c, id)}/code-injection`, json('PUT', { version, head, foot }));

// ---------- site health and exports (owner, administrator) ----------
export type Rating = 'good' | 'needs-work' | 'poor' | null;
export type Vitals = { lcp: { p75: number | null; rating: Rating }; inp: { p75: number | null; rating: Rating }; cls: { p75: number | null; rating: Rating } } | { none: true };
/** Google's field data for the site or a page: phone and desktop, or why there is none */
export interface Speed {
  fetchedAt: string;
  phone?: Vitals;
  desktop?: Vitals;
  error?: string;
}
export interface HealthPage {
  collection: string;
  id: string;
  title: string;
  path: string | null;
  url: string | null;
  words: number | null;
  searchTitle: number;
  description: number;
  altText: number;
  links: { href: string; problem: 'not-live' | 'unknown'; sure?: boolean; target?: EntryRef }[];
  headings: number;
  speed: Speed | null;
}
export interface Health {
  pages: HealthPage[];
  counts: { live: number; drafts: number; altText: number; links: number; headings: number; longTitles: number; noDescription: number };
  duplicates: { what: 'title' | 'description'; text: string; entries: EntryRef[] }[];
  deploy: { commit: string | null; at: string | null; job: string | null; kind: string | null; canRollBack: boolean; failedSince: { id: string; kind: string; entry: string | null; at: string; error: string | null }[]; blocked: BuildBlocked | null };
  build: { known: boolean };
  disk: { free: number | null; total: number | null; media: { files: number; bytes: number } };
  speed: { on: boolean; why: 'off' | 'no-site-url' | null; site: Speed | null };
  backup: BackupStatus;
  /** where alerts go besides the editor (config notify) */
  alerts: { email: boolean; slack: boolean; webhook: boolean };
  /** what the host serves for each address of the build (the site's health hook) */
  addresses?: AddressStatus;
  /** the site's forms: team mails not sent, and each form that also sends its messages to a CRM */
  forms?: { alertFailed: number; crm?: CrmStatus };
}
export interface CrmStatus {
  forms: { form: string; label: string; kind: 'odoo'; name: string; on: boolean; problem: string | null }[];
  failed: number;
}
export type AddressStatus =
  | { on: false }
  | { on: true; running: boolean; at: string | null; stale: boolean; counts: { pages: number; redirects: number; chains: number; broken: number } | null; error: { at: string; message: string } | null };
export type AddressShow = 'broken' | 'chains' | 'redirects' | 'pages';
type EntryAt = { collection: string; id: string; title: string; status: string } | null;
export type AddressItem =
  | { path: string; linkedFrom: { path: string; entry: EntryAt }[] }
  | { hops: string[]; from: string; to: string }
  | { path: string; status: number; redirectsTo?: string; entry?: EntryAt };
export const siteAddresses = (show: AddressShow, q: string, page: number) =>
  request<AddressStatus & { show: AddressShow; items: AddressItem[]; total: number; page: number; perPage: number }>(`site/health/addresses${qs({ show, q: q || null, page: page > 1 ? page : null })}`);
export const checkAddresses = () => request<AddressStatus>('site/health/addresses', json('POST', {}));
export type BackupStatus =
  | { on: false }
  | { on: true; everyHours: number; keep: number; ships: boolean; due: string | null; late: boolean; last: { at?: string; ok: boolean; name?: string; bytes?: number; commit?: string | null; shipped?: boolean | null; failedAt?: string; error?: string } | null };
export const health = () => request<Health>('site/health');
export const rollBack = () => request<{ job: string }>('site/rollback', json('POST', {}));
export const testAlert = () => request<{ channels: { channel: 'email' | 'slack' | 'webhook'; ok: boolean; detail: string }[] }>('site/notify/test', json('POST', {}));
export const backUpNow = () => request<{ job: string }>('site/backup', json('POST', {}));
export const askSpeed = (path: string | null) => request<Speed>('site/health/speed', json('POST', path ? { path } : {}));
export type ExportKind = 'pages' | 'links' | 'images' | 'headings';
/** A CSV download (a plain GET with the session cookie): the whole site, or one entry ("<collection>/<id>"). */
export const exportUrl = (kind: ExportKind, entryRef?: string) => `${config().api.replace(/\/+$/, '')}/site/export/${kind}${entryRef ? `?entry=${encodeURIComponent(entryRef)}` : ''}`;

// ---------- notices (a failed publish, a scheduled entry held back or late): kept until seen ----------
export interface Notice {
  id: string;
  at: string;
  kind: 'publish.failed' | 'deploy.failed' | 'backup.failed' | 'schedule.held' | 'schedule.late' | string;
  level: 'error' | 'warn' | 'info';
  text: string;
  /** a hash in the editor: the job, the publish sheet, the entry */
  link: string | null;
}
export const notices = () => request<{ items: Notice[] }>('notices');
export const noticeSeen = (id: string) => request<{ ok: true }>(`notices/${encodeURIComponent(id)}/seen`, json('POST', {}));
export const noticesSeen = () => request<{ ok: true; seen: number }>('notices/seen', json('POST', {}));

// ---------- replace an image everywhere (server only; editors and above) ----------
export type ReplacePlan = { entries: { collection: string; id: string; title: string; status: string; count: number; url: string | null }[] };
export const replacePlan = (mid: string, withId: string) => request<ReplacePlan>(`media/${encodeURIComponent(mid)}/replace?with=${encodeURIComponent(withId)}`);
export const replaceMedia = (mid: string, withId: string) => request<ReplacePlan & { commit: string | null; job: string | null }>(`media/${encodeURIComponent(mid)}/replace`, json('POST', { with: withId }));
/** Undo a find and replace or an image replaced everywhere: each entry back as it was, unless changed since. */
export type Undone = { commit: string | null; undone: EntryRef[]; restored?: { id: string; filename: string }[]; skipped: (EntryRef & { reason: string })[]; job: string | null };
export const undoChange = (commit: string) => request<Undone>('site/undo', json('POST', { commit }));

// ---------- trash, and the entries that link to one (warned before a delete) ----------
export interface TrashItem {
  trashId: string;
  collection: string;
  id: string;
  title: string;
  author: string | null;
  deletedAt: string;
  deletedBy: string | null;
  /** the address it had (null for an entry without a page) */
  url: string | null;
}
export interface LinkingEntry extends EntryRef { title: string; status: string; url: string | null }
export const trash = () => request<TrashItem[]>('trash');
export const trashLinksIn = (tid: string) => request<{ url: string | null; entries: LinkingEntry[] }>(`trash/${encodeURIComponent(tid)}/links-in`);
export const restoreTrash = (tid: string) => request<{ id: string }>(`trash/${encodeURIComponent(tid)}/restore`, json('POST', {}));
export const purgeTrash = (tid: string) => request<{ ok: true }>(`trash/${encodeURIComponent(tid)}`, json('DELETE'));
export const linksIn = (c: string, id: string) => request<{ entries: (EntryRef & { status: string })[] }>(`${entry(c, id)}/links-in`);

// --- find and replace across the site; bulk actions ---------------------------------------------------------------
/** Where a match sits: plain text is replaced by default; the others only when their group is ticked. */
export type FindKind = 'text' | 'link' | 'image' | 'html' | 'code' | 'key';
/** A plain-text match as it reads: words, the match, and links (their words, with the match if it is in them). */
export type ReadPart = string | { match: string } | { link: string; label: (string | { match: string })[] };
export interface FindSample { line: number; where: 'fields' | 'text'; kind: FindKind; field: string; before: string; match: string; after: string; read?: ReadPart[]; to?: string }
export interface FindHit extends EntryRef { title: string; status: string; url: string | null; version: string; count: number; kinds: Partial<Record<FindKind, number>>; samples: FindSample[]; problem?: string | null; problems?: Partial<Record<FindKind, string | null>> }
export interface FindOptions { q: string; with?: string | null; case?: boolean; whole?: boolean; keep?: boolean; collection?: string }
export interface Skipped extends EntryRef { title: string; reason?: string; problem?: string }
const findQuery = (o: FindOptions) => {
  const p = new URLSearchParams({ q: o.q });
  if (o.with !== undefined && o.with !== null) p.set('with', o.with);
  if (o.case) p.set('case', '1');
  if (o.whole) p.set('whole', '1');
  if (o.keep && !o.case) p.set('keep', '1');
  if (o.collection) p.set('collection', o.collection);
  return p.toString();
};
export const find = (o: FindOptions) => request<{ total: number; entries: FindHit[]; more: boolean }>(`site/find?${findQuery(o)}`);
export const replaceAll = (o: FindOptions, entries: { collection: string; id: string; version: string; kinds?: FindKind[] }[]) =>
  request<{ commit: string | null; changed: (EntryRef & { title: string; count: number; kinds: FindKind[] })[]; skipped: Skipped[]; job: string | null }>('site/replace', json('POST', { q: o.q, with: o.with ?? '', case: Boolean(o.case), whole: Boolean(o.whole), keep: Boolean(o.keep && !o.case), entries }));

export type BulkAction = 'set' | 'add' | 'remove' | 'rename' | 'unpublish' | 'trash';
export type FieldValue = string | number | boolean | null | (string | number | boolean)[];
export interface BulkField { name: string; list: boolean; kind: 'list' | 'text' | 'number' | 'boolean'; entries: number; values: { value: string; entries: number }[] }
export interface BulkRequest { action: BulkAction; field?: string; value?: FieldValue; from?: (string | number | boolean)[] }
export interface BulkRow extends EntryRef { title: string; status?: string; version?: string; from?: FieldValue; to?: FieldValue; problem?: string; /** a trashed row's place in the trash (restoreTrash brings it back) */ trashId?: string }
export const bulkFields = (collection?: string) => request<{ fields: BulkField[] }>(`site/bulk/fields${collection ? `?collection=${encodeURIComponent(collection)}` : ''}`);
export const bulkPlan = (r: BulkRequest, entries: { collection: string; id: string }[]) => request<{ entries: BulkRow[] }>('site/bulk/plan', json('POST', { ...r, entries }));
export const bulkApply = (r: BulkRequest, entries: { collection: string; id: string; version: string }[]) => request<{ commit: string | null; changed: BulkRow[]; skipped: BulkRow[]; job: string | null }>('site/bulk', json('POST', { ...r, entries }));
// the lists screen: one collection's entries, filtered, sorted and paged by the server
export interface ListedEntry {
  id: string;
  title: string;
  status: 'draft' | 'scheduled' | 'published';
  held?: Held;
  author: string | null;
  tags: string[];
  date: string | null;
  modified: string | null;
  publishAt: string | null;
  url: string | null;
  version: string;
  words?: number;
  parent?: string | null;
  /** the section or topic it is in (its collection's groups.field), when the collection has groups */
  groupId?: string | null;
  /** the site's tracked locales: whether each has this entry's words (only on a site that tracks any) */
  locales?: { code: string; done: boolean }[];
}
export interface EntryList {
  items: ListedEntry[];
  total: number;
  page: number;
  perPage: number;
  counts: { all: number; draft: number; scheduled: number; published: number };
  facets: { authors: { name: string; count: number }[]; tags: { name: string; count: number }[] };
}
export type Attention = 'no-description' | 'no-title' | 'alt-text' | 'links' | 'not-translated';
export const entries = (c: string, f: { status?: string; author?: string; tag?: string; group?: string; since?: string | null; attention?: string; q?: string; sort?: string; page?: number; perPage?: number }) =>
  request<EntryList>(`collections/${enc(c)}/entries${qs({ ...f, page: f.page && f.page > 1 ? f.page : null })}`);
// many entries moved at once (the Pages tree): new names and fields set (order, parent), in one commit with redirects
export interface MoveOne { collection: string; id: string; version: string; newId?: string; newSlug?: string; set?: Record<string, string | number | boolean | null> }
export const moveMany = (moves: MoveOne[]) =>
  request<{ commit: string | null; moved: { collection: string; id: string; from: string; version: string; url: string | null; oldUrl: string | null }[]; linksUpdated: { collection: string; id: string }[]; redirects: { from: string; to: string }[]; job: string | null }>('site/move', json('POST', { moves }));
// categories, tags, authors: every value of a field; the summary of renaming, merging or deleting one everywhere
export interface TaxonomyValue { value: string | number | boolean; entries: number; live: number; collections: string[] }
export const taxonomy = (field: string) => request<{ field: string; list: boolean; values: TaxonomyValue[] }>(`site/taxonomy${qs({ field })}`);
export const taxonomyPlan = (field: string, from: (string | number | boolean)[], to: string | null) => request<{ entries: BulkRow[] }>('site/taxonomy/plan', json('POST', { field, from, to }));

// --- presence (who is editing what; the editor's heartbeat is the shell's) ------------------------------------------
export interface Editing { userId: string; name: string; since: string; you: boolean }
export const presence = () => request<{ entries: { collection: string; id: string; editing: Editing | null; open: number }[] }>('presence');

// --- redirects (the site's old -> new addresses, through its redirects hook) ----------------------------------------
export type RedirectFlagKind = 'loop' | 'chain' | 'shadowed' | 'missing' | 'duplicate' | 'bad';
export interface RedirectFlag { kind: RedirectFlagKind; text: string; trail?: string[]; fix?: string }
export interface Redirect { from: string; to: string; status: number | null; flags: RedirectFlag[] }
export interface RedirectList { on: boolean; canList: boolean; message: string | null; more?: boolean; siteUrl: string | null; redirects: Redirect[] }
export interface Hop { url: string; status: number | null; location: string | null; via: 'http' | 'page' | null }
export interface RedirectTest {
  from: string;
  build: { kind: 'page' | 'redirect' | null; to: string | null } | null;
  live: { hops?: Hop[]; verdict?: 'ok' | 'page' | 'error' | 'loop' | 'away' | 'long'; status?: number | null; text?: string; error?: string };
}
export const redirects = () => request<RedirectList>('site/redirects');
export const saveRedirect = (from: string, to: string, was?: string) => request<{ commit: string | null; job: string | null; redirect: Redirect }>('site/redirects', json('POST', { from, to, ...(was ? { was } : {}) }));
export const removeRedirects = (from: string[]) => request<{ commit: string | null; job: string | null; removed: number }>('site/redirects/remove', json('POST', { from }));
export const testRedirect = (from: string) => request<RedirectTest>('site/redirects/test', json('POST', { from }));
