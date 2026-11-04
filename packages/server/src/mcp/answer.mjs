// What an AI agent is told is the content and the facts it asked for, never a secret (docs/API-MCP.md "No secrets").
// Every answer and every error goes through scrub() last:
// - the values of the server's secrets, found by name in the environment (…PASSWORD, …SECRET, …TOKEN, …KEY, SMTP_…,
//   a form's CRM sign-in <env>_URL/_DB/_EMAIL/_PASSWORD), in its config, the AI key's file (ai.keyFile) and a sign-on
//   provider's secret file (sso clientSecretFile), become "[hidden]";
// - the git remotes' addresses (an origin URL can carry a token), and any sign-in written into a URL (https://u:p@);
// - the people's email addresses (accounts are shown by name and id only), and every `email` key is left out.
// Only a value of 8 characters or more counts as a secret, so a short value never blanks ordinary words.
import { execFileSync } from 'node:child_process';
import { keyOf } from '../env/summary.mjs';
import { secretOf } from '../integrations/config.mjs';
import { clientSecretOf } from '../auth/sso-config.mjs';

export const HIDDEN = '[hidden]';
const MIN = 8;
// an environment variable named like a secret (…_PASSWORD, …_TOKEN, …_KEY, SMTP_…), and a config or answer key that
// ends like one (password, apiKey, secretKey, …); never "author" or "titleKey"
const ENV_SECRET = /(PASS|PASSWORD|PASSWD|SECRET|TOKEN|KEY|CREDENTIALS?|DSN|SALT|_AUTH)$|(^|_)SMTP_/i;
const KEY_SECRET = /(pass|password|passwd|secret|token|apikey|privatekey|secretkey|credentials?|dsn|salt)$/i;
const USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:'"]+(?::[^\s/@'"]*)?@/gi;
const TTL_MS = 60_000;

/** Every string under a key that names a secret, in a config object (nested, arrays too). */
function configSecrets(v, out, key = '', depth = 0) {
  if (depth > 8 || v === null || v === undefined) return out;
  if (typeof v === 'string') {
    if (KEY_SECRET.test(key)) out.add(v);
    return out;
  }
  if (Array.isArray(v)) for (const x of v) configSecrets(x, out, key, depth + 1);
  else if (typeof v === 'object') for (const [k, x] of Object.entries(v)) configSecrets(x, out, k, depth + 1);
  return out;
}

export function createScrub(app, { env = process.env } = {}) {
  let cached = null;
  let at = 0;

  /** The git remotes' addresses of the content repo (an origin URL may hold a token). */
  function remotes() {
    try {
      const out = execFileSync('git', ['-C', app.config.contentRoot, 'remote', '-v'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
      return out.split('\n').map((l) => l.split(/\s+/)[1]).filter(Boolean);
    } catch {
      return [];
    }
  }

  /** The values to hide, longest first (a secret that holds another is hidden whole). */
  function values() {
    if (cached && app.clock() - at < TTL_MS) return cached;
    const set = new Set();
    for (const [k, v] of Object.entries(env)) if (typeof v === 'string' && ENV_SECRET.test(k)) set.add(v);
    // a form's CRM sign-in, by its own prefix (forms.<id>.crm.env, "ODOO" by default)
    for (const f of Object.values(app.config.forms ?? {})) {
      const p = f?.crm?.env;
      if (p) for (const k of ['URL', 'DB', 'EMAIL', 'PASSWORD']) if (env[`${p}_${k}`]) set.add(env[`${p}_${k}`]);
    }
    configSecrets(app.config, set);
    // the AI key from its file (ai.keyFile, a Docker secret): a secret by where it is, whatever its name
    const k = app.config.ai?.keyFile ? keyOf(app.config.ai, {}) : null;
    if (k) set.add(k);
    // an integration's sign-in (integrations/config.mjs), from its variable or its file
    for (const i of Object.values(app.config.integrations ?? {})) {
      const s = secretOf(i.auth, env);
      if (s) set.add(s);
    }
    // a single sign-on provider's client secret (auth/sso-config.mjs), from its variable or its file
    for (const p of app.config.sso?.providers ?? []) {
      const s = clientSecretOf(p, env);
      if (s) set.add(s);
    }
    for (const r of remotes()) set.add(r);
    for (const u of app.db.prepare('SELECT email FROM users').all()) if (u.email) set.add(u.email);
    cached = [...set].map((s) => s.trim()).filter((s) => s.length >= MIN).sort((a, b) => b.length - a.length);
    at = app.clock();
    return cached;
  }

  // the known values whole first (a remote's address is hidden whole), then any sign-in left in a URL
  const text = (s, list) => {
    let out = s;
    for (const v of list) if (out.includes(v)) out = out.split(v).join(HIDDEN);
    return out.replace(USERINFO, `$1${HIDDEN}@`);
  };

  /** A copy of `v` with no secret in it, and no `email` key. */
  function scrub(v, list = values(), depth = 0) {
    if (typeof v === 'string') return text(v, list);
    if (v === null || typeof v !== 'object' || depth > 40) return v;
    if (Array.isArray(v)) return v.map((x) => scrub(x, list, depth + 1));
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (/^emails?$/i.test(k)) continue;
      out[k] = KEY_SECRET.test(k) && typeof x === 'string' && x ? HIDDEN : scrub(x, list, depth + 1);
    }
    return out;
  }

  return { scrub, values, forget: () => (cached = null) };
}
