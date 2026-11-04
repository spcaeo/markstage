// TOTP (RFC 6238, SHA-1, 6 digits, 30 s) for authenticator apps, and one-time recovery codes. Built-ins only.
import crypto from 'node:crypto';
import { safeEqual, sha256 } from '../util.mjs';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32 (what authenticator apps expect). */
export const newTotpSecret = () => base32Encode(crypto.randomBytes(20));

export const STEP_SECONDS = 30;
export const stepAt = (ms) => Math.floor(ms / 1000 / STEP_SECONDS);

/** The 6-digit code for a secret at a time step (RFC 4226 dynamic truncation). */
export function totpAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  const bin = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 1_000_000).padStart(6, '0');
}

/**
 * Check a code against the current step +-1 (clock drift). Returns the matched step, or 0 when wrong.
 * A step at or before `lastStep` is refused, so a code works once (no replay).
 */
/** 'ok' with the step, 'used' when the code is right but a code of that step was used already, else 'wrong'. */
export function checkTotp(secret, code, { now = Date.now(), lastStep = 0 } = {}) {
  const clean = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return { state: 'wrong', step: 0 };
  const current = stepAt(now);
  let matched = 0;
  let used = false;
  for (const step of [current - 1, current, current + 1]) {
    if (!safeEqual(totpAt(secret, step), clean)) continue;
    if (step > lastStep) matched = step;
    else used = true;
  }
  return matched ? { state: 'ok', step: matched } : { state: used ? 'used' : 'wrong', step: 0 };
}

export const USED_WORDS = 'That code was used already. Wait for the next one on your phone (about 30 seconds) and try again.';

export function verifyTotp(secret, code, { now = Date.now(), lastStep = 0 } = {}) {
  const clean = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return 0;
  const current = stepAt(now);
  let matched = 0;
  // check every candidate (no early exit) so timing does not say which step matched
  for (const step of [current - 1, current, current + 1]) {
    if (safeEqual(totpAt(secret, step), clean) && step > lastStep) matched = step;
  }
  return matched;
}

export function otpauthUri(secret, { issuer = 'Markstage', account }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** Ten recovery codes like `k7f3-9qmd-2xwp` (~60 bits each). Stored as sha256: they are random, not passwords. */
export function newRecoveryCodes(count = 10) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: count }, () => {
    const bytes = crypto.randomBytes(12);
    let s = '';
    for (let i = 0; i < 12; i++) s += alphabet[bytes[i] % alphabet.length] + (i % 4 === 3 && i < 11 ? '-' : '');
    return s;
  });
}

export const hashRecoveryCode = (code) => sha256(String(code ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''));
