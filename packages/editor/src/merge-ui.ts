// Merging two people's changes to one entry (core's three-way merge): what only the other side changed comes in by
// itself; where both changed the same block (or the same setting) a side-by-side picker asks which to keep: yours,
// theirs, or both. Used when a save finds the file changed (keep.ts), and when a recovery copy is older than the file.
import './styles/merge.css';
import { modalize } from './shell';
import { mergeBlocks, mergeData, resolve } from '@markstage/core';

type Choice = 'mine' | 'theirs' | 'both';

export interface MergeInput<T> {
  base: T[];
  mine: T[];
  theirs: T[];
  /** the frontmatter (absent for a text merged as a whole) */
  fmBase?: Record<string, unknown>;
  fmMine?: Record<string, unknown>;
  fmTheirs?: Record<string, unknown>;
  /** a block as the picker shows it (its words) */
  describe(block: T): string;
  /** a frontmatter path as the picker names it */
  label(path: string): string;
  /** how the other side is called: "Saved meanwhile", "In the file now" */
  theirsName: string;
}

export interface MergeResult<T> {
  blocks: T[];
  fm: Record<string, unknown> | undefined;
  /** blocks (stretches) taken from the other side without asking */
  theirsTaken: number;
  /** the picker was shown */
  asked: boolean;
}

/** The merged blocks and frontmatter, asking where both sides changed the same thing; null when the writer cancels. */
export async function merge3<T>(o: MergeInput<T>): Promise<MergeResult<T> | null> {
  const r = mergeBlocks(o.base, o.mine, o.theirs);
  const fm = o.fmMine ? mergeData(o.fmBase ?? {}, o.fmMine, o.fmTheirs ?? {}) : null;
  const fmConflicts = fm?.conflicts ?? [];
  if (!r.conflicts && !fmConflicts.length) return { blocks: r.merged!, fm: fm?.merged, theirsTaken: r.theirsTaken, asked: false };
  const conflicts = r.parts.flatMap((p) => (p.conflict ? [p.conflict] : []));
  const picked = await pick(
    [
      ...conflicts.map((c, i) => ({ title: `Part ${i + 1}`, theirs: c.theirs.map(o.describe).join('\n\n'), mine: c.mine.map(o.describe).join('\n\n'), both: true })),
      ...fmConflicts.map((path) => ({ title: o.label(path), theirs: shown(leaf(o.fmTheirs, path)), mine: shown(leaf(o.fmMine, path)), both: false })),
    ],
    o.theirsName,
  );
  if (!picked) return null;
  const blocks = resolve(r.parts, picked.slice(0, conflicts.length));
  const merged = fm ? structuredClone(fm.merged) : undefined;
  fmConflicts.forEach((path, i) => {
    if (merged && picked[conflicts.length + i] === 'theirs') setLeaf(merged, path, leaf(o.fmTheirs, path));
  });
  return { blocks, fm: merged, theirsTaken: r.theirsTaken, asked: true };
}

const leaf = (o: Record<string, unknown> | undefined, path: string) =>
  path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), o);
const shown = (v: unknown) => (v === undefined || v === null || v === '' ? '(empty)' : typeof v === 'string' ? v : JSON.stringify(v));

function setLeaf(o: Record<string, unknown>, path: string, v: unknown) {
  const keys = path.split('.');
  let at = o;
  for (const k of keys.slice(0, -1)) at = (at[k] = at[k] && typeof at[k] === 'object' ? at[k] : {}) as Record<string, unknown>;
  if (v === undefined) delete at[keys[keys.length - 1]];
  else at[keys[keys.length - 1]] = v;
}

/** `text` with the words that differ from `other` marked (what lies between the shared start and the shared end). */
function marked(text: string, other: string): Node[] {
  const a = text.split(/(\s+)/);
  const b = other.split(/(\s+)/);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const mid = a.slice(head, a.length - tail).join('');
  if (!mid.trim() || text === other) return [document.createTextNode(text)];
  const m = document.createElement('mark');
  m.textContent = mid;
  return [document.createTextNode(a.slice(0, head).join('')), m, document.createTextNode(a.slice(a.length - tail).join(''))];
}

interface Item {
  title: string;
  theirs: string;
  mine: string;
  /** "Keep both" makes sense (blocks, not one setting) */
  both: boolean;
}

/** The side-by-side picker: one row per part both changed; resolves with a choice per row, or null (Cancel, Esc). */
function pick(items: Item[], theirsName: string): Promise<Choice[] | null> {
  return new Promise((done) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'ms-dialog ms-merge';
    dlg.setAttribute('aria-labelledby', 'ms-merge-title');
    const head = document.createElement('div');
    head.className = 'ms-merge__head';
    head.innerHTML = '<h2 id="ms-merge-title">You both changed the same part</h2><p>Everything else is merged. For each part below, pick what to keep.</p>';
    const list = document.createElement('div');
    list.className = 'ms-merge__list';
    const choices: Choice[] = items.map(() => 'mine');
    items.forEach((it, i) => {
      const row = document.createElement('section');
      row.className = 'ms-merge__item';
      const h = document.createElement('h3');
      h.textContent = it.title;
      const cols = document.createElement('div');
      cols.className = 'ms-merge__cols';
      const col = (label: string, text: string, other: string, side: Choice) => {
        const c = document.createElement('div');
        c.className = `ms-merge__col is-${side}`;
        const l = document.createElement('div');
        l.className = 'ms-merge__label';
        l.textContent = label;
        const t = document.createElement('div');
        t.className = 'ms-merge__text';
        t.append(...marked(text, other));
        c.append(l, t);
        return c;
      };
      cols.append(col(theirsName, it.theirs, it.mine, 'theirs'), col('Yours', it.mine, it.theirs, 'mine'));
      const seg = document.createElement('div');
      seg.className = 'ms-seg ms-merge__pick';
      seg.setAttribute('role', 'radiogroup');
      seg.setAttribute('aria-label', `Keep for ${it.title}`);
      const opts: [Choice, string][] = [['mine', 'Keep yours'], ['theirs', 'Keep theirs'], ...(it.both ? [['both', 'Keep both'] as [Choice, string]] : [])];
      const draw = () => {
        for (const b of seg.querySelectorAll<HTMLButtonElement>('button')) {
          const on = b.dataset.choice === choices[i];
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-checked', String(on));
        }
        row.dataset.choice = choices[i];
      };
      for (const [value, label] of opts) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ms-seg__btn';
        b.setAttribute('role', 'radio');
        b.dataset.choice = value;
        b.textContent = label;
        b.addEventListener('click', () => {
          choices[i] = value;
          draw();
        });
        seg.append(b);
      }
      draw();
      row.append(h, cols, seg);
      list.append(row);
    });
    const tools = document.createElement('div');
    tools.className = 'ms-dialog__tools';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'ms-btn';
    cancel.textContent = 'Not now';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'ms-btn ms-btn--primary';
    ok.textContent = 'Keep these and save';
    tools.append(cancel, ok);
    dlg.append(head, list, tools);
    document.body.append(dlg);
    const end = (v: Choice[] | null) => {
      dlg.close();
      dlg.remove();
      done(v);
    };
    cancel.addEventListener('click', () => end(null));
    ok.addEventListener('click', () => end(choices));
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      end(null);
    });
    modalize(dlg);
    dlg.showModal();
    ok.focus();
  });
}
