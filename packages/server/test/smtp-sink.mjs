// A local SMTP sink for the alert tests: it takes mail on 127.0.0.1 (an odd five-digit port that is free), offers
// STARTTLS when given a certificate, checks AUTH PLAIN / LOGIN against one test account, and keeps every message.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';

/** A self-signed certificate for 127.0.0.1 in `dir`: {key, cert} (PEM). */
export function testCertificate(dir) {
  const key = path.join(dir, 'smtp-key.pem');
  const cert = path.join(dir, 'smtp-cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'pipe' });
  return { key: fs.readFileSync(key, 'utf8'), cert: fs.readFileSync(cert, 'utf8') };
}

/** Listen on the first free odd port from `from`; resolves the port. */
async function listenOdd(server, from = 18301) {
  for (let port = from | 1; port < 18999; port += 2) {
    const ok = await new Promise((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => resolve(true));
    });
    if (ok) return port;
  }
  throw new Error('no free odd port for the SMTP sink');
}

/**
 * Start the sink. `tlsOptions`: {key, cert} to offer STARTTLS; `account`: {user, pass} to require AUTH.
 * Resolves {port, messages: [{from, to, data, tls, user}], sessions, close()}.
 */
export async function smtpSink({ tlsOptions = null, account = null, from } = {}) {
  const messages = [];
  const sessions = [];
  const open = new Set();
  const server = net.createServer((raw) => {
    open.add(raw);
    raw.on('close', () => open.delete(raw));
    const s = { tls: false, user: null, from: null, to: [], commands: [] };
    sessions.push(s);
    let sock = raw;
    let buf = '';
    let inData = false;
    let data = '';
    let authLogin = null;
    const say = (line) => sock.write(`${line}\r\n`);
    const onLine = (line) => {
      if (inData) {
        if (line === '.') {
          inData = false;
          messages.push({ from: s.from, to: s.to, data, tls: s.tls, user: s.user });
          data = '';
          return say('250 queued');
        }
        data += `${line.startsWith('..') ? line.slice(1) : line}\r\n`;
        return;
      }
      s.commands.push(line.split(' ')[0].toUpperCase());
      if (authLogin) {
        const v = Buffer.from(line, 'base64').toString('utf8');
        if (authLogin.step === 'user') {
          authLogin = { step: 'pass', user: v };
          return say('334 UGFzc3dvcmQ6');
        }
        const ok = account && authLogin.user === account.user && v === account.pass;
        s.user = ok ? authLogin.user : null;
        authLogin = null;
        return say(ok ? '235 ok' : '535 bad credentials');
      }
      const [verb, ...rest] = line.split(' ');
      const arg = rest.join(' ');
      switch (verb.toUpperCase()) {
        case 'EHLO':
          return sock.write(['250-sink', ...(tlsOptions && !s.tls ? ['250-STARTTLS'] : []), ...(account ? ['250-AUTH PLAIN LOGIN'] : []), '250 8BITMIME'].join('\r\n') + '\r\n');
        case 'STARTTLS': {
          say('220 go ahead');
          raw.removeAllListeners('data');
          sock = new tls.TLSSocket(raw, { isServer: true, ...tlsOptions });
          s.tls = true;
          sock.on('data', onData);
          sock.on('error', () => {});
          return;
        }
        case 'AUTH': {
          if (/^PLAIN /i.test(arg)) {
            const [, user, pass] = Buffer.from(arg.slice(6), 'base64').toString('utf8').split('\u0000');
            const ok = account && user === account.user && pass === account.pass;
            s.user = ok ? user : null;
            return say(ok ? '235 ok' : '535 bad credentials');
          }
          authLogin = { step: 'user' };
          return say('334 VXNlcm5hbWU6');
        }
        case 'MAIL':
          if (account && !s.user) return say('530 authentication required');
          s.from = /<(.*)>/.exec(arg)?.[1] ?? null;
          return say('250 ok');
        case 'RCPT':
          s.to.push(/<(.*)>/.exec(arg)?.[1]);
          return say('250 ok');
        case 'DATA':
          inData = true;
          return say('354 end with .');
        case 'QUIT':
          say('221 bye');
          return sock.end();
        default:
          return say('502 not here');
      }
    };
    const onData = (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        onLine(line);
      }
    };
    raw.on('data', onData);
    raw.on('error', () => {});
    say('220 sink ready');
  });
  const port = await listenOdd(server, from);
  // a mail still on its way when a test ends (a failed test, or a server closed first) must not keep the run open
  const close = () =>
    new Promise((r) => {
      server.close(r);
      for (const c of open) c.destroy();
    });
  return { port, messages, sessions, close };
}

/** The decoded text body and the headers of a sunk message. */
export function readMessage(data) {
  const [head, ...rest] = data.split('\r\n\r\n');
  // header values as people read them (RFC 2047 encoded words decoded)
  const word = (v) => v.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, b) => Buffer.from(b, 'base64').toString('utf8'));
  const headers = Object.fromEntries(head.split('\r\n').map((l) => [l.slice(0, l.indexOf(':')).toLowerCase(), word(l.slice(l.indexOf(':') + 1).trim())]));
  const body = Buffer.from(rest.join('\r\n\r\n').replace(/\s+/g, ''), 'base64').toString('utf8');
  return { headers, body };
}
