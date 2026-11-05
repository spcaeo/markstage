// Server configuration: `<dataDir>/config.json` plus a few environment overrides. Secrets never live here or in the
// content repo; the server keeps its own state in the data dir, which must sit outside the content repo.
//
// Environment: MARKSTAGE_DATA_DIR (required), MARKSTAGE_CONTENT_ROOT, MARKSTAGE_PUBLIC_ORIGIN, MARKSTAGE_HOST,
// MARKSTAGE_PORT, MARKSTAGE_EDITOR_DIR (the built editor, editorDir), MARKSTAGE_DEV_NO_AUTH=1, NODE_ENV.
import fs from 'node:fs';
import path from 'node:path';
import { formsOf } from './forms/config.mjs';
import { checkNotify } from './notify/config.mjs';
import { checkAi, checkEnvironment, checkSinkMail, quietOutsideProduction } from './env/config.mjs';
import { checkSso } from './auth/sso-config.mjs';

export const ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
const COLLECTION_ID = /^[a-z][a-z0-9-]{0,39}$/;

const DEFAULTS = {
  host: '127.0.0.1',
  port: 18231,
  basePath: '/markstage',
  devNoAuth: false,
  trustProxy: false,
  session: { idleMinutes: 120, absoluteHours: 12 },
  login: { ipWindowSeconds: 600, ipMaxAttempts: 30, accountFreeFailures: 5, lockBaseSeconds: 60, lockMaxSeconds: 3600, accountMaxFailures: 50, accountWindowSeconds: 3600 },
  git: { committerName: 'Markstage', committerEmail: 'markstage@localhost' },
  // rollback: puts the release before back live (e.g. ["markstage-deploy", "rollback", "--to", "/srv/site"])
  commands: { build: null, deploy: null, rollback: null, timeoutSeconds: 900, env: {} },
  checks: [],
  // { public: 'dist', private: 'dist-private' }: status jobs check every locale copy in the build before deploying
  verify: null,
  // the site's entry check: argv (stdin = entry text), or { command, timeoutSeconds }; blocking before every write
  validate: null,
  // what stops a publish (block), only warns, or is not checked (off): docs/SEO.md section 3
  publishRules: { altText: 'block', links: 'block', duplicates: 'block', headings: 'warn' },
  collections: [],
  // documents: PDFs may be uploaded as downloads (stored as they are; false refuses them)
  // importMaxBytes: a zip of pictures (POST media/import/zip), streamed to <dataDir>/tmp and read in place
  media: { dir: 'src/assets/uploads', url: '/{path}', maxBytes: 10 * 1024 * 1024, maxSide: 2560, reencode: true, documents: true, importMaxBytes: 64 * 1024 * 1024 },
  // stock photo search in the media picker: { provider: 'unsplash' | 'pexels', keyFile } (or the key in
  // MARKSTAGE_STOCK_KEY, or `key` here: this file is in the data dir, outside the repo). Off when null.
  stock: null,
  // after a deploy (never failing the job): the CDN purge command (argv; stdin {urls} or {all: true}), and IndexNow
  // ({ key | keyFile, endpoint }: search engines re-crawl the changed pages; the site serves /<key>.txt)
  purge: null,
  indexNow: null,
  // alerts also go out by email, Slack and a webhook (notify/config.mjs; secrets from the environment or files)
  notify: null,
  // backups (backup.mjs): { dir: '/mnt/backup/markstage', everyHours: 24, keep: 7, command: null }; off when null
  backup: null,
  // field speed from the Chrome UX Report: { key | keyFile, endpoint }, the site's own Google key (crux.mjs)
  crux: null,
  compat: { collection: null },
  protectedPages: { dir: null, hosts: [], cookieHours: 12 },
  // the site's own host names (www.example.com): its forms post to Markstage there (forms/submit.mjs)
  siteHosts: [],
  // the site's forms when it has no markstage.config (forms/config.mjs); the site's own `forms` wins
  forms: null,
  // the city database for a form message's approximate place (geo/index.mjs): { file }, else <dataDir>/geoip/city.mmdb
  geoip: null,
  // which environment this server is (env/config.mjs, docs/ENVIRONMENTS.md); none: production
  environment: null,
  // the AI wording of a promotion's summary: { provider: 'anthropic', model, keyFile } (env/summary.mjs)
  ai: null,
  // the Library's shared items, one file each in the site repo (library/items.mjs)
  // importMaxBytes: a pack or a WordPress export (POST library/import), streamed to <dataDir>/tmp first
  library: { dir: 'markstage/library', importMaxBytes: 64 * 1024 * 1024 },
  scheduler: { intervalSeconds: 60 },
  // more than one server process on this data dir (docs/SCALING.md): how long a process's heartbeat and the locks it
  // holds count without being renewed; a process on another machine that stops frees its locks after this long
  processes: { leaseSeconds: 30 },
  maxBodyBytes: 4 * 1024 * 1024,
  editorDir: null,
  // preview render: its own origin (author HTML must never run on the CMS origin), a private clone of the site,
  // and the site's dev server on an odd loopback port. Off until `origin` is set. In dev mode, `devServer` (the
  // site's own dev server URL) is used instead.
  preview: {
    origin: null,
    port: 18245,
    dir: null,
    command: ['npx', 'astro', 'dev', '--host', '127.0.0.1', '--port', '{port}', '--ignore-lock'],
    ports: [18247, 18299],
    idleMinutes: 10,
    startSeconds: 90,
    // start the site's dev server when Markstage starts and keep it running (the home page is asked for once, so the
    // first page a writer opens is warm); false: start on the first page, stop after idleMinutes
    warm: true,
    // after writing a state, wait until the dev server has re-read it: this file's mtime passes the write time
    // (Astro rewrites its content store), else a fixed settleMs
    settleFile: '.astro/data-store.json',
    settleMs: 2500,
    env: {},
    devServer: null,
  },
  // share links (releases/share.mjs): a release's or a draft's preview build for people without an account, on its
  // own origin (the site's scripts run there, never on the CMS origin). Off until `origin` is set.
  share: { origin: null, port: 18251, days: 7, maxDays: 30 },
};

