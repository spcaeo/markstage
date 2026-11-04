// docs/WRITING.md is the editor's "How do I…" guide (packages/editor/src/help-topics.ts) as a page: written from
// the same topics, so the two never disagree. `--check` exits 1 when the page is out of date (run it after changing
// a topic; without it the page is written again).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOPICS } from '../packages/editor/src/help-topics.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs/WRITING.md');

const lines = [
  '# Writing with Markstage',
  '',
  '<!-- Written by scripts/writer-guide.mjs from packages/editor/src/help-topics.ts: change the topics there, then run',
  '     `npm run guide`. -->',
  '',
  'The same guide is inside the editor: press **?** (anywhere but in text) or More (…) → **How do I…**. There each',
  'topic can point at the part of the screen it is about ("Show me"), and the open topic is in the address, so a link',
  'to it opens it.',
  '',
  ...TOPICS.map((t) => `- [${t.title}](#${t.id})`),
];
for (const t of TOPICS) {
  lines.push('', `<a id="${t.id}"></a>`, '', `## ${t.title}`, '', ...t.steps.map((s, i) => `${i + 1}. ${s}`));
  if (t.keys?.length) lines.push('', '| Keys | |', '|---|---|', ...t.keys.map(([k, what]) => `| \`${k}\` | ${what} |`));
}
const text = `${lines.join('\n')}\n`;

if (process.argv.includes('--check')) {
  const now = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (now !== text) {
    console.error('docs/WRITING.md is out of date with help-topics.ts: run npm run guide');
    process.exit(1);
  }
  console.log(`guide: docs/WRITING.md matches the ${TOPICS.length} topics`);
} else {
  fs.writeFileSync(out, text);
  console.log(`guide: wrote docs/WRITING.md (${TOPICS.length} topics)`);
}
