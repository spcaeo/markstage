// #/environments/plans/<id>: one promotion or sync, reviewed before it runs. The summary, the conflicts to decide
// (conflicts.ts), what the rules say for the person looking and the approvals, Promote (or Sync) with a reason, the
// checks, the files by group (?files=pages), the pages that change, and the before and after screenshots (shots.ts,
// ?w=390). ?conflict=<id> opens one conflict side by side, ?do=cancel the cancel panel, ?suggest=summary the AI's
// summary of the changes next to the Reason (plan-ai.ts). While it is being prepared or run, the job is followed
// live and the plan is read again when it ends.
import type { ScreenCtx } from '../host';
import { jobPanel, type JobPanel } from '../admin/jobs';
import { button, chips, drawer, el, failure, link, message, page, state, value, when, whoami } from '../admin/ui';
import { usersBrief } from '../admin/api';
import * as api from './api';
import { conflictsCard, sideBySide } from './conflicts';
import { summaryAi } from './plan-ai';
import { statusBadge } from './overview';
import { shotsCard } from './shots';
import { decisionWords, envWord, fromWord, planTitle, runnable, short } from './words';

const GROUP_WORDS: Record<api.FileGroup, string> = { pages: 'Pages and content', templates: 'Templates and sections', styles: 'Styles', config: 'Config', media: 'Media', other: 'Other code' };
const FILE_STATUS: Record<string, string> = { added: 'Added', modified: 'Changed', removed: 'Removed', deleted: 'Removed', renamed: 'Renamed' };
const CHECK_WORDS: Record<string, string> = { passed: 'Passed', failed: 'Failed', warned: 'Warning', skipped: 'Not run' };

