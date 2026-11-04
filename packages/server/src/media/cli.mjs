// `markstage-server media import <folder | file.zip | addresses.txt> [--dry] --as <email>` on the server itself
// (docs/API.md "Importing media"): many files into the media library in one commit, as the person named by --as, with
// the same rights and checks as the routes. A folder is read without its sub-folders' hidden files; a .txt file is
// one picture address per line (fetched through the SSRF guard). `media index [--dry]` registers the files already
// under the media folder (index-files.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { can } from '../roles.mjs';
import { MAX_URLS, nameOfUrl } from './import.mjs';
import { fileSource } from './zip.mjs';
import { indexExistingFiles, indexWords } from './index-files.mjs';

const value = (args, flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const MAX_FILES = 500;

/** The files of a folder, sub-folders included, hidden ones left out, in name order. */
function filesIn(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) out.push(abs);
    }
  };
  walk(dir);
  return out;
}

export async function mediaCommand(app, args, out = console.log) {
  const [sub, target] = args;
  // the site's own files, registered in place: no person needed, nothing is written to the repo
  if (sub === 'index') {
    const r = indexExistingFiles(app, { dry: args.includes('--dry') });
    out(indexWords(r));
    for (const a of r.added) out(`  ${r.dry ? 'would add' : 'added'} ${a.path} (${a.type}, ${a.bytes} bytes${a.used ? `, used on ${a.used} page${a.used === 1 ? '' : 's'}` : ''})`);
    for (const s of r.skipped) out(`  left out ${s.path}: ${s.reason}`);
    return 0;
  }
  if (sub !== 'import' || !target || target.startsWith('--')) throw new Error('Usage: markstage-server media import <folder | file.zip | addresses.txt> [--dry] --as <email>, or media index [--dry]');
  const email = value(args, '--as');
  const row = email ? app.db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email) : null;
  if (!row || row.disabled) throw new Error('Say who does it: --as <email of an account on this server>.');
  const ctx = { user: app.users.toPublic(row), ip: null, userAgent: 'markstage-server media', status: 200, query: new URLSearchParams(), params: {} };
  if (!can(ctx.user, 'media.import')) throw new Error('Your role cannot import media files.');
  const dry = args.includes('--dry');
  const mi = app.mediaImport;
  const from = path.resolve(target);
  const max = app.config.media.maxBytes;
  let items;
  let sources;
  if (fs.statSync(from).isDirectory()) {
    const files = filesIn(from);
    if (files.length > MAX_FILES) throw new Error(`This folder holds ${files.length} files; at most ${MAX_FILES} are taken at once.`);
    items = files.map((f) => {
      const bytes = fs.statSync(f).size;
      return { name: path.relative(from, f), bytes, ...(bytes > max ? { problem: `larger than ${Math.round(max / 1024 / 1024)} MB, left out` } : {}), file: f };
    });
    sources = items.filter((i) => !i.problem).map((i) => ({ label: i.name, name: path.basename(i.file), read: async () => fs.readFileSync(i.file) }));
  } else if (/\.zip$/i.test(from)) {
    const entries = mi.zipEntries(fileSource(from));
    items = entries;
    sources = entries.filter((e) => !e.problem).map((e) => ({ label: e.name, name: path.posix.basename(e.name), read: async () => e.read() }));
  } else if (/\.txt$/i.test(from)) {
    const urls = fs.readFileSync(from, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    if (urls.length > MAX_URLS) throw new Error(`This list holds ${urls.length} addresses; at most ${MAX_URLS} are taken at once.`);
    items = mi.checkUrls(urls).map((i) => ({ name: i.url, ...(i.problem ? { problem: i.problem } : {}) }));
    sources = items.filter((i) => !i.problem).map((i) => ({ label: i.name, name: nameOfUrl(i.name), read: () => mi.fetchImage(i.name) }));
  } else throw new Error('Import a folder, a .zip file, or a .txt file with one picture address per line.');
  if (dry) {
    out(`Dry run, nothing written: ${sources.length} file${sources.length === 1 ? '' : 's'} would come in${items.length > sources.length ? `, ${items.length - sources.length} left out` : ''}.`);
    for (const i of items) if (i.problem) out(`  ${i.name}: ${i.problem}`);
    return 0;
  }
  if (!sources.length) throw new Error('Nothing here can be imported.');
  const r = await mi.storeAll(ctx, sources, { source: path.basename(from), message: (n) => `Import ${n === 1 ? '1 media file' : `${n} media files`} from ${path.basename(from)}` });
  out(`Imported ${r.rows.length} file${r.rows.length === 1 ? '' : 's'}${r.commit ? ` in ${r.commit.slice(0, 7)}` : ''}.`);
  for (const p of [...items.filter((i) => i.problem).map((i) => `${i.name}: ${i.problem}`), ...r.problems]) out(`  ${p}`);
  return r.rows.length ? 0 : 1;
}
