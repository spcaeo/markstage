// #/environments: this environment (its branch, what is live, the remote, what production has that it has not), the
// plans that promote or sync into it, the branches on the shared remote, and the branch previews. Every open panel is
// in the URL: ?plan=promote&source=<branch>&sha=<sha>&reason=<text> (the handoff from staging opens the new-plan form
// filled in), ?plan=sync, ?handoff=1 (staging: send it to production), ?rollback=1; ?status= filters the plans.
import { ApiError } from '../api';
import type { ScreenCtx } from '../host';
import { jobPanel } from '../admin/jobs';
import { button, chips, drawer, el, failure, form, link, message, page, state, value, when } from '../admin/ui';
import * as api from './api';
import { envWord, planStatusWord, planTitle, short, STATUS_WORDS } from './words';

const STATUS_CHIPS: [string, string][] = [
  ['', 'All'],
  ['conflicts', 'Conflicts'],
  ['ready', 'Ready'],
  ['running', 'Running'],
  ['done', 'Done'],
  ['failed', 'Failed'],
];
const PANELS = ['plan', 'source', 'sha', 'reason', 'handoff', 'rollback'];

/** A plan's status as a badge (the colour says how it stands); with the plan, a ready one the rules hold back says why. */
export function statusBadge(s: api.PlanStatus, p?: Pick<api.Plan, 'status' | 'decision'>): HTMLElement {
  const word = p ? planStatusWord(p) : (STATUS_WORDS[s] ?? s);
  const held = s === 'ready' && word !== STATUS_WORDS.ready;
  const tone = held ? '' : s === 'done' || s === 'ready' ? '.ms-adm-badge--ok' : ['failed', 'blocked', 'conflicts'].includes(s) ? '.is-bad' : '';
  return el(`span.ms-adm-badge.ms-env-status.ms-env-status--${s}${tone}`, word);
}

/** The environment's name as a pill in its ribbon colour. */
export function envPill(name: string, ribbon: string | null): HTMLElement {
  const pill = el('span.ms-env-pill', envWord(name));
  if (ribbon) pill.style.setProperty('--ms-env-ribbon', ribbon);
  if (name === 'production') pill.classList.add('is-production');
  return pill;
}

const count = (n: number | null | undefined) => (n === null || n === undefined ? '—' : String(n));