export class ConfigError extends Error {}

const fail = (message) => {
  throw new ConfigError(message);
};

/**
 * The real path of `p` (symlinks resolved, e.g. macOS /var -> /private/var); for a path that does not exist yet,
 * the real path of its nearest existing parent with the rest added. Every inside/outside check goes through this.
 */
export function realish(p) {
  const abs = path.resolve(p);
  const rest = [];
  for (let dir = abs; ; dir = path.dirname(dir)) {
    try {
      return path.join(fs.realpathSync(dir), ...rest);
    } catch {
      if (path.dirname(dir) === dir) return abs;
      rest.unshift(path.basename(dir));
    }
  }
}

/** Is `child` the same as or inside `parent`? Both are compared as real paths (realish), so a link cannot hide it. */
export const isInside = (parent, child) => {
  const rel = path.relative(realish(parent), realish(child));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
};
/** Strictly inside: a file or folder in `parent`, not `parent` itself. */
export const isWithin = (parent, child) => isInside(parent, child) && realish(parent) !== realish(child);

const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return fail(`Path does not exist: ${p}`);
  }
};

/** A collection's default author for new entries (an author slug), or null. */
function defaultAuthorOf(c) {
  if (c.defaultAuthor === undefined || c.defaultAuthor === null) return null;
  if (typeof c.defaultAuthor !== 'string' || !ID.test(c.defaultAuthor)) fail(`Collection "${c.id}": defaultAuthor must be an author slug like "site-team".`);
  return c.defaultAuthor;
}

const FIELD_KEY = /^[A-Za-z_][\w-]*(\.[A-Za-z_][\w-]*)*$/;
function requiredKeys(c) {
  const list = c.required ?? [];
  if (!Array.isArray(list) || list.some((k) => typeof k !== 'string' || !FIELD_KEY.test(k))) fail(`Collection "${c.id}": required must be a list of frontmatter keys such as "seo.title".`);
  return [...new Set(list)];
}

