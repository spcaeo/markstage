// config.json `notify`: where alerts go besides the editor (docs/DEPLOY.md "Alerts"). Secrets never sit in the config
// file: the Slack webhook and the SMTP password come from the environment or from a file outside the site repo.
//   notify: {
//     email:   { host, port?, security?: 'starttls'|'tls'|'none', from, to?: [addresses], roles?: [roles],
//                user?, passwordFile?, caFile? }      MARKSTAGE_SMTP_USER / MARKSTAGE_SMTP_PASSWORD win over these
//     slack:   { webhookFile } | 'https://hooks.slack.com/…'   MARKSTAGE_SLACK_WEBHOOK wins
//     webhook: { url } | 'https://…'
//     digestHour: 8                                    the daily digest goes out at this hour (server time)
//   }
// https (and TLS for mail) everywhere; plain http or plain SMTP only to a loopback address outside production.
import fs from 'node:fs';
import path from 'node:path';
import { isInside } from '../config.mjs';

const ROLES = ['owner', 'administrator', 'editor', 'author', 'contributor'];
const EMAIL = /^[^\s<>@,;"]+@[^\s<>@,;"]+\.[^\s<>@,;"]+$|^[^\s<>@,;"]+@localhost$/;
const isLoopback = (host) => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);

/** Read and check `notify`; `fail(message)` throws the config error. Returns null when nothing is set up. */
export function checkNotify(n, { env = {}, production = false, contentRoot = null, fail }) {
  if (n === null || n === undefined) return null;
  if (typeof n !== 'object' || Array.isArray(n)) fail('notify must be an object: { email, slack, webhook }.');
  for (const k of Object.keys(n)) if (!['webhook', 'slack', 'email', 'digestHour'].includes(k)) fail(`notify.${k}: unknown (email, slack, webhook, digestHour).`);
  if (n.digestHour !== undefined && (!Number.isInteger(n.digestHour) || n.digestHour < 0 || n.digestHour > 23)) fail('notify.digestHour must be an hour from 0 to 23.');

  const readFile = (what, file) => {
    if (typeof file !== 'string' || !path.isAbsolute(file)) fail(`${what} must be an absolute path.`);
    if (contentRoot && isInside(contentRoot, file)) fail(`${what} must be outside the site repo.`);
    try {
      return fs.readFileSync(file, 'utf8').trim();
    } catch (e) {
      return fail(`${what} could not be read: ${e.message}`);
    }
  };
  const httpsUrl = (what, value) => {
    let u;
    try {
      u = new URL(value);
    } catch {
      fail(`${what} is not a URL.`);
    }
    if (u.protocol !== 'https:' && (production || u.protocol !== 'http:' || !isLoopback(u.hostname))) fail(`${what} must be https.`);
    return u.href;
  };

  const out = {};
  const webhook = typeof n.webhook === 'object' && n.webhook !== null ? n.webhook.url : n.webhook;
  if (webhook !== undefined && webhook !== null) out.webhook = httpsUrl('notify.webhook', webhook);

  let slack = env.MARKSTAGE_SLACK_WEBHOOK || null;
  if (!slack && n.slack !== undefined && n.slack !== null) slack = typeof n.slack === 'object' ? readFile('notify.slack.webhookFile', n.slack.webhookFile) : n.slack;
  if (slack) out.slack = httpsUrl('notify.slack', slack);

  if (n.email !== undefined && n.email !== null) {
    const e = n.email;
    if (typeof e !== 'object' || Array.isArray(e)) fail('notify.email must be an object: { host, port, security, from, to, roles }.');
    if ('password' in e) fail('notify.email: put the SMTP password in MARKSTAGE_SMTP_PASSWORD or a file (passwordFile), not in config.json.');
    if (typeof e.host !== 'string' || !e.host || /[\s/]/.test(e.host)) fail('notify.email.host must be the SMTP server name, e.g. "smtp.example.com".');
    const security = e.security ?? (e.port === 465 ? 'tls' : 'starttls');
    if (!['starttls', 'tls', 'none'].includes(security)) fail('notify.email.security must be "starttls", "tls" or "none".');
    if (security === 'none' && (production || !isLoopback(e.host))) fail('notify.email.security "none" (no TLS) is only for a relay on this machine in development.');
    const port = e.port ?? (security === 'tls' ? 465 : 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail('notify.email.port must be a port number.');
    if (typeof e.from !== 'string' || !EMAIL.test(e.from.replace(/^.*<([^<>]+)>\s*$/, '$1')) || /[\r\n]/.test(e.from)) fail('notify.email.from must be an address, e.g. "Markstage <cms@example.com>".');
    const to = e.to ?? [];
    if (!Array.isArray(to) || to.some((a) => typeof a !== 'string' || !EMAIL.test(a))) fail('notify.email.to must be a list of addresses.');
    const roles = e.roles ?? (to.length ? [] : ['owner', 'administrator']);
    if (!Array.isArray(roles) || roles.some((r) => !ROLES.includes(r))) fail(`notify.email.roles must be a list of roles (${ROLES.join(', ')}).`);
    const user = env.MARKSTAGE_SMTP_USER || e.user || null;
    const pass = env.MARKSTAGE_SMTP_PASSWORD || (e.passwordFile ? readFile('notify.email.passwordFile', e.passwordFile) : null);
    if (pass && !user) fail('notify.email: a password is set but no user (MARKSTAGE_SMTP_USER or notify.email.user).');
    const ca = e.caFile ? readFile('notify.email.caFile', e.caFile) : null;
    // the password is kept out of JSON and inspection of the config (only the mailer reads it)
    const auth = user ? Object.defineProperty({ user }, 'pass', { value: pass, enumerable: false }) : null;
    out.email = { host: e.host, port, security, from: e.from, to, roles, auth, ca };
  }
  if (!Object.keys(out).length) return null;
  if (n.digestHour !== undefined) out.digestHour = n.digestHour;
  return out;
}
