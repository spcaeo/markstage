// `markstage-server translate --to <locale> …` on the server itself (docs/API-TRANSLATIONS.md "From the command
// line"): the same plan and run as the editor's Translate the site screen, as the person named by --as, with the
// same rights, AI limits and audit. The drafts are reviewed in the editor.
//   translate --to <locale> [--only <collection,…>] [--include-translated] [--dry] --as <email>
import { HttpError } from '../util.mjs';
import { planLines } from './plan.mjs';

const USAGE = `Usage:
  markstage-server translate --to <locale> [--only <collection,…>] [--include-translated] [--dry] --as <email>
--dry shows the plan and writes nothing. --include-translated also drafts entries that have their own words in that
region (the draft waits beside them for review; it never replaces them).`;

const value = (args, flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);

export async function translateCommand(app, args, { out = console.log } = {}) {
  const to = value(args, '--to');
  if (!to || to.startsWith('--')) throw new Error(USAGE);
  const email = value(args, '--as');
  const row = email ? app.db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email) : null;
  if (!row || row.disabled) throw new Error('Say who does it: --as <email of an account on this server>.');
  const ctx = { user: app.users.toPublic(row), ip: null, userAgent: 'markstage-server translate', status: 200, query: new URLSearchParams(), params: {}, req: { headers: {} } };
  const only = value(args, '--only');
  const body = { locale: to, collections: only ? only.split(',').map((s) => s.trim()).filter(Boolean) : null, skipExisting: !args.includes('--include-translated') };
  const call = async (fn) => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof HttpError) throw new Error(e.extra?.field ? `${e.message} (${e.extra.field})` : e.message);
      throw e;
    }
  };
  const made = await call(() => app.translate.plan({ ...ctx, body }));
  for (const l of planLines(made.plan)) out(l);
  if (args.includes('--dry')) {
    out(`Dry run, nothing written. To see it in the editor: #/translate/${made.run.id}`);
    return 0;
  }
  if (!made.plan.counts.draft) {
    out('Nothing to draft.');
    return 0;
  }
  await call(() => app.translate.start({ ...ctx, params: { rid: made.run.id } }));
  await app.translate.idle();
  const { run, result } = app.translate.get({ ...ctx, params: { rid: made.run.id } });
  const p = run.progress;
  out(`${run.status === 'done' ? 'Done' : run.status === 'paused' ? 'Paused' : 'Stopped'} in ${result.commits.length} ${result.commits.length === 1 ? 'commit' : 'commits'}: ${p.created} drafted, ${p.skipped} skipped, ${p.failed} failed.`);
  if (run.status !== 'done' && run.reason) out(run.reason);
  for (const i of result.items.filter((x) => x.action !== 'created')) out(`  ${i.action === 'failed' ? 'Failed' : 'Skipped'}: ${i.collection}/${i.id}: ${i.why}`);
  if (p.created) out(`To review: #/translate/${run.id}?show=review`);
  return run.status === 'done' ? 0 : 1;
}
