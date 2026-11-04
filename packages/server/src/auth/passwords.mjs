// Password hashing with scrypt (built into node:crypto; argon2 is not in Node 22/24 LTS without a native addon).
// Stored as `scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>` so the cost can be raised later and old hashes still verify.
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

// N=2^15, r=8 is ~32 MiB and roughly 50-100 ms per hash on a server core (OWASP minimum is N=2^17 with r=8 p=1
// or N=2^15 with p=3; we use p=3).
export const PARAMS = { N: 2 ** 15, r: 8, p: 3, keylen: 32 };

const COMMON = new Set([
  'password1234', 'password12345', '123456789012', 'qwertyuiop12', 'iloveyou1234', 'administrator',
  'letmein12345', 'welcome12345', 'changeme1234', 'passwordpassword', '111111111111', '000000000000',
  'abc123456789', 'qwerty123456', '1q2w3e4r5t6y', 'monkey123456', 'dragon123456', 'football1234',
]);

/** Returns a plain-words problem with the password, or null when it is acceptable. */
export function passwordProblem(password, email = '') {
  if (typeof password !== 'string') return 'Enter a password.';
  if (password.length < 12) return 'Use at least 12 characters.';
  if (password.length > 256) return 'Use at most 256 characters.';
  const lower = password.toLowerCase();
  if (email && lower === String(email).toLowerCase()) return 'The password cannot be your email.';
  if (COMMON.has(lower) || /^(.)\1+$/.test(password)) return 'That password is too common.';
  return null;
}

const maxmem = (p) => 256 * p.N * p.r + 1024 * 1024;

export async function hashPassword(password, params = PARAMS) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, params.keylen, { N: params.N, r: params.r, p: params.p, maxmem: maxmem(params) });
  return ['scrypt', params.N, params.r, params.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

// Verifying against this keeps "unknown email" as slow as "wrong password" (no user enumeration by timing).
let dummy;
const dummyHash = async () => (dummy ??= await hashPassword(crypto.randomBytes(16).toString('hex')));

/** Constant-time verify. `stored` may be null (unknown user or no password set): still spends the same time. */
export async function verifyPassword(password, stored) {
  const record = stored || (await dummyHash());
  const [kind, N, r, p, salt, hash] = String(record).split('$');
  if (kind !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const params = { N: Number(N), r: Number(r), p: Number(p) };
  const actual = await scrypt(String(password ?? '').normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, { ...params, maxmem: maxmem(params) });
  return crypto.timingSafeEqual(actual, expected) && Boolean(stored);
}