export function normalizeCollection(c, contentRoot) {
  if (!c || !COLLECTION_ID.test(c.id ?? '')) fail(`Collection id must match ${COLLECTION_ID}: ${JSON.stringify(c?.id)}`);
  if (!['md', 'mdx', 'json'].includes(c.format)) fail(`Collection "${c.id}": format must be "md", "mdx" or "json".`);
  if (typeof c.dir !== 'string' || !c.dir || path.isAbsolute(c.dir)) fail(`Collection "${c.id}": dir must be repo-relative.`);
  const abs = path.resolve(contentRoot, c.dir);
  const realDir = real(abs);
  if (!isInside(contentRoot, realDir) || realDir === contentRoot) fail(`Collection "${c.id}": dir must be inside the content repo.`);
  if (isInside(path.join(contentRoot, '.git'), realDir)) fail(`Collection "${c.id}": dir cannot be inside .git.`);
  const fields = {
    title: 'title',
    author: 'author',
    tags: 'tags',
    date: 'date',
    modified: 'modified',
    excerpt: 'excerpt',
    slug: null,
    url: null,
    ...(c.fields ?? {}),
  };
  return {
    id: c.id,
    label: String(c.label ?? c.id),
    // an MDX collection is Markdown everywhere but for its files' reader (docs/MDX.md)
    format: c.format === 'json' ? 'json' : 'md',
    mdx: c.format === 'mdx',
    dir: path.relative(contentRoot, realDir),
    absDir: realDir,
    ext: c.format === 'json' ? '.json' : `.${c.format}`,
    hasStatus: Boolean(c.hasStatus),
    fields,
    // the roles the site named itself (the rest are defaults a collection may not have, e.g. a page's author)
    fieldsGiven: Object.keys(c.fields ?? {}),
    // frontmatter keys the site's build needs in every entry ("seo.title"): a write without them is refused
    required: requiredKeys(c),
    // the keys a new entry must be given a value for (what the New sheet asks), and plain names for the keys
    ask: [],
    labels: {},
    url: typeof c.url === 'string' ? c.url : null,
    defaultAuthor: defaultAuthorOf(c),
  };
}

/** publishRules: each rule 'block', 'warn' or 'off', over the defaults. */
function rulesOf(r = {}) {
  const out = { ...DEFAULTS.publishRules };
  if (typeof r !== 'object' || r === null || Array.isArray(r)) fail('publishRules must be an object like { links: "warn" }.');
  for (const [k, v] of Object.entries(r)) {
    if (!(k in out)) fail(`publishRules.${k}: unknown rule (${Object.keys(out).join(', ')}).`);
    if (!['block', 'warn', 'off'].includes(v)) fail(`publishRules.${k} must be "block", "warn" or "off".`);
    out[k] = v;
  }
  return out;
}

const isArgv = (v) => Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string' && s.length > 0);

const isLoopback = (host) => ['127.0.0.1', 'localhost', '[::1]'].includes(host);

function checkPreview(pv, { origin, production, realData, contentRoot, port, siteHosts }) {
  let devServer = null;
  if (pv.devServer !== null) {
    try {
      devServer = new URL(pv.devServer).origin;
    } catch {
      fail('preview.devServer must be a URL like http://127.0.0.1:4321.');
    }
  }
  if (!pv.origin) return { ...pv, origin: null, host: null, devServer };
  let u;
  try {
    u = new URL(pv.origin);
  } catch {
    fail(`preview.origin is not a URL: ${pv.origin}`);
  }
  if (u.origin !== String(pv.origin).replace(/\/+$/, '')) fail('preview.origin must be an origin only (scheme://host[:port]).');
  if (u.protocol !== 'https:' && (production || !isLoopback(u.hostname))) fail('preview.origin must be https unless it is a loopback address in development.');
  // its own origin, so author HTML and scripts in a preview can never act with the CMS session
  if (u.origin === origin.origin || u.host === origin.host) fail('preview.origin must differ from publicOrigin (previews run author HTML).');
  if (siteHosts.includes(u.host)) fail('preview.origin must not be one of the site hosts (siteHosts, protectedPages.hosts).');
  if (!Number.isInteger(pv.port) || pv.port < 1 || pv.port > 65535 || pv.port === port) fail('preview.port must be a free port other than the server port.');
  const [lo, hi] = pv.ports ?? [];
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 1024 || hi > 65535 || lo > hi) fail('preview.ports must be [low, high], e.g. [18247, 18299].');
  if (!isArgv(pv.command) || !pv.command.some((a) => a.includes('{port}'))) fail('preview.command must be an argv array with a {port} placeholder.');
  const dir = pv.dir ?? path.join(realData, 'preview');
  if (!path.isAbsolute(dir)) fail('preview.dir must be an absolute path.');
  if (isInside(contentRoot, path.resolve(dir)) || isInside(path.resolve(dir), contentRoot)) fail('preview.dir must be outside the content repo.');
  return { ...pv, origin: u.origin, host: u.host, secure: u.protocol === 'https:', dir: path.resolve(dir), devServer };
}

