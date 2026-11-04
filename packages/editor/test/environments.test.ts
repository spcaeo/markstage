// The Environments screens' words (src/environments/words.ts): a plan's title and conflict sides, a rule as a
// sentence, whether a plan can run with the reason typed, and a new rule's id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// the editor's sources import each other without the extension (Vite resolves them): so does this test
registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx);
    } catch (e) {
      if (spec.startsWith('.') && !/\.\w+$/.test(spec)) return next(`${spec}.ts`, ctx);
      throw e;
    }
  },
});
const { badgeWords, decisionWords, planStatusWord, planTitle, ruleId, ruleWords, runnable, sideWord } = await import('../src/environments/words.ts');

const names = (id: string) => ({ u_sam: 'Sam' })[id] ?? id;
const plan = (over: object = {}) => ({ action: 'promote' as const, from: { env: 'staging', branch: 'staging', sha: 'a' }, to: { env: 'production', branch: 'main', sha: 'b' }, ...over });

test('a plan says where it goes, and a branch by its name', () => {
  assert.equal(planTitle(plan()), 'Promote Staging to Production');
  assert.equal(planTitle(plan({ from: { env: 'branch', branch: 'my-change', sha: 'a' }, to: { env: 'staging', branch: 'staging', sha: 'b' } })), 'Promote my-change to Staging');
  assert.equal(planTitle(plan({ action: 'sync', from: { env: 'production', branch: 'main', sha: 'a' }, to: { env: 'staging', branch: 'staging', sha: 'b' } })), 'Sync Production into Staging');
  assert.equal(sideWord(plan(), 'ours'), 'Production’s');
  assert.equal(sideWord(plan(), 'theirs'), 'Staging’s');
});

test('a rule reads as a sentence with what it needs', () => {
  const w = ruleWords({ id: 's', name: 'S', who: { roles: ['owner', 'administrator'], users: ['u_sam'] }, action: ['promote'], from: ['staging'], to: ['production'], requires: { approvals: { count: 2, roles: ['administrator'] }, checks: 'all', stagingMinutes: 60, reason: true }, effect: 'allow' }, names);
  assert.equal(w.sentence, 'The owner, administrators or Sam may promote from Staging to Production.');
  assert.deepEqual(w.lines, ['Needs 2 approvals from administrators (never the author’s own), every check passing, 1 hour on staging first and a reason.']);
});

test('a deny reads naturally: nobody may, someone may not, while a freeze is set, and the cases it covers', () => {
  const freeze = ruleWords({ id: 'f', name: 'F', action: ['promote'], to: ['production'], when: { freezes: [] }, effect: 'deny' }, names);
  assert.equal(freeze.sentence, 'Nobody may promote to Production while a freeze is set.');
  assert.deepEqual(freeze.lines, ['No freeze is set now.']);
  assert.equal(ruleWords({ id: 'd', name: 'D', who: { roles: ['editor'] }, action: ['rollback'], effect: 'deny' }, names).sentence, 'Editors may not roll back.');
  assert.equal(ruleWords({ id: 'e', name: 'E', who: { groups: [] }, action: ['sync'], effect: 'allow' }, names).sentence, 'Nobody (an empty list) may sync.');
  assert.equal(ruleWords({ id: 'g', name: 'G', who: { roles: ['author'] }, action: ['promote'], to: ['production'], when: { freezes: [] }, effect: 'deny' }, names).sentence, 'Authors may not promote to Production while a freeze is set.');
  const cases = ruleWords({ id: 'c', name: 'C', action: ['promote'], what: { only: ['templates'], not: ['config'] }, when: { windows: [{ days: ['fri'], from: '15:00' }] }, effect: 'deny' }, names);
  assert.equal(cases.sentence, 'Nobody may promote.');
  assert.deepEqual(cases.lines, [`When every file is ${'templates'}.`, 'Except when a file is config.', 'On Fri, 15:00 to 24:00 (UTC).']);
  // no rule sentence starts "Anyone may not"
  for (const effect of ['deny', 'allow', 'allow-with-approval'] as const) assert.doesNotMatch(ruleWords({ id: 'x', name: 'X', action: ['sync'], effect }, names).sentence, /Anyone may not/);
});

test('a release rule reads without saying "release" twice, and the freeze covers releases', () => {
  const rel = ruleWords({ id: 'releases', name: 'R', who: { roles: ['owner', 'administrator', 'editor'] }, action: ['publish-release'], from: ['release'], effect: 'allow' }, names);
  assert.equal(rel.sentence, 'The owner, administrators or editors may publish a release.');
  const freeze = ruleWords({ id: 'owner-freeze', name: 'F', action: ['promote', 'publish-release'], to: ['production'], when: { freezes: [] }, effect: 'deny' }, names);
  assert.equal(freeze.sentence, 'Nobody may promote or publish a release to Production while a freeze is set.');
  // another action keeps its "from a release"
  assert.equal(ruleWords({ id: 'p', name: 'P', action: ['preview'], from: ['release'], effect: 'allow' }, names).sentence, 'Anyone may preview from a release.');
});

