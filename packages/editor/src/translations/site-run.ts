// A site translation's run: #/translate/<rid>?show=<tab>. Planned: the dry run in plain words, with To draft and
// Skipped. Running: its progress, live (it runs on the server; leaving the page does not stop it), with Pause and
// Cancel. Paused, cancelled or done: the report, with To review (each draft opens in Post settings at its region),
// Skipped and Failed, each in plain words; a paused run also has Resume and Cancel.
import type { ScreenCtx } from '../host';
import { collection } from '../runtime';
import { button, chips, el, failure, message, state, whoami, type Page } from '../admin/ui';
import { act, getRun, type PlanItem, type ResultItem, type RunInfo, type RunState } from './site-api';

const NUM = new Intl.NumberFormat('en-US');
const FIELD_WORDS = (f: string[] = []) => (f.length === 2 ? 'Title and description' : f[0] === 'title' ? 'Title' : f[0] === 'description' ? 'Description' : '—');
const plural = (n: number, one: string, many = `${one}s`) => `${NUM.format(n)} ${n === 1 ? one : many}`;

export interface RunView {
  update(): void;
  destroy(): void;
}

/** Where an entry is edited; with `loc`, Post settings opens with that region's draft to review. */
const entryHash = (c: string, id: string, loc?: string) =>
  `#/${collection(c)?.format === 'json' ? 'p' : 'e'}/${encodeURIComponent(c)}/${encodeURIComponent(id)}${loc ? `?s=1&suggest=translate&loc=${encodeURIComponent(loc)}` : ''}`;

