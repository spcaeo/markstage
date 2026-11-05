// The Import screen's plan, run and report: #/import/<rid>?show=summary|entries|media|review|redirects&q=&kind=
// The dry run's plan in plain words with its choices (a taken address, the mapping), then the run as a background
// job with its steps, then what it did, with the review list linking to each entry and picture to look at.
import type { ScreenCtx } from '../../host';
import { config } from '../../runtime';
import { copyable } from '../../copy';
import { job as getJob, type Job } from '../api';
import { button, chips, el, failure, message, searchBox, select, state } from '../ui';
import * as api from './api';
import { ACTION_WORD, COLLISION_WORD, PRODUCT, count, planLines, planSentence, resultLines, reviewKind } from './words';

const ROLE_LABEL: Record<string, string> = { title: 'Title', date: 'Date', updated: 'Updated', author: 'Author', tags: 'Tags', categories: 'Categories', excerpt: 'Excerpt', cover: 'Cover image', coverAlt: 'Cover alt text', seoTitle: 'Search title', seoDescription: 'Search description', body: 'Text', url: 'Address', sections: 'Sections' };
const STEP_WORD: Record<string, string> = { media: 'Images and files', authors: 'Authors', entries: 'Pages and posts', redirects: 'Old addresses' };

/** A site path with copy and open (on the site); a full address with both too. */
const address = (u: string, label: string) => copyable(u, { label, open: /^https?:/.test(u) ? u : config().siteUrl ? new URL(u, config().siteUrl).href : undefined });

export interface PlanView {
  update(): void;
  destroy(): void;
}

