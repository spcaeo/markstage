// Two habits that make the browser tests fail on one machine and pass on another, checked over every e2e file:
// - a bare page.goto('about:blank'): the browser aborts it when the editor is still moving (net::ERR_ABORTED), a
//   different test each run; support.mjs's blank(page) tries again instead;
// - Control+<key> for an editor shortcut: on a Mac the editor listens for ⌘, so Control+A does not select all and
//   Control+S does not save; ControlOrMeta+<key> is Ctrl elsewhere and ⌘ on a Mac.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(import.meta.dirname, '../e2e');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs') && f !== 'support.mjs');

/** `file:line  text` for every line of the e2e files that matches `re`. */
const hits = (re) =>
  files.flatMap((f) =>
    fs
      .readFileSync(path.join(dir, f), 'utf8')
      .split('\n')
      .flatMap((line, i) => (re.test(line) ? [`${f}:${i + 1}  ${line.trim()}`] : [])),
  );

test('e2e files reach about:blank through blank(page), never a bare goto', () => {
  assert.ok(files.length > 10, 'the e2e files are found');
  assert.deepEqual(hits(/goto\(\s*['"`]about:blank/), []);
});

test('e2e shortcuts use ControlOrMeta, so they work on a Mac too', () => {
  assert.deepEqual(hits(/press\(\s*['"`]Control\+/), []);
});
