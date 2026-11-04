// The device check's list of problems, in the right column while a screen is shown: what is wider than the screen,
// images too wide, small tap targets, tiny text. A click on one scrolls the framed page to it and outlines it.
import { copyable } from '../copy';
import { ic } from '../icons';
import { h } from '../panel-form';
import type { Issue, IssueKind, Measured } from './measure';
import type { SpellingChange } from './spelling';

const KINDS: { kind: IssueKind; title: string; why: string }[] = [
  { kind: 'overflow', title: 'Wider than the screen', why: 'The page scrolls sideways or cuts this off.' },
  { kind: 'image', title: 'Images wider than the screen', why: 'Give the image a width of 100% or put it in a scrolling box.' },
  { kind: 'tap', title: 'Small tap targets', why: 'Under 24 × 24 px with another target close by: easy to miss with a finger.' },
  { kind: 'font', title: 'Text under 12 px', why: 'Hard to read, most of all on a phone.' },
];
/** a page can have hundreds of tiny labels: the first ones are listed, the rest counted */
const SHOWN = 40;

export class ChecksPanel {
  private body: HTMLElement;
  /** the respelled words of the locale shown, above the checks */
  private spell: HTMLElement;
  private title: HTMLElement;

  constructor(
    readonly el: HTMLElement,
    private o: { onReveal: (id: number) => void; onWord: (word: string) => void; onRerun: () => void; onClose: () => void },
  ) {
    el.innerHTML = `<header class="ms-panel__head"><h2 class="ms-panel__title"></h2><div class="ms-checks__tools"><button type="button" class="ms-btn ms-btn--quiet" data-rerun>Check again</button><button type="button" class="ms-iconbtn ms-panel__close" aria-label="Back to editing (Esc)" title="Back to editing (Esc)">${ic('x', 16)}</button></div></header><div class="ms-panel__body ms-checks__body"><section class="ms-checks__group ms-checks__spell" hidden></section><div class="ms-checks__results" aria-live="polite"></div></div>`;
    this.title = el.querySelector('.ms-panel__title')!;
    this.body = el.querySelector('.ms-checks__results')!;
    this.spell = el.querySelector('.ms-checks__spell')!;
    el.querySelector('[data-rerun]')!.addEventListener('click', () => o.onRerun());
    el.querySelector('.ms-panel__close')!.addEventListener('click', () => o.onClose());
    this.show(false);
  }

  show(on: boolean): void {
    this.el.classList.toggle('is-open', on);
    this.el.inert = !on;
    this.el.setAttribute('aria-hidden', String(!on));
  }

  setWidth(width: number): void {
    this.title.textContent = `Checks at ${width} px`;
  }

  /** A note in place of the list (checking, or the checks cannot run). */
  message(text: string, busy = false): void {
    const p = h('p', `ms-checks__msg${busy ? ' is-busy' : ''}`);
    p.textContent = text;
    this.body.replaceChildren(p);
  }

  render(m: Measured): void {
    this.body.replaceChildren();
    const n = m.issues.length;
    const sum = h('div', `ms-checks__sum ${n ? 'is-bad' : 'is-ok'}`, ic(n ? 'alert' : 'check', 16));
    const words = h('div');
    words.append(Object.assign(h('strong'), { textContent: n ? `${n} problem${n === 1 ? '' : 's'} at ${m.width} px` : `No problems at ${m.width} px` }));
    const detail = m.sideways ? `The page scrolls sideways by ${m.sideways} px.` : n ? 'The page fits the screen.' : 'Nothing is wider than the screen, tap targets and text are big enough.';
    words.append(Object.assign(h('span'), { textContent: detail }));
    sum.append(words);
    this.body.append(sum);
    for (const k of KINDS) {
      const list = m.issues.filter((i) => i.kind === k.kind);
      if (!list.length) continue;
      const group = h('section', 'ms-checks__group');
      const head = h('h3', 'ms-checks__title');
      head.append(Object.assign(h('span'), { textContent: k.title }), Object.assign(h('span', 'ms-checks__count'), { textContent: String(list.length) }));
      group.append(head, Object.assign(h('p', 'ms-checks__why'), { textContent: k.why }));
      for (const issue of list.slice(0, SHOWN)) group.append(this.row(issue));
      if (list.length > SHOWN) group.append(Object.assign(h('p', 'ms-checks__why'), { textContent: `And ${list.length - SHOWN} more.` }));
      this.body.append(group);
    }
  }

  /** The words a locale respells, each once with its count; a click shows the next place it occurs. */
  spelling(title: string | null, changes: SpellingChange[]): void {
    this.spell.hidden = !title;
    this.spell.replaceChildren();
    if (!title) return;
    const head = h('h3', 'ms-checks__title');
    head.append(Object.assign(h('span'), { textContent: title }), Object.assign(h('span', 'ms-checks__count is-info'), { textContent: String(changes.length) }));
    const why = changes.length
      ? 'Words the site respells in this region (the file keeps them as written). Click one to find it in the page.'
      : 'Nothing in this text is respelled in this region: it shows as written.';
    this.spell.append(head, Object.assign(h('p', 'ms-checks__why'), { textContent: why }));
    for (const c of changes.slice(0, SHOWN)) {
      const row = h('div', 'ms-check ms-check--spell');
      const go = h('button', 'ms-check__go');
      go.type = 'button';
      go.title = 'Find it in the page';
      go.append(Object.assign(h('span', 'ms-check__text'), { textContent: `${c.from} → ${c.to}` }), Object.assign(h('span', 'ms-check__times'), { textContent: c.count > 1 ? `× ${c.count}` : '' }));
      go.addEventListener('click', () => this.o.onWord(c.to));
      row.append(go);
      this.spell.append(row);
    }
    if (changes.length > SHOWN) this.spell.append(Object.assign(h('p', 'ms-checks__why'), { textContent: `And ${changes.length - SHOWN} more.` }));
  }

  private row(issue: Issue): HTMLElement {
    const row = h('div', 'ms-check');
    const go = h('button', 'ms-check__go');
    go.type = 'button';
    go.title = 'Show it on the page';
    go.append(Object.assign(h('span', 'ms-check__text'), { textContent: issue.text }));
    go.addEventListener('click', () => {
      for (const r of this.body.querySelectorAll('.ms-check.is-on')) r.classList.remove('is-on');
      row.classList.add('is-on');
      this.o.onReveal(issue.id);
    });
    row.append(go, copyable(issue.label, { label: 'element', className: 'ms-check__label' }));
    return row;
  }
}
