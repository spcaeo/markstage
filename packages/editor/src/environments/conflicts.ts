// A plan's conflicts (docs/ENVIRONMENTS.md "Conflicts"): each one named in words, with three ways out: keep this
// environment's version, take the incoming one, or open both side by side (?conflict=<id>) and write the text by
// hand. Nothing is merged silently: a plan with an open conflict cannot run.
import type { ScreenCtx } from '../host';
import { diffList, words } from '../admin/diff';
import { button, el, message, value } from '../admin/ui';
import * as api from './api';
import { sideWord } from './words';

const KIND_WORDS: Record<api.Conflict['kind'], string> = {
  text: 'Both changed it',
  blocks: 'Both changed the same parts',
  'removed-here': 'Removed here, changed there',
  'removed-incoming': 'Changed here, removed there',
  'added-both': 'Added on both sides',
};

export interface ConflictOpts {
  ctx: ScreenCtx;
  /** the server's answer after a choice: the plan as it is now, and the check job when none is left open */
  changed(plan: api.Plan, job: string | null): void;
}

const title = (c: api.Conflict) => c.entry ? `${c.entry.label}: “${c.entry.title}”` : c.path;

/** What was chosen, in words. */
function chosen(p: api.Plan, c: api.Conflict): string {
  if (!c.resolved) return 'Not decided yet';
  return c.take === 'ours' ? `Keeping ${sideWord(p, 'ours')} version` : c.take === 'theirs' ? `Taking ${sideWord(p, 'theirs')} version` : 'Your own text';
}

async function decide(p: api.Plan, c: api.Conflict, take: 'ours' | 'theirs' | 'text', o: ConflictOpts, text?: string): Promise<void> {
  try {
    const r = await api.resolve(p.id, { conflictId: c.id, take, text, version: p.version });
    o.ctx.toast(r.job ? 'Every conflict is decided: the plan is being checked again.' : `${title(c)}: decided.`, 'ok');
    o.changed(r.plan, r.job);
  } catch (e) {
    o.ctx.toast(message(e), 'error');
  }
}

/** The card with every conflict and its choices. */
export function conflictsCard(p: api.Plan, o: ConflictOpts): HTMLElement | null {
  if (!p.conflicts.length) return null;
  const open = p.conflicts.filter((c) => !c.resolved).length;
  const canChoose = p.status === 'conflicts' || p.status === 'blocked' || p.status === 'ready';
  const list = el('ul.ms-env-conflicts');
  for (const c of p.conflicts) {
    const tools = el('div.ms-adm-row');
    if (canChoose) {
      tools.append(
        button(`Keep ${sideWord(p, 'ours')}`, () => void decide(p, c, 'ours', o), { small: true, kind: c.take === 'ours' ? 'primary' : undefined }),
        button(`Take ${sideWord(p, 'theirs')}`, () => void decide(p, c, 'theirs', o), { small: true, kind: c.take === 'theirs' ? 'primary' : undefined }),
        button('Side by side', () => o.ctx.go({ params: { conflict: c.id } }, true), { small: true, kind: c.take === 'text' ? 'primary' : 'quiet', icon: 'sections' }),
      );
    }
    list.append(
      el(`li.ms-env-conflict${c.resolved ? '.is-done' : ''}`,
        el('div.ms-adm-row', el('strong', title(c)), el('span.ms-adm-badge', KIND_WORDS[c.kind] ?? c.kind), el('span.ms-adm-grow'), el(`span.ms-adm-badge${c.resolved ? '.ms-adm-badge--ok' : '.is-bad'}`, chosen(p, c))),
        el('p.ms-env-conflict__words', c.words),
        el('div.ms-adm-sub', value(c.path, 'file path', 'ms-adm-mono')),
        tools,
      ),
    );
  }
  return el('section.ms-adm-card.ms-env-conflicts-card', { id: 'conflicts' },
    el('div.ms-adm-row', el('h2.ms-adm-h2', open ? `${open} conflict${open === 1 ? '' : 's'} to decide` : 'Conflicts: all decided'), el('span.ms-adm-grow'), el('span.ms-adm-sub', `${p.conflicts.length} in all`)),
    el('p.ms-adm-sub', `Someone changed these on both sides. Keep ${sideWord(p, 'ours')} version, take ${sideWord(p, 'theirs')}, or open them side by side to write the text yourself.`),
    list,
  );
}

