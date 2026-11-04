// The licence-word rules of scripts/check-licence.mjs: never "open source" or MIT for Markstage, and the one narrow
// exception for another product's licence in the comparison files.   node --test scripts/lib/licence-words.test.mjs
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { COMPARISON_FILES, licenceHits } from './licence-words.mjs';

const lines = (rel, text) => licenceHits(rel, text).map((h) => h.line);

const TABLE = `| | Markstage | Decap CMS |
| --- | --- | --- |
| Licence | Elastic License 2.0 | MIT |`;

describe('outside the comparison files', () => {
  test('MIT and open source are claims anywhere, in any column', () => {
    assert.deepEqual(lines('README.md', TABLE), [3]);
    assert.deepEqual(lines('docs/DEPLOY.md', 'Decap CMS is MIT.'), [1]);
    assert.deepEqual(lines('site/faq/index.html', '<p>Payload is MIT licensed.</p>'), [1]);
    assert.deepEqual(lines('packages/core/README.md', 'An open source editor.'), [1]);
  });

  test('saying what Markstage is not stays fine', () => {
    assert.deepEqual(lines('README.md', 'Markstage is not open source; it is source-available.\nIt is never MIT.'), []);
  });
});

describe('in the comparison files', () => {
  test('are docs/COMPARISON.md, site-content/ and the compare and alternatives pages, nothing else', () => {
    for (const f of ['docs/COMPARISON.md', 'site-content/faq.md', 'site-content/alternatives/decap-cms.md', 'site/compare/full/index.html', 'site/alternatives/decap-cms/index.html']) {
      assert.ok(COMPARISON_FILES.test(f), f);
    }
    for (const f of ['README.md', 'docs/DEPLOY.md', 'site/index.html', 'site/faq/index.html', 'scripts/site/compare.mjs', 'site-content/x.mjs', 'docs/COMPARISON.md.bak']) {
      assert.ok(!COMPARISON_FILES.test(f), f);
    }
  });

  test('another product’s column may say MIT', () => {
    assert.deepEqual(lines('docs/COMPARISON.md', TABLE), []);
    assert.deepEqual(lines('site-content/alternatives/decap-cms.md', TABLE), []);
  });

  test('Markstage’s column may not, wherever it is in the table', () => {
    assert.deepEqual(lines('docs/COMPARISON.md', '| | Decap CMS | **Markstage** |\n| --- | :---: | :---: |\n| Licence | MIT | MIT |'), [3]);
    assert.deepEqual(lines('site-content/alternatives/x.md', TABLE.replace('Elastic License 2.0', 'MIT')), [3]);
  });

  test('a cell or a sentence that names Markstage may not say MIT', () => {
    assert.deepEqual(lines('site-content/faq.md', '| Licence | Markstage: MIT |'), [1]);
    assert.deepEqual(lines('site-content/faq.md', 'Markstage is MIT.'), [1]);
    assert.deepEqual(lines('site-content/faq.md', 'Like Decap CMS, Markstage uses MIT.'), [1]);
  });

  test('a sentence about another product may name its licence', () => {
    assert.deepEqual(lines('site-content/alternatives/payload.md', 'Its repository is under the MIT licence. Markstage is source-available.'), []);
  });

  test('open source gets no exception', () => {
    assert.deepEqual(lines('docs/COMPARISON.md', '| | Markstage | Decap CMS |\n| --- | --- | --- |\n| Licence | Elastic | Open source |'), [3]);
    assert.deepEqual(lines('site-content/alternatives/decap-cms.md', 'Decap CMS is open source.'), [1]);
  });

  test('built HTML: another product’s column may say MIT, Markstage’s may not', () => {
    const page = (ms, other) =>
      `<div class="table-wrap"><table><thead><tr><th scope="col"></th><th scope="col">Markstage</th><th scope="col">Decap CMS</th></tr></thead><tbody><tr><td>Licence</td><td>${ms}</td><td>${other}</td></tr></tbody></table></div>`;
    assert.deepEqual(lines('site/alternatives/decap-cms/index.html', page('Elastic License 2.0', 'MIT')), []);
    assert.deepEqual(lines('site/alternatives/decap-cms/index.html', page('MIT', 'MIT')), [1]);
    assert.deepEqual(lines('site/compare/full/index.html', '<p>Markstage is <strong>MIT</strong>.</p>'), [1]);
    assert.deepEqual(lines('site/compare/full/index.html', '<p>Decap CMS is <strong>MIT</strong>. Markstage is source-available.</p>'), []);
  });

  test('a table row after a paragraph about Markstage is judged by its own header', () => {
    const md = `Markstage is source-available.\n\n${TABLE}\n\nText.\n\n| A | B |\n| --- | --- |\n| MIT | x |`;
    assert.deepEqual(lines('docs/COMPARISON.md', md), []);
  });
});
