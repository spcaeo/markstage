// The link box's rules (src/link-rel.ts): an unsafe address is refused at once with the server's words (QA F11), and
// "New tab" always carries rel="noopener" (QA F12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unsafeLink, withOptions } from '../src/link-rel.ts';

test('javascript:, data: and vbscript: links are refused with the server’s words; http, mailto, tel and relative pass', () => {
  assert.equal(unsafeLink('javascript:alert(1)'), 'Links must start with http, https, mailto or tel, or be relative: javascript:alert(1)');
  assert.match(unsafeLink(' JavaScript:alert(1)')!, /^Links must start with/);
  assert.match(unsafeLink('data:text/html,hi')!, /^Links must start with/);
  for (const ok of ['https://example.com/', 'http://example.com', 'mailto:a@b.c', 'tel:+1555', '/about/', '../x', '#top', 'page.html', '']) assert.equal(unsafeLink(ok), null, ok);
});

test('New tab adds noopener once; an existing rel keeps its words; off again drops the target', () => {
  assert.deepEqual(withOptions({}, new Set(['tab'])), { target: '_blank', rel: 'noopener' });
  assert.deepEqual(withOptions({ target: null, rel: 'nofollow' }, new Set(['tab', 'nofollow'])), { target: '_blank', rel: 'nofollow noopener' });
  // a link that already opened in a new tab is written as it was
  assert.deepEqual(withOptions({ target: '_blank', rel: 'noopener noreferrer' }, new Set(['tab'])), { target: '_blank', rel: 'noopener noreferrer' });
  assert.deepEqual(withOptions({ target: '_blank', rel: 'noopener' }, new Set()), { target: null, rel: 'noopener' });
});
