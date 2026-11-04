// Single sign-on (docs/API-SSO.md): the server's config.json `sso`, checked at start. Each provider is an OpenID
// Connect issuer; its client secret comes from MARKSTAGE_SSO_<ID>_SECRET or a file outside the repo (read at each
// sign-in, so a new one is used without a restart), never from the config itself.
import fs from 'node:fs';
import path from 'node:path';

const ID = /^[a-z][a-z0-9-]{0,29}$/;
const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const CREATE_ROLES = ['contributor', 'author', 'editor'];

export const secretEnvOf = (id) => `MARKSTAGE_SSO_${id.toUpperCase().replace(/-/g, '_')}_SECRET`;

/** The client secret now, or null. */
export function clientSecretOf(p, env = process.env) {
  if (env[p.secretEnv]?.trim()) return env[p.secretEnv].trim();
  if (!p.clientSecretFile) return null;
  try {
    return fs.readFileSync(p.clientSecretFile, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/** `sso: {providers: [...], passwordLogin?}` checked, or null when there is none. */
export function checkSso(raw, { env = process.env, production, contentRoot, fail, isInside, isLoopback }) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) fail('sso must be { providers: [...] }.');
  const odd = Object.keys(raw).filter((k) => !['providers', 'passwordLogin'].includes(k));
  if (odd.length) fail(`sso has keys it does not know: ${odd.join(', ')} (it takes providers, passwordLogin).`);
  if (!Array.isArray(raw.providers) || !raw.providers.length || raw.providers.length > 5) fail('sso.providers is a list of one to five OpenID Connect providers.');
  if (raw.passwordLogin !== undefined && typeof raw.passwordLogin !== 'boolean') fail('sso.passwordLogin is true or false.');
  const seen = new Set();
  const providers = raw.providers.map((p, i) => {
    const at = `sso.providers[${i}]`;
    if (!p || typeof p !== 'object' || Array.isArray(p)) fail(`${at} must be an object.`);
    const known = ['id', 'label', 'issuer', 'clientId', 'clientSecretFile', 'scopes', 'domains', 'autoCreate'];
    const extra = Object.keys(p).filter((k) => !known.includes(k));
    if (extra.length) fail(`${at} has keys it does not know: ${extra.join(', ')} (it takes ${known.join(', ')}; the client secret is MARKSTAGE_SSO_<ID>_SECRET or clientSecretFile).`);
    if (!ID.test(p.id ?? '') || seen.has(p.id)) fail(`${at}.id must be a unique short lowercase name such as "google".`);
    seen.add(p.id);
    let issuer;
    try {
      issuer = new URL(p.issuer);
    } catch {
      fail(`${at}.issuer must be the provider's issuer URL, e.g. "https://accounts.google.com".`);
    }
    if (issuer.username || issuer.password || issuer.search || issuer.hash) fail(`${at}.issuer must be a plain URL (no sign-in, query or fragment).`);
    if (issuer.protocol !== 'https:' && (production || !isLoopback(issuer.hostname))) fail(`${at}.issuer must be https.`);
    if (typeof p.clientId !== 'string' || !p.clientId.trim() || p.clientId.length > 300) fail(`${at}.clientId is the client id the provider gave this site.`);
    if (p.clientSecretFile !== undefined) {
      if (typeof p.clientSecretFile !== 'string' || !path.isAbsolute(p.clientSecretFile)) fail(`${at}.clientSecretFile must be an absolute path.`);
      if (isInside(contentRoot, path.resolve(p.clientSecretFile))) fail(`${at}.clientSecretFile must be outside the content repo: a file there can be committed, pushed and built into the site.`);
    }
    const out = {
      id: p.id,
      label: typeof p.label === 'string' && p.label.trim() ? p.label.trim().slice(0, 40) : p.id,
      // the issuer as written (an ID token's iss must equal it exactly), without a trailing slash for building URLs
      issuer: String(p.issuer),
      clientId: p.clientId.trim(),
      clientSecretFile: p.clientSecretFile ?? null,
      secretEnv: secretEnvOf(p.id),
      scopes: p.scopes ?? ['openid', 'email', 'profile'],
      domains: (p.domains ?? []).map((d) => String(d).toLowerCase()),
      autoCreate: p.autoCreate ?? null,
    };
    if (!clientSecretOf(out, env)) fail(`${at}: no client secret. Set ${out.secretEnv}, or clientSecretFile to a file outside the repo.`);
    if (!Array.isArray(out.scopes) || !out.scopes.includes('openid') || !out.scopes.includes('email') || out.scopes.some((s) => typeof s !== 'string' || !/^[\x21-\x7e]{1,100}$/.test(s))) fail(`${at}.scopes must include "openid" and "email".`);
    if (!Array.isArray(p.domains ?? []) || out.domains.some((d) => !DOMAIN.test(d))) fail(`${at}.domains is a list of email domains such as "example.com".`);
    if (out.autoCreate !== null) {
      if (typeof out.autoCreate !== 'object' || Object.keys(out.autoCreate).some((k) => k !== 'role') || !CREATE_ROLES.includes(out.autoCreate.role)) fail(`${at}.autoCreate is { role } with role ${CREATE_ROLES.join(', ')} (administrators are given their role by a person).`);
      if (!out.domains.length) fail(`${at}.autoCreate needs domains: only people with an email at those domains get an account on first sign-in.`);
    }
    return Object.freeze(out);
  });
  return Object.freeze({ providers, passwordLogin: raw.passwordLogin ?? true });
}
