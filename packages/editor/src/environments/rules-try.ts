// The rules' dry run: "What would happen if Sam promoted this?" A person, an action, from and to, the files it would
// change, a time and a reason; the answer is what the rules say (the unsaved ones when there are changes), the rule
// that decided, what is missing, and each rule's part in it. The question is in the URL (?as=&action=&from=&to=
// &files=&at=&reason=), so a link opens the same answer.
import type { ScreenCtx } from '../host';
import { button, el, message } from '../admin/ui';
import * as api from './api';
import { ACTION_WORDS, envWord, list as inWords } from './words';

const KEYS = ['as', 'action', 'from', 'to', 'files', 'at', 'reason', 'checks'] as const;
const CHECKS: [string, string][] = [
  ['pass', 'All pass'],
  ['fail', 'One fails'],
  ['', 'Not run yet'],
];

function pick(id: string, label: string, options: [string, string][], val: string): HTMLElement {
  const s = el('select.ms-input.ms-adm-select', { id, name: id });
  for (const [v, l] of options) s.append(el('option', { value: v, selected: v === val }, l));
  return el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: id }, label), s);
}

export function mountTry(ctx: ScreenCtx, view: api.RulesView, unsaved: () => api.RulesDoc | null): { el: HTMLElement; destroy(): void } {
  const q = ctx.params();
  const get = (k: (typeof KEYS)[number], d = '') => q.get(k) ?? d;
  const places: [string, string][] = [['branch', 'a branch'], ['local', 'a laptop'], ...view.envs.map((e): [string, string] => [e, envWord(e)])];
  const people: [string, string][] = view.people.map((u) => [u.id, `${u.name} (${u.role})`]);
  const files = el('textarea.ms-input', { id: 'try-files', name: 'try-files', rows: '3', spellcheck: 'false', placeholder: 'src/layouts/page.astro\nsrc/content/pages/about.json' });
  files.value = get('files');
  const at = el('input.ms-input', { id: 'try-at', name: 'try-at', type: 'datetime-local' });
  const atIso = get('at');
  if (atIso && Number.isFinite(Date.parse(atIso))) {
    const t = Date.parse(atIso);
    at.value = new Date(t - new Date(t).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }
  const reason = el('input.ms-input', { id: 'try-reason', name: 'try-reason', maxlength: '500', placeholder: 'Optional' });
  reason.value = get('reason');
  const out = el('div.ms-env-try__out', { 'aria-live': 'polite' });
  const box = el('section.ms-adm-card.ms-env-try', { id: 'try' },
    el('h3.ms-adm-h3', 'What would happen if…'),
    el('p.ms-adm-sub', 'Ask the rules about one person and one change. With unsaved changes, it uses them.'),
    el('div.ms-env-try__grid',
      pick('try-as', 'Person', people, get('as', people[0]?.[0] ?? '')),
      pick('try-action', 'Does', view.actions.map((a): [string, string] => [a, ACTION_WORDS[a] ?? a]), get('action', 'promote')),
      pick('try-from', 'From', places, get('from', 'staging')),
      pick('try-to', 'To', places.filter(([v]) => v !== 'branch' && v !== 'local'), get('to', 'production')),
    ),
    el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: 'try-files' }, 'Files it changes (one per line; empty: not known yet)'), files),
    el('div.ms-env-try__grid', el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: 'try-at' }, 'When (empty: now)'), at), el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: 'try-reason' }, 'Reason'), reason), pick('try-checks', 'The checks', CHECKS, get('checks', 'pass'))),
    el('div.ms-adm-actions', button('Ask the rules', () => ask(), { kind: 'primary' })),
    out,
  );
  const val = (id: string) => box.querySelector<HTMLSelectElement>(`#${id}`)!.value;
  let alive = true;

  /** The question into the URL; the screen draws again and answers it from there. */
  function ask(): void {
    const params: Record<string, string | null> = {
      as: val('try-as') || null,
      action: val('try-action'),
      from: val('try-from'),
      to: val('try-to'),
      files: files.value.trim() || null,
      at: at.value ? new Date(at.value).toISOString() : null,
      reason: reason.value.trim() || null,
      checks: val('try-checks') || null,
    };
    // the same question asks again in place (the URL does not change)
    if (KEYS.every((k) => (params[k] ?? null) === (ctx.params().get(k) ?? null))) return void answer();
    ctx.go({ params }, true);
  }

  async function answer(): Promise<void> {
    const p = ctx.params();
    out.replaceChildren(el('p.ms-adm-sub', 'Asking…'));
    try {
      const list = (p.get('files') ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
      const rules = unsaved();
      // the checks as asked: every named check passed, or failed (with the build), or not run yet
      const named = [...new Set([...(rules ?? view).rules.flatMap((x) => (Array.isArray(x.requires?.checks) ? x.requires.checks : [])), 'build'])];
      const c = p.get('checks');
      const checks = c === 'pass' ? { done: true, passed: named, failed: [] } : c === 'fail' ? { done: true, passed: [], failed: named } : undefined;
      const r = await api.checkRules({ action: p.get('action')!, from: p.get('from') ?? undefined, to: p.get('to') ?? undefined, userId: p.get('as') ?? undefined, files: list.length ? list : undefined, at: p.get('at') ?? undefined, reason: p.get('reason') ?? undefined, checks, ...(rules ? { rules } : {}) });
      if (!alive) return;
      const tone = r.effect === 'allow' ? '.is-ok' : r.effect === 'deny' ? '.is-bad' : '';
      const who = r.user?.name ?? 'They';
      const trace = el('table.ms-adm-table', el('thead', el('tr', el('th', 'Rule'), el('th', 'Applies'), el('th', 'Why'))), el('tbody', ...r.trace.map((t) => el(`tr${t.matched ? '.is-open' : ''}`, el('td', view.rules.find((x) => x.id === t.rule)?.name ?? rules?.rules.find((x) => x.id === t.rule)?.name ?? t.rule), el('td', t.matched ? 'Yes' : 'No'), el('td', t.why)))));
      out.replaceChildren(
        // each thing said once: what is missing, or the rules' own words
        el(
          `div.ms-adm-outcome${tone}`,
          el('strong', r.effect === 'allow' ? `${who} may. ` : r.effect === 'deny' ? `${who} may not. ` : `${who} may once it has ${inWords(r.missing.map((m) => m.words), 'and')}. `),
          r.effect === 'needs' && r.missing.length ? (r.rule ? `Rule: ${r.rule.name}.` : '') : r.words,
          rules ? el('span.ms-adm-sub', ' (with your unsaved changes)') : '',
        ),
        r.files?.length ? el('p.ms-adm-sub', 'The files read as: ', r.files.map((f) => `${f.path} (${f.kinds.join(', ')})`).join('; ')) : '',
        el('details.ms-env-trace', el('summary', 'Each rule’s part'), trace),
      );
    } catch (e) {
      if (alive) out.replaceChildren(el('p.ms-adm-note.is-bad', message(e)));
    }
  }

  if (ctx.params().get('action')) void answer();
  return { el: box, destroy: () => (alive = false) };
}
