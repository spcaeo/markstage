// A small OpenID Connect provider on loopback for the single sign-on tests: discovery, its keys, and a token endpoint
// that checks the client's secret and the PKCE verifier before it hands out an ID token signed with a key made here.
// `authorize(url, claims)` plays the person signing in at the provider: it reads the sign-in URL Markstage made and
// returns {code, state, redirectUri}; a browser goes to /authorize instead, signed in there as `idp.person`. `tamper`
// changes the next token (claims, alg, key) to show each check.
import crypto from 'node:crypto';
import { startWebSite } from './web-site.mjs';

export async function fakeOidc({ clients }) {
  const keyPair = () => crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const { publicKey, privateKey } = keyPair();
  const stranger = keyPair().privateKey;
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const codes = new Map();
  const tokenCalls = [];
  const idp = { tamper: null, person: null, tokenCalls };
  let base;

  const sign = (claims, { alg = 'RS256', key = privateKey, kid = 'k1' } = {}) => {
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const head = enc({ alg, kid, typ: 'JWT' });
    const body = enc(claims);
    const sig = alg === 'none' ? '' : crypto.sign('sha256', Buffer.from(`${head}.${body}`), key).toString('base64url');
    return `${head}.${body}.${sig}`;
  };
  const readForm = async (req) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
  };

  const site = await startWebSite({
    // the provider's own sign-in page, for a browser (e2e): `idp.person` has signed in there and agrees at once
    '/authorize': (req) => {
      if (!idp.person) return { status: 400, type: 'text/plain', body: 'nobody is signed in at the provider' };
      const at = idp.authorize(`${base}${req.url}`, idp.person);
      return { status: 302, headers: { Location: `${at.redirectUri}?code=${at.code}&state=${encodeURIComponent(at.state)}` } };
    },
    '/.well-known/openid-configuration': () => ({ type: 'application/json', body: JSON.stringify({ issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, jwks_uri: `${base}/jwks` }) }),
    '/jwks': { type: 'application/json', body: JSON.stringify({ keys: [jwk] }) },
    '/token': async (req) => {
      const f = await readForm(req);
      tokenCalls.push(f);
      const c = codes.get(f.code);
      const challenge = crypto.createHash('sha256').update(f.code_verifier ?? '').digest('base64url');
      if (!c || clients[f.client_id] !== f.client_secret || c.clientId !== f.client_id || c.redirectUri !== f.redirect_uri || c.challenge !== challenge) return { status: 400, type: 'application/json', body: '{"error":"invalid_grant"}' };
      codes.delete(f.code);
      const t = idp.tamper ?? {};
      idp.tamper = null;
      const claims = { ...c.claims, ...(t.claims ?? {}) };
      return { type: 'application/json', body: JSON.stringify({ access_token: 'x', token_type: 'Bearer', id_token: sign(claims, { alg: t.alg, key: t.stranger ? stranger : privateKey }) }) };
    },
  });
  base = site.base;

  /** The person signs in at the provider: a code for the sign-in URL Markstage sent them to. */
  idp.authorize = (url, claims = {}) => {
    const u = new URL(url);
    const q = Object.fromEntries(u.searchParams);
    const code = crypto.randomBytes(12).toString('hex');
    const now = Math.floor(Date.now() / 1000);
    codes.set(code, { clientId: q.client_id, redirectUri: q.redirect_uri, challenge: q.code_challenge, claims: { iss: base, aud: q.client_id, iat: now, exp: now + 300, nonce: q.nonce, ...claims } });
    return { code, state: q.state, redirectUri: q.redirect_uri, query: q };
  };
  idp.site = site;
  idp.issuer = base;
  idp.close = () => site.close();
  return idp;
}