export function mountPlan(host: HTMLElement, ctx: ScreenCtx, id: string) {
  let plan: api.Plan | null = null;
  let me: { id: string; role: string } | null = null;
  /** names of the people who ran plans (the plan has their id) */
  const people = new Map<string, string>();
  let alive = true;
  let follow: JobPanel | null = null;
  let followed = '';
  const reasonBox = el('textarea.ms-input', { id: 'ms-env-run-reason', rows: '2', maxlength: '500', placeholder: 'Why this goes live now' });
  const ai = summaryAi(() => ctx, reasonBox);

  async function load(): Promise<void> {
    try {
      const [m, p] = await Promise.all([whoami(), api.plan(id)]);
      if (!alive) return;
      me = m.user ? { id: m.user.id, role: m.user.role } : null;
      plan = p;
      if (typeof p.runBy === 'string' && !people.size) for (const u of await usersBrief().catch(() => [])) people.set(u.id, u.name);
      if (!alive) return;
      if (!reasonBox.value && p.reason) reasonBox.value = p.reason;
      draw();
    } catch (e) {
      if (!alive) return;
      page(host, 'Plan', '').body.replaceChildren(failure(e, () => void load()));
    }
  }

  function changed(p: api.Plan): void {
    plan = p;
    draw();
  }

  /** the params other than the AI card's: when only that changes, the page is not drawn again */
  let drawnFor = '';
  const others = () => {
    const q = new URLSearchParams(ctx.params());
    q.delete('suggest');
    return q.toString();
  };

  function draw(): void {
    const p = plan!;
    drawnFor = others();
    ctx.setTitle(`${planTitle(p)} · Environments`);
    const pg = page(host, planTitle(p), '');
    pg.head.querySelector('.ms-adm-head__text')!.append(
      el('p.ms-adm-intro', value(p.from.branch, 'branch'), ` at ${short(p.from.sha)} into `, value(p.to.branch, 'branch'), ` at ${short(p.to.sha)} · made by ${p.author?.name ?? 'someone'} `, when(p.createdAt), p.expiresAt && ['ready', 'conflicts', 'blocked'].includes(p.status) ? el('span', ' · expires ', when(p.expiresAt)) : ''),
    );
    pg.actions.replaceChildren(el('a.ms-btn.ms-btn--quiet', { href: '#/environments' }, 'All plans'), statusBadge(p.status, p));
    const layout = el('div.ms-adm-split');
    const main = el('div.ms-adm-split__main.ms-env');
    main.append(...[outcome(p), newer(p), summary(p), conflictsCard(p, { ctx, changed: (x, job) => (job ? (x.job = job) : null, changed(x)) }), decision(p), checks(p), files(p), pages(p), shotsCard(p, ctx)].filter((x): x is HTMLElement => !!x));
    layout.append(main);
    pg.body.replaceChildren(layout);
    const conflict = ctx.params().get('conflict');
    if (conflict) {
      const d = drawer(layout, 'Side by side', () => ctx.go({ params: { conflict: null } }, true));
      d.el.classList.add('ms-env-drawer--wide');
      sideBySide(d.body, p, conflict, { ctx, changed: (x, job) => (ctx.go({ params: { conflict: null } }, true), job ? (x.job = job) : null, changed(x)) });
    } else if (ctx.params().get('do') === 'cancel') cancelPanel(layout, p);
  }

  // ---------- where it stands ----------
  function outcome(p: api.Plan): HTMLElement | null {
    const jid = p.status === 'preparing' ? p.job : p.status === 'running' ? p.runJob : null;
    if (jid) {
      // followed live; the plan is read again when the job ends
      if (followed !== jid) {
        follow?.destroy();
        followed = jid;
        follow = jobPanel(jid, { quietSuccess: true, failedHint: p.status === 'running' ? `${envWord(p.to.env)} is as it was: its branch went back and the live site did not change.` : '', onEnd: () => void load() });
      }
      return el('section.ms-env-follow', el('p.ms-adm-sub', p.status === 'preparing' ? 'Preparing the plan: merging, building, checking and comparing the pages. Nothing has changed yet.' : `Going live on ${envWord(p.to.env)}…`), follow!.el);
    }
    follow?.destroy();
    follow = null;
    followed = '';
    const rid = typeof p.runBy === 'string' ? p.runBy : (p.runBy?.id ?? null);
    const run = rid ? ` by ${rid === me?.id ? 'you' : typeof p.runBy === 'object' && p.runBy ? p.runBy.name : rid === p.author?.id ? p.author.name : (people.get(rid) ?? 'someone')}` : '';
    if (p.status === 'done') return el('div.ms-adm-outcome.is-ok', { role: 'status' }, el('strong', 'Done. '), `${p.action === 'sync' ? 'Synced' : 'Live'} on ${envWord(p.to.env)}${run} `, when(p.finishedAt), p.merged ? el('span', ' · commit ', value(short(p.merged), 'commit')) : '', p.runJob ? el('a', { href: `#/jobs/${p.runJob}` }, ' · the log') : '');
    if (p.status === 'failed') return el('div.ms-adm-outcome.is-bad', { role: 'alert' }, el('strong', 'It did not go through. '), value(p.error ?? p.note ?? 'A step failed.', 'error message'), ` ${envWord(p.to.env)} is as it was.`, p.runJob ? el('a', { href: `#/jobs/${p.runJob}` }, ' See the log.') : '');
    if (p.status === 'stale' || p.status === 'expired' || p.status === 'cancelled') return el('div.ms-adm-outcome', { role: 'status' }, el('strong', `${p.status === 'stale' ? 'Out of date' : p.status === 'expired' ? 'Expired' : 'Cancelled'}. `), p.note ?? '', p.status !== 'cancelled' ? el('span', ' ', again(p)) : '');
    if (p.status === 'blocked') return el('div.ms-adm-outcome.is-bad', { role: 'alert' }, el('strong', 'Blocked. '), p.note ?? 'A blocking check failed: see the checks below.');
    return null;
  }

  /** A new plan of the same source, for an out-of-date one or one whose branch moved on. */
  function again(p: api.Plan): HTMLElement {
    const b = button('Plan it again', async () => {
      b.disabled = true;
      try {
        const r = await api.makePlan({ action: p.action, source: p.action === 'promote' ? p.from.branch : undefined, reason: p.reason ?? undefined });
        ctx.open(`#/environments/plans/${r.plan.id}`, true);
      } catch (e) {
        b.disabled = false;
        ctx.toast(message(e), 'error');
      }
    }, { small: true, icon: 'refresh' });
    return b;
  }

  function newer(p: api.Plan): HTMLElement | null {
    if (!p.newer || !['ready', 'conflicts', 'blocked'].includes(p.status)) return null;
    return el('p.ms-adm-note', `${p.from.branch} has moved on since this plan was made (now at ${short(p.newer)}). This plan still brings exactly ${short(p.from.sha)}; plan it again to include the newer changes. `, again(p));
  }

  function summary(p: api.Plan): HTMLElement | null {
    const s = p.summary;
    if (!s) return null;
    const by = s.status === 'ai' && s.ai ? el('p.ms-adm-sub', `Worded by ${s.ai.model} from the facts below.`) : s.status === 'dropped' ? el('p.ms-adm-sub', `The AI wording was dropped${s.ai?.why ? `: ${s.ai.why}` : ''}. These are the facts.`) : null;
    const facts = s.facts?.length ? el('details.ms-env-facts', el('summary', 'The facts'), el('ul', ...s.facts.map((f) => el('li', f)))) : null;
    return el('section.ms-adm-card', el('h2.ms-adm-h2', 'Summary'), el('p.ms-env-summary', s.text), by, facts);
  }

  // ---------- the rules, approvals, and the button ----------
  function decision(p: api.Plan): HTMLElement | null {
    if (['done', 'failed', 'cancelled', 'preparing', 'running'].includes(p.status) && !p.approvals.length) return null;
    const card = el('section.ms-adm-card.ms-env-decision', el('h2.ms-adm-h2', p.action === 'sync' ? 'Sync' : 'Promote'));
    const d = p.decision;
    if (d) {
      const tone = d.effect === 'allow' ? '.is-ok' : d.effect === 'deny' ? '.is-bad' : '';
      card.append(el(`div.ms-adm-outcome${tone}`, decisionWords(d)));
    }
    // waiting on an approval: the plan's address, to send to whoever approves it
    if (d?.missing.some((m) => m.kind === 'approval')) card.append(el('div.ms-adm-row.ms-adm-sub', 'Send this plan to an approver: ', link(`${location.origin}${location.pathname}${p.link}`, 'plan address')));
    // approvals: tied to the exact merge; an older one shows, crossed out
    if (p.approvals.length) {
      card.append(el('h3.ms-adm-h3', 'Approvals'), el('ul.ms-env-approvals', ...p.approvals.map((a) => el(`li${a.current ? '' : '.is-old'}`, value(a.name, 'name', 'ms-env-approver'), el('span.ms-adm-sub', ` · ${a.role} · `), when(a.at), a.note ? el('span', ' · ', value(a.note, 'approval note')) : '', a.current ? '' : el('span.ms-adm-sub', ' · for an earlier version of the plan')))));
    }
    if (p.status === 'ready' && me && p.author && me.id !== p.author.id && p.merged && !p.approvals.some((a) => a.current && a.userId === me!.id)) {
      const nid = 'ms-env-approve-note';
      const note = el('input.ms-input', { id: nid, maxlength: '300', placeholder: 'A note (optional)' });
      const b = button(`Approve this version (${short(p.merged)})`, async () => {
        b.disabled = true;
        try {
          const r = await api.approve(p.id, { sha: p.merged!, note: note.value.trim() || undefined });
          ctx.toast('Approved.', 'ok');
          changed(r.plan);
        } catch (e) {
          b.disabled = false;
          ctx.toast(message(e), 'error');
          void load();
        }
      }, { icon: 'check' });
      card.append(el('div.ms-adm-row.ms-env-approve', el('label.ms-adm-sub', { for: nid }, 'Approve'), note, b));
    }
    if (p.status === 'ready' || p.status === 'conflicts' || p.status === 'blocked') {
      const go = button(p.action === 'sync' ? `Sync into ${envWord(p.to.env)}` : `Promote to ${envWord(p.to.env)}`, () => void runIt(p, go), { kind: 'primary', icon: p.action === 'sync' ? 'down' : 'rocket' });
      const why = el('p.ms-adm-sub.ms-env-why', { role: 'status' });
      const sync = () => {
        const r = runnable(p, reasonBox.value);
        go.disabled = !r.ok;
        // what the rules still need is said once, in the box above; here only what Promote does, or why else it waits
        const said = !r.ok && d?.effect === 'needs' && d.missing.some((m) => r.why.includes(m.words));
        why.textContent = r.ok ? `It merges ${fromWord(p)} at ${short(p.from.sha)}, builds, runs the checks, then goes live. If a step fails, nothing changes.` : said ? '' : r.why;
        why.hidden = !why.textContent;
      };
      reasonBox.oninput = sync;
      sync();
      const cancel = button('Cancel the plan…', () => ctx.go({ params: { do: 'cancel' } }, true), { kind: 'quiet' });
      card.append(el('div.ms-field.ms-adm-field', el('div.ms-adm-row', el('label.ms-field__label', { for: 'ms-env-run-reason' }, 'Reason'), el('span.ms-adm-grow'), ai.button()), reasonBox, ai.card(p)), el('div.ms-adm-actions', go, el('span.ms-adm-grow'), cancel), why);
    }
    return card;
  }

  async function runIt(p: api.Plan, b: HTMLButtonElement): Promise<void> {
    b.disabled = true;
    b.classList.add('is-busy');
    try {
      const r = await api.run(p.id, { version: p.version, reason: reasonBox.value.trim() || undefined });
      r.plan.runJob = r.plan.runJob ?? r.job;
      changed(r.plan);
    } catch (e) {
      b.classList.remove('is-busy');
      b.disabled = false;
      ctx.toast(message(e), 'error');
      void load();
    }
  }

  function cancelPanel(layout: HTMLElement, p: api.Plan): void {
    const d = drawer(layout, 'Cancel the plan', () => ctx.go({ params: { do: null } }, true));
    if (!['preparing', 'conflicts', 'ready', 'blocked', 'stale', 'expired', 'failed'].includes(p.status)) return void d.body.append(el('p', `The plan is ${p.status}: it can no longer be cancelled.`));
    d.body.append(
      el('p', `Nothing has changed on ${envWord(p.to.env)}, and nothing will: the plan is kept, marked cancelled, with its review.`),
      el('div.ms-adm-actions', button('Cancel the plan', async () => {
        try {
          const r = await api.cancel(p.id, p.version);
          ctx.go({ params: { do: null } }, true);
          changed(r.plan);
        } catch (e) {
          ctx.toast(message(e), 'error');
        }
      }, { kind: 'danger' }), button('Keep it', () => ctx.go({ params: { do: null } }, true), { kind: 'quiet' })),
    );
  }

  // ---------- checks, files, pages ----------
  function checks(p: api.Plan): HTMLElement | null {
    if (!p.checks) return null;
    const list = el('div.ms-adm-checks');
    for (const c of p.checks) {
      const bad = c.status === 'failed';
      list.append(el(`div.ms-adm-check${bad ? '.is-bad' : c.status === 'warned' ? '.is-warn' : ''}`, el('div.ms-adm-check__head', el('strong', c.label), el(`span.ms-adm-badge${c.status === 'passed' ? '.ms-adm-badge--ok' : bad ? '.is-bad' : ''}`, CHECK_WORDS[c.status] ?? c.status), bad && c.blocking ? el('span.ms-adm-sub', 'blocks the plan') : ''), el('p.ms-adm-sub', c.words)));
    }
    const failed = p.checks.filter((c) => c.status === 'failed').length;
    return el('section.ms-adm-card', el('div.ms-adm-row', el('h2.ms-adm-h2', 'Checks'), el('span.ms-adm-grow'), el('span.ms-adm-sub', failed ? `${failed} failed` : 'All passed')), list);
  }

  function files(p: api.Plan): HTMLElement | null {
    if (!p.files) return null;
    const groups = p.files.groups as Partial<Record<api.FileGroup, api.PlanFile[]>>;
    const present = api.GROUPS.filter((g) => groups[g]?.length);
    const pick = ctx.params().get('files') ?? '';
    const shown = present.filter((g) => !pick || g === pick);
    const head = el('div.ms-adm-row', el('h2.ms-adm-h2', `${p.files.count} file${p.files.count === 1 ? '' : 's'} change`));
    if (present.length > 1) head.append(el('span.ms-adm-grow'), chips(ctx, 'files', 'Files', [['', 'All'], ...present.map((g): [string, string] => [g, `${GROUP_WORDS[g]} (${groups[g]!.length})`])]));
    const card = el('section.ms-adm-card', head);
    if (p.files.autoMerged?.length) card.append(el('p.ms-adm-sub', `${p.files.autoMerged.length} changed on both sides and merged part by part, with nothing lost: `, ...p.files.autoMerged.slice(0, 5).flatMap((x, i) => [i ? ', ' : '', value(x, 'file path')])));
    for (const g of shown) {
      const t = el('table.ms-adm-table', el('caption.ms-env-caption', GROUP_WORDS[g]), el('tbody', ...groups[g]!.map((f) => el('tr', el('td', value(f.path, 'file path', 'ms-adm-mono'), f.from ? el('span.ms-adm-sub', ' from ', value(f.from, 'old path')) : ''), el('td.ms-adm-cell--end', el('span.ms-adm-badge', FILE_STATUS[f.status] ?? f.status))))));
      card.append(t);
    }
    return card;
  }

  function pages(p: api.Plan): HTMLElement | null {
    const pg = p.pages;
    if (!pg) return null;
    const part = (title: string, paths: string[], bad = false) =>
      paths.length ? el(`div.ms-env-pages${bad ? '.is-bad' : ''}`, el('h3.ms-adm-h3', `${title} (${paths.length})`), el('ul.ms-adm-list', ...paths.slice(0, 60).map((x) => el('li', link(x, 'page path')))), paths.length > 60 ? el('p.ms-adm-sub', `and ${paths.length - 60} more`) : '') : null;
    const parts = [part('Removed without a redirect', pg.removedWithoutRedirect, true), part('New pages', pg.added), part('Removed pages', pg.removed.filter((x) => !pg.removedWithoutRedirect.includes(x))), part('Pages that look different', pg.changed)].filter(Boolean);
    if (!parts.length) return el('section.ms-adm-card', el('h2.ms-adm-h2', 'Pages'), el('p.ms-adm-sub', 'No page of the site looks different.'));
    return el('section.ms-adm-card', el('h2.ms-adm-h2', 'Pages'), ...parts);
  }

  page(host, 'Plan', '').body.replaceChildren(state('loading', 'Loading the plan…'));
  void load();
  return {
    update: (c: ScreenCtx) => {
      ctx = c;
      if (plan && others() === drawnFor) ai.card(plan);
      else if (plan) draw();
    },
    destroy: () => {
      alive = false;
      follow?.destroy();
      ai.destroy();
    },
  };
}
