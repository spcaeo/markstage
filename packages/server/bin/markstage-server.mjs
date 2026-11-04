#!/usr/bin/env node
// markstage-server: run the server, or the one-off admin commands that must not go over HTTP.
//   markstage-server serve                  start the server (config from MARKSTAGE_DATA_DIR/config.json)
//   markstage-server init <dataDir>         create a data dir (mode 0700) with a starter config.json
//   markstage-server setup-code             print a one-time code to create the first owner (valid 1 hour)
//   markstage-server reset-password <email> clear a user's password and print a setup code for them
//   markstage-server backup                 back up now (config backup), print the log; exit 1 if it failed
//   markstage-server version                the version and commit this install runs
//   markstage-server check                  load the config and the server code (no database change): exit 0 if fine
//   markstage-server forms import-wordpress <dump.sql.gz> [--form contact] [--table wp_contact] [--dry-run]
//                                           bring old WordPress contact messages into the Inbox (src/forms/import-wp.mjs)
//   markstage-server geoip update <url|file>  put a city database (.mmdb, gzip or not) in place for form messages'
//                                           approximate place, checked first (src/geo/index.mjs)
//   markstage-server env status | sync [--run] --as <email> | promote <branch> [--run] [--reason "…"] --as <email>
//                                           Environments from the server itself, under the same rules (src/env/cli.mjs)
//   markstage-server library import <file> [--dry] [--on-clash skip|copy] --as <email> | export <id,…> [--out <file>] --as <email>
//                                           the Library's packs and WordPress imports (src/library/cli.mjs)
//   markstage-server media import <folder | file.zip | addresses.txt> [--dry] --as <email>
//                                           many media files in one commit (src/media/cli.mjs)
//   markstage-server media index [--dry]    the files already under the media folder, listed in place
//   markstage-server update [--check | --to vX.Y.Z | --rollback [--with-data]] [--remote origin]
//                                           update this git checkout of Markstage (src/update.mjs)
import fs from 'node:fs';
import path from 'node:path';

// node:sqlite still prints an ExperimentalWarning on Node 22/24; hide that one line, keep every other warning
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning' && /SQLite/.test(w.message)) return;
  console.warn(`${w.name}: ${w.message}`);
});
process.umask(0o077);

const [cmd, ...args] = process.argv.slice(2);

const STARTER = {
  contentRoot: '/absolute/path/to/your-site',
  publicOrigin: 'https://cms.example.com',
  host: '127.0.0.1',
  port: 18231,
  commands: { build: ['npm', 'run', 'build'], deploy: null },
  checks: [],
  collections: [{ id: 'posts', label: 'Posts', dir: 'src/content/blog', format: 'md', hasStatus: true, url: '/blog/{id}/' }],
  media: { dir: 'src/assets/uploads', url: '{path}' },
};

