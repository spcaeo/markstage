// Promotion rules (src/env/rules.mjs): a pure evaluator, checked case by case. Deny wins, no rule is deny, every
// refusal names its rule; windows and freezes, approvals tied to the exact version (never the author's), checks,
// time on staging, a reason; kinds of change; the starter rules; and the rules document checked in plain words.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { STARTER, checkRules, decide, globRe, inWindow, kindsOf } from '../src/env/rules.mjs';

const OWNER = { id: 'u_owner', role: 'owner', name: 'Olive' };
const ADMIN = { id: 'u_admin', role: 'administrator', name: 'Ada' };
const DEV = { id: 'u_dev', role: 'author', name: 'Sam' };
const EDITOR = { id: 'u_ed', role: 'editor', name: 'Edna' };
const SITE = { collections: [{ id: 'pages', dir: 'src/content/pages' }, { id: 'blog', dir: 'src/content/blog' }, { id: 'menus', dir: 'src/content/menus' }], mediaDir: 'src/assets/uploads' };
const file = (path) => ({ path, kinds: kindsOf(path, SITE) });
const TEMPLATE = [file('src/layouts/Base.astro'), file('src/components/sections/Hero.astro'), file('src/styles/site.css')];
const CONTENT = [file('src/content/pages/about.md'), file('src/assets/uploads/team.jpg')];
const CONFIG = [file('markstage.config.mjs')];
// Wednesday 2026-10-28 14:00 UTC (10:00 in Toronto)
const WED = Date.parse('2026-10-28T14:00:00Z');
const SAT = Date.parse('2026-10-31T14:00:00Z');
const DOC = {
  groups: { developers: ['u_dev'], hotfix: ['u_admin'] },
  rules: [
    { id: 'dev-staging', name: 'Developers to staging', who: { groups: ['developers'], roles: ['owner'] }, action: ['promote'], from: ['branch'], to: ['staging'], effect: 'allow' },
    { id: 'prod', name: 'Staging to production with checks and an approval', who: { roles: ['owner', 'administrator'] }, action: ['promote'], from: ['staging'], to: ['production'], when: { windows: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '08:00', to: '18:00', tz: 'America/Toronto' }] }, requires: { checks: 'all', approvals: { count: 1, roles: ['owner', 'administrator'] }, stagingMinutes: 60 }, effect: 'allow' },
    { id: 'hotfix', name: 'Hotfix needs owner', who: { groups: ['hotfix'] }, action: ['promote'], from: ['branch'], to: ['production'], requires: { reason: true, approvals: { count: 1, users: ['u_owner'] } }, effect: 'allow' },
    { id: 'content-only', name: 'Editors promote content only', who: { roles: ['editor'] }, action: ['promote'], from: ['staging'], to: ['production'], what: { only: ['content'] }, effect: 'allow-with-approval' },
    { id: 'no-config', name: 'Developers never change config', who: { groups: ['developers'] }, action: ['promote'], what: { any: ['config', 'deploy'] }, effect: 'deny' },
    { id: 'freeze', name: 'Launch freeze', action: ['promote'], to: ['production'], when: { freezes: [{ from: '2026-11-01T00:00:00Z', until: '2026-11-03T00:00:00Z', words: 'the launch' }] }, effect: 'deny' },
    { id: 'rollback', name: 'Admins roll back', who: { roles: ['owner', 'administrator'] }, action: ['rollback'], effect: 'allow' },
  ],
};
const passed = { done: true, passed: ['build', 'links'], failed: [] };
const base = { action: 'promote', from: 'staging', to: 'production', at: WED, sha: 'b'.repeat(40), author: 'u_dev', files: TEMPLATE, checks: passed, stagingSince: WED - 2 * 3600_000, approvals: [{ userId: 'u_admin', role: 'administrator', sha: 'b'.repeat(40) }] };

