// One AI suggestion, the same wherever it is asked for (alt text, search title and description, a plan's summary, a
// region's translation): the current value next to the suggested one (with its copy icon), and Accept, Edit then
// accept, Dismiss. While it is asked: "Asking the AI…". When it can't be: off (the env var to set, by name),
// too many asked for (try again in N seconds), or failed, each in plain words. Accepting hands the values to the
// place that asked (its own save path: locks, validation, Undo); a refusal shows its words here.
import '../styles/ai.css';
import { copyable } from '../copy';
import { ic } from '../icons';
import { aiInfo, offWords, suggest, trouble, type AiTrouble, type SuggestBody, type Suggestion } from './api';

export interface SuggestField {
  /** the suggestion's key: alt, title, description, text */
  name: string;
  label: string;
  /** the value now (unsaved changes too) */
  now(): string;
  multiline?: boolean;
  /** shown when the value is empty ("Empty: the title is used") */
  empty?: string;
}

export interface CardSpec {
  /** "Suggested alt text" */
  title: string;
  fields: SuggestField[];
  /** what to ask for (read when asked, so it is the text as it is then) */
  body(): SuggestBody;
  /** applies the values through the place's own path; words when refused */
  accept(values: Suggestion): string | null | Promise<string | null>;
  /** Dismiss, Escape, or accepted: the place closes the card (the URL follows) */
  close(): void;
  /** where the focus goes when the card closes with it (default: the button that asked, so ⌘Z there works) */
  refocus?(): void;
}

export interface Card {
  el: HTMLElement;
  /** the current values were changed elsewhere */
  sync(): void;
  destroy(): void;
}

const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const btn = (cls: string, text: string, data: string, run: () => void) => {
  const b = mk('button', `ms-btn ${cls}`, text);
  b.type = 'button';
  b.dataset[data] = '';
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    asking = b;
    run();
  });
  return b;
};

let uid = 0;
/** the Suggest button clicked last: the card it opens gives the focus back to it */
let asking: HTMLElement | null = null;

