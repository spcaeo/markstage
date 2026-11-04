// #/releases?status=<status>&do=new: the releases, newest first, filtered by status; "New release…" (editors and
// above) opens its panel (do=new), and the release made opens at #/releases/<id>.
import type { ScreenCtx } from '../host';
import type { BuildBlocked } from '../admin/api';
import { buildBlockedLine, button, chips, drawer, el, failure, field, form, isEditorPlus, page, state, value, when, whoami } from '../admin/ui';
import * as api from './api';
import { STATUS_WORDS, countWords, whenWords } from './words';

const NUM = new Intl.NumberFormat('en-GB');

/** A labelled text box of a few lines, for a form() (its value is the trimmed text). */
export function textArea(name: string, label: string, val: string, maxlength = 2000): HTMLElement {
  const id = `ms-rel-${name}-${Math.random().toString(36).slice(2, 7)}`;
  const t = el('textarea.ms-input', { id, name, rows: '3', maxlength: String(maxlength) });
  t.value = val;
  return el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: id }, label), t, el('p.ms-adm-field__err', { 'data-err': name, role: 'alert' }));
}

export function statusBadge(r: Pick<api.Release, 'status' | 'blocked'>): HTMLElement {
  const tone = r.blocked ? '.is-bad' : r.status === 'published' ? '.ms-adm-badge--ok' : r.status === 'scheduled' || r.status === 'publishing' ? '.ms-rel-badge--soon' : '';
  return el(`span.ms-adm-badge.ms-rel-status.ms-rel-status--${r.status}${tone}`, r.blocked ? 'Blocked' : STATUS_WORDS[r.status]);
}

export function mountList(host: HTMLElement, ctx: ScreenCtx) {
  let alive = true;
  let rows: api.Release[] | null = null;
  let buildBlocked: BuildBlocked | null = null;
  let editor = false;
  let loadedFor: string | null = null;

  async function load(): Promise<void> {
    const status = ctx.params().get('status') ?? '';
    loadedFor = status;
    try {
      const [me, r] = await Promise.all([whoami(), api.list(api.STATUSES.includes(status as api.ReleaseStatus) ? status : '')]);
      if (!alive || loadedFor !== status) return;
      editor = isEditorPlus(me);
      rows = r.releases;
      buildBlocked = r.buildBlocked ?? null;
      draw();
    } catch (e) {
      if (alive) page(host, 'Go live', '').body.replaceChildren(failure(e, () => void load()));
    }
  }

  function draw(): void {
    ctx.setTitle('Go live');
    const p = page(host, 'Go live', 'Changes that go live together, in one go: now, or at a time you choose. Until then the site does not change, and a preview shows them as they will be.');
    if (editor) p.actions.replaceChildren(button('New release…', () => ctx.go({ params: { do: 'new' } }, true), { kind: 'primary', icon: 'plus' }));
    p.bar.hidden = false;
    p.bar.replaceChildren(chips(ctx, 'status', 'Status', [['', 'All'], ...api.STATUSES.filter((s) => s !== 'publishing').map((s): [string, string] => [s, STATUS_WORDS[s]])]));
    const layout = el('div.ms-adm-split');
    const main = el('div.ms-adm-split__main');
    layout.append(main);
    const blocked = buildBlockedLine(buildBlocked);
    p.body.replaceChildren(...(blocked ? [blocked] : []), layout);
    if (!rows!.length) {
      const status = ctx.params().get('status');
      main.append(state('empty', status ? `No ${STATUS_WORDS[status as api.ReleaseStatus]?.toLowerCase() ?? ''} releases` : 'No releases yet', editor ? 'Make one, then put pages in it from the editor: More → Add to a release.' : 'An editor makes releases.'));
    } else {
      const tb = el('tbody');
      for (const r of rows!) {
        tb.append(
          el(
            'tr',
            el('td', el('a.ms-rel-name', { href: `#/releases/${encodeURIComponent(r.id)}` }, r.name), r.description ? el('div.ms-adm-sub.ms-rel-desc', r.description) : ''),
            el('td', statusBadge(r), whenWords(r) ? el('div.ms-adm-sub', whenWords(r)) : ''),
            el('td', countWords(r.counts)),
            el('td.ms-num', NUM.format(r.counts.items)),
            el('td', r.createdBy.name ? value(r.createdBy.name, 'name') : '—'),
            el('td', when(r.updatedAt)),
          ),
        );
      }
      main.append(el('table.ms-adm-table.ms-adm-table--rows.ms-rel-table', el('thead', el('tr', el('th', 'Release'), el('th', 'Status'), el('th', 'What is in it'), el('th.ms-num', 'Items'), el('th', 'Made by'), el('th', 'Changed'))), tb));
    }
    if (ctx.params().get('do') === 'new') newPanel(layout);
  }

  function newPanel(layout: HTMLElement): void {
    const close = () => ctx.go({ params: { do: null } }, true);
    const d = drawer(layout, 'New release', close);
    if (!editor) return void d.body.append(state('denied', 'Not available to you', 'Editors and above make releases.'));
    d.body.append(
      el('p.ms-adm-sub', 'Give it a name people will know it by, like the launch or the change it is for.'),
      form(
        [field('name', 'Name', { required: true, maxlength: 120, placeholder: 'Spring pricing' }), textArea('description', 'What it is for (optional)', '')],
        'Make the release',
        async (v) => {
          const made = await api.make({ name: v.name, description: v.description || undefined });
          ctx.toast(`Made “${made.name}”.`, 'ok');
          ctx.open(`#/releases/${encodeURIComponent(made.id)}`, false);
        },
        { kind: 'primary' },
      ),
    );
    d.body.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
  }

  page(host, 'Go live', '').body.replaceChildren(state('loading', 'Loading the releases…'));
  void load();
  return {
    update(next: ScreenCtx) {
      ctx = next;
      if ((ctx.params().get('status') ?? '') !== loadedFor) void load();
      else if (rows) draw();
    },
    destroy() {
      alive = false;
    },
  };
}
