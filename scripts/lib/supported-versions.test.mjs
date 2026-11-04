// SECURITY.md's supported-versions table follows package.json (supported-versions.mjs; written by
// scripts/release.mjs): this fails when someone bumps the version without it, or edits the table by hand.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { releaseLine, supportedBlock, supportedVersionsProblem, withSupportedBlock } from './supported-versions.mjs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('SECURITY.md supported versions', () => {
  test('the table in SECURITY.md is the one for the version in package.json', () => {
    const { version } = JSON.parse(read('package.json'));
    assert.equal(supportedVersionsProblem(read('SECURITY.md'), version), null);
    assert.ok(read('SECURITY.md').includes(`| ${releaseLine(version).line} | Yes |`));
  });
  test('every package has the root version', () => {
    const { version } = JSON.parse(read('package.json'));
    for (const p of ['core', 'server', 'editor', 'astro']) assert.equal(JSON.parse(read(`packages/${p}/package.json`)).version, version, p);
  });
  test('release lines', () => {
    assert.deepEqual(releaseLine('0.2.0'), { line: '0.2.x', below: '0.2', kind: 'minor' });
    assert.deepEqual(releaseLine('1.4.2'), { line: '1.x', below: '1.0', kind: 'major' });
    assert.throws(() => releaseLine('next'), /not a version/);
  });
  test('a release rewrites the block and nothing else', () => {
    const text = `# Security\n\nBefore.\n\n${supportedBlock('0.2.0')}\n\nAfter.\n`;
    const next = withSupportedBlock(text, '0.3.0');
    assert.ok(next.includes('| 0.3.x | Yes |') && next.includes('| older than 0.3 |'));
    assert.ok(next.startsWith('# Security\n\nBefore.\n\n') && next.endsWith('\n\nAfter.\n'));
    assert.match(supportedVersionsProblem(text, '0.3.0'), /not the one for 0\.3\.0/);
    assert.match(supportedVersionsProblem('no markers', '0.3.0'), /markers are missing/);
  });
});