export function runView(p: Page, ctx: ScreenCtx, rid: string, setHead: (title: string, intro: string) => void): RunView {
  let data: RunState | null = null;
  let me = '';
  let alive = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // a run started or watched here: when it stops, one toast says how
  let watching = false;

  async function load(): Promise<void> {
    if (timer) clearTimeout(timer);
    try {
      [data, me] = await Promise.all([getRun(rid), whoami().then((m) => m.user?.id ?? '')]);
    } catch (e) {
      if (alive) p.body.replaceChildren(failure(e, () => void load()));
      return;
    }
    if (!alive) return;
    const s = data.run.status;
    if (s === 'running') watching = true;
    else if (watching) {
      watching = false;
      ctx.toast(s === 'done' ? 'The drafts are ready to review.' : s === 'paused' ? (data.run.reason ?? 'The run paused.') : 'The run is cancelled.', s === 'done' ? 'ok' : 'info');
    }
    render();
    if (s === 'running') timer = setTimeout(() => void load(), 1000);
  }

  async function doAct(what: 'run' | 'pause' | 'resume' | 'cancel'): Promise<void> {
    try {
      await act(rid, what);
      if (what === 'run' || what === 'resume') watching = true;
      if (what === 'run') ctx.go({ params: { show: null } }, false);
      await load();
    } catch (e) {
      ctx.toast(message(e), 'error');
    }
  }

  function render(): void {
    if (!data) return;
    const { run, plan, result } = data;
    const mine = run.by?.id === me;
    setHead(`Translate the site into ${run.locale.label}`, `${run.locale.code} · planned by ${run.by?.name ?? 'someone'}`);
    p.actions.replaceChildren();
    p.bar.hidden = true;
    if (run.status === 'expired') {
      return void p.body.replaceChildren(state('empty', 'This plan is more than an hour old', 'Plan it again, so it shows what a run would do now.', button('Plan it again', () => ctx.open(againHash(run), true), { icon: 'refresh' })));
    }
    if (run.status === 'running') {
      if (mine) p.actions.append(button('Pause', () => void doAct('pause'), { icon: 'clock' }), button('Cancel', () => void doAct('cancel'), { kind: 'danger' }));
      return void p.body.replaceChildren(progress(run));
    }
    const show = ctx.params().get('show') ?? '';
    const parts: HTMLElement[] = [];
    if (run.status === 'planned') {
      const skipped = plan.items.filter((i) => i.action === 'skip');
      p.bar.hidden = false;
      p.bar.replaceChildren(chips(ctx, 'show', 'Show', [['', 'Summary'], ['draft', `To draft (${NUM.format(plan.counts.draft)})`], ['skipped', `Skipped (${NUM.format(skipped.length)})`]]));
      if (mine) p.actions.append(button('Change the choices', () => ctx.open(againHash(run), true), { kind: 'quiet' }));
      if (mine && plan.counts.draft) p.actions.append(button('Run it', () => void doAct('run'), { kind: 'primary', icon: 'globe' }));
      if (show === 'draft') parts.push(draftTable(plan.items.filter((i) => i.action === 'draft')));
      else if (show === 'skipped') parts.push(whyTable(skipped, 'Nothing is skipped', 'Every entry of these collections gets a draft.'));
      else parts.push(el('section.ms-adm-card.ms-trs-plan', el('h2.ms-adm-h3', 'The plan'), el('ul.ms-trs-lines', ...plan.lines.map((l) => el('li', l))), el('p.ms-adm-sub', 'This is a dry run: nothing is asked of the AI and nothing is written until you choose Run it. Each draft is kept beside the page for a person to review: it is never published, and it never replaces anyone’s words. The drafts are saved in batches of 25, each its own change in the site’s history, by you.')));
      return void p.body.replaceChildren(...parts);
    }
    // paused, cancelled or done: the report so far
    const items = result?.items ?? [];
    const created = items.filter((i) => i.action === 'created');
    const skipped = items.filter((i) => i.action === 'skipped');
    const failed = items.filter((i) => i.action === 'failed');
    const open = created.filter((i) => i.open);
    p.bar.hidden = false;
    p.bar.replaceChildren(chips(ctx, 'show', 'Show', [['', 'Summary'], ['review', `To review (${NUM.format(open.length)})`], ['skipped', `Skipped (${NUM.format(skipped.length)})`], ['failed', `Failed (${NUM.format(failed.length)})`]]));
    if (run.status === 'paused' && mine) p.actions.append(button('Cancel', () => void doAct('cancel'), { kind: 'danger' }), button('Resume', () => void doAct('resume'), { kind: 'primary', icon: 'refresh' }));
    if (show === 'review') parts.push(reviewTable(created, run));
    else if (show === 'skipped') parts.push(whyTable(skipped, 'Nothing was skipped', 'Every entry planned was asked of the AI.'));
    else if (show === 'failed') parts.push(whyTable(failed, 'Nothing failed', 'Every entry asked got a draft or was skipped.'));
    else parts.push(report(run, created.length, open.length, skipped.length, failed.length, result?.commits.length ?? 0));
    p.body.replaceChildren(...parts);
  }

  const againHash = (run: RunInfo) => {
    const q = new URLSearchParams({ to: run.locale.code });
    if (run.options.collections) q.set('only', run.options.collections.join(','));
    if (!run.options.skipExisting) q.set('all', '1');
    return `#/translate?${q}`;
  };

  function progress(run: RunInfo): HTMLElement {
    const pr = run.progress;
    return el('section.ms-adm-card.ms-trs-plan', { 'aria-live': 'polite' },
      el('h2.ms-adm-h3', 'Drafting…'),
      el('progress.ms-trs-bar', { max: String(Math.max(1, pr.total)), value: String(pr.done), 'aria-label': 'Entries done' }),
      el('p.ms-trs-count', `${NUM.format(pr.done)} of ${NUM.format(pr.total)} done: ${plural(pr.created + pr.pending, 'draft')}, ${NUM.format(pr.skipped)} skipped, ${NUM.format(pr.failed)} failed.`),
      pr.waiting ? el('p.ms-adm-sub', pr.waiting.why) : null,
      el('p.ms-adm-sub', 'It runs on the server: you can leave this page, and it carries on. You are told when it is done.'),
    );
  }

  function report(run: RunInfo, created: number, open: number, skipped: number, failed: number, commits: number): HTMLElement {
    const title = run.status === 'done' ? 'The drafts are ready' : run.status === 'paused' ? 'Paused' : 'Cancelled';
    const lines = [
      `${plural(created, 'draft')} made in ${run.locale.label}, ${NUM.format(open)} waiting for review.`,
      `${NUM.format(skipped)} skipped, ${NUM.format(failed)} failed (each with why).`,
      `${plural(commits, 'change')} in the site’s history, by ${run.by?.name ?? 'the person who ran it'}. No page changed, and nothing went live.`,
    ];
    if (run.status === 'paused') lines.unshift(`${NUM.format(run.progress.done)} of ${NUM.format(run.progress.total)} entries done.`);
    return el('section.ms-adm-card.ms-trs-plan',
      el('h2.ms-adm-h3', title),
      run.reason && run.status !== 'done' ? el('p.ms-trs-reason', run.reason) : null,
      el('ul.ms-trs-lines', ...lines.map((l) => el('li', l))),
      open ? el('div.ms-adm-row', button(`Review the drafts (${NUM.format(open)})`, () => ctx.go({ params: { show: 'review' } }, true), { kind: 'primary' })) : null,
      el('p.ms-adm-sub', 'Each draft opens in Post settings at its region: Accept puts it in the fields, and ⌘S saves it as any change is saved. Discard drops it.'),
    );
  }

  const entryCell = (i: { collection: string; id: string; title: string }, loc?: string) => el('td', el('a', { href: entryHash(i.collection, i.id, loc) }, i.title || i.id));

  function draftTable(rows: PlanItem[]): HTMLElement {
    if (!rows.length) return state('empty', 'Nothing to draft', 'Every entry is skipped: the Skipped tab says why.');
    const tb = el('tbody');
    for (const i of rows) tb.append(el('tr', entryCell(i), el('td', i.collection), el('td', FIELD_WORDS(i.fields)), el('td', NUM.format(i.chars ?? 0))));
    return el('section.ms-adm-card.ms-adm-card--flush', el('table.ms-adm-table', el('thead', el('tr', el('th', 'Entry'), el('th', 'Collection'), el('th', 'To translate'), el('th', 'Characters'))), tb));
  }

  function whyTable(rows: (PlanItem | ResultItem)[], empty: string, text: string): HTMLElement {
    if (!rows.length) return state('empty', empty, text);
    const tb = el('tbody');
    for (const i of rows) tb.append(el('tr', entryCell(i), el('td', i.collection), el('td', i.why ?? '')));
    return el('section.ms-adm-card.ms-adm-card--flush', el('table.ms-adm-table', el('thead', el('tr', el('th', 'Entry'), el('th', 'Collection'), el('th', 'Why'))), tb));
  }

  function reviewTable(rows: ResultItem[], run: RunInfo): HTMLElement {
    if (!rows.length) return state('empty', 'No drafts', 'This run made none.');
    const tb = el('tbody');
    for (const i of rows) {
      const go = i.open ? el('a.ms-btn.ms-btn--sm', { href: entryHash(i.collection, i.id, run.locale.code), 'aria-label': `Review the draft of “${i.title || i.id}”` }, 'Review') : el('span.ms-adm-none', '—');
      tb.append(el('tr', entryCell(i, i.open ? run.locale.code : undefined), el('td', FIELD_WORDS(i.fields)), el('td', i.open ? 'Waiting for review' : 'Reviewed'), el('td', go)));
    }
    return el('section.ms-adm-card.ms-adm-card--flush', el('table.ms-adm-table', el('thead', el('tr', el('th', 'Entry'), el('th', 'Drafted'), el('th', 'Status'), el('th', ''))), tb));
  }

  void load();
  return {
    update: () => render(),
    destroy: () => {
      alive = false;
      if (timer) clearTimeout(timer);
    },
  };
}
