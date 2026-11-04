// Publishing jobs (a build and a deploy, for a static site):
//   #/jobs?status=   every recent job
//   #/jobs/<jid>     one job: its steps and its log, live while it runs
// jobPanel() is the live part on its own (the publish sheet shows it in place). A failed job says which step failed
// and that the live site did not change; the server has put the text back.
import { toast, type ScreenCtx } from '../host';
import * as api from './api';
import { buildBlockedLine, button, chips, copyButton, el, failure, isEditorPlus, link, message, page, state, value, when, whoami } from './ui';
import { fmtTime } from '../dates';

export const JOB_WORDS: Record<string, string> = { queued: 'Waiting', running: 'Running', succeeded: 'Done', failed: 'Failed' };
export const KIND_WORDS: Record<string, string> = {
  publish: 'Publish',
  unpublish: 'Unpublish',
  delete: 'Delete',
  schedule: 'Scheduled publish',
  site: 'Rebuild the site',
  protect: 'Password-protect',
  unprotect: 'Remove the password',
  move: 'Move',
  design: 'Design & Code',
  'code-injection': 'Code on a page',
  rollback: 'Roll back to the release before',
  'media-replace': 'Replace an image everywhere',
  replace: 'Find and replace',
  bulk: 'Change many entries',
  backup: 'Backup',
};
const STEP_WORDS: Record<string, string> = { commit: 'Save', checks: 'Checks', build: 'Build', verify: 'Every locale in place', deploy: 'Go live', revert: 'Put back', due: 'Due', purge: 'Clear the cache', indexnow: 'Tell search engines', rollback: 'Roll back', backup: 'Back up', ship: 'Copy it on' };
const stepWords = (n: string) => STEP_WORDS[n] ?? n.replace(/^check: /, 'Check: ');

export function mountJobs(host: HTMLElement, ctx: ScreenCtx) {
  return ctx.args[0] ? mountJob(host, ctx, ctx.args[0]) : mountJobList(host, ctx);
}