async function main() {
  if (cmd === 'init') {
    const dir = args[0];
    if (!dir || !path.isAbsolute(dir)) throw new Error('Usage: markstage-server init /absolute/data/dir');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    const file = path.join(dir, 'config.json');
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(STARTER, null, 2) + '\n', { mode: 0o600 });
    console.log(`Data dir ready: ${dir}\nEdit ${file}, then: MARKSTAGE_DATA_DIR=${dir} markstage-server setup-code`);
    return;
  }
  if (cmd === 'version') {
    const { buildInfo } = await import('../src/version.mjs');
    const v = buildInfo();
    console.log(`Markstage ${v.line}${v.commit ? ` (${v.commit})` : ''}`);
    return;
  }
  const { loadConfig, createMarkstage } = await import('../src/app.mjs');
  let config = loadConfig();
  if (cmd === 'check') {
    const { buildInfo } = await import('../src/version.mjs');
    console.log(`Configuration OK; Markstage ${buildInfo().version} loads.`);
    return;
  }
  if (cmd === 'update') return update(config);
  if (cmd === 'serve' || cmd === undefined) {
    const { watchCrashes } = await import('../src/crash.mjs');
    watchCrashes(process);
    const app = await createMarkstage(config);
    config = app.config;
    const addr = await app.listen();
    console.log(`Markstage on http://${addr.address}:${addr.port}${config.basePath}/ (public ${config.publicOrigin})`);
    if (config.devNoAuth) console.log(`${process.stdout.isTTY ? '\x1b[31m' : ''}DEV MODE: no sign-in. Everyone who reaches this address is the owner. Never put it behind a public address.${process.stdout.isTTY ? '\x1b[0m' : ''}`);
    if (config.preview.origin && !config.devNoAuth) console.log(`Previews on http://${config.host}:${config.preview.port}/ (public ${config.preview.origin})`);
    const stop = async () => {
      await app.close();
      process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    return;
  }
  const { issueOwnerCode, issueResetCode } = await import('../src/auth/routes.mjs');
  const app = await createMarkstage(config);
  try {
    if (cmd === 'setup-code') {
      console.log(`One-time owner setup code (valid 1 hour): ${issueOwnerCode(app)}\nOpen ${config.publicOrigin}${config.basePath}/#/setup and enter it.`);
    } else if (cmd === 'reset-password') {
      if (!args[0]) throw new Error('Usage: markstage-server reset-password <email>');
      console.log(`Setup code for ${args[0]} (valid 72 hours): ${issueResetCode(app, args[0])}\nThey open ${config.publicOrigin}${config.basePath}/#/accept-invite and enter their email and this code.`);
    } else if (cmd === 'backup') {
      if (!config.backup) throw new Error('Backups are not set up: set backup.dir in config.json (docs/DEPLOY.md, Backups).');
      const id = app.backup.now(null);
      await app.jobs.idle();
      const job = app.jobs.get(id);
      process.stdout.write(job.log ?? '');
      if (job.status !== 'succeeded') throw new Error(`The backup failed: ${job.error ?? 'see above'}`);
    } else if (cmd === 'forms' && args[0] === 'import-wordpress') {
      const file = args[1];
      if (!file || file.startsWith('--')) throw new Error('Usage: markstage-server forms import-wordpress <dump.sql.gz> [--form contact] [--table wp_contact] [--dry-run]');
      const value = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
      const { importWordpress } = await import('../src/forms/import-wp.mjs');
      const r = await importWordpress(app, path.resolve(file), { form: value('--form') ?? 'contact', table: value('--table') ?? 'wp_contact', dryRun: args.includes('--dry-run') });
      console.log(`${args.includes('--dry-run') ? 'Dry run, nothing written. ' : ''}${r.found} rows in the dump (times in ${r.timeZone}): ${r.added} ${args.includes('--dry-run') ? 'would be added' : 'added'}, ${r.already} already in the Inbox, ${r.skipped.length} skipped.`);
      for (const s of r.skipped) console.log(`  skipped WordPress id ${s.id}: ${s.reason}`);
    } else if (cmd === 'geoip' && args[0] === 'update') {
      if (!args[1]) throw new Error('Usage: markstage-server geoip update <url|file>   (e.g. DB-IP\'s free "IP to City Lite" .mmdb.gz)');
      const { installGeo } = await import('../src/geo/index.mjs');
      const r = await installGeo(config, args[1]);
      console.log(`The city database is in place: ${r.type}, built ${r.builtAt?.slice(0, 10) ?? 'on an unknown date'}, ${r.file}.`);
      if (r.attribution) console.log(`Credit to show with its places: ${r.attribution}.`);
    } else if (cmd === 'env') {
      const { envCommand } = await import('../src/env/cli.mjs');
      process.exitCode = await envCommand(app, args);
    } else if (cmd === 'library') {
      const { libraryCommand } = await import('../src/library/cli.mjs');
      process.exitCode = await libraryCommand(app, args);
    } else if (cmd === 'media') {
      const { mediaCommand } = await import('../src/media/cli.mjs');
      process.exitCode = await mediaCommand(app, args);
    } else {
      throw new Error(`Unknown command "${cmd}". Commands: serve, init, setup-code, reset-password, backup, forms import-wordpress, geoip update, env, library, media import, media index.`);
    }
  } finally {
    await app.close();
  }
}

/** markstage-server update: flags --check, --to <tag>, --rollback, --with-data, --remote <name>. */
async function update(config) {
  const { createUpdater } = await import('../src/update.mjs');
  const { INSTALL_DIR } = await import('../src/version.mjs');
  const flag = (f) => args.includes(f);
  const value = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
  const u = createUpdater({ installDir: INSTALL_DIR, dataDir: config.dataDir, remote: value('--remote') ?? 'origin' });
  const show = (changes) => {
    for (const n of changes.notes) console.log(`  ${n}`);
    if (!changes.notes.length) for (const s of changes.subjects) console.log(`  - ${s}`);
  };
  if (flag('--rollback')) {
    u.rollback({ withData: flag('--with-data') });
    console.log('Restart the service to run it (systemctl restart markstage).');
    return;
  }
  if (flag('--check')) {
    const c = u.check();
    if (!c.releases.length) return console.log(`Up to date: Markstage ${c.current.version}.`);
    console.log(`Markstage ${c.current.version} runs here. Newer:`);
    for (const r of c.releases) {
      console.log(`${r.tag}`);
      show(r.changes);
    }
    return console.log(`Update with: markstage-server update${c.releases.length > 1 ? ` (or --to ${c.releases.at(-1).tag})` : ''}`);
  }
  const r = u.update({ to: value('--to') });
  if (r.upToDate) return console.log(`Up to date: Markstage ${r.current.version}.`);
  show(r.changes);
  console.log(`The database before the update is kept at ${r.db ?? '(none yet)'}.\nRestart the service to run it (systemctl restart markstage). To go back: markstage-server update --rollback`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
