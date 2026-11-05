// What the live demo adds to the editor's screen (docs/DEMO.md): a strip above the editor that says it is a demo,
// with Your changes, Reset demo and Install; the diff a save would commit; and the one "not in the demo" note. The
// open diff is in the address (?changes=last|all), so a reload or a shared link shows it again.
import './demo.css';
import { copyable } from '../copy';
import { unifiedDiff, diffStat } from './diff';
import { NOT_IN_DEMO } from './standin';

export interface DiffFile {
  file: string;
  title: string;
  before: string;
  after: string;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v);
  }
  n.append(...kids);
  return n;
};

const button = (label: string, kind: string, run: () => void) => {
  const b = el('button', { type: 'button', class: `ms-demo-btn ms-demo-btn--${kind}` }, label);
  b.addEventListener('click', run);
  return b;
};

/** A modal dialog; `onClose` runs once, whatever closed it (a button, Escape). */
function dialog(label: string, kids: Node[], actions: HTMLElement[], onClose?: () => void): HTMLDialogElement {
  const d = el('dialog', { class: 'ms-demo-dialog', 'aria-label': label });
  d.append(...kids, el('div', { class: 'ms-demo-dialog__actions' }, ...actions));
  d.addEventListener('close', () => {
    d.remove();
    onClose?.();
  });
  document.body.append(d);
  d.showModal();
  // the first focus goes to the main button (Close, OK, Keep my changes), not to the diff's copy icon before it
  const buttons = actions.filter((a) => a.tagName === 'BUTTON');
  (buttons.find((b) => b.classList.contains('ms-demo-btn--primary')) ?? buttons[0])?.focus();
  return d;
}

/** One file's diff, each line coloured as git colours it; the file name's copy icon copies the whole diff. */
function diffBlock(f: DiffFile): HTMLElement {
  const text = unifiedDiff(f.file, f.before, f.after);
  const { added, removed } = diffStat(f.before, f.after);
  const pre = el('pre', { class: 'ms-demo-diff', tabindex: '0', 'aria-label': `The diff of ${f.file}` });
  for (const line of text.replace(/\n$/, '').split('\n')) {
    const kind = /^(diff|---|\+\+\+) /.test(line) ? 'file' : line.startsWith('@@') ? 'hunk' : line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'same';
    pre.append(el('span', { class: `ms-demo-diff__${kind}` }, line), '\n');
  }
  return el('section', { class: 'ms-demo-file' }, el('p', { class: 'ms-demo-file__head' }, copyable(f.file, { label: `the diff of ${f.file}`, copy: text, className: 'ms-demo-file__name' }), el('span', { class: 'ms-demo-stat' }, el('span', { class: 'ms-demo-stat__add' }, `+${added}`), ' ', el('span', { class: 'ms-demo-stat__del' }, `−${removed}`))), pre);
}

/** Puts ?changes=… in the address (or takes it out) without a new history step. */
function addressSays(changes: 'last' | 'all' | null): void {
  const url = new URL(location.href);
  if (changes) url.searchParams.set('changes', changes);
  else url.searchParams.delete('changes');
  history.replaceState(history.state, '', url.href);
}

export class DemoScreen {
  private count: HTMLElement | null = null;
  private refusal: HTMLDialogElement | null = null;
  private readonly install: string;
  private readonly changes: () => DiffFile[];
  private readonly last: () => DiffFile | null;
  private readonly reset: () => void;

  constructor(o: { install: string; changes: () => DiffFile[]; last: () => DiffFile | null; reset: () => void }) {
    this.install = o.install;
    this.changes = o.changes;
    this.last = o.last;
    this.reset = o.reset;
  }

