// The showcase exception (showcase.mjs): the first site's public address only, only in the showcase files.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { SHOWCASE_PATHS, withoutShowcase } from './showcase.mjs';

// in pieces, so that this file does not hold the name (scripts/check-generic.mjs)
const NAME = 'task' + 'rhino';
const OWN = new RegExp(`task[\\s_-]?rhino|rhino[\\s_-]?move|board[\\s_-]?bridge`, 'i');

describe('withoutShowcase', () => {
  test('takes the public address out in a showcase file, in every written form', () => {
    for (const text of [`${NAME}.ca`, `www.${NAME}.ca`, `https://www.${NAME}.ca/`, `https://${NAME}.ca/data/`, `"${NAME}.ca: from WordPress"`, `the editor for ${NAME}.ca.`, `<a href="https://www.${NAME}.ca/">www.${NAME}.ca</a>`]) {
      assert.doesNotMatch(withoutShowcase('site/showcase/index.html', text), OWN, text);
    }
  });

  test('keeps every other form: subdomains, emails, longer words, the plain name', () => {
    for (const text of [`wp.${NAME}.ca`, `https://cms.${NAME}.ca/`, `sales@${NAME}.ca`, `${NAME}.ca.example`, `${NAME}-site`, `${NAME}`, `Task ${'Rhi' + 'no'}`, `${NAME}.com`]) {
      assert.match(withoutShowcase('README.md', text), OWN, text);
    }
  });

  test('changes nothing outside the showcase files', () => {
    for (const rel of ['docs/API.md', 'packages/core/src/index.mjs', 'scripts/site/pages.mjs', 'site/docs/index.html', 'site-content/faq.md']) {
      assert.ok(!SHOWCASE_PATHS.includes(rel), rel);
      assert.match(withoutShowcase(rel, `see ${NAME}.ca`), OWN, rel);
    }
  });

  test('keeps the other private names blocked inside the showcase files', () => {
    assert.match(withoutShowcase('README.md', `${NAME}.ca and ${'rhino'}move`), OWN);
    assert.match(withoutShowcase('site/index.html', `${'board'} bridge`), OWN);
  });
});