/** share: {origin, port, days, maxDays}; an origin of its own, other than the CMS's, the preview's and the site's. */
function checkShare(sh, { origin, production, port, siteHosts, preview }) {
  const extra = Object.keys(sh).filter((k) => !['origin', 'port', 'days', 'maxDays'].includes(k));
  if (extra.length) fail(`share has no setting "${extra[0]}" (origin, port, days, maxDays).`);
  if (!Number.isInteger(sh.maxDays) || sh.maxDays < 1 || sh.maxDays > 365) fail('share.maxDays is 1 to 365.');
  if (!Number.isInteger(sh.days) || sh.days < 1 || sh.days > sh.maxDays) fail('share.days (how long a new link lasts) is 1 to share.maxDays.');
  if (!sh.origin) return { ...sh, origin: null, host: null };
  let u;
  try {
    u = new URL(sh.origin);
  } catch {
    fail(`share.origin is not a URL: ${sh.origin}`);
  }
  if (u.origin !== String(sh.origin).replace(/\/+$/, '')) fail('share.origin must be an origin only (scheme://host[:port]).');
  if (u.protocol !== 'https:' && (production || !isLoopback(u.hostname))) fail('share.origin must be https unless it is a loopback address in development.');
  if (u.host === origin.host) fail('share.origin must differ from publicOrigin (shared pages run the site\'s scripts).');
  if (preview.host && u.host === preview.host) fail('share.origin must differ from preview.origin.');
  if (siteHosts.includes(u.host)) fail('share.origin must not be one of the site hosts (siteHosts, protectedPages.hosts).');
  if (!Number.isInteger(sh.port) || sh.port < 1 || sh.port > 65535 || sh.port === port || (preview.origin && sh.port === preview.port)) fail('share.port must be a free port other than the server and preview ports.');
  return { ...sh, origin: u.origin, host: u.host, secure: u.protocol === 'https:' };
}

const STOCK = {
  unsplash: { apiBase: 'https://api.unsplash.com', imageHosts: ['images.unsplash.com'] },
  pexels: { apiBase: 'https://api.pexels.com', imageHosts: ['images.pexels.com'] },
};

/** The stock photo provider, its key and the only hosts images may be fetched from (no fetch to anywhere else). */
function checkStock(st, { env, production, contentRoot }) {
  if (st === null || st === undefined) return null;
  const base = STOCK[st.provider];
  if (!base) fail(`stock.provider must be one of: ${Object.keys(STOCK).join(', ')}.`);
  let key = env.MARKSTAGE_STOCK_KEY ?? null;
  if (!key && st.keyFile) {
    if (typeof st.keyFile !== 'string' || !path.isAbsolute(st.keyFile)) fail('stock.keyFile must be an absolute path.');
    if (isInside(contentRoot, path.resolve(st.keyFile))) fail('stock.keyFile must be outside the content repo.');
    try {
      key = fs.readFileSync(st.keyFile, 'utf8').trim();
    } catch (e) {
      fail(`stock.keyFile could not be read: ${e.message}`);
    }
  }
  key ??= typeof st.key === 'string' ? st.key.trim() : null;
  if (!key) fail('stock needs the provider key: MARKSTAGE_STOCK_KEY, stock.keyFile or stock.key.');
  // apiBase/imageHosts are for a self-hosted mirror or a test double; plain http only on loopback in development
  let apiBase = base.apiBase;
  if (st.apiBase !== undefined) {
    let u;
    try {
      u = new URL(st.apiBase);
    } catch {
      fail('stock.apiBase is not a URL.');
    }
    if (u.protocol !== 'https:' && (production || !isLoopback(u.hostname))) fail('stock.apiBase must be https.');
    apiBase = u.origin + u.pathname.replace(/\/+$/, '');
  }
  const imageHosts = st.imageHosts ?? base.imageHosts;
  if (!Array.isArray(imageHosts) || !imageHosts.length || imageHosts.some((h) => typeof h !== 'string' || !/^[a-z0-9.-]+(:\d+)?$/i.test(h))) fail('stock.imageHosts must be host names.');
  if (production && imageHosts.some((h) => isLoopback(h.split(':')[0]))) fail('stock.imageHosts cannot be loopback in production.');
  return { provider: st.provider, key, apiBase, imageHosts, httpLoopback: !production };
}