export function planView(body: HTMLElement, actions: HTMLElement, bar: HTMLElement, ctx: ScreenCtx, rid: string, setHead: (title: string, intro: string) => void): PlanView {
  let data: api.RunState | null = null;
  let job: Job | null = null;
  let alive = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // a run started or watched here: when it ends, one toast says how (the page already says it is running)
  let watching = false;

  async function load(): Promise<void> {
    try {
      data = await api.getRun(rid);
      if (data.run.kind !== 'site' || data.plan.kind !== 'site') return void body.replaceChildren(state('denied', 'Not available here', 'This import came through the API; its result is in Scheduled & history.'));
      if (data.run.job) job = await getJob(data.run.job);
    } catch (e) {
      return void body.replaceChildren(failure(e, () => void load()));
    }
    if (!alive) return;
    if (data.run.status === 'running') watching = true;
    else if (watching) {
      watching = false;
      if (data.run.status === 'done') ctx.toast('The import is done.', 'ok');
      else if (data.run.status === 'failed') ctx.toast('The import did not finish. Its log says why.', 'error');
    }
    render();
    if (data.run.status === 'running') timer = setTimeout(() => void load(), 1000);
  }

  function render(): void {
    if (!data) return;
    const { run, plan, result } = data;
    setHead(`Import from ${PRODUCT[plan.product]}`, `${plan.name}${plan.site.url ? ` · ${plan.site.url}` : ''}`);
    actions.replaceChildren();
    bar.hidden = true;
    if (run.status === 'expired') return void body.replaceChildren(state('empty', 'This plan is more than an hour old', 'Make it again, so it shows what the import would do now.', button('Start again', () => ctx.open(`#/import?source=${plan.product}`, true), { icon: 'refresh' })));
    if (run.status === 'replaced') return void body.replaceChildren(state('empty', 'This plan was made again', 'Another mapping replaced it. Its newer plan is in the list of imports.', button('See the imports', () => ctx.open('#/import', true))));
    if (run.status === 'running' || (run.status === 'failed' && !result)) return void body.replaceChildren(progress(run));
    const show = ctx.params().get('show') || 'summary';
    const review = result?.review ?? plan.review;
    const entries = result?.entries ?? plan.items;
    const media = result?.media ?? plan.media;
    bar.hidden = false;
    bar.replaceChildren(
      chips(ctx, 'show', 'Show', [['', 'Summary'], ['entries', `Pages and posts (${entries.length})`], ['media', `Images and files (${media.length})`], ['review', `To review (${review.length})`], ['redirects', `Old addresses (${plan.counts.redirects + plan.counts.ids})`]]),
      ...(show !== 'summary' && show !== 'redirects' ? [searchBox(ctx, 'q', 'Search')] : []),
    );
    if (run.status === 'planned') actions.replaceChildren(button('Start again', () => ctx.open(`#/import?source=${plan.product}`, true), { kind: 'quiet' }), button('Run the import', () => void start(), { kind: 'primary', icon: 'upload' }));
    const q = (ctx.params().get('q') ?? '').toLowerCase();
    const parts: HTMLElement[] = [];
    if (show === 'summary') parts.push(...(result ? report(plan, result, run) : summary(plan)));
    else if (show === 'entries') parts.push(entryTable(entries.filter((e) => !q || `${e.title} ${e.id ?? ''} ${e.type}`.toLowerCase().includes(q)), !!result));
    else if (show === 'media') parts.push(mediaTable(media.filter((m) => !q || m.url.toLowerCase().includes(q))));
    else if (show === 'review') parts.push(...reviewList(review, q, plan));
    else parts.push(redirectTable(plan));
    body.replaceChildren(...parts);
  }

  /** The dry run: the sentence, what it would do, and its choices. */
  function summary(plan: api.SitePlan): HTMLElement[] {
    const out: HTMLElement[] = [
      el('section.ms-adm-card.ms-imp-plan', el('p.ms-imp-sentence', planSentence(plan)), el('ul.ms-imp-lines', ...planLines(plan).map((l) => el('li', l))), el('p.ms-adm-sub', 'This is a dry run: nothing is written until you choose Run the import. Each step is its own change in the site’s history, by you.')),
    ];
    if (plan.counts.collisions) {
      const row = el('div.ms-adm-row');
      for (const k of ['both', 'skip', 'replace'] as api.Collision[]) row.append(button(COLLISION_WORD[k][0].toUpperCase() + COLLISION_WORD[k].slice(1), () => void again({ onCollision: k }), { kind: k === plan.mapping.onCollision ? 'primary' : undefined, small: true }));
      out.push(el('section.ms-adm-card', el('h2.ms-adm-h3', `${count(plan.counts.collisions, 'address is', 'addresses are')} already taken`), el('p.ms-adm-sub', 'Keep both (the new one gets -2 at the end), skip the new one, or replace what is there with it.'), row));
    }
    out.push(mappingCard(plan));
    return out;
  }

  /** Which collection each kind goes to, and which key each field is written to. */
  function mappingCard(plan: api.SitePlan): HTMLElement {
    const box = el('form.ms-adm-form.ms-imp-mapping', { novalidate: true });
    const opts: [string, string][] = [['', 'Leave out'], ...plan.collections.map((c) => [c.id, c.label] as [string, string])];
    for (const [t, n] of Object.entries(plan.counts.types)) box.append(select(`type:${t}`, `${count(n, t.replace(/_/g, ' '), `${t.replace(/_/g, ' ')}s`)} ${n === 1 ? 'goes' : 'go'} to`, opts, plan.mapping.types[t] ?? ''));
    for (const [cid, keys] of Object.entries(plan.mapping.fields)) {
      const c = plan.collections.find((x) => x.id === cid);
      const grid = el('div.ms-imp-keys');
      for (const [role, key] of Object.entries(keys)) {
        const id = `ms-imp-${cid}-${role}`;
        const input = el('input.ms-input', { id, name: `field:${cid}:${role}`, value: key ?? '', placeholder: 'left out', spellcheck: 'false', autocomplete: 'off' });
        grid.append(el('label.ms-imp-key', { for: id }, el('span', ROLE_LABEL[role] ?? role), input));
      }
      box.append(el('details.ms-imp-fields', el('summary', `Fields of ${c?.label ?? cid}`), el('p.ms-adm-sub', 'The frontmatter (or JSON) key each field is written to. Empty leaves it out.'), grid));
    }
    box.append(select('drafts', 'Drafts, in a collection without drafts', [['skip', 'Leave them out'], ['include', 'Bring them in too']], plan.mapping.drafts), select('media', 'Images and files', [['used', 'The ones the pages use'], ['all', 'Every one in the export']], plan.mapping.media));
    const err = el('p.ms-adm-form__err', { role: 'alert' });
    box.append(err, el('div.ms-adm-form__tools', button('Plan again with these', () => box.requestSubmit(), { icon: 'refresh' })));
    box.addEventListener('submit', (e) => {
      e.preventDefault();
      const m: Partial<api.Mapping> & { types: Record<string, string | null>; fields: Record<string, api.FieldKeys> } = { types: {}, fields: {} };
      for (const s of box.querySelectorAll<HTMLSelectElement | HTMLInputElement>('[name]')) {
        const [kind, a, b] = s.name.split(':');
        if (kind === 'type') m.types[a] = s.value || null;
        else if (kind === 'field') (m.fields[a] ??= {})[b] = s.value.trim() || null;
        else if (s.name === 'drafts') m.drafts = s.value as 'skip' | 'include';
        else if (s.name === 'media') m.media = s.value as 'used' | 'all';
      }
      void again({ ...m, onCollision: plan.mapping.onCollision }, err);
    });
    return el('section.ms-adm-card', el('h2.ms-adm-h3', 'Where it goes'), el('p.ms-adm-sub', 'Read from your site’s settings. Change any of it and plan again.'), box);
  }

  async function again(mapping: Partial<api.Mapping>, err?: HTMLElement): Promise<void> {
    if (!data) return;
    try {
      const r = await api.replan(rid, { ...data.plan.mapping, ...mapping });
      ctx.open(`#/import/${encodeURIComponent(r.run.id)}`, false);
    } catch (e) {
      if (err) err.textContent = message(e);
      else ctx.toast(message(e), 'error');
    }
  }

  async function start(): Promise<void> {
    try {
      await api.runImport(rid);
      watching = true;
      ctx.go({ params: { show: null, q: null } }, false);
      await load();
    } catch (e) {
      ctx.toast(message(e), 'error');
    }
  }

  /** The run's steps, live. */
  function progress(run: api.RunInfo): HTMLElement {
    const steps = el('ol.ms-adm-steps');
    const names = ['media', 'authors', 'entries', 'redirects'];
    for (const n of names) {
      const s = job?.steps.find((x) => x.name === n);
      steps.append(el(`li.ms-adm-step.is-${s?.status ?? 'waiting'}`, el('span.ms-adm-step__dot', { 'aria-hidden': 'true' }), STEP_WORD[n], s ? el('span.ms-adm-sub', s.status === 'succeeded' ? ' done' : s.status === 'running' ? ' now' : ` ${s.status}`) : null));
    }
    const follow = run.job ? el('a', { href: `#/jobs/${encodeURIComponent(run.job)}` }, 'Follow it in Scheduled & history') : null;
    if (run.status === 'failed') return el('section.ms-adm-card', state('error', 'The import did not finish', job?.error ?? 'See its log.'), steps, follow);
    return el('section.ms-adm-card', { 'aria-live': 'polite' }, el('h2.ms-adm-h3', 'Importing…'), steps, el('p.ms-adm-sub', 'It runs in the background; you can leave this page.'), follow);
  }

  /** What the run did. */
  function report(plan: api.SitePlan, r: api.SiteResult, run: api.RunInfo): HTMLElement[] {
    const needAlt = r.review.filter((x) => x.kind === 'alt').length;
    const links = el('div.ms-adm-row',
      r.review.length ? button(`See the review list (${r.review.length})`, () => ctx.go({ params: { show: 'review' } }, true), { kind: 'primary' }) : null,
      needAlt ? button(`Add alt text (${needAlt})`, () => ctx.open('#/media?show=no-alt', true), { icon: 'image' }) : null,
      r.entries[0] ? button('Open the pages', () => ctx.open(`#/entries?c=${encodeURIComponent(r.entries[0].collection)}`, true), { icon: 'table' }) : null,
      run.job ? el('a', { href: `#/jobs/${encodeURIComponent(run.job)}` }, 'The job’s log') : null,
    );
    return [el('section.ms-adm-card.ms-imp-plan', el('h2.ms-adm-h3', 'The import is done'), el('ul.ms-imp-lines', ...resultLines(r, plan.product).map((l) => el('li', l))), links)];
  }

  function entryLink(e: { collection: string; id: string | null; title: string; action: string }): HTMLElement {
    if (!e.id || e.action === 'skip' || !data?.result) return el('span', e.title || '(no title)');
    return el('a', { href: `#/e/${encodeURIComponent(e.collection)}/${encodeURIComponent(e.id)}` }, e.title || e.id);
  }

  function entryTable(rows: (api.PlanItem & { kept?: number })[], done: boolean): HTMLElement {
    if (!rows.length) return state('empty', 'Nothing matches', 'Try another search.');
    const tb = el('tbody');
    for (const e of rows)
      tb.append(el('tr', el('td', el('div.ms-adm-stack', entryLink(e), e.problem ? el('span.ms-adm-sub', e.problem) : null)), el('td', e.type.replace(/_/g, ' ')), el('td', e.sourceStatus), el('td', e.id ? `${e.collection}/${e.id}` : '—'), el('td', e.url ? address(e.url, 'new address') : el('span.ms-adm-none', '—')), el('td', ACTION_WORD[e.action] ?? e.action), el('td', String(e.notes))));
    return el('section.ms-adm-card.ms-adm-card--flush', el('table.ms-adm-table', el('thead', el('tr', el('th', 'Title'), el('th', 'Kind'), el('th', `In ${data ? PRODUCT[data.plan.product] : 'the source'}`), el('th', 'Here'), el('th', 'Address'), el('th', done ? 'Done' : 'Will'), el('th', 'Notes'))), tb));
  }

  function mediaTable(rows: (api.PlanMedia | api.SiteResult['media'][number])[]): HTMLElement {
    if (!rows.length) return state('empty', 'No images or files', 'The pages use none from the old site.');
    const tb = el('tbody');
    for (const m of rows) {
      const id = 'id' in m ? m.id : undefined;
      const name = m.url.split('/').pop()?.split('?')[0] ?? m.url;
      const here = id ? el('a', { href: `#/media?item=${encodeURIComponent(id)}` }, 'Open') : el('span.ms-adm-none', '—');
      tb.append(el('tr', el('td', el('div.ms-adm-stack', el('strong', name), address(m.url, 'old address'), m.problem ? el('span.ms-adm-sub', m.problem) : null)), el('td', m.alt ? 'Yes' : 'Needs alt text'), el('td', ACTION_WORD[m.action] ?? m.action), el('td', here)));
    }
    return el('section.ms-adm-card.ms-adm-card--flush', el('table.ms-adm-table', el('thead', el('tr', el('th', 'File'), el('th', 'Alt text'), el('th', data?.result ? 'Done' : 'Will'), el('th', 'In the library'))), tb));
  }

  function reviewList(rows: api.ReviewItem[], q: string, plan: api.SitePlan): HTMLElement[] {
    const kinds = [...new Set(rows.map((r) => r.kind))];
    const kind = ctx.params().get('kind') ?? '';
    const filterRow = kinds.length > 1 ? chips(ctx, 'kind', 'Kind', [['', 'All'], ...kinds.map((k) => [k, `${reviewKind(k)} (${rows.filter((r) => r.kind === k).length})`] as [string, string])]) : null;
    const items = plan.items;
    const shown = rows.filter((r) => (!kind || r.kind === kind) && (!q || r.text.toLowerCase().includes(q)));
    const list = el('ul.ms-imp-review');
    for (const r of shown.slice(0, 1000)) {
      const entry = typeof r.entry === 'string' ? items.find((i) => i.sourceId === r.entry) : r.entry;
      const where = entry ? (typeof r.entry === 'object' ? entryLink({ ...r.entry, action: r.entry.id ? 'create' : 'skip' }) : el('span', entry.title)) : null;
      const mid = typeof r.media === 'object' ? r.media.id : null;
      list.append(el('li', el('span.ms-adm-badge', reviewKind(r.kind)), el('span.ms-imp-review__text', r.text), where ? el('span.ms-adm-sub', ' in ', where) : null, mid ? el('a', { href: `#/media?item=${encodeURIComponent(mid)}` }, ' Open the picture') : null));
    }
    const note = el('p.ms-adm-sub', `Where something could not be converted, the text says “${plan.placeholder} …”, so a search for it in Change many at once finds them all.`);
    return [...(filterRow ? [filterRow] : []), note, shown.length ? el('section.ms-adm-card', list, shown.length > 1000 ? el('p.ms-adm-sub', `The first 1,000 of ${shown.length.toLocaleString('en-US')}.`) : null) : state('empty', rows.length ? 'Nothing matches' : 'Nothing to review', rows.length ? 'Try another kind or search.' : 'Everything came over as it was.')];
  }

  function redirectTable(plan: api.SitePlan): HTMLElement {
    const tb = el('tbody');
    for (const r of plan.redirects) tb.append(el('tr', el('td', address(r.from, 'old address')), el('td', address(r.to, 'new address'))));
    const where = plan.hook ? 'They are added to the site’s redirects and go live with the next publish.' : `This site has no redirects hook: they are kept in ${plan.idsFile} for whoever runs the site.`;
    return el('div',
      el('p.ms-adm-sub', `${where} Old links by id (?p=, ?page_id=, ?attachment_id=: ${plan.counts.ids.toLocaleString('en-US')}) are kept in ${plan.idsFile}, since a static host cannot match an address by its query.`),
      plan.redirects.length ? el('section.ms-adm-card.ms-adm-card--flush', el('table.ms-adm-table', el('thead', el('tr', el('th', 'Old address'), el('th', 'Goes to'))), tb)) : state('empty', 'No old paths to send on', 'The pages keep their addresses.'),
    );
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