function mountJobList(host: HTMLElement, ctx: ScreenCtx) {
  const p = page(host, 'Scheduled & history', 'What went live and when, what is scheduled, and what failed, newest first.');
  p.bar.hidden = false;
  let list: api.Job[] = [];
  let mine: api.Notice[] = [];
  let people = new Map<string, string>();
  let alive = true;
  let timer = 0;

  async function load(): Promise<void> {
    try {
      const me = await whoami();
      if (!people.size) people = new Map((await api.usersBrief()).map((u) => [u.id, u.name]));
      [list, mine] = await Promise.all([api.jobs(100), api.notices().then((r) => r.items, () => [])]);
      if (isEditorPlus(me) && !p.actions.childElementCount) {
        p.actions.append(button('Rebuild the site', async () => {
          if ((await ctx.ask('Rebuild the whole site?', 'Builds every page from the saved content and puts it live. Nothing changes if the build fails.', [['cancel', 'Cancel'], ['go', 'Rebuild', 'ms-btn ms-btn--primary']])) !== 'go') return;
          try {
            const r = await api.rebuildSite();
            ctx.open(`#/jobs/${encodeURIComponent(r.job)}`);
          } catch (e) {
            ctx.toast(message(e), 'error');
          }
        }, { icon: 'refresh' }));
      }
    } catch (e) {
      p.body.replaceChildren(failure(e, () => void load()));
      return;
    }
    if (!alive) return;
    render();
    // refresh while something is still running
    clearTimeout(timer);
    if (list.some((j) => j.status === 'queued' || j.status === 'running')) timer = window.setTimeout(() => void load(), 2000);
  }

  function render(): void {
    const status = ctx.params().get('status') ?? '';
    p.bar.replaceChildren(chips(ctx, 'status', 'Status', [['', 'All'], ['running', 'Running'], ['failed', 'Failed'], ['succeeded', 'Done']]));
    const rows = list.filter((j) => !status || (status === 'running' ? j.status === 'running' || j.status === 'queued' : j.status === status));
    const t = el('table.ms-adm-table.ms-adm-table--rows', el('thead', el('tr', el('th', 'What'), el('th', 'Entry'), el('th', 'Status'), el('th', 'By'), el('th', 'Started'))));
    const tb = el('tbody');
    for (const j of rows) {
      tb.append(
        el(`tr${j.status === 'failed' ? '.is-bad' : ''}`,
          el('td', el('a.ms-adm-rowlink', { href: `#/jobs/${encodeURIComponent(j.id)}` }, KIND_WORDS[j.kind] ?? j.kind)),
          el('td', j.collection && j.entryId ? el('a', { href: `#/e/${encodeURIComponent(j.collection)}/${encodeURIComponent(j.entryId)}` }, `${j.collection}/${j.entryId}`) : el('span.ms-adm-none', j.kind === 'design' ? 'the site’s design' : j.kind === 'rollback' ? 'the live site' : j.kind === 'media-replace' ? 'every page using the image' : j.kind === 'replace' || j.kind === 'bulk' ? 'several entries' : j.kind === 'backup' ? 'the database and the site repo' : 'the whole site')),
          el('td', el(`span.ms-adm-job.ms-adm-job--${j.status}`, JOB_WORDS[j.status] ?? j.status)),
          el('td', j.userId ? people.get(j.userId) ?? 'a removed user' : el('span.ms-adm-none', 'the scheduler')),
          el('td', when(j.startedAt ?? j.createdAt)),
        ),
      );
    }
    t.append(tb);
    p.body.replaceChildren(noticesCard() ?? '', rows.length ? el('section.ms-adm-card.ms-adm-card--flush', t) : state('empty', 'Nothing here', status ? 'No jobs with this status.' : 'Nothing has been published yet.'));
  }

  /** What happened while you were away (a failed publish, a scheduled entry held back or late), until marked seen. */
  function noticesCard(): HTMLElement | null {
    if (!mine.length) return null;
    const seen = async (id: string | null) => {
      try {
        if (id) await api.noticeSeen(id);
        else await api.noticesSeen();
        mine = id ? mine.filter((n) => n.id !== id) : [];
        render();
      } catch (e) {
        ctx.toast(message(e), 'error');
      }
    };
    return el('section.ms-adm-card.ms-adm-notices', { 'aria-label': 'For you' },
      el('div.ms-adm-row', el('h2.ms-adm-h2', 'For you'), el('span.ms-adm-grow'), mine.length > 1 ? button('Mark all as seen', () => void seen(null), { small: true, kind: 'quiet' }) : null),
      el('ul.ms-adm-issues', ...mine.map((n) =>
        el(`li.ms-adm-notice.is-${n.level}`,
          el('span', n.text),
          el('span.ms-adm-sub', ' ', when(n.at)),
          el('span.ms-adm-row', n.link ? el('a', { href: n.link }, 'Open') : null, button('Seen', () => void seen(n.id), { small: true, kind: 'quiet' })),
        ))),
    );
  }

  void load();
  return {
    update: () => render(),
    destroy: () => {
      alive = false;
      clearTimeout(timer);
    },
  };
}

function mountJob(host: HTMLElement, ctx: ScreenCtx, jid: string) {
  const p = page(host, 'Job', '');
  p.actions.append(button('All publishing', () => ctx.open('#/jobs'), { icon: 'log' }));
  const live = el('div');
  let page$: Promise<Awaited<ReturnType<typeof api.addresses>> | null> = Promise.resolve(null);
  const panel = jobPanel(jid, {
    quietSuccess: true,
    onFirst: (j) => {
      const kind = KIND_WORDS[j.kind] ?? j.kind;
      const name = (t: string) => {
        const title = `${kind} “${t}”`;
        p.head.querySelector('h1')!.textContent = title;
        ctx.setTitle(title);
      };
      if (!j.collection || !j.entryId) {
        p.head.querySelector('h1')!.textContent = kind;
        ctx.setTitle(kind);
        return;
      }
      name(j.entryId);
      page$ = api.addresses(j.collection, j.entryId).catch(() => null);
      void page$.then((x) => x && name(x.title || j.entryId!));
      p.actions.prepend(button('Open the entry', () => ctx.open(`#/e/${encodeURIComponent(j.collection!)}/${encodeURIComponent(j.entryId!)}`), { icon: 'article' }));
    },
    onEnd: (j) => {
      if (j.status !== 'succeeded') return;
      void page$.then((x) => live.replaceChildren(liveCard(j.kind, x?.addresses ?? null, j.id)));
    },
  });
  p.body.replaceChildren(live, panel.el);
  return { destroy: () => panel.destroy() };
}

