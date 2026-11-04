// #/publish/<collection>/<id>?when=later&job=<jid>: the publish sheet. Everything a writer needs before a page goes
// live, on one screen:
//   where     its address in every locale (copy, open)
//   changes   what is different from the live page (or that it is new), with a link to see it side by side
//   checks    the site's own rules and checks, alt text, links to drafts or to nothing, the page on a phone, and the
//             checks that run on the fresh build (hreflang, every locale copy) during the publish
//   when      now, or later (when=later: a time in the writer's own time zone)
// Publishing keeps the sheet open: the job runs in place (job=<jid>, live steps and log), and at the end the live
// address is there to copy or open. A failed job leaves the live site as it was.
import { ApiError } from '../api';
import type { ScreenCtx } from '../host';
import { aLabel } from '../page-types';
import * as api from './api';
import { compare, tally } from './diff';
import { addressList, jobPanel, liveCard, type JobPanel } from './jobs';
import { phoneCheck, type PhoneCheck, type PhoneResult } from './phone';
import { plain } from './plain';
import { textRows } from './revisions';
import { ago, button, canManageUsers, el, failure, icon, isEditorPlus, link, message, page, state, value, when, whoami } from './ui';
import { echoDate, fmtDateTime } from '../dates';

const STATUS_WORDS: Record<string, string> = { draft: 'Draft', scheduled: 'Scheduled', published: 'Published' };
type Mark = 'ok' | 'bad' | 'warn' | 'wait' | 'info';
const MARK_ICON: Record<Mark, string> = { ok: 'check', bad: 'alert', warn: 'alert', wait: 'clock', info: 'info' };
const KIND_WORDS: Record<string, string> = { overflow: 'Wider than the screen', image: 'Image too wide', tap: 'Too small to tap', font: 'Text too small' };

