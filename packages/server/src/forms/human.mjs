// A form's human check (docs/API-INBOX.md "The human check"), when its form says so (forms.<id>.human). Cloudflare
// Turnstile only for now: the page shows Cloudflare's widget, which posts a one-time pass with the form
// (cf-turnstile-response); Markstage asks Cloudflare whether the pass is good before the message is stored.
//   no pass, or one Cloudflare refuses      -> kept as spam ('no-human'), nobody mailed, and answered 400 "reload the
//                                               page and send it again": unlike the honeypot, saying so teaches a
//                                               bot nothing (it still needs a pass), and a real visitor with an
//                                               expired pass or an old page open is never thanked for a lost message
//   Cloudflare cannot be reached, or the server's own secret is wrong or missing (missing: the check is off, so a
//   page can go live before the secret is set)
//                                            -> the message goes through as usual (a real visitor is never lost to an
//                                               outage or a set-up slip) and its history says the check did not run
// The secret is read from the environment when a check runs (<env>_SECRET, TURNSTILE_SECRET by default); it is never
// logged, audited or kept. Cloudflare's own test secrets (1x…AA passes, 2x…AA fails) work on this machine.

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 5000;
// Cloudflare's passes are at most 2048 characters
const MAX_PASS = 2048;
// the published test secrets: their answers carry no real host name, so the host is not compared
const TEST_SECRET = /^[123]x0{20,}AA$/;
// the visitor's own problem (no pass, a bad, old or reused one), as opposed to ours or Cloudflare's
const VISITOR_CODES = new Set(['missing-input-response', 'invalid-input-response', 'timeout-or-duplicate']);

/** This form's check from the environment: {on, problem, secret}. */
export function humanSettingsOf(human, env = process.env) {
  const secret = String(env[`${human.env}_SECRET`] ?? '').trim();
  if (!secret) return { on: false, problem: `${human.env}_SECRET is not set on this server, so the human check did not run.`, secret: null };
  return { on: true, problem: null, secret };
}

/**
 * Ask Cloudflare about one pass. Resolves to
 *   {verdict: 'human'}                    a good pass for one of the site's hosts
 *   {verdict: 'bot', why}                 no pass, or one Cloudflare refused, or for another host
 *   {verdict: 'unchecked', why}           the check could not run (our secret, Cloudflare down): let it through
 * `why` holds no secret.
 */
export async function checkHuman(human, pass, { ip = null, hosts = [], env = process.env, fetchImpl = fetch } = {}) {
  // (decided by Cloudflare's error codes first, its HTTP status only when it gives none: a refusal is a refusal
  // whatever the status)
  const s = humanSettingsOf(human, env);
  const token = String(pass ?? '').trim();
  // no secret on this server: the check is off (set up the page first, then the secret), whatever was posted
  if (!s.on) return { verdict: 'unchecked', why: s.problem };
  if (!token) return { verdict: 'bot', why: 'no human-check pass was sent' };
  if (token.length > MAX_PASS) return { verdict: 'bot', why: 'the human-check pass was not one Cloudflare gives' };
  const body = new URLSearchParams({ secret: s.secret, response: token });
  if (ip) body.set('remoteip', ip);
  let res;
  try {
    res = await fetchImpl(VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return { verdict: 'unchecked', why: 'Cloudflare could not be reached, so the human check did not run.' };
  }
  const json = await res.json().catch(() => null);
  const codes = json && typeof json === 'object' && Array.isArray(json['error-codes']) ? json['error-codes'].map(String) : [];
  if (codes.some((c) => VISITOR_CODES.has(c))) return { verdict: 'bot', why: `Cloudflare refused the human-check pass (${codes.join(', ').slice(0, 200)})` };
  if (res.ok && json && json.success === true) {
    const test = TEST_SECRET.test(s.secret);
    if (!test && json.hostname && hosts.length && !hosts.includes(String(json.hostname))) return { verdict: 'bot', why: `the human-check pass was for another site (${String(json.hostname).slice(0, 100)})` };
    if (!test && human.action && json.action !== human.action) return { verdict: 'bot', why: `the human-check pass was for another form (${String(json.action ?? 'none').slice(0, 40)})` };
    return { verdict: 'human' };
  }
  if (!codes.length && res.ok && json && json.success === false) return { verdict: 'bot', why: 'Cloudflare refused the human-check pass (no reason given)' };
  if (!codes.length) return { verdict: 'unchecked', why: `Cloudflare answered ${res.status}, so the human check did not run.` };
  // invalid-input-secret, missing-input-secret, internal-error and the like: ours or Cloudflare's, not the visitor's
  return { verdict: 'unchecked', why: `the human check did not run (Cloudflare: ${codes.join(', ').slice(0, 200)}).` };
}