/** The end of a job that went well: where the page is now (copy, open), or that it is off the site. */
/** `fresh`: the job that just put it live; its open links carry `?v=<fresh>` so the first click never shows a cached copy. */
export function liveCard(kind: string, list: api.Address[] | null, fresh: string | null, ...actions: HTMLElement[]): HTMLElement {
  const off = kind === 'unpublish' || kind === 'delete';
  return el('section.ms-adm-card.ms-adm-live', { 'aria-label': off ? 'Off the site' : 'Live' },
    el('h2.ms-adm-h2', off ? 'It is off the site' : kind === 'rollback' ? 'The release before is live again' : kind === 'design' || kind === 'site' ? 'The site is live with this change' : 'It is live'),
    off ? el('p.ms-adm-sub', 'Its page is gone from every locale. The text stays here as a draft.') : list ? addressList(list, fresh ?? undefined) : null,
    off || !list ? null : testers(list),
    actions.length ? el('div.ms-adm-row', ...actions) : null,
  );
}

/**
 * The outside testers for the live page (docs/SEO.md): Google's Rich Results Test, and LinkedIn's and Facebook's
 * debuggers, which also refresh their cached card. Only for a public address (the site's siteUrl): they cannot reach
 * anything else. Each opens in a new tab; nothing is sent from here.
 */
