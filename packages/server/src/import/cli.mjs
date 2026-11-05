// `markstage-server import wordpress|ghost|prismic …` on the server itself (docs/IMPORT.md "From the command line"):
// the same plan and run as the Import screen, as the person named by --as, with the same rights and checks. No upload
// limit applies to a file read from disk. A password, key or token is never taken on the command line (it would stay
// in the shell's history and show in the process list): it is read from a file (--password-file, --key-file,
// --token-file) or from MARKSTAGE_IMPORT_SECRET, used for the one read, and kept nowhere.
//   import wordpress <export.xml> | --url <https://site> [--user <name>]
//   import ghost <export.json> --site-url <https://site> | --url <https://site>
//   import prismic --repo <name> [--site-url <https://site>] [--routes <routes.json>]
//   and for all: [--mapping <mapping.json>] [--on-collision both|skip|replace] [--drafts skip|include] [--dry] --as <email>
import fs from 'node:fs';
import path from 'node:path';
import { can } from '../roles.mjs';
import { HttpError } from '../util.mjs';
import { productName } from './site/plan.mjs';

const USAGE = `Usage:
  markstage-server import wordpress <export.xml> [options] --as <email>
  markstage-server import wordpress --url <https://site> [--user <name> --password-file <file>] [options] --as <email>
  markstage-server import ghost <export.json> --site-url <https://site> [options] --as <email>
  markstage-server import ghost --url <https://site> --key-file <file> [options] --as <email>
  markstage-server import prismic --repo <name> [--token-file <file>] [--site-url <https://site>] [--routes <file.json>] [options] --as <email>
Options: --mapping <file.json>  --on-collision both|skip|replace  --drafts skip|include  --dry (plan only, nothing written)
A password, key or token comes from its file or from MARKSTAGE_IMPORT_SECRET, never from the command line.`;

const value = (args, flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const readJsonFile = (f, what) => {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(f), 'utf8'));
  } catch (e) {
    throw new Error(`${what} (${f}) could not be read as JSON: ${e.message}`);
  }
};

/** A secret from its file (first line) or the environment; null when neither is given. */
function secretFrom(args, flag, env) {
  if (args.some((a) => /^--(password|key|token)$/.test(a))) throw new Error('Give a password, key or token in a file (--password-file, --key-file, --token-file) or in MARKSTAGE_IMPORT_SECRET, not on the command line.');
  const file = value(args, flag);
  if (file) return fs.readFileSync(path.resolve(file), 'utf8').split(/\r?\n/)[0].trim() || null;
  return env.MARKSTAGE_IMPORT_SECRET?.trim() || null;
}

/** The plan in plain words, as the Import screen says it. */
export function planLines(plan) {
  const c = plan.counts;
  const n = (o, k) => o?.[k] ?? 0;
  const types = Object.entries(c.types).map(([t, k]) => plural(k, t)).join(', ');
  const entries = Object.values(c.entries).reduce((a, b) => a + b, 0);
  const lines = [
    `${plan.name}: ${types || 'nothing'} in ${productName(plan.product)}.`,
    `${plural(n(c.entries, 'create'), 'entry', 'entries')} to create, ${n(c.entries, 'update')} to update, ${n(c.entries, 'unchanged')} unchanged, ${n(c.entries, 'skip')} left out (of ${entries}).`,
    `${plural(n(c.media, 'fetch'), 'media file')} to bring in, ${n(c.media, 'reuse')} already here, ${n(c.media, 'skip')} that cannot come in.`,
    `${plural(n(c.authors, 'create'), 'new author')}, ${n(c.authors, 'existing')} already here.`,
    `${plural(c.redirects, 'old address', 'old addresses')} and ${plural(c.ids, 'old id link')} will point to the new pages.`,
  ];
  if (c.collisions) lines.push(`${plural(c.collisions, 'address is', 'addresses are')} already taken (${plan.mapping.onCollision === 'both' ? 'both kept' : plan.mapping.onCollision === 'skip' ? 'the new one skipped' : 'replaced'}).`);
  if (c.needsAlt) lines.push(`${plural(c.needsAlt, 'picture needs', 'pictures need')} alt text.`);
  if (c.notConverted) lines.push(`${plural(c.notConverted, 'block')} we could not convert (each is an “Import note:” in its text).`);
  if (c.published) lines.push(`${plural(c.published, 'published entry', 'published entries')} come in as drafts: publish them when they are checked.`);
  for (const [t, k] of Object.entries(c.left ?? {})) lines.push(`${plural(k, t)} left out: no collection is chosen for them.`);
  return lines;
}

