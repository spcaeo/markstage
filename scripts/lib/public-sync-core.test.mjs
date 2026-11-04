// The publish kit's filters and checks (public-sync-core.mjs) and the built-in secret scan (secret-scan.mjs).
// The tests of the real public-sync.config.json run only where it is (the private repo; it is never exported).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  commitMessage,
  countByTop,
  globToRegExp,
  lastSyncedCommit,
  manifestProblems,
  missingImports,
  missingRequired,
  normaliseConfig,
  parseLsTree,
  planChanges,
  privateTextProblems,
  publicSubjects,
  selectFiles,
  strayPaths,
} from './public-sync-core.mjs';
import { maskSecret, scanDiff, scanLine, scanText } from './secret-scan.mjs';

const CONFIG = new URL('../../public-sync.config.json', import.meta.url);
// a Mac home folder path, in pieces: the export refuses any file that holds one (config privateText)
const HOME_DIR = '/Us' + 'ers/';

describe('globToRegExp', () => {
  test('** crosses folders, * stays in one', () => {
    assert.ok(globToRegExp('packages/**').test('packages/server/src/app.mjs'));
    assert.ok(globToRegExp('scripts/*.mjs').test('scripts/release.mjs'));
    assert.ok(!globToRegExp('scripts/*.mjs').test('scripts/lib/a.mjs'));
    assert.ok(globToRegExp('**/CLAUDE.md').test('CLAUDE.md'));
    assert.ok(globToRegExp('**/CLAUDE.md').test('packages/server/CLAUDE.md'));
  });
  test('dots and brackets are literal', () => {
    assert.ok(!globToRegExp('a.md').test('aXmd'));
    assert.ok(globToRegExp('examples/blog/src/pages/[id].astro').test('examples/blog/src/pages/[id].astro'));
  });
});

describe('selectFiles with the real config', { skip: !existsSync(CONFIG) && 'public-sync.config.json is private' }, () => {
  const config = existsSync(CONFIG) ? normaliseConfig(JSON.parse(readFileSync(CONFIG, 'utf8'))) : null;
  const paths = [
    'packages/server/src/app.mjs',
    'packages/editor/src/index.ts',
    'examples/blog/src/pages/index.astro',
    'docs/API.md',
    'docs/PUBLISHING.md',
    'docs/UX-BENCHMARK.md',
    'deploy/compose.yaml',
    '.github/workflows/ci.yml',
    'scripts/public-sync.mjs',
    'scripts/lib/public-sync-core.test.mjs',
    'LICENSE',
    'package.json',
    '.gitleaks.toml',
    '.claude/settings.json',
    'packages/server/.claude/x.md',
    'CLAUDE.md',
    'packages/server/memory/notes.md',
    '.env',
    'deploy/.env.production',
    'deploy/.env.example',
    'deploy/server.pem',
    'website-data/markstage.db',
    'packages/server/test/x.sqlite',
    'markstage-backup-2026-11-03/a.json',
    'public-sync.config.json',
    'Mockups/old.html',
    'notes.md',
  ];
  const { kept, excluded, notAllowed } = config ? selectFiles(paths, config) : { kept: [], excluded: [], notAllowed: [] };

  test('exports the packages, examples, scripts, docs, deploy, CI and root files', () => {
    for (const p of [
      'packages/server/src/app.mjs',
      'packages/editor/src/index.ts',
      'examples/blog/src/pages/index.astro',
      'docs/API.md',
      'docs/PUBLISHING.md',
      'deploy/compose.yaml',
      'deploy/.env.example',
      '.github/workflows/ci.yml',
      'scripts/public-sync.mjs',
      'scripts/lib/public-sync-core.test.mjs',
      'LICENSE',
      'package.json',
      '.gitleaks.toml',
    ]) assert.ok(kept.includes(p), p);
  });
  test('drops private material', () => {
    const dropped = excluded.map((e) => e.path);
    for (const p of [
      '.claude/settings.json',
      'packages/server/.claude/x.md',
      'CLAUDE.md',
      'packages/server/memory/notes.md',
      '.env',
      'deploy/.env.production',
      'deploy/server.pem',
      'website-data/markstage.db',
      'packages/server/test/x.sqlite',
      'markstage-backup-2026-11-03/a.json',
      'public-sync.config.json',
      'docs/UX-BENCHMARK.md',
    ]) {
      assert.ok(dropped.includes(p), p);
      assert.ok(!kept.includes(p), p);
    }
    assert.equal(excluded.find((e) => e.path === '.env')?.why, 'local secrets');
  });
  test('a folder or root file outside the allow-list is not exported', () => {
    assert.deepEqual(notAllowed, ['Mockups/old.html', 'notes.md']);
  });
  test('the private words cover the first site, and none of them is in an exported line by accident', () => {
    const first = 'task' + 'rhino';
    assert.ok(config.privateSubjectWords.includes(first));
    assert.ok(config.privateText.some((re) => re.test(`see ${first}.ca`)));
    assert.ok(config.privateText.some((re) => re.test(`${HOME_DIR}someone/Desktop`)));
    assert.ok(!config.privateText.some((re) => re.test('Welcome to the editor, a warm welcome')));
  });
});

