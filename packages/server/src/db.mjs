// The server's own state (users, sessions, audit log, jobs, media index, snippets, autosaves, trash) in one SQLite
// file in the data dir, never in the content repo. node:sqlite is built into Node 22.13+, so no dependency.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Each entry upgrades the schema by one version (PRAGMA user_version). Append only; never edit a shipped step.
// Steps only add (CREATE TABLE/INDEX, ADD COLUMN that may be empty), so the version before an update still runs
// on the newer database after `markstage-server update --rollback` (test/update.test.mjs checks every step).
export const MIGRATIONS = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    author_slug TEXT,
    pw_hash TEXT,
    totp_secret TEXT,
    totp_pending TEXT,
    totp_last_step INTEGER NOT NULL DEFAULT 0,
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );
  CREATE TABLE recovery_codes (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at TEXT
  );
  CREATE TABLE setup_codes (
    code_hash TEXT PRIMARY KEY,
    purpose TEXT NOT NULL,            -- 'owner' (first owner, from the CLI) | 'invite' (new user or reset)
    user_id TEXT,
    expires_at INTEGER NOT NULL,
    used_at TEXT
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    ip TEXT,
    user_agent TEXT,
    revoked_at INTEGER
  );
  CREATE TABLE challenges (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE lockouts (
    key TEXT PRIMARY KEY,
    failures INTEGER NOT NULL,
    locked_until INTEGER NOT NULL DEFAULT 0,
    last_failure_at INTEGER NOT NULL
  );
  CREATE TABLE audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    user_id TEXT,
    user_name TEXT,
    ip TEXT,
    user_agent TEXT,
    action TEXT NOT NULL,
    target TEXT,
    ok INTEGER NOT NULL,
    detail TEXT
  );
  CREATE INDEX audit_action ON audit(action);
  CREATE INDEX audit_user ON audit(user_id);
  CREATE TABLE autosaves (
    user_id TEXT NOT NULL,
    collection TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    base_version TEXT,
    payload TEXT NOT NULL,
    saved_at TEXT NOT NULL,
    PRIMARY KEY (user_id, collection, entry_id)
  );
  CREATE TABLE trash (
    id TEXT PRIMARY KEY,
    collection TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    title TEXT,
    author TEXT,
    text TEXT NOT NULL,
    deleted_at TEXT NOT NULL,
    deleted_by TEXT
  );
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    collection TEXT,
    entry_id TEXT,
    user_id TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    steps TEXT NOT NULL DEFAULT '[]',
    log TEXT NOT NULL DEFAULT '',
    error TEXT
  );
  CREATE TABLE media (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    type TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    bytes INTEGER NOT NULL,
    alt TEXT NOT NULL DEFAULT '',
    uploaded_by TEXT,
    uploaded_at TEXT NOT NULL
  );
  CREATE TABLE snippets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    doc TEXT NOT NULL,
    created_by TEXT NOT NULL,
    shared INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE templates (
    id TEXT PRIMARY KEY,
    collection TEXT NOT NULL,
    name TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_by TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // 2: password-protected pages (src/protect.mjs)
  `
  CREATE TABLE protected_pages (
    collection TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    pw_hash TEXT NOT NULL,
    pw_version INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (collection, entry_id)
  );
  `,
  // 3: preview render on its own origin (src/preview/routes.mjs): one-time tickets and preview cookies
  `
  CREATE TABLE preview_tickets (
    ticket_hash TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    to_path TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE preview_sessions (
    token_hash TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    collection TEXT,
    entry_id TEXT,
    created_at INTEGER NOT NULL
  );
  `,
  // 2: edited and stock images remember their original and their credit; autosaves keep a history (time slices)
  `
  ALTER TABLE media ADD COLUMN derived_from TEXT;
  ALTER TABLE media ADD COLUMN credit TEXT;
  CREATE TABLE autosave_snapshots (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    collection TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    base_version TEXT,
    payload TEXT NOT NULL,
    started_at TEXT NOT NULL,
    saved_at TEXT NOT NULL
  );
  CREATE INDEX autosave_snapshots_entry ON autosave_snapshots (user_id, collection, entry_id, saved_at);
  `,
  // 3: a person's unsaved draft of a design file (Custom CSS, tokens, injected code), and a failed save's text
  `
  CREATE TABLE design_drafts (
    user_id TEXT NOT NULL,
    path TEXT NOT NULL,
    base_version TEXT,
    text TEXT NOT NULL,
    saved_at TEXT NOT NULL,
    PRIMARY KEY (user_id, path)
  );
  `,
  // 4: notices for people (a failed publish, a scheduled entry held back or late), shown until they mark them seen
  `
  CREATE TABLE notices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    at TEXT NOT NULL,
    kind TEXT NOT NULL,
    level TEXT NOT NULL,
    text TEXT NOT NULL,
    link TEXT,
    seen_at TEXT
  );
  CREATE INDEX notices_user ON notices (user_id, seen_at);
  `,
  `
  CREATE TABLE form_messages (
    id TEXT PRIMARY KEY,
    form TEXT NOT NULL,
    at TEXT NOT NULL,
    status TEXT NOT NULL,             -- 'new' | 'read' | 'spam' | 'archived'
    name TEXT,
    email TEXT COLLATE NOCASE,
    fields TEXT NOT NULL,             -- JSON {key: value}, the form's own fields only
    meta TEXT NOT NULL,               -- JSON {page, referrer, landing, referringDomain, source, medium}
    ip TEXT,                          -- from the connection (or a trusted proxy); cleared after 30 days
    user_agent TEXT,
    spam TEXT,                        -- why it was put aside: 'honeypot' | 'too-fast'
    source TEXT,                      -- 'wordpress' for an imported row
    source_id TEXT,
    status_by TEXT,
    status_at TEXT
  );
  CREATE INDEX form_messages_form ON form_messages (form, at);
  CREATE INDEX form_messages_ip ON form_messages (ip, at);
  CREATE INDEX form_messages_email ON form_messages (email, at);
  CREATE UNIQUE INDEX form_messages_source ON form_messages (source, source_id);
  `,
  `
  CREATE TABLE alert_prefs (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    delivery TEXT NOT NULL,           -- 'now' | 'digest' | 'editor' | 'off'
    PRIMARY KEY (user_id, kind)
  );
  CREATE TABLE alert_digest (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    link TEXT
  );
  CREATE INDEX alert_digest_user ON alert_digest (user_id, id);
  CREATE TABLE known_devices (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_hash TEXT NOT NULL,
    first_at TEXT NOT NULL,
    last_at TEXT NOT NULL,
    user_agent TEXT,
    PRIMARY KEY (user_id, device_hash)
  );
  `,
  `
  ALTER TABLE form_messages ADD COLUMN rev INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE form_messages ADD COLUMN assignee_id TEXT;
  ALTER TABLE form_messages ADD COLUMN service TEXT;
  -- the team alert of a message: NULL (no mail set up), 'pending', 'sent', 'none' (nobody to mail) or 'failed'
  -- (tried again with backoff until alert_next_at is NULL); 'read' and 'archived' from before are read as 'handled'
  ALTER TABLE form_messages ADD COLUMN alert TEXT;
  ALTER TABLE form_messages ADD COLUMN alert_tries INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE form_messages ADD COLUMN alert_next_at TEXT;
  ALTER TABLE form_messages ADD COLUMN alert_error TEXT;
  CREATE INDEX form_messages_alert ON form_messages (alert, alert_next_at);
  CREATE INDEX form_messages_assignee ON form_messages (assignee_id, at);
  CREATE TABLE form_notes (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES form_messages(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    by_id TEXT,
    by_name TEXT NOT NULL,
    text TEXT NOT NULL
  );
  CREATE INDEX form_notes_message ON form_notes (message_id, at);
  CREATE TABLE form_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL REFERENCES form_messages(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    by_id TEXT,
    by_name TEXT,
    change TEXT NOT NULL
  );
  CREATE INDEX form_events_message ON form_events (message_id, id);
  ALTER TABLE alert_prefs ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
  `,
  // 10: Environments (src/env/): promotion and sync plans, approvals tied to a sha, personal access tokens, the
  // staging site's sign-in tickets and the branch previews
  `
  CREATE TABLE env_plans (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,              -- 'promote' | 'sync'
    from_env TEXT NOT NULL,
    from_branch TEXT NOT NULL,
    from_sha TEXT,
    to_env TEXT NOT NULL,
    to_branch TEXT NOT NULL,
    to_sha TEXT,
    base_sha TEXT,
    merged_sha TEXT,
    author_id TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    status TEXT NOT NULL,
    rev INTEGER NOT NULL DEFAULT 1,
    reason TEXT,
    job_id TEXT,
    run_job_id TEXT,
    run_by TEXT,
    finished_at TEXT,
    data TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX env_plans_status ON env_plans (status, created_at);
  CREATE TABLE env_approvals (
    plan_id TEXT NOT NULL REFERENCES env_plans(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    sha TEXT NOT NULL,
    note TEXT,
    at TEXT NOT NULL,
    PRIMARY KEY (plan_id, user_id, sha)
  );
  CREATE TABLE api_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    scopes TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_used_at TEXT,
    last_used_ip TEXT,
    revoked_at TEXT
  );
  CREATE INDEX api_tokens_user ON api_tokens (user_id, created_at);
  CREATE TABLE env_gate_tickets (
    ticket_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    host TEXT NOT NULL,
    to_path TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE env_previews (
    slug TEXT PRIMARY KEY,
    branch TEXT NOT NULL,
    sha TEXT,
    status TEXT NOT NULL,
    created_by TEXT,
    created_at TEXT NOT NULL,
    built_at TEXT,
    job_id TEXT,
    error TEXT
  );
  `,
  // 11: the Library (library/items.mjs): a personal snippet's description, folder, tags, place and when it was made
  `
  ALTER TABLE snippets ADD COLUMN description TEXT NOT NULL DEFAULT '';
  ALTER TABLE snippets ADD COLUMN folder TEXT NOT NULL DEFAULT '';
  ALTER TABLE snippets ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE snippets ADD COLUMN ord REAL;
  ALTER TABLE snippets ADD COLUMN created_at TEXT;
  `,
  // 12: releases (releases/): a named set of changes published in one commit, now or at a time; their preview builds;
  // share links to a release's or a draft's preview for people without an account (only the token's hash is kept)
  `
  CREATE TABLE releases (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    publish_at TEXT,
    rev INTEGER NOT NULL DEFAULT 1,
    approvals TEXT NOT NULL DEFAULT '[]',
    checks TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    scheduled_by TEXT,
    published_at TEXT,
    published_by TEXT,
    build_time TEXT,
    commit_sha TEXT,
    revert_sha TEXT,
    job_id TEXT,
    error TEXT
  );
  CREATE INDEX releases_status ON releases (status, publish_at);
  CREATE TABLE release_items (
    id TEXT PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    rel TEXT NOT NULL,
    collection TEXT,
    entry_id TEXT,
    lib_id TEXT,
    title TEXT NOT NULL,
    base TEXT,
    sha TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    meta TEXT NOT NULL DEFAULT '{}',
    added_by TEXT NOT NULL,
    added_at TEXT NOT NULL,
    UNIQUE (release_id, rel)
  );
  CREATE INDEX release_items_rel ON release_items (rel);
  CREATE TABLE release_builds (
    target TEXT PRIMARY KEY,
    key TEXT,
    status TEXT NOT NULL,
    build_time TEXT,
    built_at TEXT,
    job_id TEXT,
    error TEXT
  );
  CREATE TABLE share_links (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    release_id TEXT,
    collection TEXT,
    entry_id TEXT,
    label TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    revoked_by TEXT,
    views INTEGER NOT NULL DEFAULT 0,
    last_view_at TEXT
  );
  CREATE INDEX share_links_target ON share_links (release_id, collection, entry_id);
  `,
  // 13: a scheduled release the rules or the site stop at its time stays scheduled, blocked, with why; a preview build
  // says what it was built from (the site's commit, the release's content), so a stale one can say which changed
  `
  ALTER TABLE releases ADD COLUMN blocked TEXT;
  ALTER TABLE release_builds ADD COLUMN head TEXT;
  ALTER TABLE release_builds ADD COLUMN content TEXT;
  `,
  // 14: a form message that also goes to a CRM (forms.<id>.crm): how that went, tried again like the team mail, and
  // the lead's id there; and the visitor's place in parts (city, region, country code) for the CRM's own fields
  `
  ALTER TABLE form_messages ADD COLUMN crm TEXT;
  ALTER TABLE form_messages ADD COLUMN crm_tries INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE form_messages ADD COLUMN crm_next_at TEXT;
  ALTER TABLE form_messages ADD COLUMN crm_error TEXT;
  ALTER TABLE form_messages ADD COLUMN crm_id TEXT;
  ALTER TABLE form_messages ADD COLUMN crm_at TEXT;
  ALTER TABLE form_messages ADD COLUMN place TEXT;
  CREATE INDEX form_messages_crm ON form_messages (crm, crm_next_at);
  `,
  // 15: the import API (import/): each plan and its run, and what each source id became (so a second import updates,
  // or leaves alone, what the first made, and sees when a person changed it since: `written` is the file's sha1)
  `
  CREATE TABLE import_runs (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    payload TEXT NOT NULL,
    plan TEXT NOT NULL,
    status TEXT NOT NULL,
    job_id TEXT,
    result TEXT,
    finished_at TEXT
  );
  CREATE TABLE import_map (
    source TEXT NOT NULL,
    kind TEXT NOT NULL,
    source_id TEXT NOT NULL,
    collection TEXT,
    target TEXT NOT NULL,
    input_hash TEXT NOT NULL,
    written TEXT,
    run_id TEXT,
    at TEXT NOT NULL,
    PRIMARY KEY (source, kind, source_id)
  );
  `,
  // 16: webhooks (webhooks/): each named address, the events it listens to and its signing secret; and each delivery,
  // tried again with backoff, with the first part of the answer (scrubbed)
  `
  CREATE TABLE webhooks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    events TEXT NOT NULL,
    secret TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE webhook_deliveries (
    id TEXT PRIMARY KEY,
    hook_id TEXT NOT NULL,
    event TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_at TEXT,
    last_status INTEGER,
    last_error TEXT,
    answer TEXT,
    last_at TEXT,
    duration_ms INTEGER,
    delivered_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX webhook_deliveries_due ON webhook_deliveries (status, next_at);
  CREATE INDEX webhook_deliveries_hook ON webhook_deliveries (hook_id, created_at);
  `,
  // 17: integrations (integrations/): each one's last good list of options (kept when a fetch fails, so editors still
  // pick from it), when it was fetched and tried, why the last try failed, and when it is due; `shape` is a hash of
  // its address and keys, so a changed config starts over
  `
  CREATE TABLE integration_cache (
    name TEXT PRIMARY KEY,
    shape TEXT NOT NULL,
    items TEXT,
    count INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    bytes INTEGER,
    status TEXT NOT NULL DEFAULT 'never',
    error TEXT,
    fetched_at TEXT,
    tried_at TEXT,
    next_at TEXT,
    refreshed_at TEXT
  );
  `,
  // 18: custom roles (custom-roles/): a named role on a base role with its rules; a person given one keeps its base
  // as their role (every rank check still holds) and names it in custom_role
  `
  CREATE TABLE custom_roles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    base TEXT NOT NULL,
    rules TEXT NOT NULL,
    rev INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT
  );
  ALTER TABLE users ADD COLUMN custom_role TEXT;
  `,
  // 19: single sign-on (auth/sso.mjs): each sign-in started (its state hashed; the nonce and PKCE verifier for its
  // callback; ten minutes, once), and each person's link to a provider's own id for them
  `
  CREATE TABLE sso_states (
    state_hash TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    nonce TEXT NOT NULL,
    verifier TEXT NOT NULL,
    next TEXT,
    created_at TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at TEXT
  );
  CREATE TABLE sso_identities (
    provider TEXT NOT NULL,
    subject TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT,
    created_at TEXT NOT NULL,
    last_at TEXT,
    PRIMARY KEY (provider, subject)
  );
  CREATE INDEX sso_identities_user ON sso_identities (user_id);
  `,
  // 20: link suggestions someone skipped (links/): kept so the Link inbox does not offer them again
  `
  CREATE TABLE link_skips (
    id TEXT PRIMARY KEY,
    from_ref TEXT NOT NULL,
    to_ref TEXT NOT NULL,
    anchor TEXT,
    user_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX link_skips_to ON link_skips (to_ref);
  `,
  // 21: emails are kept lowercased (users.mjs normalEmail). The column is UNIQUE COLLATE NOCASE (ASCII only), so
  // two rows that differ only in non-ASCII case could exist: refused with a clear error before anything changes.
  (db) => {
    const rows = db.prepare('SELECT id, email FROM users').all();
    const seen = new Map();
    for (const r of rows) {
      const low = r.email.trim().toLowerCase();
      if (seen.has(low)) throw new Error(`Two accounts have the same email in different letter cases: "${seen.get(low)}" and "${r.email}". Delete or rename one of them (markstage-server reset-password tells you which is which), then start again.`);
      seen.set(low, r.email);
    }
    const put = db.prepare('UPDATE users SET email = ? WHERE id = ?');
    for (const r of rows) if (r.email !== r.email.trim().toLowerCase()) put.run(r.email.trim().toLowerCase(), r.id);
  },
  // 22: where each media file is used (media/uses.mjs): the path pieces each entry's text names, per entry version,
  // so "unused" and "used by" are a lookup, not a scan of every text against every file. Derived data, so the step
  // may run again (a database put back to an older version, as update.test.mjs does): IF NOT EXISTS
  `
  CREATE TABLE IF NOT EXISTS media_use_entries (
    collection TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    version TEXT NOT NULL,
    PRIMARY KEY (collection, entry_id)
  );
  CREATE TABLE IF NOT EXISTS media_uses (
    collection TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    path TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS media_uses_path ON media_uses (path);
  CREATE INDEX IF NOT EXISTS media_uses_entry ON media_uses (collection, entry_id);
  `,
  // 23: the site translation's runs (translate/): its plan, where it is, and what each entry came to
  `
  CREATE TABLE IF NOT EXISTS translate_runs (
    id TEXT PRIMARY KEY,
    locale TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    plan TEXT NOT NULL,
    status TEXT NOT NULL,
    reason TEXT,
    result TEXT,
    started_at TEXT,
    finished_at TEXT,
    updated_at TEXT NOT NULL
  );
  `,
  // 24: more than one server process on one data dir (docs/SCALING.md): the processes and their heartbeats, leases
  // (a lock with an owner that frees itself when the owner stops), the limits' recent hits, who has an entry open and
  // its soft lock, the preview's unsaved states, the stock search's thumbnails, and who runs a job or a translation
  `
  CREATE TABLE IF NOT EXISTS server_processes (
    id TEXT PRIMARY KEY,
    pid INTEGER NOT NULL,
    host TEXT NOT NULL,
    kind TEXT NOT NULL,
    port INTEGER,
    started_at INTEGER NOT NULL,
    seen_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS leases (
    name TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    what TEXT,
    since INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS limit_hits (
    bucket TEXT NOT NULL,
    key TEXT NOT NULL,
    at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    owner TEXT
  );
  CREATE INDEX IF NOT EXISTS limit_hits_key ON limit_hits (bucket, key, at);
  CREATE INDEX IF NOT EXISTS limit_hits_expires ON limit_hits (expires_at);
  CREATE TABLE IF NOT EXISTS presence_tabs (
    entry TEXT NOT NULL,
    tab_key TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT,
    tab TEXT NOT NULL,
    mode TEXT NOT NULL,
    since INTEGER NOT NULL,
    seen INTEGER NOT NULL,
    PRIMARY KEY (entry, tab_key)
  );
  CREATE TABLE IF NOT EXISTS presence_locks (
    entry TEXT PRIMARY KEY,
    tab_key TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT,
    since INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS presence_taken (
    tab_key TEXT PRIMARY KEY,
    entry TEXT NOT NULL,
    by_name TEXT,
    at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS preview_states (
    key TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    text TEXT,
    css TEXT,
    at INTEGER NOT NULL,
    rev INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS stock_thumbs (
    token TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    at INTEGER NOT NULL
  );
  `,
  // 25: the process that runs a job or a site translation, a Pause or Cancel asked on another process, and where a
  // running translation is; empty columns only, added when missing (the step may run again, as 22 to 24 may)
  (db) => {
    const add = (table, column) => {
      if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
    };
    add('jobs', 'owner');
    add('translate_runs', 'owner');
    add('translate_runs', 'stop_asked');
    add('translate_runs', 'live');
  },
  // 26: how a server process is told alive without the wall clock (cluster/identity.mjs): its machine (hostname, pid
  // namespace, boot) and when its pid started; empty columns, added when missing
  (db) => {
    for (const column of ['machine', 'pid_start']) {
      if (!db.prepare('PRAGMA table_info(server_processes)').all().some((c) => c.name === column)) db.exec(`ALTER TABLE server_processes ADD COLUMN ${column} TEXT`);
    }
  },
];