export function testers(list: api.Address[]): HTMLElement | null {
  const url = list.find((a) => a.url && /^https:\/\//.test(a.url))?.url;
  if (!url) return null;
  const q = encodeURIComponent(url);
  const out = (href: string, label: string) => el('a.ms-adm-tester', { href, target: '_blank', rel: 'noopener noreferrer' }, label);
  return el('p.ms-adm-sub.ms-adm-testers', 'See it as others do: ',
    out(`https://search.google.com/test/rich-results?url=${q}`, 'Test in Google'), ' · ',
    out(`https://www.linkedin.com/post-inspector/inspect/${q}`, 'Refresh on LinkedIn'), ' · ',
    out(`https://developers.facebook.com/tools/debug/?q=${q}`, 'Refresh on Facebook'),
  );
}

/** A page's addresses, one per locale, each with copy and open always showing (not only on hover). */
export function addressList(list: api.Address[], fresh?: string): HTMLElement {
  if (!list.length) return el('p.ms-adm-sub', 'This entry has no page of its own.');
  return el('ul.ms-adm-addresses', ...list.map((a) => el('li', a.locale ? el('span.ms-adm-badge', a.locale) : null, link(a.url ?? a.path, a.locale ? `the ${a.locale} address` : 'the page address', '', fresh))));
}

export interface JobPanel {
  el: HTMLElement;
  /** the row under the steps (job ID, start time); a caller may add to it */
  meta: HTMLElement;
  destroy(): void;
}

/**
 * One job, live: the outcome line, the steps, and, folded under "Details (for developers)", the job ID and the log
 * (followed while it grows, copyable). Built once and updated in place while the job runs, so focus and a copy's tick
 * survive the polling. `onEnd` runs once it is done; `quietSuccess`: the caller shows its own card when it went well.
 */
/** The jobs whose change stays saved on a failed build (the site stays as it was): a build can be tried again. */
const KEPT = new Set(['media-replace']);
function tryAgain(): HTMLElement {
  const b = button('Try the build again', async () => {
    b.disabled = true;
    try {
      const r = await api.rebuildSite();
      location.hash = `#/jobs/${encodeURIComponent(r.job)}`;
    } catch (e) {
      b.disabled = false;
      toast(message(e), 'error');
    }
  }, { small: true, icon: 'refresh' });
  return el('div.ms-adm-row', b);
}

export function jobPanel(jid: string, opts: { onFirst?: (j: api.Job) => void; onEnd?: (j: api.Job) => void; failedHint?: string; quietSuccess?: boolean } = {}): JobPanel {
  const root = el('div.ms-adm-jobpanel');
  const outcome = el('div.ms-adm-outcome', { role: 'status' });
  const steps = el('ol.ms-adm-steps', { 'aria-label': 'Steps' });
  const meta = el('div.ms-adm-row.ms-adm-sub');
  const copySlot = el('span');
  const logEl = el('pre.ms-adm-log', { tabindex: '0', 'aria-label': 'Log' });
  let built = false;
  let text = '';
  let offset = 0;
  let alive = true;
  let timer = 0;
  let follow = true;
  let lastStatus = '';
  logEl.addEventListener('scroll', () => (follow = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 8));
  root.append(state('loading', 'Starting…'));

  async function poll(): Promise<void> {
    let j: api.Job;
    try {
      j = await api.job(jid, offset);
    } catch (e) {
      root.replaceChildren(failure(e));
      return;
    }
    if (!alive) return;
    text += j.log ?? '';
    offset = j.logOffset ?? text.length;
    render(j);
    if (j.status === 'queued' || j.status === 'running') timer = window.setTimeout(() => void poll(), 1200);
    else opts.onEnd?.(j);
  }

  function render(j: api.Job): void {
    if (!built) {
      meta.append('Started ', when(j.startedAt ?? j.createdAt), el('span.ms-adm-grow'));
      // the engine's own words (commands, paths) are for developers: folded away
      const details = el('details.ms-adm-card.ms-adm-details', el('summary', 'Details (for developers)'), el('div.ms-adm-row.ms-adm-sub', 'Job ', value(j.id, 'job ID'), el('span.ms-adm-grow'), copySlot), logEl);
      root.replaceChildren(outcome, el('section.ms-adm-card', steps, meta), details);
      built = true;
      opts.onFirst?.(j);
    }
    if (j.status !== lastStatus) {
      lastStatus = j.status;
      outcome.className = `ms-adm-outcome${j.status === 'failed' ? ' is-bad' : j.status === 'succeeded' ? ' is-ok' : ''}`;
      outcome.hidden = j.status === 'succeeded' && !!opts.quietSuccess;
      outcome.setAttribute('role', j.status === 'failed' ? 'alert' : 'status');
      outcome.replaceChildren(
        ...(j.status === 'failed'
          ? [el('strong', 'It did not go live. '), j.error ?? 'A step failed.', ` ${opts.failedHint ?? 'Your text is safe: it is back in the editor as your unsaved changes.'}`, ...(j.blocked?.length ? [buildBlockedLine({ entries: j.blocked })!] : []), ...(KEPT.has(j.kind) ? [tryAgain()] : [])]
          : j.status === 'succeeded'
            ? [el('strong', 'Done. '), `Finished ${fmtTime(j.finishedAt ?? Date.now())}.`]
            : [el('strong', `${JOB_WORDS[j.status]}… `), 'This follows it live; you can leave and come back.']),
      );
    }
    steps.replaceChildren(...j.steps.map((s) => el(`li.ms-adm-step.is-${s.status}`, el('span.ms-adm-step__dot'), el('span', stepWords(s.name)), el('span.ms-adm-sub', s.status === 'running' ? 'running…' : s.status === 'failed' ? 'failed' : s.status === 'succeeded' ? 'done' : s.status === 'warned' ? 'did not go through (the page is live; see Details)' : s.status))));
    if (logEl.textContent !== (text || '(nothing yet)')) {
      logEl.textContent = text || '(nothing yet)';
      if (follow) logEl.scrollTop = logEl.scrollHeight;
    }
    if (!copySlot.firstChild) copySlot.append(copyButton('log', () => text));
  }

  void poll();
  return {
    el: root,
    meta,
    destroy: () => {
      alive = false;
      clearTimeout(timer);
    },
  };
}