describe('selectFiles rules', () => {
  test('the last exclude wins and ! puts a path back', () => {
    const config = normaliseConfig({ include: ['**'], exclude: ['docs/**', '!docs/public/**', 'docs/public/secret.md'] });
    const { kept, excluded } = selectFiles(['docs/a.md', 'docs/public/b.md', 'docs/public/secret.md'], config);
    assert.deepEqual(kept, ['docs/public/b.md']);
    assert.deepEqual(excluded.map((e) => e.path), ['docs/a.md', 'docs/public/secret.md']);
  });
  test('an empty include list is refused', () => {
    assert.throws(() => normaliseConfig({ include: [] }), /include/);
  });
  test('counts by top-level folder', () => {
    assert.deepEqual([...countByTop(['a/x', 'a/y', 'b/z', 'LICENSE'])], [['a/', 2], ['(root)', 1], ['b/', 1]]);
  });
});

describe('planChanges and parseLsTree', () => {
  test('lists added, changed and deleted paths', () => {
    const tree = parseLsTree(['100644 blob aaa\ta.ts', '100644 blob bbb\tb.ts', '160000 commit ccc\tsub', '100755 blob ddd\tx y.sh', ''].join('\0'));
    assert.deepEqual([...tree.keys()], ['a.ts', 'b.ts', 'x y.sh']);
    const current = new Map([['a.ts', '100644 aaa'], ['b.ts', '100644 old'], ['gone.ts', '100644 eee']]);
    assert.deepEqual(planChanges(tree, current), { added: ['x y.sh'], modified: ['b.ts'], deleted: ['gone.ts'] });
  });
  test('a mode change counts as a change', () => {
    assert.deepEqual(planChanges(new Map([['a', '100755 s']]), new Map([['a', '100644 s']])).modified, ['a']);
  });
});

describe('commit message', () => {
  const sha = '0123456789abcdef0123456789abcdef01234567';
  test('first sync', () => {
    const msg = commitMessage({ shortSha: '01234567', fullSha: sha, subjects: [], first: true });
    assert.equal(msg.split('\n')[0], 'Sync from private 01234567: First public snapshot');
    assert.equal(lastSyncedCommit(msg), sha);
  });
  test('later syncs list the subjects and keep the title short', () => {
    const subjects = Array.from({ length: 70 }, (_, i) => `Change number ${i + 1} with a longer subject line`);
    const msg = commitMessage({ shortSha: '01234567', fullSha: sha, subjects, first: false });
    const [title] = msg.split('\n');
    assert.ok(title.startsWith('Sync from private 01234567: Change number 1'));
    assert.ok(title.includes('(+69 more)'));
    assert.ok(title.length <= 100);
    assert.ok(msg.includes('- Change number 60 with'));
    assert.ok(msg.includes('- …and 10 more'));
    assert.equal(lastSyncedCommit(msg), sha);
  });
  test('short lists fit in the title', () => {
    const msg = commitMessage({ shortSha: 'abcd1234', fullSha: sha, subjects: ['Fix A', 'Fix B'], first: false });
    assert.equal(msg.split('\n')[0], 'Sync from private abcd1234: Fix A; Fix B');
  });
  test('subjects naming private words are hidden', () => {
    assert.deepEqual(publicSubjects(['Forms for Example Corp', 'Fix chart'], ['example corp']), ['Private change', 'Fix chart']);
  });
});