export function suggestCard(spec: CardSpec): Card {
  const id = `ms-ai-${++uid}`;
  const opener = asking;
  asking = null;
  const el = mk('section', 'ms-ai');
  el.setAttribute('aria-labelledby', `${id}-title`);
  el.dataset.msUi = '';
  el.contentEditable = 'false';
  // it takes the focus when it opens (from the button, or a link): the keys reach it, and Esc closes it
  el.tabIndex = -1;
  const head = mk('header', 'ms-ai__head');
  const title = mk('h3', 'ms-ai__title');
  title.id = `${id}-title`;
  title.innerHTML = ic('sparkle', 14);
  title.append(spec.title);
  const x = mk('button', 'ms-iconbtn ms-ai__x');
  x.type = 'button';
  x.innerHTML = ic('x', 14);
  x.setAttribute('aria-label', `Dismiss the ${spec.title.toLowerCase()}`);
  x.title = 'Dismiss (Esc)';
  x.addEventListener('click', (e) => (e.stopPropagation(), spec.close()));
  head.append(title, x);
  const body = mk('div', 'ms-ai__body');
  el.append(head, body);
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    e.preventDefault();
    spec.close();
  });

  let alive = true;
  let asked = 0;
  let got: Suggestion | null = null;
  let model: string | null = null;
  let editing = false;
  let waitTimer = 0;
  const nows = new Map<string, HTMLElement>();

  const now = (f: SuggestField, into: HTMLElement) => {
    const v = f.now().trim();
    into.replaceChildren(v ? copyable(v, { label: `the ${f.label.toLowerCase()} now`, className: 'ms-ai__text' }) : mk('span', 'ms-ai__empty', f.empty ?? 'Empty'));
  };

  const state = (s: 'loading' | AiTrouble['state'] | 'ready') => (el.dataset.aiState = s);

  async function ask(): Promise<void> {
    const n = ++asked;
    clearTimeout(waitTimer);
    got = null;
    editing = false;
    state('loading');
    const busy = mk('p', 'ms-ai__state', 'Asking the AI for a suggestion…');
    busy.setAttribute('role', 'status');
    body.setAttribute('aria-busy', 'true');
    body.replaceChildren(busy);
    const info = await aiInfo();
    if (!alive || n !== asked) return;
    if (!info.on) return void drawTrouble({ state: 'off', words: offWords(info.envVar), envVar: info.envVar });
    try {
      const s = await suggest(spec.body());
      if (!alive || n !== asked) return;
      got = s.suggestion;
      model = s.model;
      draw();
    } catch (err) {
      if (alive && n === asked) drawTrouble(trouble(err));
    }
  }

  function drawTrouble(t: AiTrouble): void {
    state(t.state);
    body.removeAttribute('aria-busy');
    const p = mk('p', `ms-ai__state is-${t.state}`, t.words);
    p.setAttribute('role', t.state === 'off' ? 'status' : 'alert');
    const out: HTMLElement[] = [p];
    if (t.envVar) {
      const line = mk('p', 'ms-ai__env');
      line.append(mk('span', 'ms-ai__tag', 'Environment variable'), copyable(t.envVar, { label: 'the environment variable name', className: 'ms-ai__code' }));
      out.push(line);
    }
    const acts = mk('div', 'ms-ai__acts');
    if (t.state === 'rate' || t.state === 'failed') {
      const again = btn('', 'Try again', 'aiRetry', () => void ask());
      if (t.wait) {
        again.disabled = true;
        waitTimer = window.setTimeout(() => (again.disabled = false), t.wait * 1000);
      }
      acts.append(again);
    }
    acts.append(btn('ms-btn--quiet', 'Close', 'aiDismiss', () => spec.close()));
    out.push(acts);
    body.replaceChildren(...out);
  }

  function draw(): void {
    if (!got) return;
    state('ready');
    body.removeAttribute('aria-busy');
    nows.clear();
    const out: HTMLElement[] = [];
    const inputs = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
    const fields = spec.fields.filter((f) => typeof got![f.name] === 'string');
    if (!fields.length) return void drawTrouble({ state: 'failed', words: 'No suggestion this time: the AI answered with nothing to use. Nothing was changed.' });
    for (const f of fields) {
      const box = mk('div', 'ms-ai__field');
      box.dataset.aiField = f.name;
      if (fields.length > 1 || spec.fields.length > 1) box.append(mk('p', 'ms-ai__label', f.label));
      const nowRow = mk('div', 'ms-ai__row ms-ai__now');
      const nowVal = mk('div', 'ms-ai__val');
      now(f, nowVal);
      nows.set(f.name, nowVal);
      nowRow.append(mk('span', 'ms-ai__tag', 'Now'), nowVal);
      const newRow = mk('div', 'ms-ai__row ms-ai__new');
      const newVal = mk('div', 'ms-ai__val');
      const fid = `${id}-${f.name}`;
      if (editing) {
        const input = f.multiline ? mk('textarea', 'ms-input ms-ai__input') : mk('input', 'ms-input ms-ai__input');
        input.id = fid;
        input.value = got[f.name];
        if (input instanceof HTMLTextAreaElement) input.rows = 3;
        inputs.set(f.name, input);
        const label = mk('label', 'ms-ai__tag', 'Yours');
        label.htmlFor = fid;
        newRow.append(label, newVal);
        newVal.append(input);
      } else {
        newVal.append(copyable(got[f.name], { label: `the suggested ${f.label.toLowerCase()}`, className: 'ms-ai__text ms-ai__suggested' }));
        newRow.append(mk('span', 'ms-ai__tag', 'Suggested'), newVal);
      }
      box.append(nowRow, newRow);
      out.push(box);
    }
    const why = mk('p', 'ms-ai__why');
    why.setAttribute('role', 'alert');
    why.hidden = true;
    const values = (): Suggestion => Object.fromEntries(fields.map((f) => [f.name, editing ? inputs.get(f.name)!.value : got![f.name]]));
    const accept = async () => {
      why.hidden = true;
      const refused = await spec.accept(values());
      if (!alive) return;
      if (refused) {
        why.textContent = refused;
        why.hidden = false;
      } else spec.close();
    };
    const acts = mk('div', 'ms-ai__acts');
    if (editing) {
      acts.append(
        btn('ms-btn--primary', 'Accept', 'aiAccept', () => void accept()),
        btn('', 'Cancel edit', 'aiEdit', () => ((editing = false), draw())),
      );
    } else {
      acts.append(
        btn('ms-btn--primary', 'Accept', 'aiAccept', () => void accept()),
        btn('', 'Edit then accept', 'aiEdit', () => {
          editing = true;
          draw();
          (body.querySelector('.ms-ai__input') as HTMLElement | null)?.focus();
        }),
      );
    }
    acts.append(mk('span', 'ms-ai__grow'), btn('ms-btn--quiet', 'Suggest again', 'aiRetry', () => void ask()), btn('ms-btn--quiet', 'Dismiss', 'aiDismiss', () => spec.close()));
    out.push(why, acts, mk('p', 'ms-ai__note', `Written by AI${model ? ` (${model})` : ''}: read it before you accept. Nothing changes until you do.`));
    body.replaceChildren(...out);
  }

  void ask();
  requestAnimationFrame(() => {
    if (alive && el.isConnected && !el.contains(document.activeElement)) el.focus();
  });
  return {
    el,
    sync: () => {
      for (const f of spec.fields) {
        const into = nows.get(f.name);
        if (into) now(f, into);
      }
    },
    destroy: () => {
      alive = false;
      clearTimeout(waitTimer);
      const had = el.contains(document.activeElement);
      const back = opener?.isConnected ? opener : askNear(el);
      el.remove();
      if (!had) return;
      if (spec.refocus) spec.refocus();
      else back?.focus();
    },
  };
}

/** The nearest button that asks for a suggestion around `el` (what it sits in was drawn again since it was asked). */
function askNear(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const b = p.querySelector<HTMLElement>('[data-ai-ask]:not([hidden])');
    if (b) return b;
  }
  return null;
}

/** The button that asks for a suggestion ("Suggest alt text"), with the sparkle. */
export function suggestButton(text: string, run: () => void, cls = ''): HTMLButtonElement {
  const b = mk('button', `ms-btn ms-btn--quiet ms-ai__ask ${cls}`.trim());
  b.type = 'button';
  b.innerHTML = ic('sparkle', 14);
  b.append(mk('span', '', text));
  b.dataset.aiAsk = '';
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    run();
  });
  return b;
}