test('what may change and the hours read in words', () => {
  const w = ruleWords({ id: 'w', name: 'W', action: ['promote'], what: { only: ['templates', 'styles'], not: ['src/deploy/**'] }, when: { windows: [{ days: ['mon', 'fri'], from: '08:00', to: '17:00', tz: 'America/Toronto' }] }, effect: 'allow' }, names);
  assert.equal(w.sentence, 'Anyone may promote.');
  assert.deepEqual(w.lines, ['Only when every file is templates or styles.', 'Not when a file is src/deploy/**.', 'Only Mon, Fri, 08:00 to 17:00 (America/Toronto).']);
});

test('a plan runs when ready and allowed; a missing reason is met by typing one', () => {
  const needsReason = { status: 'ready' as const, decision: { effect: 'needs' as const, rule: null, words: 'Allowed once it has a reason.', missing: [{ kind: 'reason', words: 'a reason' }] } };
  assert.equal(runnable(needsReason, '').ok, false);
  assert.equal(runnable(needsReason, '').why, 'Still needs a reason.');
  assert.equal(runnable(needsReason, 'Launch').ok, true);
  const approval = { ...needsReason, decision: { ...needsReason.decision, missing: [{ kind: 'approval', words: '1 more approval' }] } };
  assert.equal(runnable(approval, 'Launch').ok, false);
  assert.equal(runnable({ status: 'conflicts', decision: null }, '').why, 'Decide the conflicts first.');
  assert.equal(runnable({ status: 'ready', decision: { effect: 'allow', rule: null, words: 'Allowed.', missing: [] } }, '').ok, true);
});

test('what is missing is said once, with the rule; the chip says Needs approval until it can run', () => {
  const rule = { id: 'sp', name: 'Staging to production needs the owner or an administrator, and every check' };
  const approval = { kind: 'approval', words: '1 more approval of this exact version from an administrator (not the author)' };
  const d = { effect: 'needs' as const, rule, words: 'Allowed once it has: 1 more approval of this exact version from an administrator (not the author).', missing: [approval] };
  assert.equal(decisionWords(d), 'Not yet: needs 1 more approval of this exact version from an administrator (not the author). Rule: Staging to production needs the owner or an administrator, and every check.');
  assert.equal(decisionWords({ effect: 'allow', rule, words: 'Allowed by the rules.', missing: [] }), `Allowed by the rules. Rule: ${rule.name}.`);
  assert.equal(decisionWords({ effect: 'deny', rule: null, words: 'No rule lets Dev promote.', missing: [] }), 'Not allowed. No rule lets Dev promote.');
  assert.equal(planStatusWord({ status: 'ready', decision: d }), 'Needs approval');
  assert.equal(planStatusWord({ status: 'ready', decision: { ...d, missing: [{ kind: 'reason', words: 'a reason' }] } }), 'Ready');
  assert.equal(planStatusWord({ status: 'ready', decision: { effect: 'allow', rule, words: '', missing: [] } }), 'Ready');
  assert.equal(planStatusWord({ status: 'ready', decision: { effect: 'deny', rule, words: '', missing: [] } }), 'Not allowed');
  assert.equal(planStatusWord({ status: 'done', decision: d }), 'Done');
});

test('a new rule gets a free id from its name', () => {
  assert.equal(ruleId('New rule', []), 'new-rule');
  assert.equal(ruleId('New rule', ['new-rule', 'new-rule-2']), 'new-rule-3');
  assert.equal(ruleId('!!!', []), 'rule');
});

test('the place chip: a server links to Staging & live with a ribbon off production; a laptop says On my computer and links nowhere', () => {
  const staging = badgeWords({ name: 'staging', production: false, branch: 'staging' });
  assert.deepEqual([staging.label, staging.tone, staging.branch, staging.link, staging.ribbon], ['Staging', 'amber', 'staging', true, true]);
  assert.equal(staging.title, 'Staging, on the branch staging: open Staging & live');
  const live = badgeWords({ name: 'production', production: true, branch: 'main' });
  assert.deepEqual([live.label, live.tone, live.ribbon], ['Live site', 'green', false]);
  const mine = badgeWords({ name: 'local', production: false, local: true, branch: 'my-change' });
  assert.deepEqual([mine.label, mine.tone, mine.branch, mine.link, mine.ribbon, mine.aria], ['On my computer', 'grey', 'my-change', false, false, 'Place: On my computer, branch my-change']);
  assert.match(mine.title, /runs on your computer, on the branch my-change\./);
  const nogit = badgeWords({ name: 'local', production: false, local: true, branch: null });
  assert.deepEqual([nogit.branch, nogit.aria], ['', 'Place: On my computer']);
  assert.doesNotMatch(nogit.title, /branch/);
  // the internal words never reach the chip
  for (const w of [staging, live, mine]) assert.doesNotMatch(w.label, /local|production|environment/i);
});