describe('export checks', () => {
  const config = normaliseConfig({
    include: ['**'],
    exclude: [{ path: '**/.env', why: 'local secrets' }, 'secret/**'],
    requiredFiles: ['LICENSE', 'SECURITY.md'],
    privateText: ['example[\\s-]?corp', '/Users/[A-Za-z]'],
  });

  test('a stray or excluded file in the export folder is refused', () => {
    assert.deepEqual(strayPaths(['a.mjs', '.env', 'secret/k.txt', 'extra.md'], ['a.mjs'], config), [
      '.env: matches the exclude rule "**/.env" (local secrets)',
      'secret/k.txt: matches the exclude rule "secret/**" (private)',
      'extra.md: in the export folder but not in the export list',
    ]);
  });
  test('required files', () => {
    assert.deepEqual(missingRequired(['LICENSE'], config), ['SECURITY.md is missing']);
  });
  test('private text is found by line', () => {
    const files = [
      { path: 'docs/a.md', text: 'one\nbuilt for Example-Corp first\n' },
      { path: 'b.mjs', text: `const home = '${HOME_DIR}me/x';` },
      { path: 'logo.png', text: null },
      { path: 'c.md', text: 'nothing here' },
    ];
    assert.deepEqual(privateTextProblems(files, config.privateText), [
      'docs/a.md:2: names something private (example[\\s-]?corp)',
      'b.mjs:1: names something private (\\/Users\\/[A-Za-z])',
    ]);
  });
  test('every path a package.json points at is in the export', () => {
    const pkg = (p, json) => ({ path: p, text: JSON.stringify(json) });
    const files = [
      pkg('package.json', { workspaces: ['packages/*', 'examples/*'], scripts: { lines: 'node scripts/check-lines.mjs', gone: 'node scripts/gone.mjs', t: 'node --test "test/**/*.test.mjs"' } }),
      { path: 'scripts/check-lines.mjs', text: '' },
      pkg('packages/core/package.json', { main: './src/index.mjs', exports: { '.': { types: './src/index.d.ts', default: './src/index.mjs' }, './styles/*': './src/styles/*' }, bin: { x: './bin/x.mjs' } }),
      { path: 'packages/core/src/index.mjs', text: '' },
      { path: 'packages/core/src/styles/a.css', text: '' },
    ];
    assert.deepEqual(manifestProblems(files), [
      'package.json: workspace "examples/*" has no package.json in the export',
      'package.json: scripts.gone points at "scripts/gone.mjs", which is not in the export',
      'packages/core/package.json: bin.x points at "./bin/x.mjs", which is not in the export',
      'packages/core/package.json: exports points at "./src/index.d.ts", which is not in the export',
    ]);
  });
  test('a relative import of a file left out of the export is refused', () => {
    const files = [
      { path: 'src/a.mjs', text: "import { b } from './b.mjs';\nimport c from './c';\nconst d = await import('../lib/d.js');\nimport x from './fixture-only.mjs';" },
      { path: 'src/b.mjs', text: '' },
      { path: 'src/c.ts', text: '' },
    ];
    const privateTree = new Set(['src/a.mjs', 'src/b.mjs', 'src/c.ts', 'lib/d.ts']);
    assert.deepEqual(missingImports(files, privateTree), ['src/a.mjs: imports "../lib/d.js" (lib/d.ts), which is not exported']);
  });
});

// Key-shaped test values are built from pieces at run time, so this file never holds one.
const rand = (n) => 'Q7mZ4pX9vR2kT8wB3nY6cL1dF5gH0jA'.repeat(4).slice(0, n);
const googleKey = 'AI' + 'za' + rand(35);
const openaiKey = 'sk-' + 'proj-' + rand(48);
const githubToken = 'gh' + 'p_' + rand(36);
const privateKey = '-----BEGIN ' + 'RSA PRIVATE KEY-----';
const hexKey = ['9f3c1e7a5b2d8f40', '6c1a9e3b7d5f2a8c', '4e0b6d2f8a1c7e39', '5b0d2f6a8c4e1b73'].join('');

describe('built-in secret scan', () => {
  test('finds common key formats and masks them', () => {
    assert.deepEqual(scanLine(`const k = "${googleKey}"`)[0], { rule: 'google-api-key', preview: maskSecret(googleKey) });
    assert.equal(scanLine(`OPENAI=${openaiKey}`)[0]?.rule, 'openai-key');
    assert.equal(scanLine(`token: '${githubToken}'`)[0]?.rule, 'github-token');
    assert.equal(scanLine(privateKey)[0]?.rule, 'private-key');
    assert.equal(scanLine(`SMTP_PASSWORD=${hexKey}`)[0]?.rule, 'high-entropy-assignment');
    assert.equal(scanLine(`const apiKey = '${hexKey}'`)[0]?.rule, 'high-entropy-assignment');
    assert.equal(maskSecret(googleKey), 'AIza… (39 chars)');
  });
  test('never returns the whole value', () => {
    const found = scanText(`a\nconst secret = "${hexKey}"\n`);
    assert.equal(found.length, 1);
    assert.equal(found[0].line, 2);
    assert.ok(!JSON.stringify(found).includes(hexKey.slice(4)));
  });
  test('leaves fake values, names and ids alone', () => {
    for (const line of [
      "const SECRET = 'sk-test-secret-value-1234'",
      "occurrenceKey: 'report:sched-weekly:weekly:2026-02-02'",
      "const KEY = 'markstage.sidebarGroups.'",
      'SMTP_PASSWORD=',
      'const apiKey = process.env.MARKSTAGE_API_KEY',
      "'Sec-WebSocket-Key': Buffer.from('the sample nonce').toString('base64'),",
      `const k = "${googleKey}" // gitleaks:allow`,
    ]) assert.deepEqual(scanLine(line), [], line);
  });
  test('reads only the added lines of a staged diff', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -10,2 +10,3 @@',
      `-const old = "${googleKey}"`,
      ' unchanged',
      `+const key = "${googleKey}"`,
      '+const ok = 1',
    ].join('\n');
    assert.deepEqual(scanDiff(diff), [{ file: 'src/a.ts', line: 11, rule: 'google-api-key', preview: maskSecret(googleKey) }]);
  });
});
