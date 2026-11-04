// markdownUrls: every URL a CommonMark (+GFM) renderer would turn into a link or an image, read with the same
// parser the site's Markdown renderer uses, so the server's link-scheme check and the site can never disagree
// (security review 3 Nov, S1: `<javascript:…>` was text to the editor's document and a live link on the site).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markdownUrls } from '../src/index.mjs';

test('autolinks, inline links, images and reference definitions are all found', () => {
  const md = [
    '<javascript:alert(1)>',
    '',
    '[a](https://a.test) ![b](/b.png) <https://c.test> <me@d.test>',
    '',
    '[ref]: vbscript:x',
    '',
    '[used][ref]',
  ].join('\n');
  assert.deepEqual(markdownUrls(md).sort(), ['/b.png', 'https://a.test', 'https://c.test', 'javascript:alert(1)', 'mailto:me@d.test', 'vbscript:x'].sort());
});

test('frontmatter is skipped; code spans and fenced code are not links', () => {
  const md = '---\ntitle: "<javascript:x>"\n---\n\n`<javascript:y>`\n\n```\n<javascript:z>\n```\n';
  assert.deepEqual(markdownUrls(md), []);
});

test('entities in a link destination are decoded as the renderer decodes them', () => {
  assert.deepEqual(markdownUrls('[x](&#106;avascript:alert(1))'), ['javascript:alert(1)']);
});
