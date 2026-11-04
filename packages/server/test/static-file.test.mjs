// staticFileIn / realInside (src/static-file.mjs; security review 3 Nov 2026, S5): what every server of a build
// (gated site and branch previews, share links, the before/after comparison) serves for a site path. Never a file
// outside the build, whether reached by `..`, an encoded `..`, NUL, or a symlink in the build (file or folder).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { realInside, staticFileIn } from '../src/static-file.mjs';

test('a build serves its own files, folders as index.html, and nothing outside it, links followed', () => {
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ms-static-')));
  try {
    const dist = path.join(top, 'dist');
    fs.mkdirSync(path.join(dist, 'about'), { recursive: true });
    fs.writeFileSync(path.join(dist, 'about/index.html'), 'about');
    fs.writeFileSync(path.join(dist, 'a.css'), 'a');
    fs.writeFileSync(path.join(top, 'secret.txt'), 'secret');
    fs.symlinkSync(path.join(top, 'secret.txt'), path.join(dist, 'leak.txt'));
    fs.symlinkSync(top, path.join(dist, 'up'));
    fs.symlinkSync(path.join(dist, 'a.css'), path.join(dist, 'b.css'));
    assert.equal(staticFileIn(dist, '/about/'), path.join(dist, 'about/index.html'));
    assert.equal(staticFileIn(dist, '/a.css'), path.join(dist, 'a.css'));
    assert.equal(staticFileIn(dist, '/b.css'), path.join(dist, 'b.css'), 'a link inside the build');
    for (const p of ['/leak.txt', '/up/secret.txt', '/up/dist/a.css/../../secret.txt', '/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/a.css%00', '/nope.html']) assert.equal(staticFileIn(dist, p), null, p);
    assert.equal(realInside(dist, path.join(dist, 'leak.txt')), false);
    assert.equal(realInside(dist, path.join(dist, 'a.css')), true);
    assert.equal(realInside(dist, path.join(dist, 'missing')), false);
  } finally {
    fs.rmSync(top, { recursive: true, force: true });
  }
});