/** Open (and create or upgrade) the database at `<dataDir>/markstage.db`, readable by the server user only. */
export function openDb(dataDir) {
  const file = path.join(dataDir, 'markstage.db');
  const db = new DatabaseSync(file);
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.chmodSync(file + suffix, 0o600);
    } catch {
      // the -wal/-shm files appear later; they inherit the umask set by the CLI
    }
  }
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  // another server process may be opening the same new database: switching it to WAL does not wait by itself, so it
  // is tried again for a few seconds (once it is WAL, it stays WAL and this returns at once)
  const until = Date.now() + 5000;
  for (;;) {
    try {
      db.exec('PRAGMA journal_mode = WAL');
      break;
    } catch (e) {
      if (!/locked|busy/i.test(e.message) || Date.now() > until) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  const version = () => db.prepare('PRAGMA user_version').get().user_version;
  while (version() < MIGRATIONS.length) {
    // the write lock first, then the version again: two server processes starting at once run each step once
    // (docs/SCALING.md); the second one waits (busy_timeout) and finds the step done
    db.exec('BEGIN IMMEDIATE');
    try {
      const v = version();
      if (v >= MIGRATIONS.length) {
        db.exec('COMMIT');
        break;
      }
      // a step is SQL, or a function for what SQL cannot say (a check in plain words before a change)
      if (typeof MIGRATIONS[v] === 'function') MIGRATIONS[v](db);
      else db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}

const txDepth = new WeakMap();

/**
 * Run fn inside a write transaction (node:sqlite has no helper for it). BEGIN IMMEDIATE takes the database's write
 * lock first, so what fn reads cannot change under it from another server process before it writes. Inside another
 * tx it is a savepoint: an error undoes fn's part only, and the outer transaction decides.
 */
export function tx(db, fn) {
  const depth = txDepth.get(db) ?? 0;
  const [begin, commit, undo] = depth ? [`SAVEPOINT tx${depth}`, `RELEASE tx${depth}`, `ROLLBACK TO tx${depth}; RELEASE tx${depth}`] : ['BEGIN IMMEDIATE', 'COMMIT', 'ROLLBACK'];
  db.exec(begin);
  txDepth.set(db, depth + 1);
  try {
    const out = fn();
    db.exec(commit);
    return out;
  } catch (e) {
    db.exec(undo);
    throw e;
  } finally {
    txDepth.set(db, depth);
  }
}
