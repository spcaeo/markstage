// `markstage-server library …` on the server itself (docs/API-LIBRARY.md "Command line"), as the person named by --as
// (an account on this server), with the same rights and checks as the routes:
//   library import <file> [--dry] [--on-clash skip|copy] [--media-map <file>] --as <email>
//                                       a pack (.json), a WordPress export (.xml) or database dump (.sql, .sql.gz);
//                                       --media-map: JSON {urls: {old picture address: file in the repo}}
//   library export <id,id,…> [--out <file>] --as <email>                the pack of these items
import fs from 'node:fs';
import path from 'node:path';

const value = (args, flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);

export async function libraryCommand(app, args, out = console.log) {
  const [sub, target] = args;
  const email = value(args, '--as');
  const row = email ? app.db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email) : null;
  if (!row || row.disabled) throw new Error('Say who does it: --as <email of an account on this server>.');
  const ctx = { user: app.users.toPublic(row), ip: null, userAgent: 'markstage-server library', status: 200, query: new URLSearchParams(), params: {} };
  await app.library.moveOld();
  if (sub === 'export') {
    if (!target || target.startsWith('--')) throw new Error('Usage: markstage-server library export <id,id,…> [--out <file>] --as <email>');
    const text = app.libraryPacks.exportPack(ctx.user, target.split(','));
    const file = value(args, '--out');
    if (file) {
      fs.writeFileSync(path.resolve(file), text, { flag: 'wx' });
      out(`Wrote ${path.resolve(file)} (${target.split(',').length} item${target.split(',').length === 1 ? '' : 's'}).`);
    } else process.stdout.write(text);
    app.audit.log(ctx, 'library.export', { target: 'library', detail: { ids: target.split(','), via: 'cli' } });
    return 0;
  }
  if (sub !== 'import' || !target || target.startsWith('--')) throw new Error('Usage: markstage-server library import <file> [--dry] [--on-clash skip|copy] [--media-map <file>] --as <email> | export <id,…> [--out <file>] --as <email>');
  const file = path.resolve(target);
  const dry = args.includes('--dry');
  const name = path.basename(file);
  let r;
  if (/\.json$/i.test(name)) r = await app.libraryPacks.importPack(ctx, fs.readFileSync(file, 'utf8'), { dry, onClash: value(args, '--on-clash') ?? 'skip', source: name });
  else if (/\.(xml|sql|sql\.gz)$/i.test(name)) {
    const map = value(args, '--media-map');
    r = await app.libraryWp.importPath(ctx, file, { dry, source: name, mediaMap: map ? fs.readFileSync(path.resolve(map), 'utf8') : null });
  }
  else throw new Error('Import a Markstage pack (.json), a WordPress export (.xml) or a WordPress database dump (.sql or .sql.gz).');
  if (dry) {
    out(`Dry run, nothing written: ${r.items.length} item${r.items.length === 1 ? '' : 's'}, ${r.media} media file${r.media === 1 ? '' : 's'}.`);
    for (const i of r.items) out(`  ${i.kind.padEnd(8)} ${i.name}${i.exists ? ' (already here)' : ''}`);
  } else out(`Imported ${r.created.length} item${r.created.length === 1 ? '' : 's'}${r.skipped?.length ? `, ${r.skipped.length} skipped (already here)` : ''}${r.commit ? ` in ${r.commit.slice(0, 7)}` : ''}.`);
  for (const p of r.problems ?? []) out(`  ${p}`);
  return 0;
}
