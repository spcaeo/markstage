// The site's `design` (markstage.config): the stylesheets, scripts and injected code the Design & Code screens show.
//
//   design: { tokens: 'src/styles/tokens.css', customCss: 'src/styles/custom.css',
//             files: [{ path, label, scope }], scripts: [{ path, label }], inject: { head, foot } }
//
// Every path is checked once at start, as collection folders are: repo-relative, inside the repo once symlinks are
// resolved, never in .git, not a symlink itself, and of a known kind. Components (.astro, .tsx …) are listed
// read-only: their structure stays developer work in git. customCss and the inject files may not exist yet (the
// first save creates them).
import fs from 'node:fs';
import path from 'node:path';
import { ConfigError, isInside, realish } from '../config.mjs';

const fail = (message) => {
  throw new ConfigError(`design: ${message}`);
};

/** File extension -> [language, editable in the browser]. Anything else is refused. */
const LANGS = {
  '.css': ['css', true],
  '.scss': ['css', true],
  '.js': ['js', true],
  '.mjs': ['js', true],
  '.html': ['html', true],
  '.astro': ['astro', false],
  '.tsx': ['tsx', false],
  '.jsx': ['jsx', false],
  '.ts': ['ts', false],
  '.vue': ['vue', false],
  '.svelte': ['svelte', false],
};

const label = (v, fallback) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : fallback);

/** A url-safe id from a repo path ("src/styles/global.css" -> "src-styles-global-css"). */
const slug = (rel) => rel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'file';

/** Check one declared path and describe it. `mayBeMissing`: the first save creates it. */
function fileOf(contentRoot, rel, what, { mayBeMissing = false, langs = null } = {}) {
  if (typeof rel !== 'string' || !rel.trim()) fail(`${what} must be a repo-relative path.`);
  rel = rel.trim().replace(/^\.\//, '');
  if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) fail(`${what} must be a path inside the site repo: ${rel}`);
  const ext = path.extname(rel).toLowerCase();
  const kind = LANGS[ext];
  if (!kind || (langs && !langs.includes(kind[0]))) fail(`${what}: ${rel} is not a ${langs ? langs.join(' or ') : 'stylesheet, script or component'} file.`);
  const abs = path.resolve(contentRoot, rel);
  let exists = true;
  try {
    if (fs.lstatSync(abs).isSymbolicLink()) fail(`${what}: ${rel} is a symlink.`);
  } catch (e) {
    if (e instanceof ConfigError) throw e;
    if (!mayBeMissing) fail(`${what}: ${rel} does not exist.`);
    exists = false;
  }
  // the nearest existing folder, resolved, must be inside the repo and outside .git
  const realFile = realish(abs);
  if (!isInside(contentRoot, realFile) || realFile === contentRoot) fail(`${what}: ${rel} is outside the site repo.`);
  if (isInside(path.join(contentRoot, '.git'), realFile)) fail(`${what}: ${rel} is inside .git.`);
  if (exists && !fs.statSync(realFile).isFile()) fail(`${what}: ${rel} is not a file.`);
  return { path: path.relative(contentRoot, realFile).split(path.sep).join('/'), abs: realFile, lang: kind[0], editable: kind[1] };
}

/**
 * The normalized design: { files: [{id, path, abs, label, kind, lang, editable, scope}], order: [id…] } or null when
 * the site declares none. `order` is the stylesheets in load order (the last one wins a tie).
 */
export function designOf(raw, contentRoot) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) fail('must be an object like { tokens, customCss, files, scripts, inject }.');
  const files = [];
  const ids = new Set();
  const add = (f, id, extra) => {
    if (files.some((x) => x.path === f.path)) fail(`${f.path} is listed twice.`);
    let unique = id;
    for (let n = 2; ids.has(unique); n++) unique = `${id}-${n}`;
    ids.add(unique);
    files.push({ id: unique, ...f, ...extra });
  };

  if (raw.tokens !== undefined) add(fileOf(contentRoot, raw.tokens, 'tokens', { langs: ['css'] }), 'tokens', { kind: 'tokens', label: 'Design tokens', scope: 'site' });
  if (!Array.isArray(raw.files ?? [])) fail('files must be a list of { path, label, scope }.');
  for (const [i, f] of (raw.files ?? []).entries()) {
    const file = fileOf(contentRoot, f?.path, `files[${i}].path`);
    add(file, slug(file.path), { kind: 'file', label: label(f.label, path.basename(file.path)), scope: label(f.scope, 'site') });
  }
  if (raw.customCss !== undefined) add(fileOf(contentRoot, raw.customCss, 'customCss', { mayBeMissing: true, langs: ['css'] }), 'custom-css', { kind: 'custom', label: 'Custom CSS', scope: 'site' });
  if (!Array.isArray(raw.scripts ?? [])) fail('scripts must be a list of { path, label }.');
  for (const [i, s] of (raw.scripts ?? []).entries()) {
    const file = fileOf(contentRoot, s?.path, `scripts[${i}].path`, { langs: ['js', 'ts', 'tsx', 'jsx'] });
    add(file, slug(file.path), { kind: 'script', label: label(s.label, path.basename(file.path)), scope: 'site' });
  }
  const inject = raw.inject ?? {};
  if (typeof inject !== 'object' || Array.isArray(inject)) fail('inject must be { head, foot } (paths of .html files).');
  for (const where of ['head', 'foot']) {
    if (inject[where] === undefined) continue;
    add(fileOf(contentRoot, inject[where], `inject.${where}`, { mayBeMissing: true, langs: ['html'] }), `inject-${where}`, {
      kind: `inject-${where}`,
      label: where === 'head' ? 'Code in every page’s head' : 'Code at the end of every page',
      scope: 'site',
    });
  }
  const order = files.filter((f) => f.lang === 'css' && f.kind !== 'custom').map((f) => f.id);
  const custom = files.find((f) => f.kind === 'custom');
  if (custom) order.push(custom.id);
  return Object.freeze({ files, order });
}