/** purge: { command: argv, timeoutSeconds }, run after every deploy with the changed addresses on stdin. */
function checkPurge(p) {
  if (p === null || p === undefined) return null;
  if (!isArgv(p.command)) fail('purge must be { command: ["node", "scripts/purge-cdn.mjs"] } (argv, no shell).');
  return { command: p.command, timeoutSeconds: Number.isFinite(p.timeoutSeconds) ? p.timeoutSeconds : 60 };
}

/**
 * backup: a folder outside the repo and the data dir (another disk or mount), how often (hours), how many to keep,
 * and an optional argv command that ships each backup further (it gets the backup folder as its last argument).
 */
function checkBackup(b, { contentRoot, dataDir }) {
  if (b === null || b === undefined) return null;
  if (typeof b.dir !== 'string' || !path.isAbsolute(b.dir)) fail('backup.dir must be an absolute path (another disk or a mounted share).');
  const dir = path.resolve(b.dir);
  if (isInside(contentRoot, dir) || isInside(dataDir, dir) || isInside(dir, contentRoot) || isInside(dir, dataDir)) fail('backup.dir must be outside the site repo and the data dir: a second place.');
  const whole = (v, d, lo, hi, name) => {
    if (v === undefined || v === null) return d;
    if (!Number.isInteger(v) || v < lo || v > hi) fail(`backup.${name} must be a whole number from ${lo} to ${hi}.`);
    return v;
  };
  if (b.command !== undefined && b.command !== null && !isArgv(b.command)) fail('backup.command must be argv like ["rclone", "copy", "--"] (no shell); the backup folder is added last.');
  return { dir, everyHours: whole(b.everyHours, 24, 1, 168, 'everyHours'), keep: whole(b.keep, 7, 1, 365, 'keep'), command: b.command ?? null, timeoutSeconds: whole(b.timeoutSeconds, 1800, 10, 86400, 'timeoutSeconds') };
}

/** indexNow: the site's own key (also served by the site at /<key>.txt) and the endpoint to tell. */
function checkIndexNow(n, { production, contentRoot }) {
  if (n === null || n === undefined) return null;
  let key = typeof n.key === 'string' ? n.key.trim() : null;
  if (!key && n.keyFile) {
    if (typeof n.keyFile !== 'string' || !path.isAbsolute(n.keyFile)) fail('indexNow.keyFile must be an absolute path.');
    if (isInside(contentRoot, path.resolve(n.keyFile))) fail('indexNow.keyFile must be outside the content repo.');
    try {
      key = fs.readFileSync(n.keyFile, 'utf8').trim();
    } catch (e) {
      fail(`indexNow.keyFile could not be read: ${e.message}`);
    }
  }
  if (!key || !/^[A-Za-z0-9-]{8,128}$/.test(key)) fail('indexNow needs its key (8 to 128 letters, digits or dashes): indexNow.key or indexNow.keyFile.');
  let u;
  try {
    u = new URL(n.endpoint ?? 'https://api.indexnow.org/indexnow');
  } catch {
    fail('indexNow.endpoint is not a URL.');
  }
  if (u.protocol !== 'https:' && (production || !isLoopback(u.hostname))) fail('indexNow.endpoint must be https.');
  return { key, endpoint: u.href };
}

/** crux: the site's own Chrome UX Report key (a key file outside the repo, or the key) and the endpoint. */
function checkCrux(n, { env, production, contentRoot }) {
  if (n === null || n === undefined) return null;
  let key = env.MARKSTAGE_CRUX_KEY ?? (typeof n.key === 'string' ? n.key.trim() : null);
  if (!key && n.keyFile) {
    if (typeof n.keyFile !== 'string' || !path.isAbsolute(n.keyFile)) fail('crux.keyFile must be an absolute path.');
    if (isInside(contentRoot, path.resolve(n.keyFile))) fail('crux.keyFile must be outside the content repo.');
    try {
      key = fs.readFileSync(n.keyFile, 'utf8').trim();
    } catch (e) {
      fail(`crux.keyFile could not be read: ${e.message}`);
    }
  }
  if (!key || !/^[A-Za-z0-9_-]{20,100}$/.test(key)) fail('crux needs the site\'s own Chrome UX Report API key: MARKSTAGE_CRUX_KEY, crux.keyFile or crux.key.');
  let u;
  try {
    u = new URL(n.endpoint ?? 'https://chromeuxreport.googleapis.com/v1/records:queryRecord');
  } catch {
    fail('crux.endpoint is not a URL.');
  }
  if (u.protocol !== 'https:' && (production || !isLoopback(u.hostname))) fail('crux.endpoint must be https.');
  return { key, endpoint: u.href };
}