// [name, request, expected effect, expected rule id (or null), words or missing pattern]
const CASES = [
  ['the owner promotes staging to production with everything in place', { user: OWNER }, 'allow', 'prod'],
  ['an author is not named by any rule for production', { user: DEV }, 'deny', null, /No rule lets Sam promote from staging to production/],
  ['no rule for this action: deny', { user: OWNER, action: 'preview' }, 'deny', null, /No rule/],
  ['no approval yet: needs one, from the right people', { user: OWNER, approvals: [] }, 'needs', 'prod', /1 more approval of this exact version from an owner or an administrator \(not the author\)/],
  ['the author approving their own change does not count', { user: OWNER, author: 'u_admin' }, 'needs', 'prod', /not the author/],
  ['an approval of an older version (a new push) does not count', { user: OWNER, approvals: [{ userId: 'u_admin', role: 'administrator', sha: 'a'.repeat(40) }] }, 'needs', 'prod', /approval/],
  ['an approver whose role dropped since does not count', { user: OWNER, approvals: [{ userId: 'u_admin', role: 'editor', sha: 'b'.repeat(40) }] }, 'needs', 'prod', /approval/],
  ['checks still running', { user: OWNER, checks: { done: false } }, 'needs', 'prod', /checks have not finished/],
  ['a failed check is named', { user: OWNER, checks: { done: true, passed: ['build'], failed: ['links'] } }, 'needs', 'prod', /failed checks: links/],
  ['too short a time on staging', { user: OWNER, stagingSince: WED - 20 * 60_000 }, 'needs', 'prod', /40 more minutes on staging/],
  ['never on staging', { user: OWNER, stagingSince: null }, 'needs', 'prod', /has not been on staging/],
  ['outside the hours (Saturday): refused, naming the rule and its hours', { user: OWNER, at: SAT }, 'deny', 'prod', /outside its hours \(mon, tue, wed, thu, fri 08:00–18:00 \(America\/Toronto\)\)/],
  ['before the hours in the window’s own time zone (07:30 Toronto)', { user: OWNER, at: Date.parse('2026-10-28T11:30:00Z') }, 'deny', 'prod', /outside its hours/],
  ['a freeze: deny wins over every allow', { user: OWNER, at: Date.parse('2026-11-02T14:00:00Z') }, 'deny', 'freeze', /Launch freeze.*the launch/],
  ['the freeze is over', { user: OWNER, at: Date.parse('2026-11-03T14:00:00Z') }, 'allow', 'prod'],
  ['a developer to staging (by group)', { user: DEV, from: 'branch', to: 'staging' }, 'allow', 'dev-staging'],
  ['a developer touching config: deny wins over their allow', { user: DEV, from: 'branch', to: 'staging', files: [...TEMPLATE, ...CONFIG] }, 'deny', 'no-config', /Developers never change config/],
  ['a developer touching deploy files: denied too', { user: DEV, from: 'branch', to: 'staging', files: [file('deploy/nginx/site.conf')] }, 'deny', 'no-config'],
  ['the owner touching config is not stopped by the developers’ rule', { user: OWNER, from: 'branch', to: 'staging', files: CONFIG }, 'allow', 'dev-staging'],
  ['an editor promoting content only: allowed once approved', { user: EDITOR, files: CONTENT, approvals: [] }, 'needs', 'content-only', /1 more approval/],
  ['an editor promoting content only, approved', { user: EDITOR, files: CONTENT }, 'allow', 'content-only'],
  ['an editor promoting a template is not content only', { user: EDITOR, files: [...CONTENT, ...TEMPLATE] }, 'deny', null, /No rule lets Edna/],
  ['a hotfix needs a reason and the owner’s approval', { user: ADMIN, from: 'branch', to: 'production', approvals: [] }, 'needs', 'hotfix', /approval.*; a reason/],
  ['a hotfix approved by someone else than the named owner does not count', { user: ADMIN, from: 'branch', to: 'production', reason: 'checkout broken', approvals: [{ userId: 'u_ed', role: 'editor', sha: 'b'.repeat(40) }] }, 'needs', 'hotfix'],
  ['a hotfix with a reason and the owner’s approval', { user: ADMIN, from: 'branch', to: 'production', reason: 'checkout broken', approvals: [{ userId: 'u_owner', role: 'owner', sha: 'b'.repeat(40) }] }, 'allow', 'hotfix'],
  ['a hotfix during the freeze', { user: ADMIN, from: 'branch', to: 'production', reason: 'x', at: Date.parse('2026-11-01T10:00:00Z'), approvals: [{ userId: 'u_owner', role: 'owner', sha: 'b'.repeat(40) }] }, 'deny', 'freeze'],
  ['a rollback by an administrator (no from or to on the rule: anywhere)', { user: ADMIN, action: 'rollback', from: 'production', to: 'production', files: null }, 'allow', 'rollback'],
  ['a rollback by an editor', { user: EDITOR, action: 'rollback', from: 'production', to: 'production', files: null }, 'deny', null],
  ['a dry run with no files yet: what rules can still say', { user: DEV, from: 'branch', to: 'staging', files: null }, 'allow', 'dev-staging'],
];

