// Pasting from Word (src/paste-word.ts): the list paragraphs become real lists (nested by level), the Title and
// Heading styles headings, and the office markup goes; a table, bold and a link survive (QA pass 2, N3). Run in a
// real browser document (headless Chromium through Playwright), as the editor's page parses HTML; the fixture is
// a fragment saved from Word.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { chromium } from 'playwright';

const src = fs.readFileSync(path.join(import.meta.dirname, '../src/paste-word.ts'), 'utf8');
const js = stripTypeScriptTypes(src).replace(/^export /gm, '');
const WORD = fs.readFileSync(path.join(import.meta.dirname, 'fixtures/word-paste.html'), 'utf8');

async function cleaned(html: string): Promise<string> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><title>t</title>');
    await page.addScriptTag({ content: `${js}\nwindow.__clean = (h) => cleanWordHtml(h);` });
    return await page.evaluate((h) => (window as unknown as { __clean: (h: string) => string }).__clean(h), html);
  } finally {
    await browser.close();
  }
}

test('a Word fragment: real lists (nested, bulleted and numbered), headings, a clean table, bold and a link; no office markup', async () => {
  const out = await cleaned(WORD);
  assert.ok(out.startsWith('<h2>Word Title</h2>'), out);
  assert.ok(out.includes('<p><b>Bold lead</b>  normal text with a <a href="https://example.com/doc">link</a>.</p>'), out);
  assert.ok(out.includes('<ul><li>First bullet</li><li>Second bullet<ul><li>Under the second</li></ul></li></ul>'), out);
  assert.ok(out.includes('<h2>A heading in Word</h2>'), out);
  assert.ok(out.includes('<ol><li>First step</li><li>Second step</li></ol>'), out);
  assert.ok(out.includes('<table><tbody><tr><td><p>Cell A</p></td><td><p>Cell B</p></td></tr></tbody></table>'), out);
  assert.ok(out.includes('<p>Red text</p>'), out);
  for (const gone of ['mso-', 'Mso', 'o:p', 'style=', 'class=', '<span', '·', 'supportLists', '<!--', '&nbsp;</p>']) assert.ok(!out.includes(gone), `${gone} must be gone: ${out}`);
});

test('HTML that is not from Word passes through untouched', async () => {
  const html = '<p class="lead" style="color:red">Hello <span>there</span></p><ul><li>one</li></ul>';
  assert.equal(await cleaned(html), html);
});

test('a plain-text marker ("· First") with no marker run is taken off too; a lettered list is numbered', async () => {
  const out = await cleaned('<p class=MsoListParagraph>· First</p><p class=MsoListParagraph>· Second</p><p class=MsoListParagraph style="mso-list:l2 level1 lfo3">a) Alpha</p>');
  assert.equal(out, '<ul><li>First</li><li>Second</li></ul><ol><li>Alpha</li></ol>');
});
