// The live demo's diff (src/demo/diff.ts): what a save would commit, as `git diff` prints it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, diffStat, hunks, unifiedDiff } from '../src/demo/diff.ts';

const before = ['---', 'title: Hello', '---', '', 'One', '', '## Two', '', 'Three', '', 'Four', '', 'Five', '', 'Six', ''].join('\n');

test('one changed line: removed then added, three lines of context, the right line numbers', () => {
  const after = before.replace('## Two', '## Two (edited)');
  assert.equal(
    unifiedDiff('src/content/posts/hello.md', before, after),
    [
      'diff --git a/src/content/posts/hello.md b/src/content/posts/hello.md',
      '--- a/src/content/posts/hello.md',
      '+++ b/src/content/posts/hello.md',
      '@@ -4,7 +4,7 @@',
      ' ',
      ' One',
      ' ',
      '-## Two',
      '+## Two (edited)',
      ' ',
      ' Three',
      ' ',
      '',
    ].join('\n'),
  );
  assert.deepEqual(diffStat(before, after), { added: 1, removed: 1 });
});

test('no change, no diff', () => {
  assert.equal(unifiedDiff('a.md', before, before), '');
  assert.deepEqual(hunks(diffLines(before, before)), []);
});

test('two changes far apart are two hunks; close ones are one', () => {
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
  const far = lines.replace('line 2\n', 'line two\n').replace('line 28\n', 'line twenty-eight\n');
  assert.equal(hunks(diffLines(lines, far)).length, 2);
  const near = lines.replace('line 2\n', 'line two\n').replace('line 6\n', 'line six\n');
  assert.equal(hunks(diffLines(lines, near)).length, 1);
});

test('added and removed lines count, and a hunk at the end of the file', () => {
  const after = `${before}Seven\n`;
  const d = unifiedDiff('a.md', before, after);
  assert.match(d, /^\+Seven$/m);
  assert.deepEqual(diffStat(before, after), { added: 1, removed: 0 });
  const cut = before.replace('Three\n\n', '');
  assert.deepEqual(diffStat(before, cut), { added: 0, removed: 2 });
});
