// Messages are drawn as text, never as HTML (security review 3 Nov 2026, S3): a server's message can quote what
// someone else wrote (a locked heading's words in a 423, a validator's output in a 422), and the banner drew it with
// innerHTML. Banner.show now takes text (with bold parts as { strong }), and this scan of the editor's source fails
// when any banner or notice path puts a message into HTML again: the banner itself, a caller passing markup or an
// escaped string, or an error's message interpolated into innerHTML or the panel-form h() helper (which sets HTML).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : d.name.endsWith('.ts') ? [path.join(dir, d.name)] : []));
const sources = files(SRC).map((f) => ({ rel: path.relative(SRC, f), text: fs.readFileSync(f, 'utf8') }));
const lineOf = (text: string, at: number) => text.slice(0, at).split('\n').length;

test('Banner.show draws its words as text nodes, never through innerHTML', () => {
  const shell = sources.find((s) => s.rel === 'shell.ts')!.text;
  const body = /class Banner \{[\s\S]*?\n\}/.exec(shell)?.[0] ?? '';
  assert.ok(body.includes('show('), 'Banner found');
  for (const m of body.matchAll(/innerHTML\s*=\s*`([^`]*)`/g)) assert.doesNotMatch(m[1], /\$\{(?!ic\()/, `only the icon goes in as HTML: ${m[0]}`);
  assert.doesNotMatch(body, /innerHTML\s*\+?=\s*(?![\s`])/, 'no innerHTML from a variable');
});

test('no banner caller passes markup or an escaped string (the banner takes text now)', () => {
  const bad: string[] = [];
  for (const { rel, text } of sources) {
    for (const m of text.matchAll(/\b(?:banner|this)\.show\(\s*(?:'(?:error|info|conflict)'|kind)\s*,([\s\S]*?)(?:,\s*\[\[|,\s*actions|\);)/g)) {
      const arg = m[1];
      if (/<\/?(strong|b|em|i|a|br|span|p|code)\b|&(amp|lt|gt|quot|nbsp);/.test(arg) || /\b(esc|escapeHtml|escHtml)\(/.test(arg)) bad.push(`${rel}:${lineOf(text, m.index!)} ${m[0].slice(0, 120)}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('no error message goes into HTML: innerHTML or h() with an interpolated message is refused', () => {
  const MSG = /\$\{[^}]*(\.message\b|\berr\b|\berror\b|\(e as Error\)|\bfailed\b|\bproblem\b|\brefused\b)[^}]*\}/;
  const bad: string[] = [];
  for (const { rel, text } of sources) {
    for (const m of text.matchAll(/innerHTML\s*\+?=\s*`([^`]*)`/g)) if (MSG.test(m[1]) && !/\b(esc|escapeHtml|escHtml)\(/.test(m[1])) bad.push(`${rel}:${lineOf(text, m.index!)}`);
    for (const m of text.matchAll(/\bh\(\s*'[a-z0-9]+'\s*,\s*[^,()]*,\s*`([^`]*)`/g)) if (MSG.test(m[1]) && !/\b(esc|escapeHtml|escHtml)\(/.test(m[1])) bad.push(`${rel}:${lineOf(text, m.index!)}`);
  }
  assert.deepEqual(bad, [], 'use ht() (text) or textContent for a message');
});