/** Read, merge and validate the configuration. Throws ConfigError with a plain message. */
/** `health: { command: [argv] }`: the site's hook that says what the host serves for each address (health-addresses.mjs). */
export function healthOf(h) {
  if (h === undefined || h === null) return null;
  const ok = Array.isArray(h?.command) && h.command.length && h.command.every((x) => typeof x === 'string' && x);
  if (!ok) throw new ConfigError('health must be { command: ["node", "scripts/health.mjs"] } (argv, no shell).');
  return { command: h.command, timeoutSeconds: Number.isFinite(h.timeoutSeconds) ? h.timeoutSeconds : 120 };
}

export function loadConfig({ env = process.env, overrides = {} } = {}) {
  const dataDir = overrides.dataDir ?? env.MARKSTAGE_DATA_DIR;
  if (!dataDir || !path.isAbsolute(dataDir)) fail('Set MARKSTAGE_DATA_DIR to an absolute path (the server data dir).');
  const realData = real(dataDir);
  const file = path.join(realData, 'config.json');
  let fromFile = {};
  if (fs.existsSync(file)) {
    try {
      fromFile = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      fail(`${file} is not valid JSON: ${e.message}`);
    }
  }
  const raw = { ...DEFAULTS, ...fromFile, ...overrides };
  for (const key of ['session', 'login', 'git', 'commands', 'media', 'compat', 'scheduler', 'processes', 'protectedPages', 'preview', 'library', 'share']) {
    raw[key] = { ...DEFAULTS[key], ...(fromFile[key] ?? {}), ...(overrides[key] ?? {}) };
  }
  if (env.MARKSTAGE_CONTENT_ROOT) raw.contentRoot = env.MARKSTAGE_CONTENT_ROOT;
  if (env.MARKSTAGE_PUBLIC_ORIGIN) raw.publicOrigin = env.MARKSTAGE_PUBLIC_ORIGIN;
  if (env.MARKSTAGE_HOST) raw.host = env.MARKSTAGE_HOST;
  if (env.MARKSTAGE_PORT) raw.port = Number(env.MARKSTAGE_PORT);
  // the Docker image builds the site's editor at start and names the folder here (docs/DOCKER.md)
  if (env.MARKSTAGE_EDITOR_DIR) raw.editorDir = env.MARKSTAGE_EDITOR_DIR;
  if (env.MARKSTAGE_DEV_NO_AUTH === '1') raw.devNoAuth = true;
  const production = env.NODE_ENV === 'production';

  if (!raw.contentRoot || !path.isAbsolute(raw.contentRoot)) fail('contentRoot must be an absolute path to the site repo.');
  const contentRoot = real(raw.contentRoot);
  if (!fs.existsSync(path.join(contentRoot, '.git'))) fail(`contentRoot is not a git working copy: ${contentRoot}`);
  if (isInside(contentRoot, realData)) fail('The data dir must be outside the content repo (it holds password hashes and sessions).');
  if (isInside(realData, contentRoot)) fail('The content repo cannot be inside the data dir.');

  if (!Number.isInteger(raw.port) || raw.port < 1 || raw.port > 65535) fail(`Bad port: ${raw.port}`);
  if (Object.keys(raw.processes).some((k) => k !== 'leaseSeconds') || !Number.isFinite(raw.processes.leaseSeconds) || raw.processes.leaseSeconds < 1 || raw.processes.leaseSeconds > 600) fail('processes is { "leaseSeconds": 1 to 600 } (30 by default).');

  // dev mode: no sign-in at all, so it may only ever listen on loopback and never in production
  if (raw.devNoAuth) {
    if (production) fail('Dev mode (no sign-in) refuses to start with NODE_ENV=production.');
    if (raw.host !== '127.0.0.1') fail('Dev mode (no sign-in) only binds to 127.0.0.1.');
  }

  let publicOrigin = raw.publicOrigin;
  if (!publicOrigin) {
    if (production) fail('publicOrigin is required in production (e.g. https://cms.example.com).');
    publicOrigin = `http://${raw.host === '0.0.0.0' ? '127.0.0.1' : raw.host}:${raw.port}`;
  }
  let origin;
  try {
    origin = new URL(publicOrigin);
  } catch {
    fail(`publicOrigin is not a URL: ${publicOrigin}`);
  }
  if (origin.origin !== publicOrigin.replace(/\/+$/, '')) fail('publicOrigin must be an origin only (scheme://host[:port]).');
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
  if (origin.protocol !== 'https:' && (production || !loopback)) fail('publicOrigin must be https unless it is a loopback address in development.');
  // dev mode behind a public address (a dev config copied to a server, NODE_ENV forgotten) would sign the whole
  // internet in as the owner; only a test suite may say it knows (MARKSTAGE_I_KNOW_DEV_NO_AUTH=1)
  if (raw.devNoAuth && !loopback && env.MARKSTAGE_I_KNOW_DEV_NO_AUTH !== '1') fail(`Dev mode (no sign-in) only works with a loopback publicOrigin (http://127.0.0.1:${raw.port}), not ${origin.origin}.`);

  const collections = (raw.collections ?? []).map((c) => normalizeCollection(c, contentRoot));
  const seen = new Set();
  for (const c of collections) {
    if (seen.has(c.id)) fail(`Duplicate collection id "${c.id}".`);
    seen.add(c.id);
  }
  for (const [name, argv] of Object.entries({ build: raw.commands.build, deploy: raw.commands.deploy, rollback: raw.commands.rollback ?? null })) {
    if (argv !== null && !isArgv(argv)) fail(`commands.${name} must be an argv array like ["npm", "run", "${name}"] (no shell).`);
  }
  const checks = (raw.checks ?? []).map((c) => {
    if (!c || !COLLECTION_ID.test(c.id ?? '') || !isArgv(c.command)) fail('Each check needs an id and an argv array command.');
    // after: 'build' runs it on the fresh build, before the deploy (e.g. an hreflang check of the built pages)
    if (c.after !== undefined && c.after !== 'build') fail(`Check "${c.id}": after may only be "build".`);
    return { id: c.id, label: String(c.label ?? c.id), command: c.command, blocking: c.blocking !== false, timeoutSeconds: c.timeoutSeconds ?? 60, after: c.after ?? null };
  });
  // the build output a status job checks before deploying (every locale copy public, private or gone)
  let verify = null;
  if (raw.verify !== null && raw.verify !== undefined) {
    const dir = (key) => {
      const d = raw.verify[key];
      if (d === undefined || d === null) return null;
      if (typeof d !== 'string' || !d) fail(`verify.${key} must be the build's ${key} output folder, e.g. "dist".`);
      return path.resolve(contentRoot, d);
    };
    verify = { public: dir('public'), private: dir('private') };
    if (!verify.public) fail('verify.public is required (the build output folder, e.g. "dist").');
  }
  let validate = null;
  if (raw.validate !== null && raw.validate !== undefined) {
    const v = Array.isArray(raw.validate) ? { command: raw.validate } : raw.validate;
    if (!isArgv(v?.command)) fail('validate must be an argv array like ["node", "scripts/validate-entry.mjs"] (no shell), or { command, timeoutSeconds }.');
    validate = { command: v.command, timeoutSeconds: Number.isFinite(v.timeoutSeconds) && v.timeoutSeconds > 0 ? v.timeoutSeconds : 30 };
  }
  const mediaDir = path.resolve(contentRoot, raw.media.dir);
  for (const [key, v] of [['media.importMaxBytes', raw.media.importMaxBytes], ['library.importMaxBytes', raw.library.importMaxBytes]]) {
    if (!Number.isInteger(v) || v < 1024 * 1024 || v > 2 * 1024 * 1024 * 1024) fail(`${key} must be a whole number of bytes from 1 MB to 2 GB (default 64 MB).`);
  }
  if (!isInside(contentRoot, mediaDir) || isInside(path.join(contentRoot, '.git'), mediaDir)) fail('media.dir must be inside the content repo.');
  // iPhone photos when the image library cannot read HEIC: a converter command, e.g. ["heif-dec", "{in}", "{out}"]
  const hc = raw.media.heicCommand;
  if (hc !== undefined && hc !== null && (!isArgv(hc) || !hc.includes('{in}') || !hc.includes('{out}'))) fail('media.heicCommand must be an argv array with {in} and {out}, e.g. ["heif-dec", "{in}", "{out}"] (no shell).');
  const pp = raw.protectedPages;
  if (pp.dir !== null && (typeof pp.dir !== 'string' || !path.isAbsolute(pp.dir))) fail('protectedPages.dir must be an absolute path (the private build output).');
  if (!Array.isArray(pp.hosts) || pp.hosts.some((h) => typeof h !== 'string' || !/^[a-z0-9.-]+(:\d+)?$/i.test(h))) fail('protectedPages.hosts must be host names like "www.example.com".');
  if (pp.dir && !pp.hosts.length) fail('protectedPages.hosts must list the site host names that may serve protected pages.');
  if (pp.hosts.includes(origin.host)) fail('protectedPages.hosts must not include the Markstage host itself.');
  if (!Array.isArray(raw.siteHosts) || raw.siteHosts.some((h) => typeof h !== 'string' || !/^[a-z0-9.-]+(:\d+)?$/i.test(h))) fail('siteHosts must be host names like "www.example.com".');
  if (raw.siteHosts.includes(origin.host)) fail('siteHosts must not include the Markstage host itself.');
  // every host name the site answers on (forms, and protected pages when they are on)
  const siteHosts = [...new Set([...raw.siteHosts, ...pp.hosts].map((h) => h.toLowerCase()))];
  // block packs are code the server runs: operator config only (absolute paths, never from the content API)
  const packs = raw.packs ?? [];
  if (!Array.isArray(packs) || packs.some((p) => typeof p !== 'string' || !path.isAbsolute(p) || !fs.existsSync(p))) fail('packs must be a list of absolute paths to block pack modules.');
  // with no collections here they come from the site's markstage.config, checked there (site-config.mjs)
  if (raw.compat.collection && collections.length && !seen.has(raw.compat.collection)) fail(`compat.collection "${raw.compat.collection}" is not a collection.`);
  const stock = checkStock(raw.stock, { env, production, contentRoot });
  const crux = checkCrux(raw.crux, { env, production, contentRoot });
  const environment = checkEnvironment(raw.environment, { fail, isLoopback, production });
  // outside production nothing reaches the outside world unless environment.keep says so
  const quiet = quietOutsideProduction(environment, { purge: checkPurge(raw.purge), indexNow: checkIndexNow(raw.indexNow, { production, contentRoot }), notify: checkNotify(raw.notify, { env, production, contentRoot, fail }) });
  checkSinkMail(environment, quiet.notify, { fail, isLoopback });
  const ai = checkAi(raw.ai, { fail, contentRoot, isInside, env });
  // single sign-on through OpenID Connect providers (auth/sso.mjs)
  const sso = checkSso(raw.sso, { env, production, contentRoot, fail, isInside, isLoopback });
  const backup = checkBackup(raw.backup, { contentRoot, dataDir: realData });
  if (raw.geoip !== null && (typeof raw.geoip !== 'object' || typeof raw.geoip.file !== 'string' || !raw.geoip.file.endsWith('.mmdb') || Object.keys(raw.geoip).some((k) => k !== 'file'))) fail('geoip must be { "file": "<path>.mmdb" } (absolute, or inside the data dir).');
  if (raw.geoip && isInside(contentRoot, path.resolve(realData, raw.geoip.file))) fail('geoip.file must be outside the content repo.');
  if (Object.keys(raw.library).some((k) => k !== 'dir' && k !== 'importMaxBytes') || typeof raw.library.dir !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9._-]*(\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/.test(raw.library.dir) || raw.library.dir.split('/').some((x) => x === '..' || x === '.git')) fail('library.dir must be a folder inside the site repo, such as "markstage/library".');
  const preview = checkPreview(raw.preview, { origin, production, realData, contentRoot, port: raw.port, siteHosts });
  const share = checkShare(raw.share, { origin, production, port: raw.port, siteHosts, preview });

  return Object.freeze({
    ...raw,
    health: healthOf(raw.health),
    siteHosts,
    forms: formsOf(raw.forms, fail),
    production,
    dataDir: realData,
    contentRoot,
    publicOrigin: origin.origin,
    publicHost: origin.host,
    secure: origin.protocol === 'https:',
    collections,
    // from the site's markstage.config (site-config.mjs); a config.json-only site has one locale
    locales: null,
    siteUrl: null,
    redirects: null,
    design: null,
    decorativeClass: 'decorative',
    checks,
    verify,
    publishRules: rulesOf(raw.publishRules),
    validate,
    packs,
    media: { ...raw.media, dir: path.relative(contentRoot, mediaDir), absDir: mediaDir },
    preview,
    share,
    stock,
    purge: quiet.purge,
    indexNow: quiet.indexNow,
    crux,
    notify: quiet.notify,
    backup,
    environment,
    ai,
    sso,
  });
}
