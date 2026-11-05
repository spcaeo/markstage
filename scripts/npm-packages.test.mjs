// The npm packages before any publish (docs/PUBLISHING.md "npm"): each @markstage/* package is packed for real into
// a temporary folder (`npm pack`, never a publish), unpacked, and its tarball must hold what runs plus README, LICENSE
// and NOTICE, and nothing else:
// - no test, e2e or fixture file, no scratch file, no tool config;
// - nothing secret-like: no .env, key, certificate or database by its name, and no key in any file (the built-in
//   secret scan of the pre-commit hook);
// - every file `main`, `types`, `exports` and `bin` point at is in it;
// - it fits its size budget (scripts/lib/npm-packages.mjs BUDGET);
// - `npm run generic` over its files: no site's words in its code, none of the first site's names anywhere; in the
//   private repo also the publish kit's private names (public-sync.config.json privateText);
// - its npm metadata: Elastic-2.0, repository and directory, engines, publishConfig with provenance, and the other
//   @markstage packages pinned to the same version.
// The rules themselves are tested on made-up lists first, so a rule that stopped matching fails here too.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { CODE_FILE, ownNameHits, siteWordHits } from './lib/generic-words.mjs';
import { BUDGET, PACKAGES, REPO, budgetProblems, contentProblems, meetsEngines, metadataProblems, missingEntryPoints, packAll } from './lib/npm-packages.mjs';
import { normaliseConfig, privateTextProblems } from './lib/public-sync-core.mjs';
import { scanText } from './lib/secret-scan.mjs';

const root = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
const TEXT = /\.(mjs|cjs|js|ts|mts|astro|css|json|md|txt|html|svg)$|(^|\/)(LICENSE|NOTICE|README[^/]*)$/;