describe('the promotion rules', () => {
  for (const [name, over, effect, rule, pattern] of CASES) {
    test(name, () => {
      const d = decide(DOC, { ...base, ...over });
      assert.equal(d.effect, effect, d.words);
      assert.equal(d.rule?.id ?? null, rule, d.words);
      if (pattern) assert.match(d.words, pattern);
      assert.equal(d.trace.length, DOC.rules.length, 'every rule is in the trace');
      if (effect === 'needs') assert.ok(d.missing.length);
    });
  }

  test('there are enough cases', () => assert.ok(CASES.length >= 25, CASES.length));

  test('the starter rules: developers to staging; production needs every check; hotfix only for the named; a freeze with none set stops nothing', () => {
    const doc = structuredClone(STARTER);
    doc.groups.developers = ['u_dev'];
    assert.equal(decide(doc, { ...base, user: DEV, from: 'branch', to: 'staging' }).effect, 'allow');
    assert.equal(decide(doc, { ...base, user: OWNER }).effect, 'allow', 'no freeze set: the freeze rule stays out');
    assert.match(decide(doc, { ...base, user: OWNER, checks: { done: true, passed: [], failed: ['links'] } }).words, /failed checks: links/);
    assert.equal(decide(doc, { ...base, user: ADMIN, from: 'branch', to: 'production' }).effect, 'deny', 'nobody is on the hotfix list yet');
    doc.rules.find((r) => r.id === 'owner-freeze').when.freezes.push({ from: '2026-10-01T00:00:00Z', words: 'until the launch' });
    const frozen = decide(doc, { ...base, user: OWNER });
    assert.deepEqual([frozen.effect, frozen.rule.id], ['deny', 'owner-freeze']);
    assert.match(frozen.words, /until the launch/);
    assert.equal(decide(doc, { ...base, user: EDITOR, action: 'sync', from: 'production', to: 'staging' }).effect, 'allow');
  });
});

describe('kinds, globs and windows', () => {
  test('a path’s kinds; content covers pages, menus, media and data', () => {
    const k = (p) => kindsOf(p, SITE).sort();
    assert.deepEqual(k('src/content/pages/about.md'), ['content', 'pages']);
    assert.deepEqual(k('src/content/menus/main.json'), ['content', 'menus']);
    assert.deepEqual(k('src/data/menus.json'), ['content', 'menus']);
    assert.deepEqual(k('src/data/settings.json'), ['content', 'data']);
    assert.deepEqual(k('src/assets/uploads/2026/a.webp'), ['content', 'media']);
    assert.deepEqual(k('src/components/sections/Hero.astro'), ['sections']);
    assert.deepEqual(k('src/layouts/Base.astro'), ['templates']);
    // the Library's items and pictures are content, wherever library.dir puts them
    assert.deepEqual(kindsOf('markstage/library/section/lib_abcdefgh12.json', { ...SITE, libraryDir: 'markstage/library' }).sort(), ['content', 'data']);
    assert.deepEqual(kindsOf('markstage/library/section/lib_abcdefgh12.png', { ...SITE, libraryDir: 'markstage/library' }).sort(), ['content', 'data']);
    assert.deepEqual(k('src/styles/site.css'), ['styles']);
    assert.deepEqual(k('astro.config.mjs'), ['config']);
    assert.deepEqual(k('package-lock.json'), ['config']);
    assert.deepEqual(k('.github/workflows/ci.yml'), ['deploy']);
    assert.deepEqual(k('scripts/build-search.mjs'), ['code']);
    assert.deepEqual(kindsOf('src/legal/terms.md', { ...SITE, kinds: { pages: ['src/legal/**'] } }).sort(), ['content', 'pages'], 'a site may add its own');
  });
  test('globs: * within a folder, ** across', () => {
    assert.ok(globRe('src/layouts/**').test('src/layouts/a/b.astro'));
    assert.ok(globRe('src/**/*.css').test('src/styles/site.css'));
    assert.ok(globRe('src/**/*.css').test('src/site.css'));
    assert.ok(!globRe('src/*.css').test('src/styles/site.css'));
    assert.ok(globRe('markstage.config.*').test('markstage.config.mjs'));
    assert.ok(!globRe('markstage.config.*').test('markstagexconfig.mjs'), 'a dot is a dot');
  });
  test('windows in their time zone, over midnight', () => {
    const night = { days: ['fri'], from: '22:00', to: '02:00', tz: 'UTC' };
    assert.ok(inWindow(night, Date.parse('2026-10-30T23:00:00Z')));
    assert.ok(inWindow(night, Date.parse('2026-10-31T01:30:00Z')), 'Saturday 01:30 is still Friday night');
    assert.ok(!inWindow(night, Date.parse('2026-10-31T03:00:00Z')));
    assert.ok(inWindow({ days: ['wed'], from: '09:00', to: '11:00', tz: 'America/Toronto' }, WED));
    assert.ok(!inWindow({ days: ['wed'], from: '09:00', to: '11:00', tz: 'Asia/Kolkata' }, WED));
  });
});

