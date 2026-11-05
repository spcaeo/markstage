// Translate the site with AI (docs/API-TRANSLATIONS.md "AI drafts of a whole site"), opened from the Languages
// screen. Every state is its URL:
//   #/translate?to=<code>&only=<collection,…>&all=1   the choices (a region, the collections, include translated)
//   #/translate/<rid>?show=<tab>                       the plan (a dry run), the run as it goes, then its report
// Off while AI is off, saying why, as every AI button does. The server decides who may (editors and up, or a role
// that writes the region's words) and checks each entry as its save would be.
import { ApiError } from '../api';
import type { ScreenCtx } from '../host';
import { button, el, failure, message, page, state, when } from '../admin/ui';
import { makePlan, startInfo, type RunStatus, type StartInfo } from './site-api';
import { runView, type RunView } from './site-run';

export const STATUS_WORD: Record<RunStatus, string> = { planned: 'Planned', expired: 'Plan expired', running: 'Running', paused: 'Paused', cancelled: 'Cancelled', done: 'Done' };
const NUM = new Intl.NumberFormat('en-US');

export function mountTranslateSite(host: HTMLElement, ctx: ScreenCtx) {
  const p = page(host, 'Translate the site', 'An AI draft of every page’s title and description in one region, for people to review. You see the plan before anything is asked or written.');
  p.root.classList.add('ms-trs');
  const setHead = (title: string, intro: string) => {
    p.head.querySelector('.ms-adm-title')!.textContent = title;
    const i = p.head.querySelector('.ms-adm-intro');
    if (i) i.textContent = intro;
    ctx.setTitle(title);
  };
  let view: RunView | null = null;
  let info: StartInfo | null = null;
  let alive = true;
  /** the params the form itself last wrote: no redraw for those (the focus stays where it is) */
  let own = '';

  async function draw(): Promise<void> {
    view?.destroy();
    view = null;
    const rid = ctx.args[0];
    if (rid) {
      view = runView(p, ctx, rid, setHead);
      return;
    }
    p.actions.replaceChildren();
    p.bar.hidden = true;
    setHead('Translate the site', 'An AI draft of every page’s title and description in one region, for people to review. You see the plan before anything is asked or written.');
    if (!info) p.body.replaceChildren(state('loading', 'Loading…'));
    try {
      info = await startInfo();
    } catch (e) {
      if (alive) p.body.replaceChildren(e instanceof ApiError && e.status === 403 ? state('denied', 'Not available to you', e.message) : failure(e, () => void draw()));
      return;
    }
    if (!alive || ctx.args[0]) return;
    if (!info.ai.on) return void p.body.replaceChildren(state('empty', 'AI is off', info.ai.why ?? 'AI suggestions are off on this server.'));
    if (!info.locales.length) return void p.body.replaceChildren(state('empty', 'No region to translate into', 'Every page uses the same words in every region. A region whose config lists title or description in its `overrides` gets its own.'));
    p.body.replaceChildren(choices(info), earlier(info));
  }

  /** The form: its values are the URL's (to, only, all), so a link opens it as it was. */
  function choices(i: StartInfo): HTMLElement {
    const q = ctx.params();
    const to = q.get('to') && i.locales.some((l) => l.code === q.get('to')) ? q.get('to')! : i.locales[0].code;
    const offered = i.collections.filter((c) => c.offered);
    const only = q.get('only') ? q.get('only')!.split(',').filter((x) => offered.some((c) => c.id === x)) : null;
    const f = el('form.ms-adm-form.ms-trs-form', { novalidate: true });
    const region = el('select.ms-input', { id: 'ms-trs-to', name: 'to' }, ...i.locales.map((l) => el('option', { value: l.code, selected: l.code === to }, `${l.label} (${l.code})`)));
    const boxes = el('fieldset.ms-trs-cols', el('legend', 'What to include'));
    for (const c of i.collections) {
      const id = `ms-trs-c-${c.id}`;
      const box = el('input', { type: 'checkbox', id, name: 'only', value: c.id, checked: c.offered && (!only || only.includes(c.id)), disabled: !c.offered });
      boxes.append(el('label.ms-trs-col', { for: id }, box, el('span', c.label), c.why ? el('span.ms-adm-sub', ` ${c.why}`) : null));
    }
    const skip = el('input', { type: 'checkbox', id: 'ms-trs-skip', name: 'skip', checked: q.get('all') !== '1' });
    const err = el('p.ms-adm-form__err', { role: 'alert' });
    const plan = button('Plan it', () => f.requestSubmit(), { kind: 'primary', icon: 'globe' });
    f.append(
      el('div.ms-adm-field', el('label', { for: 'ms-trs-to' }, 'Translate into'), region),
      boxes,
      el('label.ms-trs-col', { for: 'ms-trs-skip' }, skip, el('span', 'Skip entries that have their own words in that region already'), el('span.ms-adm-sub', ' Unticked, a draft waits beside them for review; it never replaces them.')),
      err,
      el('div.ms-adm-form__tools', plan, el('span.ms-adm-sub', ' The plan asks the AI nothing and writes nothing.')),
    );
    const chosen = () => [...f.querySelectorAll<HTMLInputElement>('input[name="only"]:checked')].map((b) => b.value);
    // each choice is the URL's at once (no history entry per click), so Reload and a link keep it
    f.addEventListener('change', () => {
      const c = chosen();
      ctx.go({ params: { to: region.value === i.locales[0].code ? null : region.value, only: c.length === offered.length ? null : c.join(',') || '-', all: skip.checked ? null : '1' } });
      own = ctx.params().toString();
    });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const c = chosen();
      if (!c.length) return void (err.textContent = 'Choose at least one collection to include.');
      err.textContent = '';
      plan.disabled = true;
      makePlan({ locale: region.value, collections: c.length === offered.length ? null : c, skipExisting: skip.checked }).then(
        (r) => ctx.open(`#/translate/${encodeURIComponent(r.run.id)}`, true),
        (e2) => {
          plan.disabled = false;
          err.textContent = message(e2);
        },
      );
    });
    return el('section.ms-adm-card', el('h2.ms-adm-h3', 'Choose what to translate'), f);
  }

  function earlier(i: StartInfo): HTMLElement {
    if (!i.runs.length) return el('div', el('h2.ms-adm-h3', 'Earlier runs'), el('p.ms-adm-none', 'None yet.'));
    const tb = el('tbody');
    for (const r of i.runs) {
      tb.append(
        el('tr',
          el('td', el('a.ms-adm-rowlink', { href: `#/translate/${encodeURIComponent(r.id)}` }, r.locale.label)),
          el('td', STATUS_WORD[r.status] ?? r.status),
          el('td', NUM.format(r.status === 'planned' || r.status === 'expired' ? r.counts.draft : r.progress.created)),
          el('td', r.by?.name ?? '—'),
          el('td', when(r.createdAt)),
        ),
      );
    }
    return el('div', el('h2.ms-adm-h3', 'Earlier runs'), el('section.ms-adm-card.ms-adm-card--flush', el('table.ms-adm-table', el('thead', el('tr', el('th', 'Region'), el('th', 'Status'), el('th', 'Drafts'), el('th', 'By'), el('th', 'When'))), tb)));
  }

  void draw();
  return {
    update: () => {
      if (view) return view.update();
      if (ctx.params().toString() === own) return;
      // Back or Forward to other choices: the form shows them
      if (info?.ai.on && info.locales.length) p.body.replaceChildren(choices(info), earlier(info));
      else void draw();
    },
    destroy: () => {
      alive = false;
      view?.destroy();
    },
  };
}