describe('the rules', () => {
  test('tests, fixtures, scratch files and secret-like names are caught', () => {
    const bad = ['test/a.test.mjs', 'src/x.test.ts', 'e2e/run.mjs', 'src/fixtures/a.md', 'test/fixtures/b.json', 'src/a.browser.mjs', 'tsconfig.json', 'src/a.mjs.orig', 'src/.DS_Store', 'dist/a.js', '.env', '.env.local', 'src/key.pem', 'markstage.db', 'data.sqlite', 'id_ed25519', '.npmrc', 'site-data/config.json'];
    for (const p of bad) assert.ok(contentProblems([p]).length, p);
    const good = ['src/index.mjs', 'src/env/rules.mjs', 'src/auth/keys.mjs', 'src/styles/a.css', 'bin/markstage.mjs', 'README.md', 'LICENSE', 'NOTICE', 'package.json', 'src/index.d.ts', 'scripts/canvas-fidelity.mjs', 'src/testing-words.mjs'];
    assert.deepEqual(contentProblems(good), []);
  });

  test('an entry point missing from the tarball is caught, wildcards included', () => {
    const pkg = { main: './src/app.mjs', exports: { '.': { types: './src/index.d.ts', default: './src/index.mjs' }, './styles/*': './src/styles/*' }, bin: { x: './bin/x.mjs' } };
    assert.deepEqual(missingEntryPoints(pkg, ['src/app.mjs', 'src/index.d.ts', 'src/index.mjs', 'src/styles/a.css', 'bin/x.mjs']), []);
    const missing = missingEntryPoints(pkg, ['src/app.mjs', 'src/index.mjs']);
    assert.equal(missing.length, 3);
    assert.match(missing.join('\n'), /index\.d\.ts/);
    assert.match(missing.join('\n'), /styles\/\*: no file matches/);
    assert.match(missing.join('\n'), /bin\.x -> bin\/x\.mjs/);
  });

  test('a package over its budget is caught, and every package has one', () => {
    assert.equal(budgetProblems('core', { files: 1, unpacked: 1, packed: 1 }).length, 0);
    assert.equal(budgetProblems('core', { files: 10_000, unpacked: 1e9, packed: 1e9 }).length, 3);
    assert.match(budgetProblems('nope', { files: 1, unpacked: 1, packed: 1 })[0], /no size budget/);
    assert.deepEqual(Object.keys(BUDGET).sort(), [...PACKAGES].sort());
  });

  test('a site name and a key in a file are caught', () => {
    const name = ['task', 'rhino'].join('');
    assert.equal(ownNameHits('README.md', `Built for ${name}.`).length, 1);
    assert.equal(siteWordHits('src/a.mjs', "const label = 'Side' + 'note'; // sidenote").length, 1);
    assert.equal(siteWordHits('src/a.mjs', "fetch('/studio-api/entries')").length, 0, 'the old dev routes are allowed');
    // key-shaped, built at run time from short pieces (CONTRIBUTING.md)
    const shaped = ['sk', 'ant', 'api03', ['Q9x2', 'Lm7V', 'b4Nc', '8Rt1', 'Zp6W', 'd3Fy', '5Hj0', 'Kg2L', 's9Ae', '4Bu7', 'Ci1D'].join('')].join('-');
    assert.ok(scanText(`const apiKey = '${shaped}';`).length, 'a key-shaped value');
  });

  test("engines: the install test reads Astro's Node range", () => {
    assert.equal(meetsEngines('22.13.0', '>=22.23.4'), false);
    assert.equal(meetsEngines('22.23.4', '>=22.23.4'), true);
    assert.equal(meetsEngines('24.19.0', '>=22.23.4'), true);
    assert.equal(meetsEngines('22.13.0', '^20.19.0 || >=22.12.0'), true);
    assert.equal(meetsEngines('21.0.0', '^20.19.0 || >=22.12.0'), false);
    assert.equal(meetsEngines('22.13.0', root.engines.node), true, "the repo's own floor");
  });

  test('metadata: a loose internal version or a missing field is caught', () => {
    const good = JSON.parse(fs.readFileSync(path.join(REPO, 'packages/astro/package.json'), 'utf8'));
    const opts = { version: good.version, engines: root.engines.node };
    assert.deepEqual(metadataProblems('astro', good, opts), []);
    const loose = { ...good, dependencies: { ...good.dependencies, '@markstage/core': `^${good.version}` } };
    assert.match(metadataProblems('astro', loose, opts).join('\n'), /@markstage\/core is "\^/);
    const { publishConfig: _, ...noConfig } = good;
    assert.match(metadataProblems('astro', noConfig, opts).join('\n'), /publishConfig/);
    // npm would rewrite this one on publish (and warn the bin "was invalid and removed")
    assert.match(metadataProblems('astro', { ...good, bin: { markstage: './bin/markstage.mjs' } }, opts).join('\n'), /bin\.markstage is "\.\/bin\/markstage\.mjs", write it as "bin\/markstage\.mjs"/);
  });
});

describe('the tarballs', { timeout: 180_000 }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-npm-guard-'));
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const packed = {};
  const privateCfg = fs.existsSync(path.join(REPO, 'public-sync.config.json')) ? normaliseConfig(JSON.parse(fs.readFileSync(path.join(REPO, 'public-sync.config.json'), 'utf8'))) : null;

  before(() => {
    for (const p of packAll(path.join(tmp, 'tgz'))) {
      const name = p.name.replace('@markstage/', '');
      const dir = path.join(tmp, name);
      fs.mkdirSync(dir);
      execFileSync('tar', ['-xzf', path.join(tmp, 'tgz', p.filename), '-C', dir]);
      const files = p.files.map((f) => f.path).sort();
      packed[name] = { ...p, dir: path.join(dir, 'package'), files, pkg: JSON.parse(fs.readFileSync(path.join(dir, 'package/package.json'), 'utf8')) };
    }
  });

  const read = (p, rel) => fs.readFileSync(path.join(packed[p].dir, rel), 'utf8');
  const textFiles = (p) => packed[p].files.filter((f) => TEXT.test(f));

  for (const p of PACKAGES) {
    describe(`@markstage/${p}`, () => {
      test('the tarball is what npm listed: the same files, unpacked', () => {
        const onDisk = execFileSync('find', ['.', '-type', 'f'], { cwd: packed[p].dir, encoding: 'utf8' }).split('\n').filter(Boolean).map((f) => f.slice(2)).sort();
        assert.deepEqual(onDisk, packed[p].files);
      });

      test('README, LICENSE (the Elastic License 2.0, as the repo has it) and NOTICE', () => {
        for (const f of ['README.md', 'LICENSE', 'NOTICE', 'package.json']) assert.ok(packed[p].files.includes(f), f);
        assert.equal(read(p, 'LICENSE'), fs.readFileSync(path.join(REPO, 'LICENSE'), 'utf8'));
        assert.match(read(p, 'NOTICE'), /Elastic License 2\.0/);
        assert.equal(read(p, 'NOTICE'), read('core', 'NOTICE'), 'one NOTICE for the four packages');
      });

      test('no test, e2e, fixture or scratch file, and nothing secret-like by its name', () => {
        assert.deepEqual(contentProblems(packed[p].files), []);
      });

      test('no key in any file (the built-in secret scan)', () => {
        const found = textFiles(p).flatMap((f) => scanText(read(p, f)).map((h) => `${f}:${h.line}: ${h.rule} ${h.preview}`));
        assert.deepEqual(found, []);
      });

      test('every file main, types, exports and bin point at is in it', () => {
        assert.deepEqual(missingEntryPoints(packed[p].pkg, packed[p].files), []);
      });

      test(`within its size budget (${BUDGET[p].files} files, ${BUDGET[p].unpacked / 1e6} MB unpacked, ${BUDGET[p].packed / 1e6} MB packed)`, () => {
        const { entryCount: files, unpackedSize: unpacked, size } = packed[p];
        assert.deepEqual(budgetProblems(p, { files, unpacked, packed: size }), []);
      });

      test('npm run generic over its files: no site words in its code, none of the first site\'s names anywhere', () => {
        const hits = [];
        for (const f of textFiles(p)) {
          const text = read(p, f);
          if (CODE_FILE.test(f)) hits.push(...siteWordHits(f, text));
          hits.push(...ownNameHits(f, text));
        }
        assert.deepEqual(hits, []);
      });

      test('nothing the publish kit calls private (privateText; the private repo only)', { skip: !privateCfg && 'no public-sync.config.json here' }, () => {
        const files = textFiles(p).map((f) => ({ path: `packages/${p}/${f}`, text: read(p, f) }));
        assert.deepEqual(privateTextProblems(files, privateCfg.privateText, privateCfg.privateTextAllow), []);
      });

      test('npm metadata: Elastic-2.0, repository, engines, publishConfig, internal versions pinned', () => {
        assert.deepEqual(metadataProblems(p, packed[p].pkg, { version: root.version, engines: root.engines.node }), []);
        if (p === 'core') assert.equal(packed[p].pkg.sideEffects, false, 'core has no side effects on import');
        // the editor registers its screens and styles on import, so it must keep the default (side effects)
        if (p === 'editor') assert.equal(packed[p].pkg.sideEffects, undefined);
      });
    });
  }
});