describe('the rules document is checked in plain words', () => {
  const fail = (m) => {
    throw new Error(m);
  };
  const check = (doc) => checkRules(doc, { users: ['u_owner', 'u_admin', 'u_dev', 'u_ed'], envs: ['staging', 'production'], fail });
  test('the example and the starter rules pass', () => {
    assert.deepEqual(check(DOC).rules.length, DOC.rules.length);
    assert.equal(check(STARTER).rules.length, STARTER.rules.length);
  });
  const bad = [
    [{ rules: 'x' }, /must be \{groups, rules/],
    [{ rules: [{ id: 'a', name: 'A', action: ['promote'], effect: 'maybe' }] }, /effect is allow, allow-with-approval, deny/],
    [{ rules: [{ id: 'a', name: 'A', action: ['deploy'], effect: 'allow' }] }, /action is a list of promote, sync, rollback, preview/],
    [{ rules: [{ id: 'a', name: 'A', action: ['promote'], effect: 'allow' }, { id: 'a', name: 'B', action: ['promote'], effect: 'allow' }] }, /id must be unique/],
    [{ rules: [{ id: 'a', name: '', action: ['promote'], effect: 'allow' }] }, /give it a name/],
    [{ rules: [{ id: 'a', name: 'A', action: ['promote'], to: ['qa'], effect: 'allow' }] }, /to is a list of branch, local, release, \*, staging, production/],
    [{ rules: [{ id: 'a', name: 'A', action: ['promote'], who: { users: ['u_ghost'] }, effect: 'allow' }] }, /who.users must be users of this site/],
    [{ rules: [{ id: 'a', name: 'A', action: ['promote'], who: { groups: ['qa'] }, effect: 'allow' }] }, /who.groups must be groups defined here/],
    [{ groups: { Devs: [] }, rules: [] }, /"Devs" is not a group name/],
    [{ rules: [{ id: 'a', name: 'A', action: ['promote'], when: { windows: [{ from: '8am' }] }, effect: 'allow' }] }, /times like "08:00"/],
    [{ rules: [{ id: 'a', name: 'A', action: ['promote'], when: { windows: [{ tz: 'Mars/Base' }] }, effect: 'allow' }] }, /"Mars\/Base" is not a time zone/],
    [{ rules: [{ id: 'a', name: 'A', action: ['promote'], when: { freezes: [{ from: '2026-11-02', until: '2026-11-01' }] }, effect: 'deny' }] }, /a freeze needs a from date, and an until after it/],
    [{ rules: [{ id: 'a', name: 'A', action: ['promote'], requires: { approvals: { count: 0 } }, effect: 'allow' }] }, /approvals.count is 1 to 10/],
  ];
  for (const [doc, re] of bad) test(`refused: ${re.source.slice(0, 50)}`, () => assert.throws(() => check(doc), re));
});

test('the approval sentence counts in words: "from an administrator" for one, "from administrators" for more', () => {
  const two = { rules: DOC.rules.map((r) => (r.id === 'prod' ? { ...r, requires: { ...r.requires, approvals: { count: 2, roles: ['administrator'] } } } : r)), groups: DOC.groups };
  const words = (approvals) => decide(two, { ...base, user: OWNER, approvals }).missing.find((m) => m.kind === 'approval')?.words;
  assert.equal(words([]), '2 more approvals of this exact version from administrators (not the author)');
  assert.equal(words(base.approvals), '1 more approval of this exact version from an administrator (not the author)');
});
