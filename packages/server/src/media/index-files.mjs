// Index the site's existing files (docs/API.md "Indexing existing files"): every file already under the media
// folder (the one uploads go to, config media.dir) that the library does not know yet becomes a media row, in
// place: nothing is copied, moved or committed. The row has what the file tells (its bytes' type, size, an image's
// width and height from its header, the file's modified time); no uploader and no alt text. A file the library
// already lists, or of a kind the site does not take (SVG, text, unknown bytes), is left out and named. Safe to
// run again: the second run adds nothing. Where each file is used is found like an upload's (the entry texts).
//   POST /media/index {dry?}             owner and administrators ('media.index')
//   markstage-server media index [--dry] the same on the server itself
import fs from 'node:fs';
import path from 'node:path';
import { isInside } from '../config.mjs';
import { tx } from '../db.mjs';
import { newId } from '../util.mjs';
import { TYPES, dimensions, sniff } from './sniff.mjs';

/** The files of a folder, sub-folders included, hidden ones left out, in name order. */
export function filesUnder(dir) {
  const out = [];
  const walk = (d) => {
    let list;
    try {
      list = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) out.push(abs);
    }
  };
  walk(dir);
  return out;
}

/** What one file would become: {row} or {problem}. The bytes decide the type; the name is only the filename. */
export function rowFor(abs, rel, stat, head) {
  const found = sniff(head);
  if (!found.type) return { problem: found.svg ? 'SVG files are not taken' : found.markup ? 'not an image or document' : 'not a kind of file the site takes' };
  const doc = TYPES[found.type].document;
  const size = doc ? {} : dimensions(head, found.type);
  return {
    row: {
      id: newId('m'),
      path: rel,
      filename: path.basename(abs),
      type: found.type,
      width: size.width ?? null,
      height: size.height ?? null,
      bytes: stat.size,
      alt: '',
      uploaded_by: null,
      uploaded_at: new Date(stat.mtimeMs).toISOString(),
    },
  };
}

/**
 * Walks the media folder and registers what is new. `dry` writes nothing. Returns {found, added: [{path, type,
 * bytes, used}], known, skipped: [{path, reason}]}; `used` is how many entries name the file (0 when `usage` is
 * off; media/uses.mjs says where).
 */
export function indexExistingFiles(app, { dry = false, usage = true } = {}) {
  const { db, store, config } = app;
  const media = config.media;
  const known = new Set(db.prepare('SELECT path FROM media').all().map((r) => r.path));
  const added = [];
  const skipped = [];
  let already = 0;
  const insert = db.prepare('INSERT INTO media (id, path, filename, type, width, height, bytes, alt, uploaded_by, uploaded_at) VALUES (@id, @path, @filename, @type, @width, @height, @bytes, @alt, @uploaded_by, @uploaded_at)');
  const files = filesUnder(media.absDir);
  if (usage) app.mediaUses.sync();
  const run = () => {
    for (const abs of files) {
      let real;
      try {
        real = fs.realpathSync(abs);
      } catch {
        continue;
      }
      // a link that leaves the repo is never a site file
      if (!isInside(config.contentRoot, real)) {
        skipped.push({ path: store.rel(abs), reason: 'points outside the site' });
        continue;
      }
      const rel = store.rel(abs);
      if (known.has(rel)) {
        already++;
        continue;
      }
      const stat = fs.statSync(abs);
      const fd = fs.openSync(abs, 'r');
      const head = Buffer.alloc(Math.min(stat.size, 64 * 1024));
      try {
        fs.readSync(fd, head, 0, head.length, 0);
      } finally {
        fs.closeSync(fd);
      }
      const r = rowFor(abs, rel, stat, head.subarray(0, Math.min(head.length, stat.size)));
      if (r.problem) {
        skipped.push({ path: rel, reason: r.problem });
        continue;
      }
      const inMedia = path.relative(media.dir, rel).split(path.sep).join('/');
      const used = usage ? app.mediaUses.countOf(inMedia) : 0;
      if (!dry) insert.run(r.row);
      known.add(rel);
      added.push({ path: rel, type: r.row.type, bytes: r.row.bytes, width: r.row.width, height: r.row.height, used });
    }
  };
  if (dry) run();
  else tx(db, run);
  return { found: files.length, added, known: already, skipped, dry };
}

/** The report as a few lines for a terminal or a toast. */
export function indexWords(r) {
  const n = r.added.length;
  const head = r.dry ? `Dry run, nothing written: ${n} file${n === 1 ? '' : 's'} would be added` : `Added ${n} file${n === 1 ? '' : 's'}`;
  const used = r.added.filter((a) => a.used).length;
  return `${head}${r.known ? `, ${r.known} already listed` : ''}${r.skipped.length ? `, ${r.skipped.length} left out` : ''}.${n ? ` ${used} of them ${used === 1 ? 'is' : 'are'} used on a page.` : ''}`;
}