/** One line of a side, its changed words marked (each side drawn from its own words, so nothing is lost). */
function line(a: string | null, b: string | null, side: 'ours' | 'theirs'): HTMLElement {
  const mine = side === 'ours' ? a : b;
  if (mine === null) return el('div.ms-env-line.is-gap', ' ');
  const other = side === 'ours' ? b : a;
  if (other === mine) return el('div.ms-env-line', mine);
  const row = el(`div.ms-env-line.${side === 'ours' ? 'is-del' : 'is-ins'}`);
  if (other === null) return (row.append(mine), row);
  for (const o of diffList(words(a!), words(b!))) {
    if (o.op === 'same') row.append(o.a!);
    else if (o.op === 'del' && side === 'ours') row.append(el('del', o.a!));
    else if (o.op === 'ins' && side === 'theirs') row.append(el('ins', o.b!));
  }
  return row;
}

/** The two texts line by line: equal lines side by side, a changed line next to its counterpart, a line on one side
 *  only next to a gap. */
function pairs(ours: string, theirs: string): [string | null, string | null][] {
  const ops = diffList(ours.split('\n'), theirs.split('\n'));
  const out: [string | null, string | null][] = [];
  for (let k = 0; k < ops.length; k++) {
    if (ops[k]!.op === 'same') {
      out.push([ops[k]!.a!, ops[k]!.b!]);
      continue;
    }
    const dels: string[] = [];
    const inss: string[] = [];
    for (; k < ops.length && ops[k]!.op !== 'same'; k++) (ops[k]!.op === 'del' ? dels : inss).push((ops[k]!.op === 'del' ? ops[k]!.a : ops[k]!.b)!);
    k--;
    for (let i = 0; i < Math.max(dels.length, inss.length); i++) out.push([dels[i] ?? null, inss[i] ?? null]);
  }
  return out;
}

function column(rows: [string | null, string | null][], side: 'ours' | 'theirs', label: string): HTMLElement {
  return el('section.ms-env-side', el('h3.ms-adm-h3', label), el('div.ms-env-side__text', ...rows.map(([a, b]) => line(a, b, side))));
}

/** The side-by-side view in the drawer: both texts, the differences marked, and the text to write by hand. */
export function sideBySide(box: HTMLElement, p: api.Plan, conflictId: string, o: ConflictOpts): void {
  const c = p.conflicts.find((x) => x.id === conflictId);
  if (!c) return void box.append(el('p', 'This conflict is not in the plan any more.'));
  const ours = c.ours ?? '';
  const theirs = c.theirs ?? '';
  const rows = pairs(ours, theirs);
  const tid = `ms-env-merge-${c.id}`;
  const text = el('textarea.ms-input.ms-env-merge', { id: tid, rows: '14', spellcheck: 'false' });
  text.value = c.take === 'text' && c.merged ? c.merged : c.take === 'theirs' ? theirs : ours;
  const canChoose = p.status === 'conflicts' || p.status === 'blocked' || p.status === 'ready';
  box.append(
    el('p', el('strong', title(c)), ` · ${c.words}`),
    el('div.ms-env-sides', column(rows, 'ours', `${sideWord(p, 'ours')} version`), column(rows, 'theirs', `${sideWord(p, 'theirs')} version`)),
    c.ours === null || c.theirs === null ? el('p.ms-adm-note', c.ours === null ? 'It was removed here.' : 'It was removed on the incoming side.') : '',
    el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: tid }, 'The text to keep (edit it by hand)'), text),
    canChoose
      ? el('div.ms-adm-actions',
          button('Use this text', () => void decide(p, c, 'text', o, text.value), { kind: 'primary' }),
          button(`Keep ${sideWord(p, 'ours')}`, () => void decide(p, c, 'ours', o)),
          button(`Take ${sideWord(p, 'theirs')}`, () => void decide(p, c, 'theirs', o)),
        )
      : el('p.ms-adm-sub', 'The plan can no longer change.'),
  );
}