export function mountOverview(host: HTMLElement, ctx: ScreenCtx) {
  const p = page(host, 'Staging & live', 'Where changes go before they are live: promote a branch here, bring production’s content down, or roll back.');
  const layout = el('div.ms-adm-split');
  let info: api.EnvInfo | null = null;
  let branches: api.Branch[] = [];
  let plans: api.Plan[] = [];
  let previews: Awaited<ReturnType<typeof api.previews>> | null = null;
  let loadedFor: string | null = null;
  let alive = true;
  let panelJob: { destroy(): void } | null = null;
  let hereEl: HTMLElement | null = null;

  const upstreamEnv = () => (info?.upstream ? (info.peers.find((x) => x.branch === info!.upstream)?.name ?? info.upstream) : null);

  async function load(fetchRemote = false): Promise<void> {
    const status = ctx.params().get('status') ?? '';
    // the remote is fetched first, so the branches are read as they are now
    const i = await api.env(fetchRemote);
    const [b, l] = await Promise.all([api.branches().catch(() => ({ branches: [] as api.Branch[] })), api.plans(status)]);
    info = i;
    branches = b.branches;
    plans = l.plans;
    previews = i.previews?.on ? await api.previews().catch(() => null) : null;
    loadedFor = status;
  }

  async function render(): Promise<void> {
    if (loadedFor !== (ctx.params().get('status') ?? '')) {
      if (!info) p.body.replaceChildren(state('loading', 'Loading…'));
      try {
        // a handoff names a commit: fetch first, so the branch is compared as it is now
        await load(!info && !!ctx.params().get('sha'));
      } catch (e) {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 404) return void p.body.replaceChildren(state('empty', 'Not on this server', 'Environments need the Markstage server with a git remote.'));
        return void p.body.replaceChildren(failure(e, () => ((loadedFor = null), void render())));
      }
      if (!alive) return;
    }
    draw();
  }

  function draw(): void {
    if (!info) return;
    ctx.setTitle(`Staging & live · ${envWord(info.name)}`);
    p.actions.replaceChildren(button('New plan', () => ctx.go({ params: { plan: 'promote', source: null, sha: null, reason: null } }, true), { kind: 'primary', icon: 'plus' }));
    hereEl = here(info);
    const main = el('div.ms-adm-split__main.ms-env', hereEl, plansCard(), branchesCard(), previewsCard());
    layout.replaceChildren(main);
    p.body.replaceChildren(layout);
    panel();
  }

  // ---------- this environment ----------
  function here(i: api.EnvInfo): HTMLElement {
    const up = upstreamEnv();
    const remote = i.remote.ok
      ? el('span', i.remote.behind ? `${i.remote.behind} new on the remote; ` : '', i.remote.ahead ? `${i.remote.ahead} here not pushed yet; ` : '', 'checked ', when(i.remote.lastFetchAt))
      : el('span.ms-env-bad', i.remote.error ?? 'The remote cannot be reached.');
    const rows: [string, Node | string][] = [
      ['Environment', el('span', envPill(i.name, i.ribbon), i.configured ? '' : el('span.ms-adm-sub', ' · This is the live site.'))],
      ['Branch', value(i.branch, 'branch')],
      ['Live', i.live ? value(short(i.live), 'live commit') : el('span.ms-adm-none', 'nothing built yet')],
      ['Latest commit', i.head ? value(short(i.head), 'latest commit') : el('span.ms-adm-none', '—')],
      ['Remote', remote],
    ];
    if (!i.production) rows.push(['Mail and forms', i.mail === 'sink' ? 'Mail goes to the test mail catcher; forms say “Test form: not sent”.' : 'Mail goes only to the person who ran a job; forms say “Test form: not sent”.']);
    if (i.gate) rows.push(['Site', 'Behind sign-in, and never indexed (noindex on every answer).']);
    const card = el('section.ms-adm-card.ms-env-here', el('h2.ms-adm-h2', 'This environment'), el('dl.ms-adm-facts'));
    const dl = card.querySelector('dl')!;
    for (const [k, v] of rows) dl.append(el('dt', k), el('dd', v));
    const tools = el('div.ms-adm-row');
    // what production has that is not here yet, and what is here that production has not
    if (up && i.behind) tools.append(el('p.ms-env-line', `${envWord(up)} has ${i.behind} change${i.behind === 1 ? '' : 's'} not here yet.`), button(`Sync down from ${envWord(up)}`, () => ctx.go({ params: { plan: 'sync' } }, true), { icon: 'down' }));
    else if (up) tools.append(el('p.ms-env-line', `Up to date with ${envWord(up)}.`));
    if (i.handoff && i.ahead) tools.append(el('p.ms-env-line', `${i.ahead} change${i.ahead === 1 ? '' : 's'} here not on ${envWord(i.handoff.to)} yet.`), button(`Promote to ${envWord(i.handoff.to)}…`, () => ctx.go({ params: { handoff: '1' } }, true), { kind: 'primary', icon: 'up' }));
    const busy = button('Look for changes', async () => {
      busy.disabled = true;
      busy.classList.add('is-busy');
      try {
        await load(true);
        draw();
      } catch (e) {
        ctx.toast(message(e), 'error');
      } finally {
        busy.disabled = false;
        busy.classList.remove('is-busy');
      }
    }, { icon: 'refresh', kind: 'quiet' });
    // only for those who may make the server check the remote (promote or sync); everyone else sees the last check
    tools.append(el('span.ms-adm-grow'));
    if (i.canFetch !== false) tools.append(busy);
    if (i.canRollback) tools.append(button('Roll back…', () => ctx.go({ params: { rollback: '1' } }, true), { kind: 'quiet', icon: 'undo' }));
    card.append(tools);
    return card;
  }

  // ---------- plans ----------
  function plansCard(): HTMLElement {
    const head = el('div.ms-adm-row', el('h2.ms-adm-h2', 'Plans'), el('span.ms-adm-grow'), chips(ctx, 'status', 'Show plans', STATUS_CHIPS));
    if (!plans.length) return el('section.ms-adm-card', head, el('p.ms-adm-sub', ctx.params().get('status') ? 'No plans with this status.' : 'No plans yet. A plan shows what a promotion or a sync would change before anything does.'));
    const t = el('table.ms-adm-table.ms-adm-table--rows', el('thead', el('tr', el('th', 'Made'), el('th', 'Plan'), el('th', 'From'), el('th', 'By'), el('th.ms-num', 'Files'), el('th.ms-num', 'Conflicts'), el('th', 'Status'))));
    const tb = el('tbody');
    for (const x of plans) {
      const a = el('a.ms-adm-rowlink', { href: `#/environments/plans/${x.id}` }, planTitle(x));
      const open = x.conflicts.filter((c) => !c.resolved).length;
      tb.append(el('tr', el('td', when(x.createdAt)), el('td', a, x.reason ? el('span.ms-adm-sub', ` · ${x.reason}`) : null), el('td', value(x.from.branch, 'branch'), el('span.ms-adm-sub', ` ${short(x.from.sha)}`)), el('td', x.author?.name ?? '—'), el('td.ms-num', x.files ? String(x.files.count) : '—'), el('td.ms-num', x.conflicts.length ? `${open} of ${x.conflicts.length}` : '0'), el('td', statusBadge(x.status, x))));
    }
    t.append(tb);
    return el('section.ms-adm-card', head, el('div.ms-adm-card--flush', t));
  }

  // ---------- branches ----------
  function branchesCard(): HTMLElement {
    const head = el('div.ms-adm-row', el('h2.ms-adm-h2', 'Branches'), el('span.ms-adm-sub', 'On the shared remote, newest first'));
    if (!branches.length) return el('section.ms-adm-card', head, el('p.ms-adm-sub', 'No branches on the remote, or it cannot be reached.'));
    const t = el('table.ms-adm-table', el('thead', el('tr', el('th', 'Branch'), el('th', 'Last change'), el('th.ms-num', 'Not here yet'), el('th.ms-num', 'Here only'), el('th', ''))));
    const tb = el('tbody');
    for (const b of branches) {
      const mine = b.name === info!.branch;
      const tag = b.env !== 'branch' ? envPill(b.env, b.env === info!.name ? info!.ribbon : null) : null;
      const plan = mine ? el('span.ms-adm-sub', 'this environment') : button(b.env === 'branch' ? 'Promote here…' : `Bring ${envWord(b.env)} here…`, () => ctx.go({ params: { plan: upstreamEnv() === b.env ? 'sync' : 'promote', source: b.name, sha: null, reason: null } }, true), { small: true });
      const prev = previews?.on && b.env === 'branch' ? button('Preview', () => void makePreview(b.name), { small: true, kind: 'quiet', title: `Build ${b.name} on its own address, behind sign-in` }) : null;
      tb.append(el('tr', el('td', value(b.name, 'branch'), ' ', tag), el('td', b.subject ? value(b.subject, 'commit message') : '—', el('span.ms-adm-sub', ' · '), b.author ? value(b.author, 'author') : '—', el('span.ms-adm-sub', ' · '), when(b.at)), el('td.ms-num', count(b.behind)), el('td.ms-num', count(b.ahead)), el('td.ms-adm-cell--end', plan, prev)));
    }
    t.append(tb);
    return el('section.ms-adm-card', head, el('div.ms-adm-card--flush', t));
  }

  // ---------- previews ----------
  async function makePreview(branch: string): Promise<void> {
    try {
      await api.makePreview(branch);
      ctx.toast(`Building a preview of ${branch}.`, 'ok');
      loadedFor = null;
      void render();
    } catch (e) {
      ctx.toast(message(e), 'error');
    }
  }

  function previewsCard(): HTMLElement | null {
    if (!previews?.on) return null;
    const head = el('div.ms-adm-row', el('h2.ms-adm-h2', 'Branch previews'), el('span.ms-adm-sub', 'Each branch on its own address, behind sign-in'));
    if (!previews.previews.length) return el('section.ms-adm-card', head, el('p.ms-adm-sub', 'None yet: Preview on a branch above builds one.'));
    const t = el('table.ms-adm-table', el('thead', el('tr', el('th', 'Branch'), el('th', 'Address'), el('th', 'Status'), el('th', 'Built'), el('th', ''))));
    const tb = el('tbody');
    for (const v of previews.previews) {
      const drop = button('Remove', async () => {
        try {
          await api.dropPreview(v.slug);
          loadedFor = null;
          void render();
        } catch (e) {
          ctx.toast(message(e), 'error');
        }
      }, { small: true, kind: 'quiet' });
      const st = v.status === 'failed' ? el('span.ms-adm-badge.is-bad', { title: v.error ?? '' }, 'Failed') : v.status === 'ready' ? el('span.ms-adm-badge.ms-adm-badge--ok', 'Ready') : el('span.ms-adm-badge', 'Building…');
      tb.append(el('tr', el('td', value(v.branch, 'branch'), ' ', value(short(v.sha), 'commit', 'ms-adm-sub')), el('td', v.url ? link(v.url, 'preview address') : '—'), el('td', st, v.job ? el('a.ms-adm-sub', { href: `#/jobs/${v.job}` }, ' log') : null), el('td', when(v.builtAt)), el('td.ms-adm-cell--end', drop)));
    }
    t.append(tb);
    return el('section.ms-adm-card', head, el('div.ms-adm-card--flush', t));
  }

  // ---------- the open panel ----------
  const close = () => ctx.go({ params: Object.fromEntries(PANELS.map((k) => [k, null])) }, true);

  function panel(): void {
    panelJob?.destroy();
    panelJob = null;
    const q = ctx.params();
    const kind = q.get('plan');
    if (kind === 'promote' || kind === 'sync') return newPlan(kind, q);
    if (q.get('handoff') && info?.handoff) return handoff(info.handoff);
    if (q.get('rollback')) return rollback();
  }

  function newPlan(kind: 'promote' | 'sync', q: URLSearchParams): void {
    const i = info!;
    const up = upstreamEnv();
    const d = drawer(layout, kind === 'sync' ? `Sync down from ${envWord(up ?? 'production')}` : `Promote to ${envWord(i.name)}`, close);
    if (kind === 'sync' && !i.upstream) return void d.body.append(el('p', 'This environment has no upstream to bring content down from.'));
    const choices = branches.filter((b) => b.name !== i.branch);
    const asked = q.get('source') ?? '';
    const fields: HTMLElement[] = [];
    let note: HTMLElement | null = null;
    if (kind === 'promote') {
      if (!choices.length) return void d.body.append(el('p', 'There is no other branch on the remote to bring here.'));
      const src = asked && choices.some((b) => b.name === asked) ? asked : (choices.find((b) => b.env !== 'branch')?.name ?? choices[0]!.name);
      const id = 'ms-env-source';
      const s = el('select.ms-input.ms-adm-select', { id, name: 'source' });
      for (const b of choices) s.append(el('option', { value: b.name, selected: b.name === src }, `${b.name}${b.env !== 'branch' ? ` (${envWord(b.env)})` : ''}${b.subject ? ` · ${b.subject.slice(0, 60)}` : ''}`));
      fields.push(el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: id }, 'Bring this branch here'), s, el('p.ms-adm-field__err', { 'data-err': 'source', role: 'alert' })));
      // the handoff names the commit staging was at: say whether the branch is still there
      const sha = q.get('sha');
      if (asked && !choices.some((b) => b.name === asked)) note = el('p.ms-adm-note.is-bad', `The branch “${asked}” is not on the remote (or it is this environment’s own).`);
      else if (sha && asked) {
        const b = choices.find((x) => x.name === asked)!;
        note = b.sha.startsWith(sha) || sha.startsWith(b.sha) ? el('p.ms-adm-note', `Exactly what was sent: ${asked} at ${short(sha)}.`) : el('p.ms-adm-note', `${asked} has moved on since it was sent (sent at ${short(sha)}, now ${short(b.sha)}): the plan takes it as it is now.`);
      }
    } else {
      fields.push(el('p', `Brings ${envWord(up!)}’s changes into ${envWord(i.name)}. It is a merge, not an overwrite: what was made here is kept, and anything both sides changed is shown to you before it runs.`));
    }
    const rid = 'ms-env-reason';
    const reason = el('textarea.ms-input', { id: rid, name: 'reason', rows: '3', maxlength: '500', placeholder: 'What it is for (optional; some rules need one)' });
    reason.value = q.get('reason') ?? '';
    fields.push(el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: rid }, 'Reason'), reason, el('p.ms-adm-field__err', { 'data-err': 'reason', role: 'alert' })));
    const f = form(fields, 'Make the plan', async (v) => {
      const r = await api.makePlan({ action: kind, source: kind === 'promote' ? v.source : undefined, reason: v.reason || undefined });
      ctx.open(`#/environments/plans/${r.plan.id}`, true);
    });
    d.body.append(note ?? '', el('p.ms-adm-sub', 'Nothing changes yet: the plan shows the files, the pages that look different, the checks and any conflicts first.'), f);
  }

  function handoff(h: { to: string; url: string }): void {
    const d = drawer(layout, `Promote to ${envWord(h.to)}`, close);
    const rid = 'ms-env-handoff-reason';
    const reason = el('textarea.ms-input', { id: rid, rows: '3', maxlength: '500', placeholder: 'What it is for (optional)' });
    const url = () => `${h.url}${reason.value.trim() ? `&reason=${encodeURIComponent(reason.value.trim())}` : ''}`;
    const shown = el('div');
    const draw = () => shown.replaceChildren(link(url(), `${envWord(h.to)}’s review`));
    reason.addEventListener('input', draw);
    draw();
    d.body.append(
      el('p', `${envWord(h.to)} makes and runs the plan on its own server: its review shows what changes, the screenshots and the checks, and its rules decide who may promote.`),
      el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: rid }, 'Reason'), reason),
      el('div.ms-adm-actions', button(`Open the review on ${envWord(h.to)}`, () => void window.open(url(), '_blank', 'noopener'), { kind: 'primary', icon: 'open' })),
      el('p.ms-adm-sub', 'Or send this address to whoever approves it:'),
      shown,
    );
  }

  function rollback(): void {
    const i = info!;
    const d = drawer(layout, 'Roll back the live site', close);
    if (!i.canRollback) return void d.body.append(el('p', 'There is no release before this one to go back to.'));
    const rid = 'ms-env-rollback-reason';
    const out = el('div');
    const f = form([el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: rid }, 'Reason'), el('textarea.ms-input', { id: rid, name: 'reason', rows: '3', maxlength: '500', placeholder: 'What went wrong (kept in the audit log)' }))], 'Roll back', async (v) => {
      const r = await api.rollback(v.reason || undefined);
      f.remove();
      const jp = jobPanel(r.job, { failedHint: 'The live site is as it was.', onEnd: () => void load().then(() => {
          if (!alive || !hereEl) return;
          const fresh = here(info!);
          hereEl.replaceWith(fresh);
          hereEl = fresh;
        }) });
      panelJob = jp;
      out.replaceChildren(el('p', `Going back from ${short(r.from)} to ${short(r.to)}.`), jp.el);
    }, { kind: 'danger' });
    d.body.append(el('p', `The release before this one goes live again. ${envWord(i.name)}’s branch then gets a new commit with that release’s files, so the history is kept and the branch matches what is live.`), f, out);
  }

  void render();
  return {
    update: () => void render(),
    destroy: () => {
      alive = false;
      panelJob?.destroy();
    },
  };
}
