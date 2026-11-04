// A small SMTP client for alert mail, with no dependency: one message per connection. It speaks EHLO, then STARTTLS
// (port 587, never falling back to plain text when the server does not offer it) or implicit TLS (port 465), then
// AUTH PLAIN or LOGIN when credentials are set, MAIL FROM, RCPT TO for each recipient, DATA, QUIT. The body is
// UTF-8 plain text in base64 (no line can start with a dot); headers are stripped of line breaks. Plain text without
// TLS only to a loopback relay in development (checked in notify/config.mjs).
import crypto from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';

export class SmtpError extends Error {}

const clean = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
/** A header value: ASCII as it is, anything else as an RFC 2047 encoded word. */
const header = (s) => (/^[\x20-\x7e]*$/.test(clean(s)) ? clean(s) : `=?UTF-8?B?${Buffer.from(clean(s), 'utf8').toString('base64')}?=`);
/** The bare address of "Name <a@b>" or "a@b". */
export const addressOf = (s) => (/<([^<>\s]+@[^<>\s]+)>\s*$/.exec(s)?.[1] ?? clean(s));

/** The message as sent after DATA (CRLF line ends, ending with the lone dot). */
export function compose({ from, to, subject, text, replyTo = null, now = new Date() }) {
  const domain = addressOf(from).split('@')[1] ?? 'markstage.invalid';
  const name = /^(.*?)\s*<[^<>]+>\s*$/.exec(clean(from))?.[1]?.replace(/^"|"$/g, '');
  const body = Buffer.from(String(text).replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return [
    `From: ${name ? `${header(name)} <${addressOf(from)}>` : addressOf(from)}`,
    `To: ${to.map(addressOf).join(', ')}`,
    `Subject: ${header(subject)}`,
    // one plain address only (a form visitor's): anything else is left out, never a header of its own
    ...(replyTo && /^[^\s<>@,;"]+@[^\s<>@,;"]+$/.test(clean(replyTo)) ? [`Reply-To: ${clean(replyTo)}`] : []),
    `Date: ${now.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    'Auto-Submitted: auto-generated',
    '',
    body,
    '.',
    '',
  ].join('\r\n');
}

/**
 * Send one message. `security`: 'starttls' | 'tls' | 'none'; `auth`: {user, pass} or null; `ca`: extra trusted
 * certificates (PEM) for a relay with its own CA. Resolves {accepted: [...]}; rejects with SmtpError in plain words
 * (never the password).
 */
export function sendMail({ host, port, security = 'starttls', auth = null, ca = null, from, to, subject, text, replyTo = null, timeoutMs = 20_000, now }) {
  return new Promise((resolve, reject) => {
    let socket;
    let buf = '';
    let waiting = null;
    let done = false;
    const finish = (err, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket?.destroy();
      if (err) reject(err instanceof SmtpError ? err : new SmtpError(`${host}:${port}: ${err.message}`));
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new SmtpError(`${host}:${port} did not answer within ${timeoutMs / 1000} s.`)), timeoutMs);

    const pump = () => {
      if (!waiting) return;
      const lines = buf.split('\r\n');
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3}(?: |$)/.test(lines[i])) {
          const reply = lines.slice(0, i + 1);
          buf = lines.slice(i + 1).join('\r\n');
          const w = waiting;
          waiting = null;
          w({ code: Number(reply[i].slice(0, 3)), lines: reply.map((l) => l.slice(4)) });
          return;
        }
      }
    };
    const attach = (s) => {
      socket = s;
      s.on('data', (d) => {
        buf += d.toString('utf8');
        pump();
      });
      s.on('error', (e) => finish(e));
      s.on('close', () => finish(new SmtpError(`${host}:${port} closed the connection.`)));
    };
    const reply = () =>
      new Promise((r) => {
        waiting = r;
        pump();
      });
    /** Send a line (null: only read) and expect one of `codes`. */
    const step = async (line, codes, what = line?.split(' ')[0] ?? 'greeting') => {
      if (line !== null) socket.write(`${line}\r\n`);
      const r = await reply();
      if (!codes.includes(r.code)) throw new SmtpError(`${host}:${port} refused ${what}: ${r.code} ${r.lines.join(' ').slice(0, 300)}`);
      return r;
    };

    const talk = async () => {
      const me = 'markstage.localhost';
      await step(null, [220]);
      let ehlo = await step(`EHLO ${me}`, [250]);
      if (security === 'starttls') {
        if (!ehlo.lines.some((l) => /^STARTTLS\b/i.test(l))) throw new SmtpError(`${host}:${port} does not offer STARTTLS, so nothing was sent (set security "tls" for port 465).`);
        await step('STARTTLS', [220]);
        const plain = socket;
        plain.removeAllListeners('data');
        plain.removeAllListeners('close');
        plain.removeAllListeners('error');
        await new Promise((ok, bad) => {
          const s = tls.connect({ socket: plain, host, servername: net.isIP(host) ? undefined : host, ca: ca ?? undefined }, ok);
          s.once('error', bad);
          attach(s);
        });
        buf = '';
        ehlo = await step(`EHLO ${me}`, [250]);
      }
      if (auth?.user) {
        const methods = ehlo.lines.find((l) => /^AUTH\b/i.test(l))?.toUpperCase() ?? '';
        if (methods.includes('PLAIN')) await step(`AUTH PLAIN ${Buffer.from(`\u0000${auth.user}\u0000${auth.pass ?? ''}`).toString('base64')}`, [235], 'the user name and password');
        else {
          await step('AUTH LOGIN', [334], 'AUTH LOGIN');
          await step(Buffer.from(auth.user).toString('base64'), [334], 'the user name');
          await step(Buffer.from(auth.pass ?? '').toString('base64'), [235], 'the user name and password');
        }
      }
      await step(`MAIL FROM:<${addressOf(from)}>`, [250]);
      const accepted = [];
      for (const r of to) {
        await step(`RCPT TO:<${addressOf(r)}>`, [250, 251], `the recipient ${addressOf(r)}`);
        accepted.push(addressOf(r));
      }
      await step('DATA', [354]);
      await step(compose({ from, to, subject, text, replyTo, now }).replace(/\r\n$/, ''), [250], 'the message');
      socket.write('QUIT\r\n');
      return { accepted };
    };

    const open = security === 'tls' ? tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, ca: ca ?? undefined }) : net.connect({ host, port });
    attach(open);
    talk().then((v) => finish(null, v), (e) => finish(e));
  });
}