export function mountPublish(host: HTMLElement, ctx: ScreenCtx) {
  const [c, id] = ctx.args;
  const p = page(host, 'Publish', '', { narrow: true });
  let entry: Awaited<ReturnType<typeof api.getEntry>> | null = null;
  let pre: api.Preflight | null = null;
  let preError: unknown = null;
  let changes: Awaited<ReturnType<typeof api.compare>> | null = null;
  let phone: PhoneCheck | null = null;
  let phoneResult: PhoneResult | null = null;
  let panel: { jid: string; p: JobPanel; done: api.Job | null } | null = null;
  // the sheet's cards are built once and their insides updated, so the phone frame is never moved (that reloads it)
  let sheet: { where: HTMLElement; changes: HTMLElement; checks: HTMLElement; list: HTMLElement; phone: HTMLElement; when: HTMLElement } | null = null;
  let alive = true;
  // owner/administrator see why a check is off and how to turn it on; writers see plain words
  let admin = false;
  let editorPlus = false;
  let liveList: api.Address[] | null = null;
  // someone else editing this entry now (their unsaved changes are not in what goes live)
  let editingBy: api.Editing | null = null;

  async function load(): Promise<void> {
    if (!c || !id) return void p.body.replaceChildren(state('denied', 'Not available to you', 'Open the publish sheet from an entry.'));
    p.body.replaceChildren(state('loading', 'Loading…'));
    // a second load (after a 409, a cancelled schedule) draws the sheet afresh: the old sections left with the body
    sheet = null;
    try {
      entry = await api.getEntry(c, id);
    } catch (e) {
      p.body.replaceChildren(failure(e, () => void load()));
      return;
    }
    if (!alive) return;
    const me = await whoami().catch(() => null);
    admin = me ? canManageUsers(me) : false;
    editorPlus = me ? isEditorPlus(me) : false;
    p.head.querySelector('h1')!.textContent = `Publish “${entry.title || id}”`;
    ctx.setTitle(`Publish · ${entry.title || id}`);
    p.actions.replaceChildren(button('Back to the entry', () => ctx.open(`#/e/${encodeURIComponent(c)}/${encodeURIComponent(id)}`), { icon: 'article' }));
    render();
    if (!ctx.params().get('job')) void check();
  }

  /** Everything that can be known before publishing: preflight, the change against live, the phone. */
  async function check(): Promise<void> {
    pre = null;
    preError = null;
    changes = null;
    phoneResult = null;
    phone?.destroy();
    phone = entry?.url ? phoneCheck(c, id) : null;
    sheet?.phone.replaceChildren();
    render();
    const jobs: Promise<unknown>[] = [
      api.preflight(c, id).then((r) => (pre = r), (e) => (preError = e)),
      api.compare(c, id, 'live', 'current').then((r) => (changes = r), () => (changes = null)),
    ];
    void api.presence().then((r) => {
      const e = r.entries.find((x) => x.collection === c && x.id === id)?.editing;
      editingBy = e && !e.you ? e : null;
      if (alive && editingBy) render();
    }, () => undefined);
    if (phone) jobs.push(phone.result.then((r) => ((phoneResult = r), alive && render())));
    await Promise.all(jobs.slice(0, 2));
    if (alive) render();
  }

  function render(): void {
    if (!entry) return;
    const jid = ctx.params().get('job');
    if (jid) return renderJob(jid);
    if (panel) {
      panel.p.destroy();
      panel = null;
    }
    const status = entry.status ?? 'published';
    const canPublish = entry.can?.publish !== false;
    if (!sheet) {
      const checks = el('section.ms-adm-card', { 'aria-label': 'Checks' }, el('div.ms-adm-row', el('h2.ms-adm-h2', 'Checks'), el('span.ms-adm-grow'), button('Run again', () => void check(), { small: true, icon: 'refresh' })));
      sheet = { where: el('section.ms-adm-card', { 'aria-label': 'Where' }), changes: el('section.ms-adm-card', { 'aria-label': 'What changes' }), checks, list: el('div'), phone: el('div.ms-adm-pf__phone'), when: el('section.ms-adm-card.ms-adm-publish', { 'aria-label': 'When' }) };
      checks.append(sheet.list, sheet.phone);
      p.body.replaceChildren(sheet.where, sheet.changes, sheet.checks, sheet.when);
    }
    sheet.where.replaceChildren(...whereCard(status));
    sheet.changes.replaceChildren(...changesCard());
    sheet.list.replaceChildren(checksList());
    if (phone && !sheet.phone.firstChild && phoneResult?.kind !== 'unavailable') {
      sheet.phone.append(phone.frame, button('Open the phone view', () => ctx.open(`#/e/${encodeURIComponent(c)}/${encodeURIComponent(id)}?device=mobile`), { small: true, kind: 'quiet', icon: 'eye' }));
    }
    if (phoneResult?.kind === 'unavailable') sheet.phone.replaceChildren();
    sheet.when.replaceChildren(...(canPublish ? whenCard(status) : [el('p.ms-adm-lead', 'Your role cannot publish this entry. Save it, and ask an editor to publish it.')]));
  }

  // ---------- where ----------
  const addresses = () => addressList(pre?.addresses ?? (entry?.url ? [{ locale: null, path: entry.url, url: null }] : []));

  function whereCard(status: string): HTMLElement[] {
    const publishAt = typeof entry?.frontmatter?.publishAt === 'string' ? entry.frontmatter.publishAt : typeof entry?.data?.publishAt === 'string' ? entry.data.publishAt : null;
    return [
      el('div.ms-adm-row', el(`span.ms-adm-status.ms-adm-status--${status}`, entry?.held ? 'Scheduled, held' : STATUS_WORDS[status] ?? status), status === 'scheduled' && publishAt && !entry?.held ? el('span', 'goes live ', when(publishAt)) : null),
      entry?.held ? el('p.ms-adm-warnline', { role: 'note' }, 'Was due ', when(entry.held.dueAt), `, held: ${entry.held.reasons.join('; ')}. It goes live on the next scheduler run once that is fixed${editorPlus ? ', or publish it anyway below' : ''}.`) : null,
      editingBy ? el('p.ms-adm-warnline', { role: 'note' }, `${editingBy.name} is editing this now (since `, when(editingBy.since), '). What goes live is the last saved version; changes they have not saved yet are not in it.') : null,
      addresses(),
    ].filter((x): x is HTMLElement => x !== null);
  }

  // ---------- what changes ----------
  function changesCard(): HTMLElement[] {
    const card: HTMLElement[] = [el('h2.ms-adm-h2', 'What changes')];
    if (!changes) return [...card, el('p.ms-adm-sub', pre || preError ? 'The live version could not be read.' : 'Comparing with the live page…')];
    const side = button('See it side by side', () => ctx.open(`#/revisions/${encodeURIComponent(c)}/${encodeURIComponent(id)}?sha=live`), { small: true, icon: 'history' });
    if (changes.from.source === null) {
      card.push(el('p.ms-adm-lead', changes.from.deployed === false ? 'First publish from Markstage.' : 'It is new on the site: its page appears with this publish.'), ...alsoLive());
      return card;
    }
    const rows = compare(changes.from.source, changes.to.source ?? '');
    const t = tally(rows);
    if (t.added + t.removed + t.changed === 0) {
      card.push(el('p.ms-adm-lead', 'The live page already has this text. Publishing again rebuilds it.'), ...alsoLive());
      return card;
    }
    const changed = rows.filter((r) => r.kind !== 'same');
    card.push(
      el('p.ms-adm-lead', `${[t.changed && `${t.changed} changed`, t.added && `${t.added} added`, t.removed && `${t.removed} removed`].filter(Boolean).join(', ')} since the live version.`),
      el('div.ms-adm-compare.ms-adm-compare--short', ...textRows(changed.slice(0, 3), true)),
      el('div.ms-adm-row', changed.length > 3 ? el('span.ms-adm-sub', `and ${changed.length - 3} more`) : null, el('span.ms-adm-grow'), side),
      ...alsoLive(),
    );
    return card;
  }

  /** The other saved changes a build puts live with this one (title, who, when), the first 5 shown. */
  function alsoLive(): HTMLElement[] {
    const a = pre?.alsoLive;
    if (!a || (!a.entries.length && !a.media && !a.files)) return [];
    const n = a.entries.length;
    const plural = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`;
    const item = (e: (typeof a.entries)[number]) =>
      el('li', e.deleted ? el('span', `“${e.title}” (deleted)`) : el('a', { href: `#/e/${encodeURIComponent(e.collection)}/${encodeURIComponent(e.id)}` }, `“${e.title}”`), el('span.ms-adm-sub', ` · ${e.by}, ${ago(e.at)}`));
    const since = a.deployed ? 'since the last deploy' : 'saved here and not published yet';
    const rest = [a.media && plural(a.media, 'image'), a.files && plural(a.files, 'other file')].filter(Boolean).join(' and ');
    const out: (HTMLElement | null)[] = [
      n ? el('p.ms-adm-sub', `It also puts live ${plural(n, 'other saved change')} ${since}:`) : null,
      n ? el('ul.ms-adm-also', ...a.entries.slice(0, 5).map(item)) : null,
      n > 5 ? el('details.ms-adm-also__more', el('summary', `and ${n - 5} more`), el('ul.ms-adm-also', ...a.entries.slice(5).map(item))) : null,
      rest ? el('p.ms-adm-sub', n ? `And ${rest}.` : `It also puts live ${rest} ${since}.`) : null,
    ];
    return out.filter((x): x is HTMLElement => !!x);
  }

  // ---------- checks ----------
  function checkRow(mark: Mark, title: string, note: string | Node, details: Node[] = []): HTMLElement {
    return el(`li.ms-adm-pf.is-${mark}`,
      el('span.ms-adm-pf__ico', icon(MARK_ICON[mark], 16)),
      el('div.ms-adm-stack', el('div.ms-adm-pf__head', el('strong', title), el('span.ms-adm-sub', note)), details.length ? el('ul.ms-adm-issues', ...details) : null),
    );
  }

  function checksList(): HTMLElement {
    if (preError) return failure(preError, () => void check());
    if (!pre) return state('loading', 'Running the checks…', 'The site’s own rules and checks run on the saved text.');
    const ul = el('ul.ms-adm-pflist');
    if (pre.validate) {
      const v = pre.validate;
      ul.append(checkRow(v.ok ? 'ok' : v.unavailable ? 'warn' : 'bad', 'The site’s rules', v.ok ? 'Passed' : v.unavailable ? 'Could not run' : 'Failed: blocks publishing', v.issues.map((i) => el('li', value(`${i.line ? `Line ${i.line}: ` : ''}${i.message}`, 'issue')))));
    }
    for (const r of pre.checks.results) {
      const issues = r.ok ? [] : r.issues.length ? r.issues : [{ severity: 'error' as const, message: r.output.trim() || 'It failed without saying why.' }];
      ul.append(checkRow(r.ok ? 'ok' : r.blocking ? 'bad' : 'warn', r.label, r.ok ? 'Passed' : r.blocking ? 'Failed: blocks publishing' : 'Warning', issues.map((i) => el('li', value(`${'line' in i && i.line ? `Line ${i.line}: ` : ''}${i.message}`, 'issue')))));
    }
    const p = pre;
    // a rule's mark: what the server decided (block / warn), or passed
    const mark = (rule: api.PublishRule): Mark => (p.rules.some((r) => r.rule === rule && r.level === 'block') ? 'bad' : p.rules.some((r) => r.rule === rule) ? 'warn' : 'ok');
    const says = (rule: api.PublishRule, note: string) => (mark(rule) === 'bad' ? `${note}: blocks publishing` : note);
    const entryLink = (e: api.EntryRef) => el('a', { href: `#/e/${encodeURIComponent(e.collection)}/${encodeURIComponent(e.id)}` }, `“${e.title}”`);
    const dups = [...p.duplicates.title.map((e) => ['search title', e] as const), ...p.duplicates.description.map((e) => ['description', e] as const)];
    ul.append(
      checkRow(mark('altText'), 'Alt text', pre.altText.length ? says('altText', `${pre.altText.length} image${pre.altText.length === 1 ? '' : 's'} without a description`) : 'Every image is described', pre.altText.map((a) => el('li', value(a.src || '(no address)', 'image address'), el('span.ms-adm-sub', ` in ${a.where}`)))),
      checkRow(mark('links'), 'Links', pre.links.length ? says('links', `${pre.links.length} link${pre.links.length === 1 ? '' : 's'} to fix`) : 'Every link inside the site goes to a live page', pre.links.map((l) =>
        el('li', link(l.href, 'link'), ' ', l.problem === 'not-live' && l.target ? el('span', 'goes to ', entryLink(l.target), `, which is not live (${STATUS_WORDS[l.target.status]?.toLowerCase() ?? l.target.status})`) : el('span', l.sure === false ? 'goes to a page this server cannot find (check it after the build)' : 'goes to no page on the site')))),
      checkRow(mark('duplicates'), 'Search title and description', dups.length ? says('duplicates', 'Another live page has the same words') : 'Not used by another live page', dups.map(([what, e]) => el('li', `The same ${what} as `, entryLink(e)))),
      checkRow(mark('headings'), 'Headings', pre.headings.length ? says('headings', `${pre.headings.length} to look at`) : 'One main heading, no level skipped', pre.headings.map((h) => el('li', h.message, el('span.ms-adm-sub', ` in ${h.where}`)))),
      ...pageRow(),
      ...linksRow(),
      phoneRow(),
    );
    if (pre.afterBuild.length || pre.verify) {
      const names = [...pre.afterBuild.map((k) => k.label), ...(pre.verify ? ['every locale copy in place'] : [])];
      ul.append(checkRow('wait', 'On the fresh build', `Runs during the publish: ${names.join(', ')}. If one fails, nothing goes live.`));
    }
    return ul;
  }

  /** What the page's type needs (a booking button, a FAQ, links to its hub…): the checks that fail, at their level. */
  function pageRow(): HTMLElement[] {
    const pg = pre?.page;
    if (!pg?.type || !pg.checks.length) return [];
    const missing = pg.checks.filter((k) => !k.ok);
    const blocks = missing.some((k) => k.level === 'block');
    const note = !missing.length ? `Has what ${aLabel(pg.type.label)} needs` : `${missing.length} of ${pg.checks.length} to add${blocks ? ': blocks publishing' : ''}`;
    return [checkRow(!missing.length ? 'ok' : blocks ? 'bad' : 'warn', pg.type.label, note, missing.map((k) => el('li', el('strong', k.label), ': ', k.message ?? '')))];
  }

  /** Its topic links: how many pages could link to it (a new page's old neighbours), and a way to review them. */
  function linksRow(): HTMLElement[] {
    const tl = pre?.topicLinks;
    if (!tl) return [];
    const words = !tl.topic ? 'Not in a topic: pages that talk about it are not suggested to link to it.' : `${tl.in === 1 ? 'One page links' : `${tl.in} pages link`} here. ${tl.incoming ? `${tl.incoming === 1 ? 'One more page talks' : `${tl.incoming} more pages talk`} about it and could link to it.` : 'No other page talks about it without a link.'}${tl.outgoing ? ` ${tl.outgoing === 1 ? 'One link' : `${tl.outgoing} links`} to add here.` : ''}`;
    const review = el('a', { href: tl.review }, 'Review the links');
    return [checkRow(!tl.topic || tl.incoming || tl.outgoing ? 'info' : 'ok', 'Links', el('span', words, ' ', review))];
  }

  function phoneRow(): HTMLElement {
    if (!entry?.url || !phone) return checkRow('info', 'On a phone', 'This entry has no page to check.');
    const r = phoneResult;
    const row = !r
      ? checkRow('wait', 'On a phone', 'Measuring the page at 390 px…')
      : r.kind === 'unavailable'
        ? checkRow('info', 'On a phone', plain('The phone check is not set up on this server. Ask whoever runs the server.', admin ? `For the server’s administrator: ${r.why} The preview origin is set in the server config (docs/DEPLOY.md, Ports).` : null))
        : r.kind === 'unreachable'
          ? checkRow('warn', 'On a phone', r.why)
          : checkRow(r.issues.length || r.sideways ? 'warn' : 'ok', 'On a phone', r.issues.length || r.sideways ? `${r.issues.length} problem${r.issues.length === 1 ? '' : 's'} at ${r.width} px${r.sideways ? '; the page scrolls sideways' : ''}` : `Fits a ${r.width} px screen`, r.issues.slice(0, 8).map((i) => el('li', el('strong', KIND_WORDS[i.kind] ?? i.kind), ': ', value(i.label || i.text, 'element'))));
    return row;
  }

  /** A blocking failure of the saved text: publishing would stop at the checks anyway. */
  const blocked = () => !!pre && ((pre.validate !== null && !pre.validate.ok && !pre.validate.unavailable) || !pre.checks.ok || pre.blocked);
  /** Only the publish rules block (not the site's own checks): an editor may publish it anyway. */
  const onlyRules = () => !!pre && pre.blocked && !(pre.validate !== null && !pre.validate.ok && !pre.validate.unavailable) && pre.checks.ok;

  /** Publish and Schedule are off while a check blocks (the server refuses them too). */
  function blockedIf(b: HTMLButtonElement): HTMLButtonElement {
    if (blocked()) {
      b.disabled = true;
      b.title = 'A check above blocks publishing. Fix it first.';
    }
    return b;
  }

  // ---------- when ----------
  function whenCard(status: string): HTMLElement[] {
    const later = ctx.params().get('when') === 'later';
    const card: HTMLElement[] = [
      el('div.ms-adm-row', el('h2.ms-adm-h2', 'When'), el('div.ms-adm-seg', { role: 'group', 'aria-label': 'When' },
        seg('Now', !later, () => ctx.go({ params: { when: null } }, true)),
        status === 'published' ? null : seg('Later', later, () => ctx.go({ params: { when: 'later' } }, true)),
      )),
    ];
    if (later) {
      const pad = (n: number) => String(n).padStart(2, '0');
      const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      const at = el('input.ms-input', { type: 'datetime-local', name: 'publishAt', min: local(new Date(Date.now() + 60_000)), value: local(new Date(Date.now() + 3600_000)), 'aria-label': 'Publish at' });
      const err = el('p.ms-adm-form__err', { role: 'alert' });
      const atRow = el('div.ms-adm-row', at);
      echoDate(at);
      card.push(
        el('p.ms-adm-sub', `Your time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}. The server builds and publishes it then, with the same checks.`),
        atRow,
        err,
        el('div.ms-adm-row', blockedIf(button('Schedule', async () => {
          const t = new Date(at.value);
          if (!at.value || !Number.isFinite(t.getTime()) || t.getTime() <= Date.now()) return void (err.textContent = 'Pick a time in the future.');
          try {
            await api.schedule(c, id, pre?.version ?? entry!.version, t.toISOString());
            ctx.toast(`Scheduled for ${fmtDateTime(t)}.`, 'ok');
            entry = await api.getEntry(c, id);
            ctx.go({ params: { when: null } }, true);
          } catch (x) {
            err.textContent = conflictWords(x);
          }
        }, { kind: 'primary', icon: 'calendar' }))),
      );
      return card;
    }
    const go = blockedIf(button(status === 'published' ? 'Publish again' : 'Publish now', () => void run('publish'), { kind: 'primary', icon: 'rocket' }));
    const anyway = editorPlus && onlyRules() ? button('Publish anyway…', () => void run('anyway'), { icon: 'rocket' }) : null;
    card.push(
      el('div.ms-adm-row', go, anyway, el('span.ms-adm-grow'), status === 'scheduled' ? button('Cancel the schedule', () => void run('unschedule'), { kind: 'danger', icon: 'calendar' }) : status !== 'draft' ? button('Unpublish', () => void run('unpublish'), { kind: 'danger' }) : null),
      el('p.ms-adm-sub', blocked() ? 'A check above blocks publishing. Fix it in the editor, then run the checks again.' : status === 'published' ? 'It is live. Publishing again rebuilds its page with the saved text.' : 'Publishing saves it, runs the checks, builds the site and puts it live. If any step fails, the live site does not change.'),
    );
    return card;
  }

  async function run(kind: 'publish' | 'unpublish' | 'anyway' | 'unschedule'): Promise<void> {
    if (kind === 'unschedule') {
      const ok = await ctx.ask('Cancel the schedule?', 'It does not go live at that time. It is a draft again, with its text as it is; you can schedule it again or publish it now.', [['cancel', 'Keep the schedule'], ['go', 'Cancel the schedule', 'ms-btn ms-btn--danger']]);
      if (ok !== 'go') return;
      try {
        await api.unpublish(c, id, pre?.version ?? entry!.version);
        ctx.toast('The schedule is cancelled: it is a draft again.', 'ok');
        await load();
      } catch (e) {
        ctx.toast(conflictWords(e), 'error');
        if (e instanceof ApiError && e.status === 409) void load();
      }
      return;
    }
    if (kind === 'unpublish') {
      const ok = await ctx.ask('Unpublish?', 'Its page comes off the site in the next build (in every language and region). The text stays here as a draft.', [['cancel', 'Cancel'], ['go', 'Unpublish', 'ms-btn ms-btn--danger']]);
      if (ok !== 'go') return;
    }
    if (kind === 'anyway') {
      const ok = await ctx.ask('Publish past the publish rules?', 'It goes live as it is, though the rules above stop it. The audit log keeps who did it and which rules were passed over.', [['cancel', 'Cancel'], ['go', 'Publish anyway', 'ms-btn ms-btn--primary']]);
      if (ok !== 'go') return;
    }
    try {
      // the version the checks ran on: what was checked is what goes live (a newer save gets a 409 and a reload)
      const version = pre?.version ?? entry!.version;
      const r = kind === 'unpublish' ? await api.unpublish(c, id, version) : await api.publish(c, id, version, kind === 'anyway');
      ctx.go({ params: { job: r.job, when: null } });
    } catch (e) {
      ctx.toast(conflictWords(e), 'error');
      if (e instanceof ApiError && e.status === 409) void load();
      if (e instanceof ApiError && e.status === 422) void check();
    }
  }

  // ---------- the job, in place ----------
  function renderJob(jid: string): void {
    if (!panel || panel.jid !== jid) {
      panel?.p.destroy();
      const mine = { jid, done: null as api.Job | null, p: null as unknown as JobPanel };
      mine.p = jobPanel(jid, {
        quietSuccess: true,
        onEnd: (j) => {
          mine.done = j;
          void api.getEntry(c, id).then((x) => {
            entry = x;
            return api.addresses(c, id).then((r) => (liveList = r.addresses), () => null);
          }).finally(() => alive && panel === mine && renderJob(jid));
        },
      });
      panel = mine;
    }
    const done = panel.done;
    const end = !done
      ? null
      : done.status === 'succeeded'
        ? liveCard(done.kind, liveList ?? pre?.addresses ?? (entry?.url ? [{ locale: null, path: entry.url, url: null }] : []), done.id,
            button('Back to the entry', () => ctx.open(`#/e/${encodeURIComponent(c)}/${encodeURIComponent(id)}`), { icon: 'article' }), button('All publishing', () => ctx.open('#/jobs'), { kind: 'quiet', icon: 'log' }))
        : el('section.ms-adm-card', el('div.ms-adm-row', button('Back to the entry', () => ctx.open(`#/e/${encodeURIComponent(c)}/${encodeURIComponent(id)}`), { icon: 'article' }), button('Check it again', () => ctx.go({ params: { job: null } }), { kind: 'quiet', icon: 'refresh' })));
    sheet = null;
    p.body.replaceChildren(...(end ? [end] : []), panel.p.el);
  }

  void load();
  return {
    update: () => {
      // back from job=… to the sheet: check again (the text may have changed)
      if (!ctx.params().get('job') && panel) {
        render();
        void check();
        return;
      }
      render();
    },
    destroy: () => {
      alive = false;
      phone?.destroy();
      panel?.p.destroy();
    },
  };
}

function seg(label: string, on: boolean, go: () => void): HTMLButtonElement {
  const b = el('button.ms-adm-seg__btn', { type: 'button', 'aria-pressed': on ? 'true' : 'false' }, label);
  b.addEventListener('click', go);
  return b;
}

const conflictWords = (e: unknown) => (e instanceof ApiError && e.status === 409 ? 'The entry changed since this sheet opened. It has been reloaded: try again.' : message(e));
