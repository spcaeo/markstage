// The blog's author hub and author pages (src/pages/author/, @markstage/astro/authors): built from the author files,
// each page with the author's published posts newest first (a draft never), the byline on every post, and a Person
// JSON-LD with the page, the job title and the profiles as sameAs; never the email. An entry that names an author
// the site does not have fails the build, in plain words.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'astro';
import markstage from '@markstage/astro';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-authors-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const page = (rel) => fs.readFileSync(path.join(tmp, 'out', rel), 'utf8');

test('the author hub, an author page with Person JSON-LD, and the bylines', { timeout: 180_000 }, async () => {
  await build({ root, outDir: path.join(tmp, 'out'), configFile: false, trailingSlash: 'always', integrations: [markstage()], logLevel: 'error', cacheDir: path.join(tmp, 'cache') });
  const hub = page('author/index.html');
  assert.match(hub, /<a href="\/author\/alex-rivera\/">Alex Rivera<\/a> <span>Editor · 2 posts<\/span>/, 'the draft is not counted');
  assert.match(hub, /<a href="\/author\/sam-lee\/">Sam Lee<\/a> <span>Contributor · 2 posts<\/span>/);

  const alex = page('author/alex-rivera/index.html');
  const titles = [...alex.matchAll(/<li><a href="(\/posts\/[^"]+)">([^<]+)<\/a>/g)].map((m) => m[1]);
  assert.deepEqual(titles, ['/posts/writing-with-source-mode/', '/posts/hello-markstage/'], 'newest first, co-authored too, no draft');
  assert.match(alex, /co-author/);
  const ld = JSON.parse(/<script type="application\/ld\+json">(.+?)<\/script>/.exec(alex)[1]);
  assert.equal(ld['@type'], 'Person');
  assert.equal(ld.name, 'Alex Rivera');
  assert.equal(ld.jobTitle, 'Editor');
  assert.equal(ld.url, 'https://example.com/author/alex-rivera/');
  assert.deepEqual(ld.sameAs, ['https://example.com/', 'https://www.linkedin.com/in/example', 'https://github.com/example']);
  assert.match(alex, /<title>Alex Rivera, editor of the example blog<\/title>/);
  assert.doesNotMatch(alex, /@example\.com\b|"email"/, 'never the email');

  assert.match(page('posts/writing-with-source-mode/index.html'), /by <a href="\/author\/sam-lee\/">Sam Lee<\/a> and <a href="\/author\/alex-rivera\/">Alex Rivera<\/a>/);
  assert.match(page('posts/hello-markstage/index.html'), /by <a href="\/author\/alex-rivera\/">Alex Rivera<\/a>/);
});
