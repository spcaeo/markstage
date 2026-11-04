// OpenID Connect for single sign-on (docs/API-SSO.md): the provider's discovery document and keys, the code
// exchange with PKCE, and the ID token's checks. Every call to the provider goes through the SSRF guard
// (library/fetch.mjs): its addresses must be public (a test's own loopback provider aside, through the test seam).
import crypto from 'node:crypto';
import { safeFetch, safePost } from '../library/fetch.mjs';

const DOC_TTL_MS = 3_600_000;
const KEYS_REFRESH_MS = 60_000;
const SKEW_S = 60;
// the signatures accepted: RSA and P-256; never `none`, never a shared-secret HMAC
const ALGS = { RS256: { kty: 'RSA', hash: 'sha256' }, PS256: { kty: 'RSA', hash: 'sha256', pss: true }, ES256: { kty: 'EC', crv: 'P-256', hash: 'sha256', p1363: true } };

export const b64url = (buf) => Buffer.from(buf).toString('base64url');
export const pkceChallenge = (verifier) => b64url(crypto.createHash('sha256').update(verifier).digest());

class OidcError extends Error {}
const no = (words) => new OidcError(words);

/** A provider's client: discovery and keys cached per server; `outbound` is the fetch's test seam. */
export function createOidc({ outbound = {}, clock = () => Date.now() } = {}) {
  const docs = new Map();
  const keys = new Map();

  async function json(url, what) {
    const r = await safeFetch(url, { maxBytes: 256 * 1024, timeoutMs: 10_000, accept: 'application/json', outbound });
    if (r.status !== 200) throw no(`The provider's ${what} answered ${r.status}.`);
    try {
      return JSON.parse(r.body.toString('utf8'));
    } catch {
      throw no(`The provider's ${what} is not JSON.`);
    }
  }

  /** The discovery document: its endpoints, checked to belong to this issuer. */
  async function discover(p) {
    const hit = docs.get(p.id);
    if (hit && clock() - hit.at < DOC_TTL_MS) return hit.doc;
    const doc = await json(`${p.issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`, 'discovery document');
    if (doc.issuer !== p.issuer) throw no(`The provider names itself ${String(doc.issuer).slice(0, 100)}, not ${p.issuer}.`);
    for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
      let u;
      try {
        u = new URL(doc[k]);
      } catch {
        throw no(`The provider's ${k} is missing.`);
      }
      if (u.protocol !== 'https:' && u.protocol !== new URL(p.issuer).protocol) throw no(`The provider's ${k} is not https.`);
    }
    docs.set(p.id, { doc, at: clock() });
    return doc;
  }

  /** The signing key for `kid` (the keys fetched again, at most once a minute, when it is not known yet). */
  async function keyFor(p, doc, kid, alg) {
    let k = keys.get(p.id);
    const pick = () => (k?.list ?? []).filter((x) => (kid ? x.kid === kid : true) && (!x.alg || x.alg === alg) && (!x.use || x.use === 'sig'));
    if (!k || (!pick().length && clock() - k.at > KEYS_REFRESH_MS)) {
      const set = await json(doc.jwks_uri, 'keys');
      k = { list: Array.isArray(set?.keys) ? set.keys : [], at: clock() };
      keys.set(p.id, k);
    }
    const found = pick();
    if (found.length !== 1) throw no(found.length ? 'The provider has several keys for this token.' : 'The token is signed with a key the provider does not list.');
    return found[0];
  }

  /** The URL that starts a sign-in at the provider. */
  async function authorizeUrl(p, { redirectUri, state, nonce, verifier }) {
    const doc = await discover(p);
    const u = new URL(doc.authorization_endpoint);
    for (const [k, v] of Object.entries({ response_type: 'code', client_id: p.clientId, redirect_uri: redirectUri, scope: p.scopes.join(' '), state, nonce, code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256' })) u.searchParams.set(k, v);
    return u.href;
  }

  /** Exchange the code for the ID token, and check it: the claims, or an OidcError in words. */
  async function signIn(p, { code, redirectUri, verifier, nonce, secret }) {
    const doc = await discover(p);
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: p.clientId, client_secret: secret, code_verifier: verifier }).toString();
    const r = await safePost(doc.token_endpoint, { body, headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, outbound });
    let tok;
    try {
      tok = JSON.parse(r.body.toString('utf8'));
    } catch {
      tok = null;
    }
    if (r.status !== 200 || typeof tok?.id_token !== 'string') throw no(`The provider did not give a sign-in token (${r.status}${typeof tok?.error === 'string' ? `: ${tok.error.slice(0, 60)}` : ''}).`);
    return verifyIdToken(p, doc, tok.id_token, nonce);
  }

  async function verifyIdToken(p, doc, token, nonce) {
    const parts = token.split('.');
    if (parts.length !== 3) throw no('The sign-in token is not a signed token.');
    let header;
    let claims;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      throw no('The sign-in token cannot be read.');
    }
    const alg = ALGS[header?.alg];
    if (!alg) throw no(`The sign-in token is signed with ${String(header?.alg).slice(0, 20)}, which is not accepted (RS256, PS256, ES256).`);
    const jwk = await keyFor(p, doc, header.kid, header.alg);
    if (jwk.kty !== alg.kty || (alg.crv && jwk.crv !== alg.crv)) throw no('The provider’s key does not fit the token’s signature.');
    let key;
    try {
      key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    } catch {
      throw no('The provider’s key cannot be read.');
    }
    const opts = { key, ...(alg.pss ? { padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 } : {}), ...(alg.p1363 ? { dsaEncoding: 'ieee-p1363' } : {}) };
    if (!crypto.verify(alg.hash, Buffer.from(`${parts[0]}.${parts[1]}`), opts, Buffer.from(parts[2], 'base64url'))) throw no('The sign-in token’s signature is wrong.');
    const now = Math.floor(clock() / 1000);
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== p.issuer) throw no('The sign-in token is from another issuer.');
    if (!aud.includes(p.clientId) || (aud.length > 1 && claims.azp !== p.clientId)) throw no('The sign-in token is for another site.');
    if (!Number.isFinite(claims.exp) || claims.exp + SKEW_S < now) throw no('The sign-in token has expired. Sign in again.');
    if (Number.isFinite(claims.iat) && claims.iat - SKEW_S > now) throw no('The sign-in token is dated in the future.');
    if (typeof nonce !== 'string' || claims.nonce !== nonce) throw no('The sign-in token is not for this sign-in.');
    if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) throw no('The sign-in token names no one.');
    return claims;
  }

  return { authorizeUrl, signIn, discover };
}

export { OidcError };
