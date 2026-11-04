// SECURITY.md's "Supported versions" table, written from the version in package.json so it cannot go stale.
// scripts/release.mjs rewrites it on every release; supported-versions.test.mjs fails when SECURITY.md and
// package.json disagree; scripts/public-sync.mjs refuses an export where they disagree.

const START = '<!-- supported-versions:start (written by scripts/release.mjs from package.json; do not edit by hand) -->';
const END = '<!-- supported-versions:end -->';

/** The release line a version belongs to: `0.2.x` for 0.2.5, `1.x` for 1.4.0. */
export function releaseLine(version) {
  const m = /^(\d+)\.(\d+)\.\d+/.exec(version ?? '');
  if (!m) throw new Error(`"${version}" is not a version like 1.2.3`);
  const [major, minor] = [Number(m[1]), Number(m[2])];
  return major === 0 ? { line: `0.${minor}.x`, below: `0.${minor}`, kind: 'minor' } : { line: `${major}.x`, below: `${major}.0`, kind: 'major' };
}

/** The block between the markers, for this version. */
export function supportedBlock(version) {
  const { line, below, kind } = releaseLine(version);
  return [
    START,
    '| Version | Security fixes |',
    '| --- | --- |',
    `| ${line} | Yes |`,
    `| older than ${below} | No: please update |`,
    '',
    `Fixes go into the newest ${line} release (and \`main\`). When a newer ${kind} version`,
    'comes out, this table says how long the one before it still gets fixes. `markstage-server version` says which one',
    'you run.',
    END,
  ].join('\n');
}

/** SECURITY.md with its block written for this version. Throws when the markers are missing. */
export function withSupportedBlock(text, version) {
  const a = text.indexOf(START);
  const b = text.indexOf(END);
  if (a < 0 || b < a) throw new Error('SECURITY.md: the supported-versions markers are missing');
  return text.slice(0, a) + supportedBlock(version) + text.slice(b + END.length);
}

/** A problem when SECURITY.md's table is not the one for this version, else null. */
export function supportedVersionsProblem(text, version) {
  try {
    return withSupportedBlock(text, version) === text
      ? null
      : `SECURITY.md: the supported-versions table is not the one for ${version} (write it with: npm run release -- --security-table)`;
  } catch (e) {
    return e.message;
  }
}
