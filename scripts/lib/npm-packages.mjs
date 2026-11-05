// What the four @markstage/* packages ship to npm, and the rules a tarball must keep (docs/PUBLISHING.md "npm").
// scripts/npm-packages.test.mjs packs each package for real and checks it with these; scripts/npm-install.mjs installs
// the tarballs in a new site. Only Node's own modules.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** The packages in the order they are published: each one's @markstage dependencies come before it. */
export const PACKAGES = ['core', 'editor', 'astro', 'server'];
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/**
 * The size budget of each tarball: files, bytes unpacked, bytes packed. About 30% above the first release's size, so
 * normal growth fits and a stray folder (tests, fixtures, a build output, a database) does not. Raise one on purpose,
 * in the same commit as what made it grow, and say why there.
 */
export const BUDGET = {
  core: { files: 70, unpacked: 450_000, packed: 150_000 },
  editor: { files: 450, unpacked: 3_300_000, packed: 1_000_000 },
  astro: { files: 45, unpacked: 220_000, packed: 70_000 },
  server: { files: 250, unpacked: 2_300_000, packed: 750_000 },
};

/** Tests, end-to-end tests, fixtures and scratch files: never in a tarball. */
const NOT_SHIPPED = [
  [/(^|\/)(test|tests|__tests__|e2e|fixtures?|__fixtures__|__mocks__|coverage)(\/|$)/i, 'a test, e2e or fixture folder'],
  [/\.(test|spec|e2e|browser)\.[cm]?[jt]sx?$/i, 'a test file'],
  [/(^|\/)(tsconfig[^/]*\.json|\.eslintrc[^/]*|\.prettierrc[^/]*|\.editorconfig|\.gitignore|\.gitattributes)$/i, 'a build or tool config'],
  [/(\.(orig|rej|bak|swp|swo|tmp|log)|~)$/i, 'a scratch or backup file'],
  [/(^|\/)(\.DS_Store|Thumbs\.db|npm-debug\.log[^/]*)$/i, 'a stray system file'],
  [/(^|\/)(node_modules|dist|\.astro|\.markstage|\.vite|\.git)(\/|$)/, 'build output, installs or git data'],
];
/** Names that hold secrets or private data. */
const SECRET_NAMES = [
  [/(^|\/)\.env($|\.)/i, 'an .env file'],
  [/\.(pem|key|p8|p12|pfx|crt|cer|der|jks|keystore|asc|gpg)$/i, 'a key or certificate'],
  [/(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i, 'an SSH key'],
  [/\.(db|sqlite|sqlite3|db-wal|db-shm|sqlite-wal|sqlite-shm)$/i, 'a database'],
  [/(^|\/)(\.npmrc|\.netrc|\.htpasswd|credentials[^/]*|secrets?\.[a-z]+)$/i, 'a credentials file'],
  [/(^|\/)[^/]*-data\//, 'a data dir'],
];

/** `path: reason` for each file a tarball must not hold: tests, fixtures, scratch files and secret-like names. */
export function contentProblems(paths) {
  const out = [];
  for (const p of paths) {
    for (const [re, why] of [...NOT_SHIPPED, ...SECRET_NAMES]) if (re.test(p)) out.push(`${p}: ${why}`);
  }
  return out;
}

/** Every file a package.json points at (main, types, exports, bin): `[{ field, target }]`. Wildcards stay as `*`. */
export function entryPoints(pkg) {
  const out = [];
  const add = (field, target) => typeof target === 'string' && out.push({ field, target: target.replace(/^\.\//, '') });
  add('main', pkg.main);
  add('types', pkg.types);
  const walk = (field, v) => {
    if (typeof v === 'string') return add(field, v);
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(`${field}[${JSON.stringify(k)}]`, x);
  };
  walk('exports', pkg.exports);
  if (typeof pkg.bin === 'string') add('bin', pkg.bin);
  else for (const [name, target] of Object.entries(pkg.bin ?? {})) add(`bin.${name}`, target);
  return out;
}

/** `field -> target` for each entry point the tarball's `paths` do not hold (a wildcard needs one match at least). */
export function missingEntryPoints(pkg, paths) {
  const have = new Set(paths);
  const out = [];
  for (const { field, target } of entryPoints(pkg)) {
    if (target.includes('*')) {
      const re = new RegExp(`^${target.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.+')}$`);
      if (![...have].some((p) => re.test(p))) out.push(`${field} -> ${target}: no file matches`);
    } else if (!have.has(target)) out.push(`${field} -> ${target}: not in the tarball`);
  }
  return out;
}

/** What is over the package's budget. */
export function budgetProblems(name, { files, unpacked, packed }, budget = BUDGET[name]) {
  const out = [];
  if (!budget) return [`${name}: no size budget (add it to BUDGET in scripts/lib/npm-packages.mjs)`];
  if (files > budget.files) out.push(`${name}: ${files} files, over the budget of ${budget.files}`);
  if (unpacked > budget.unpacked) out.push(`${name}: ${unpacked} bytes unpacked, over the budget of ${budget.unpacked}`);
  if (packed > budget.packed) out.push(`${name}: ${packed} bytes packed, over the budget of ${budget.packed}`);
  return out;
}

/** The npm metadata every package carries; `problems` lists what is missing or wrong. */
export function metadataProblems(name, pkg, { version, engines }) {
  const out = [];
  const want = (ok, what) => !ok && out.push(`${name}: ${what}`);
  want(pkg.name === `@markstage/${name}`, `name is ${pkg.name}`);
  want(pkg.version === version, `version ${pkg.version}, not the repo's ${version}`);
  want(pkg.license === 'Elastic-2.0', `license is ${pkg.license}, not Elastic-2.0`);
  want(typeof pkg.description === 'string' && pkg.description.length > 20, 'no description');
  want(Array.isArray(pkg.keywords) && pkg.keywords.includes('markstage'), 'keywords without "markstage"');
  want(/^https:\/\//.test(pkg.homepage ?? ''), 'no homepage');
  want(pkg.bugs?.url === 'https://github.com/spcaeo/markstage/issues', 'bugs.url is not the issues page');
  want(pkg.repository?.url === 'git+https://github.com/spcaeo/markstage.git' && pkg.repository?.directory === `packages/${name}`, 'repository is not github.com/spcaeo/markstage with its directory');
  want(pkg.engines?.node === engines, `engines.node ${pkg.engines?.node}, not the repo's ${engines}`);
  want(pkg.publishConfig?.access === 'public' && pkg.publishConfig?.provenance === true, 'publishConfig is not { access: "public", provenance: true }');
  want(Array.isArray(pkg.files) && pkg.files.length > 0, 'no files allow-list');
  want(!pkg.private, 'private: true');
  // npm rewrites "./bin/x.mjs" to "bin/x.mjs" on publish and warns that the bin "was invalid and removed": write it
  // as npm keeps it, so a publish changes nothing in the manifest
  for (const [k, target] of Object.entries(typeof pkg.bin === 'string' ? { [pkg.name]: pkg.bin } : (pkg.bin ?? {}))) {
    want(typeof target === 'string' && !target.startsWith('./') && path.posix.normalize(target) === target, `bin.${k} is "${target}", write it as "${path.posix.normalize(String(target))}"`);
  }
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [dep, spec] of Object.entries(pkg[field] ?? {})) {
      if (dep.startsWith('@markstage/')) want(spec === version, `${field}.${dep} is "${spec}", not exactly ${version}`);
    }
  }
  return out;
}

/** Does Node `version` meet an engines range made of `>=x.y.z` and `^x.y.z` parts joined by `||`? */
export function meetsEngines(version, range) {
  const v = String(version).replace(/^v/, '').split('.').map(Number);
  const cmp = (a, b) => a.map((x, i) => x - b[i]).find((d) => d !== 0) ?? 0;
  return String(range)
    .split('||')
    .some((part) => {
      const m = /^\s*(>=|\^)\s*(\d+)\.(\d+)\.(\d+)\s*$/.exec(part);
      if (!m) return true; // a form this does not read: left to the package's own check
      const min = [Number(m[2]), Number(m[3]), Number(m[4])];
      return cmp(v, min) >= 0 && (m[1] === '>=' || v[0] === min[0]);
    });
}

/**
 * `npm pack` of the packages into `dest` (real tarballs; no publish). Returns npm's JSON: one
 * `{ name, version, filename, files: [{ path, size }], size, unpackedSize, entryCount }` per package, in PACKAGES order.
 */
export function packAll(dest, { packages = PACKAGES, run = execFileSync } = {}) {
  fs.mkdirSync(dest, { recursive: true });
  const args = ['pack', '--json', '--ignore-scripts', '--pack-destination', dest, ...packages.flatMap((p) => ['-w', `packages/${p}`])];
  const out = JSON.parse(run(NPM, args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
  return packages.map((p) => {
    const hit = out.find((o) => o.name === `@markstage/${p}`);
    if (!hit || !fs.existsSync(path.join(dest, hit.filename))) throw new Error(`npm pack wrote no tarball for @markstage/${p}`);
    return hit;
  });
}