  /** The strip above the editor. */
  mountBanner(): void {
    document.documentElement.classList.add('ms-demo');
    this.count = el('span', { class: 'ms-demo-count' });
    const bar = el(
      'div',
      { class: 'ms-demo-bar', role: 'region', 'aria-label': 'Live demo' },
      el('p', { class: 'ms-demo-bar__text' }, el('strong', {}, 'Live demo'), el('span', { class: 'ms-demo-bar__more' }, ': sample blog, nothing is saved, edits stay in your browser.')),
      el(
        'div',
        { class: 'ms-demo-bar__actions' },
        (() => {
          const b = button('Your changes', 'quiet', () => this.showAll());
          b.dataset.demo = 'changes';
          b.append(this.count!);
          return b;
        })(),
        (() => {
          const b = button('Reset demo', 'quiet', () => this.askReset());
          b.dataset.demo = 'reset';
          return b;
        })(),
        el('a', { class: 'ms-demo-btn ms-demo-btn--primary', href: this.install, target: '_blank', rel: 'noopener', 'data-demo': 'install', 'aria-label': 'Install Markstage' }, 'Install', el('span', { class: 'ms-demo-bar__more' }, 'Markstage')),
      ),
    );
    document.body.prepend(bar);
    this.updateCount();
    const asked = new URL(location.href).searchParams.get('changes');
    if (asked === 'all') this.showAll();
    else if (asked === 'last') {
      const f = this.last();
      if (f) this.showSaved(f);
      else addressSays(null);
    }
  }

  updateCount(): void {
    const n = this.changes().length;
    if (this.count) this.count.textContent = n ? ` (${n})` : '';
  }

  /** After a save: the diff it would commit. */
  showSaved(f: DiffFile): void {
    this.updateCount();
    addressSays('last');
    dialog(
      'Saved in this browser',
      [
        el('h2', { class: 'ms-demo-dialog__title' }, 'Saved in this browser'),
        el('p', {}, `Here is the git diff this save would commit. On a Markstage server, the save is a commit in your name with only the lines you changed.`),
        diffBlock(f),
      ],
      [button('See all your changes', 'quiet', () => (this.close(), this.showAll())), button('Close', 'primary', () => this.close())],
      () => addressSays(null),
    );
  }

  /** Every file changed in this tab, from the sample blog as it was. */
  showAll(): void {
    this.close();
    addressSays('all');
    const files = this.changes();
    dialog(
      'Your changes',
      [
        el('h2', { class: 'ms-demo-dialog__title' }, 'Your changes'),
        el('p', {}, files.length ? `What your saves changed in the sample blog, as one git diff. They stay in this browser tab until you reset the demo.` : 'Nothing saved yet. Open a post, change a word and press Save: the diff of that change shows here.'),
        ...files.map(diffBlock),
      ],
      [button('Close', 'primary', () => this.close())],
      () => addressSays(null),
    );
  }

  /** The one note for everything the demo does not do; said once at a time. */
  notInDemo(): void {
    if (this.refusal?.open) return;
    const link = el('a', { href: this.install, target: '_blank', rel: 'noopener', class: 'ms-demo-btn ms-demo-btn--primary' }, 'How to install');
    link.addEventListener('click', () => this.refusal?.close());
    this.refusal = dialog(
      'Not in the demo',
      [
        el('h2', { class: 'ms-demo-dialog__title' }, 'Not in the demo'),
        el('p', { class: 'ms-demo-refusal' }, NOT_IN_DEMO.replace(/^Not in the demo: i/, 'I')),
        el('p', { class: 'ms-demo-muted' }, 'Here you can open posts, edit them and save, and see the diff each save would commit. Publishing, releases, users, settings, uploads, AI and environments need a running Markstage.'),
      ],
      [button('OK', 'quiet', () => this.refusal?.close()), link],
      () => (this.refusal = null),
    );
  }

  private askReset(): void {
    this.close();
    dialog(
      'Reset the demo?',
      [el('h2', { class: 'ms-demo-dialog__title' }, 'Reset the demo?'), el('p', {}, 'Your saved changes in this tab are removed, and the sample blog is back as it was.')],
      [button('Keep my changes', 'quiet', () => this.close()), button('Reset demo', 'danger', () => this.reset())],
    );
  }

  private close(): void {
    for (const d of document.querySelectorAll<HTMLDialogElement>('dialog.ms-demo-dialog')) d.close();
  }
}
