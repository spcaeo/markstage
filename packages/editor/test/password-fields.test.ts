// The owner's rule (2026-11-02): every password input has the eye, lets the browser save it, and a new password is
// typed twice. Guard: a password input is made only in src/password.ts or through ui.ts's field(), and the screens
// that set a new password use newPassword() (the pair), never a bare password field.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../src/', import.meta.url).pathname;
function files(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.ts$/.test(n)) out.push(p);
  }
  return out;
}

test('a password input is made only by the shared helper or ui.ts field()', () => {
  const makers = new Set(['password.ts', 'admin/ui.ts']);
  for (const f of files(SRC)) {
    const rel = f.slice(SRC.length);
    const s = readFileSync(f, 'utf8');
    if (makers.has(rel)) continue;
    assert.ok(!/type\s*[:=]\s*['"]password['"]/.test(s) || /field\(/.test(s), `${rel}: a type="password" input outside the helper`);
    // in the screens, a password field is field(..., { type: 'password' ...}) and an eye comes with it
    for (const m of s.matchAll(/type:\s*'password'[^}]*\}/g)) assert.ok(!/autocomplete:\s*'off'/.test(m[0]), `${rel}: a password with autocomplete off`);
  }
});

test('a new password is asked twice (set-up, invitation, change)', () => {
  const auth = readFileSync(join(SRC, 'admin/auth.ts'), 'utf8');
  const account = readFileSync(join(SRC, 'admin/account.ts'), 'utf8');
  assert.equal((auth.match(/newPassword\(/g) ?? []).length, 2, 'set-up and accept-invite use the password pair');
  assert.equal((account.match(/newPassword\(/g) ?? []).length, 1, 'change password uses the password pair');
  assert.ok(!/autocomplete:\s*'new-password'/.test(auth + account), 'no bare new-password field outside newPassword()');
});

test('the helper gives the eye, saveable passwords and the mismatch check', () => {
  const pw = readFileSync(join(SRC, 'password.ts'), 'utf8');
  for (const need of ["'Show password'", "'Hide password'", 'aria-pressed', "'new-password'", "'current-password'", 'data-confirms']) assert.ok(pw.includes(need), need);
  const ui = readFileSync(join(SRC, 'admin/ui.ts'), 'utf8');
  assert.ok(ui.includes('withEye(input)') && ui.includes('mismatched(f)'), 'ui.ts wires the eye and the confirm check');
  const signin = readFileSync(join(SRC, 'signin.ts'), 'utf8');
  assert.ok(signin.includes('withEye(input)'), 'the sign-in-again dialog has the eye');
});