export async function importCommand(app, args, { out = console.log, env = process.env } = {}) {
  const [product, target] = args;
  if (!['wordpress', 'ghost', 'prismic'].includes(product)) throw new Error(USAGE);
  const email = value(args, '--as');
  const row = email ? app.db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email) : null;
  if (!row || row.disabled) throw new Error('Say who does it: --as <email of an account on this server>.');
  const ctx = { user: app.users.toPublic(row), ip: null, userAgent: 'markstage-server import', status: 200, query: new URLSearchParams(), params: {}, req: { headers: {} } };
  if (!can(ctx.user, 'content.import')) throw new Error('Importing is for editors and up.');

  const mapping = value(args, '--mapping') ? readJsonFile(value(args, '--mapping'), 'The mapping') : {};
  if (value(args, '--on-collision')) mapping.onCollision = value(args, '--on-collision');
  if (value(args, '--drafts')) mapping.drafts = value(args, '--drafts');
  const input = { source: product, mapping, siteUrl: value(args, '--site-url') };
  const file = target && !target.startsWith('--') ? path.resolve(target) : null;
  if (file) Object.assign(input, { data: fs.readFileSync(file), name: path.basename(file) });
  else if (product === 'wordpress') Object.assign(input, { url: value(args, '--url'), user: value(args, '--user'), password: value(args, '--user') ? secretFrom(args, '--password-file', env) : undefined });
  else if (product === 'ghost') Object.assign(input, { url: value(args, '--url'), key: secretFrom(args, '--key-file', env) });
  else Object.assign(input, { repo: value(args, '--repo'), token: secretFrom(args, '--token-file', env), routes: value(args, '--routes') ? readJsonFile(value(args, '--routes'), 'The routes') : undefined });
  if (!file && product !== 'prismic' && !input.url) throw new Error(USAGE);

  let made;
  try {
    made = await app.imports.planSite(ctx, input);
  } catch (e) {
    if (e instanceof HttpError) throw new Error(e.extra?.field ? `${e.message} (${e.extra.field})` : e.message);
    throw e;
  }
  const { run, plan } = made;
  for (const l of planLines(plan)) out(l);
  if (args.includes('--dry')) {
    out(`Dry run, nothing written. To see it in the Import screen: #/import/${run.id}`);
    return 0;
  }
  const started = app.imports.start({ ...ctx, params: { rid: run.id } });
  await app.jobs.idle();
  const job = app.jobs.get(started.job.id);
  const done = app.db.prepare('SELECT status, result FROM import_runs WHERE id = ?').get(run.id);
  if (done.status !== 'done') {
    process.stdout.write(job.log ?? '');
    throw new Error(`The import did not finish: ${job.error ?? 'see above'}`);
  }
  const r = JSON.parse(done.result);
  const k = (o, x) => o?.[x] ?? 0;
  out(`Done in ${plural(r.commits.length, 'commit')}: ${k(r.counts.entries, 'create')} created, ${k(r.counts.entries, 'update')} updated, ${k(r.counts.entries, 'unchanged')} unchanged, ${k(r.counts.entries, 'skip')} left out; ${k(r.counts.media, 'fetch')} media files brought in.`);
  // what the plan left out before any item was made, said again so the report accounts for it
  for (const [t, k] of Object.entries(r.counts.left ?? {})) out(`${plural(k, t)} left out: no collection is chosen for them.`);
  for (const [t, k] of Object.entries(r.counts.other ?? {})) out(`${plural(k, t.replace(/_/g, ' '))} not brought over (menus, forms and the like belong to the old site).`);
  if (r.review.length) out(`${plural(r.review.length, 'thing')} to review: #/import/${run.id}?show=review`);
  return 0;
}
