// Pure helpers for scripts/public-sync.mjs (no git, no files), so the filters and the checks are tested on their own
// (public-sync-core.test.mjs). docs/PUBLISHING.md says how the publish works.
import path from 'node:path';

/**
 * A path glob as a RegExp, matched against the whole repo-relative path.
 * `**` crosses folders, `*` and `?` stay inside one. `dir/**` matches all of dir.
 * @param {string} glob
 */
export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      const slashAfter = glob[i + 2] === '/';
      out += slashAfter ? '(?:.*/)?' : '.*';
      i += slashAfter ? 2 : 1;
    } else if (ch === '*') {
      out += '[^/]*';
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

/** One include or exclude rule: a string glob, or `{ path, why }`. */
function rule(entry) {
  const text = typeof entry === 'string' ? entry : entry.path;
  const negated = text.startsWith('!');
  const glob = negated ? text.slice(1) : text;
  return { glob, negated, re: globToRegExp(glob), why: typeof entry === 'string' ? '' : (entry.why ?? '') };
}

const list = (value, fallback = []) => (Array.isArray(value) ? value : fallback);

/**
 * Normalises public-sync.config.json. Keys starting with `$` are comments.
 * @param {Record<string, unknown>} raw
 */
export function normaliseConfig(raw) {
  const include = list(raw.include);
  if (include.length === 0) throw new Error('public-sync.config.json: "include" is empty');
  return {
    target: typeof raw.target === 'string' ? raw.target : '.public-export',
    branch: typeof raw.branch === 'string' ? raw.branch : 'main',
    publicRemote: typeof raw.publicRemote === 'string' ? raw.publicRemote : '',
    commitAuthor: typeof raw.commitAuthor === 'string' && raw.commitAuthor ? raw.commitAuthor : null,
    requiredFiles: list(raw.requiredFiles, ['LICENSE', 'NOTICE', 'README.md', 'SECURITY.md']),
    privateSubjectWords: list(raw.privateSubjectWords).filter(Boolean),
    privateText: list(raw.privateText).filter(Boolean).map((source) => new RegExp(source, 'i')),
    checks: list(raw.checks),
    include: include.map(rule),
    exclude: list(raw.exclude).map(rule),
  };
}

/** The exclude rule that drops a path (the last match wins, `!glob` puts it back), or null. */
export function excludedBy(filePath, config) {
  let hit = null;
  for (const r of config.exclude) if (r.re.test(filePath)) hit = r.negated ? null : r;
  return hit;
}

/**
 * Splits paths into what is exported, what an exclude rule drops, and what no include rule allows.
 * @param {string[]} paths
 * @param {ReturnType<typeof normaliseConfig>} config
 */
export function selectFiles(paths, config) {
  const kept = [];
  const excluded = [];
  const notAllowed = [];
  for (const p of paths) {
    const hit = excludedBy(p, config);
    if (hit) excluded.push({ path: p, rule: hit.glob, why: hit.why });
    else if (!config.include.some((r) => !r.negated && r.re.test(p))) notAllowed.push(p);
    else kept.push(p);
  }
  return { kept, excluded, notAllowed };
}

/** How many exported files sit in each top-level folder (a root file counts as "(root)"). */
export function countByTop(paths) {
  const counts = new Map();
  for (const p of paths) {
    const top = p.includes('/') ? `${p.split('/')[0]}/` : '(root)';
    counts.set(top, (counts.get(top) ?? 0) + 1);
  }
  return new Map([...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

/**
 * Parses `git ls-tree -r -z` output into Map(path → `mode sha`). Skips submodules.
 * @param {string} out
 */
export function parseLsTree(out) {
  const map = new Map();
  for (const record of out.split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    const [mode, type, sha] = record.slice(0, tab).split(' ');
    if (type !== 'blob') continue;
    map.set(record.slice(tab + 1), `${mode} ${sha}`);
  }
  return map;
}

/**
 * What a sync changes in the public repo. Both maps are path → `mode sha`.
 * @param {Map<string, string>} next  the files to export
 * @param {Map<string, string>} current  the public repo's last commit
 */
export function planChanges(next, current) {
  const added = [];
  const modified = [];
  const deleted = [];
  for (const [p, id] of next) {
    if (!current.has(p)) added.push(p);
    else if (current.get(p) !== id) modified.push(p);
  }
  for (const p of current.keys()) if (!next.has(p)) deleted.push(p);
  return { added: added.sort(), modified: modified.sort(), deleted: deleted.sort() };
}

/** The private commit a public commit came from (its `Private-Commit:` trailer), or null. */
export function lastSyncedCommit(message) {
  const match = /^Private-Commit: ([0-9a-f]{7,40})\s*$/m.exec(message ?? '');
  return match ? match[1] : null;
}

/**
 * Subjects that are safe to publish: a subject naming a private word (a client, the first site) becomes
 * "Private change".
 * @param {string[]} subjects
 * @param {string[]} privateWords
 */
export function publicSubjects(subjects, privateWords) {
  const words = privateWords.filter(Boolean).map((w) => w.toLowerCase());
  return subjects.map((s) => (words.some((w) => s.toLowerCase().includes(w)) ? 'Private change' : s));
}

/**
 * The public commit message: "Sync from private <short sha>: <subjects>", a bullet list of the subjects, and a
 * Private-Commit trailer the next sync starts from.
 * @param {{ shortSha: string, fullSha: string, subjects: string[], first: boolean }} input
 */
export function commitMessage({ shortSha, fullSha, subjects, first }) {
  const items = first ? ['First public snapshot'] : subjects.length ? subjects : ['Updates'];
  const maxTitle = 100;
  let title = `Sync from private ${shortSha}: ${items.join('; ')}`;
  if (title.length > maxTitle) {
    const more = items.length > 1 ? ` (+${items.length - 1} more)` : '';
    const head = `Sync from private ${shortSha}: ${items[0]}`;
    title = head.length + more.length > maxTitle ? `${head.slice(0, maxTitle - more.length - 1)}…${more}` : head + more;
  }
  const shown = items.slice(0, 60);
  const rest = items.length > shown.length ? `\n- …and ${items.length - shown.length} more` : '';
  const body = items.length > 1 ? `\n\n${shown.map((s) => `- ${s}`).join('\n')}${rest}` : '';
  return `${title}${body}\n\nPrivate-Commit: ${fullSha}\n`;
}

/**
 * Files in the export folder that should not be there: not in the export list, or matching an exclude rule.
 * @param {string[]} onDisk  every file in the export folder (its .git aside)
 * @param {string[]} kept  the export list
 * @param {ReturnType<typeof normaliseConfig>} config
 */
export function strayPaths(onDisk, kept, config) {
  const keep = new Set(kept);
  const problems = [];
  for (const p of onDisk) {
    const hit = excludedBy(p, config);
    if (hit) problems.push(`${p}: matches the exclude rule "${hit.glob}" (${hit.why || 'private'})`);
    else if (!keep.has(p)) problems.push(`${p}: in the export folder but not in the export list`);
  }
  return problems;
}

/** Required files that are missing from the export. */
export function missingRequired(paths, config) {
  const have = new Set(paths);
  return config.requiredFiles.filter((f) => !have.has(f)).map((f) => `${f} is missing`);
}

/**
 * Lines of exported text that name something private (config "privateText": the first site, its folders, a
 * home folder path). `files` text is null for binaries.
 * @param {{ path: string, text: string | null }[]} files
 * @param {RegExp[]} patterns
 */
export function privateTextProblems(files, patterns) {
  const problems = [];
  if (patterns.length === 0) return problems;
  for (const { path: p, text } of files) {
    if (text === null) continue;
    text.split('\n').forEach((line, i) => {
      const re = patterns.find((x) => x.test(line));
      if (re) problems.push(`${p}:${i + 1}: names something private (${re.source})`);
    });
  }
  return problems;
}

/** Does a package.json path (`./src/a.mjs`, `./styles/*`, `bin`) point at something in the export? */
function pointsAtExport(dir, ref, have) {
  const rel = path.posix.normalize(path.posix.join(dir, ref.replace(/^\.\//, '')));
  if (rel.includes('*')) {
    const re = globToRegExp(rel);
    return [...have].some((p) => re.test(p) || p.startsWith(`${rel.slice(0, rel.indexOf('*'))}`));
  }
  if (have.has(rel)) return true;
  return [...have].some((p) => p.startsWith(`${rel.replace(/\/$/, '')}/`));
}

function exportTargets(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) exportTargets(v, out);
  return out;
}

/** A script file a package.json script runs with node (`node scripts/x.mjs`, `node --test …` aside). */
const SCRIPT_FILE = /(?:^|\s)node(?:\s+--[\w=-]+)*\s+((?:\.\/)?[\w./-]+\.(?:mjs|cjs|js|ts))(?=\s|$)/g;

/**
 * What every package.json of the export points at must be in the export: the workspaces, `main`, `types`, `bin`,
 * `exports`, `files`, and the files its scripts run with node.
 * @param {{ path: string, text: string | null }[]} files
 */
export function manifestProblems(files) {
  const have = new Set(files.map((f) => f.path));
  const problems = [];
  for (const { path: p, text } of files) {
    if (text === null || path.posix.basename(p) !== 'package.json') continue;
    let pkg;
    try {
      pkg = JSON.parse(text);
    } catch {
      problems.push(`${p}: not valid JSON`);
      continue;
    }
    const dir = path.posix.dirname(p) === '.' ? '' : path.posix.dirname(p);
    for (const ws of list(pkg.workspaces)) {
      const re = globToRegExp(path.posix.join(dir, ws, 'package.json'));
      if (![...have].some((x) => re.test(x))) problems.push(`${p}: workspace "${ws}" has no package.json in the export`);
    }
    const refs = [
      ...['main', 'types', 'typings', 'module'].filter((k) => typeof pkg[k] === 'string').map((k) => [k, pkg[k]]),
      ...(typeof pkg.bin === 'string' ? [['bin', pkg.bin]] : Object.entries(pkg.bin ?? {}).map(([k, v]) => [`bin.${k}`, v])),
      ...exportTargets(pkg.exports).map((v) => ['exports', v]),
      ...list(pkg.files).map((v) => ['files', v]),
    ];
    for (const [script, command] of Object.entries(pkg.scripts ?? {})) {
      for (const m of String(command).matchAll(SCRIPT_FILE)) refs.push([`scripts.${script}`, m[1]]);
    }
    for (const [key, ref] of refs) {
      if (typeof ref !== 'string' || /^[a-z]+:/.test(ref)) continue;
      if (!pointsAtExport(dir, ref, have)) problems.push(`${p}: ${key} points at "${ref}", which is not in the export`);
    }
  }
  return problems;
}

const CODE = /\.(mjs|cjs|js|mts|ts|tsx|astro)$/;
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"](\.{1,2}\/[^'"\n]+)['"]/g;
const SUFFIXES = ['', '.mjs', '.js', '.ts', '.json', '.astro', '.d.ts', '/index.mjs', '/index.js', '/index.ts'];

function candidates(from, spec) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec.replace(/[?#].*$/, '')));
  const out = SUFFIXES.map((s) => base + s);
  if (base.endsWith('.js')) out.push(`${base.slice(0, -3)}.ts`);
  return out;
}

/**
 * Relative imports in exported code whose file is in the private tree but was left out of the export: the
 * public repo would not run. An import that does not resolve in the private tree either (a test fixture's text,
 * a string in a test) is not this check's business.
 * @param {{ path: string, text: string | null }[]} files  the export
 * @param {Set<string>} privateTree  every path of the private commit
 */
export function missingImports(files, privateTree) {
  const have = new Set(files.map((f) => f.path));
  const problems = [];
  for (const { path: p, text } of files) {
    if (text === null || !CODE.test(p)) continue;
    for (const m of text.matchAll(SPECIFIER)) {
      const options = candidates(p, m[1]);
      if (options.some((c) => have.has(c))) continue;
      const left = options.find((c) => privateTree.has(c));
      if (left) problems.push(`${p}: imports "${m[1]}" (${left}), which is not exported`);
    }
  }
  return problems;
}
