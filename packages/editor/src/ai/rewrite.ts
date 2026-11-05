// The writing help on the page (docs/API-AI.md "rewrite"): select words in one paragraph, heading or list item,
// press "Improve with AI" in the format bar (Alt+F10 reaches the bar from the keyboard), pick Rewrite, Shorten, Fix
// spelling and grammar, or a tone, and the suggestion appears beside the selection as a diff: words taken out
// struck through, words put in underlined. Accept, Edit then accept, or Reject; nothing changes until the writer
// accepts, and nothing saves by itself. Accepting is one change on the canvas like typing: ⌘Z takes it back, and ⌘S
// saves it through the one save path (locks, validation, the surgical save that touches only what changed).
//
// Every state has its URL (router.ts): suggest=rewrite&sel=<from>-<to> (the choices), &how=<mode> (the suggestion).
// The selection stays marked on the canvas while the card is open. The button is hidden while AI is off or the
// server does not offer `rewrite`; a URL that asks anyway opens the card, which says why, as every AI card does.
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import '../styles/ai.css';
import { copyable } from '../copy';
import { toast } from '../host';
import { ic } from '../icons';
import * as router from '../router';
import type { RewriteMode } from '../router';
import { aiInfo, offTrouble, suggest, trouble, type AiTrouble } from './api';
import { changeWords, wordDiff } from './diff';

export interface RewriteDeps {
  getEditor(): Editor | null;
  /** the entry the canvas shows: {collection, id}, once it is the one the URL names */
  where(): { collection: string; id: string } | null;
  /** why the text can't be changed here (the role, a read-only entry), or null */
  readOnly(): string | null;
}

/** The choices, in the order the card offers them. */
export const CHOICES: { how: RewriteMode; label: string; hint: string }[] = [
  { how: 'rewrite', label: 'Rewrite', hint: 'Clearer and smoother, the same meaning' },
  { how: 'shorten', label: 'Shorten', hint: 'Fewer words, every fact kept' },
  { how: 'fix', label: 'Fix spelling and grammar', hint: 'Only the mistakes' },
];
export const TONES: { how: RewriteMode; label: string }[] = [
  { how: 'tone:friendly', label: 'Friendly' },
  { how: 'tone:formal', label: 'Formal' },
  { how: 'tone:confident', label: 'Confident' },
];
const MAX = 4000;
const labelOf = (how: RewriteMode) => CHOICES.find((c) => c.how === how)?.label ?? `${TONES.find((t) => t.how === how)?.label ?? ''} tone`;

// the selection, marked on the canvas while its card is open (the editor's own selection goes when the card has focus)
const MARK = new PluginKey<DecorationSet>('msAiRewrite');
const markPlugin = () =>
  new Plugin<DecorationSet>({
    key: MARK,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const m = tr.getMeta(MARK) as { from: number; to: number } | null | undefined;
        if (m === null) return DecorationSet.empty;
        if (m) return DecorationSet.create(tr.doc, [Decoration.inline(m.from, m.to, { class: 'ms-ai-mark' })]);
        return set.map(tr.mapping, tr.doc);
      },
    },
    props: { decorations: (st) => MARK.getState(st) },
  });
function mark(ed: Editor, range: { from: number; to: number } | null): void {
  if (!MARK.getState(ed.state)) {
    if (!range) return;
    ed.registerPlugin(markPlugin());
  }
  ed.view.dispatch(ed.state.tr.setMeta(MARK, range).setMeta('addToHistory', false));
}

/** The selection as the writing help takes it: words inside one text block (not code), or why not. */
export function selectionOf(ed: Editor, from: number, to: number): { text: string; why: null } | { text: null; why: string } {
  const doc = ed.state.doc;
  if (!(from >= 0 && to > from && to <= doc.content.size)) return { text: null, why: 'That selection is not on the page any more.' };
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  if (!$from.sameParent($to) || !$from.parent.isTextblock) return { text: null, why: 'Select words inside one paragraph, heading or list item to improve them.' };
  if ($from.parent.type.spec.code) return { text: null, why: 'Code is kept as it is written: the writing help leaves it alone.' };
  const text = doc.textBetween(from, to, '\n', ' ');
  if (!text.trim()) return { text: null, why: 'Select some words first.' };
  if (text.length > MAX) return { text: null, why: `That is ${text.length.toLocaleString('en')} characters; the writing help takes at most ${MAX.toLocaleString('en')}. Select less.` };
  return { text, why: null };
}

/** Whether the selection holds a link or formatting that only part of it has: accepting would make it plain. */
function mixedMarks(ed: Editor, from: number, to: number): boolean {
  const sets: string[] = [];
  ed.state.doc.nodesBetween(from, to, (n) => {
    if (n.isText) sets.push(n.marks.map((m) => m.type.name).sort().join(','));
  });
  return new Set(sets).size > 1 || sets.some((s) => s.includes('link'));
}

const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const btn = (cls: string, text: string, run: () => void, attrs: Record<string, string> = {}) => {
  const b = mk('button', `ms-btn ${cls}`.trim(), text);
  b.type = 'button';
  for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    run();
  });
  return b;
};

export function rewriteHelp(d: RewriteDeps) {
  // ---------- the format bar's button ----------
  const button = mk('button', 'ms-bar__btn ms-bar__ai');
  button.type = 'button';
  button.innerHTML = `${ic('sparkle', 14)}<span>Improve with AI</span>`;
  button.setAttribute('aria-label', 'Improve with AI: rewrite, shorten, fix the spelling or change the tone of the selected words');
  button.title = 'Improve with AI';
  button.dataset.aiRewrite = '';
  button.hidden = true;
  button.addEventListener('mousedown', (e) => e.preventDefault());
  button.addEventListener('click', () => {
    const ed = d.getEditor();
    if (!ed) return;
    const { from, to } = ed.state.selection;
    const s = selectionOf(ed, from, to);
    if (s.why) return void toast(s.why, 'info');
    router.go({ suggest: { kind: 'rewrite', sel: [from, to] } }, true);
  });
  // shown only while the server offers it; when it is off, the AI cards say why (a URL that asks still opens one).
  // Asked once an entry is open (follow), never on the sign-in page or a screen with no canvas.
  let offered = false;
  const offer = () => {
    offered = true;
    void aiInfo().then((i) => {
      button.hidden = !(i.on && i.kinds.includes('rewrite'));
    });
  };

  // ---------- the card beside the selection ----------
  let pop: HTMLElement | null = null;
  let key = '';
  let asked = 0;
  let range: { from: number; to: number } | null = null;

  const close = () => router.go({ suggest: null }, true);

  function place(): void {
    const ed = d.getEditor();
    if (!pop || !ed || !range) return;
    let a: { left: number; top: number; bottom: number };
    let b: { right: number; bottom: number; top: number };
    try {
      a = ed.view.coordsAtPos(range.from);
      b = ed.view.coordsAtPos(range.to, -1);
    } catch {
      return;
    }
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const below = Math.max(a.bottom, b.bottom) + 10;
    // beside the selection: under it, or over it when there is no room below
    const top = below + h > innerHeight - 8 && Math.min(a.top, b.top) - h - 10 > 8 ? Math.min(a.top, b.top) - h - 10 : below;
    pop.style.top = `${Math.max(8, top)}px`;
    pop.style.left = `${Math.max(8, Math.min(a.left - 12, innerWidth - w - 8))}px`;
  }

  function teardown(refocus: boolean): void {
    const ed = d.getEditor();
    if (ed && !ed.isDestroyed) mark(ed, null);
    const had = pop?.contains(document.activeElement);
    pop?.remove();
    pop = null;
    key = '';
    asked++;
    // closed from the card (Esc, Reject, ×): the words are selected again and the canvas has the keys
    if (refocus && had && ed && !ed.isDestroyed && range && range.to <= ed.state.doc.content.size) {
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, range.from, range.to)).setMeta('addToHistory', false));
      ed.view.focus();
    }
    range = null;
  }

  function shell(title: string): { el: HTMLElement; body: HTMLElement } {
    const el = mk('section', 'ms-pop ms-ai ms-ai-rw');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-labelledby', 'ms-ai-rw-title');
    el.dataset.msUi = '';
    el.tabIndex = -1;
    const head = mk('header', 'ms-ai__head');
    const h = mk('h3', 'ms-ai__title');
    h.id = 'ms-ai-rw-title';
    h.innerHTML = ic('sparkle', 14);
    h.append(title);
    const x = mk('button', 'ms-iconbtn ms-ai__x');
    x.type = 'button';
    x.innerHTML = ic('x', 14);
    x.setAttribute('aria-label', 'Close the writing help');
    x.title = 'Close (Esc)';
    x.addEventListener('click', close);
    head.append(h, x);
    const body = mk('div', 'ms-ai__body');
    el.append(head, body);
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    });
    document.body.append(el);
    return { el, body };
  }

  /** The choices: each one a button, the tones in their own group. */
  function choices(body: HTMLElement, s: { sel: [number, number] }): void {
    const list = mk('div', 'ms-ai-rw__choices');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'How to improve the selected words');
    for (const c of CHOICES) {
      const b = btn('ms-ai-rw__choice', '', () => router.go({ suggest: { kind: 'rewrite', sel: s.sel, how: c.how } }, true), { 'data-how': c.how });
      b.append(mk('strong', '', c.label), mk('span', 'ms-ai-rw__hint', c.hint));
      list.append(b);
    }
    const tones = mk('div', 'ms-ai-rw__tones');
    tones.setAttribute('role', 'group');
    tones.setAttribute('aria-labelledby', 'ms-ai-rw-tone');
    const lab = mk('span', 'ms-ai-rw__tonelabel', 'Change tone:');
    lab.id = 'ms-ai-rw-tone';
    tones.append(lab, ...TONES.map((t) => btn('ms-btn--sm', t.label, () => router.go({ suggest: { kind: 'rewrite', sel: s.sel, how: t.how } }, true), { 'data-how': t.how })));
    body.replaceChildren(list, tones, mk('p', 'ms-ai__note', 'The AI suggests; you read it and decide. Nothing changes until you accept.'));
  }

  function drawTrouble(body: HTMLElement, el: HTMLElement, t: AiTrouble, again: () => void): void {
    el.dataset.aiState = t.state;
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
      const b = btn('', 'Try again', again, { 'data-ai-retry': '' });
      if (t.wait) {
        b.disabled = true;
        setTimeout(() => (b.disabled = false), t.wait * 1000);
      }
      acts.append(b);
    }
    acts.append(btn('ms-btn--quiet', 'Close', close, { 'data-ai-dismiss': '' }));
    out.push(acts);
    body.replaceChildren(...out);
    place();
  }

  /** Ask for the suggestion, then show it as a diff with Accept, Edit then accept, Reject. */
  async function ask(el: HTMLElement, body: HTMLElement, s: { sel: [number, number]; how: RewriteMode }, original: string): Promise<void> {
    const n = ++asked;
    el.dataset.aiState = 'loading';
    const busy = mk('p', 'ms-ai__state', `Asking the AI to ${labelOf(s.how).toLowerCase()}…`);
    busy.setAttribute('role', 'status');
    body.setAttribute('aria-busy', 'true');
    body.replaceChildren(busy);
    place();
    const again = () => void ask(el, body, s, original);
    const info = await aiInfo();
    if (n !== asked) return;
    if (!info.on) return drawTrouble(body, el, offTrouble(info), again);
    const where = d.where();
    if (!where) return;
    // the words around it stay as they were: spaces at either end of the selection are kept
    const lead = /^\s*/.exec(original)![0];
    const trail = /\s*$/.exec(original)![0];
    let got: string;
    try {
      got = (await suggest({ kind: 'rewrite', ...where, mode: s.how, text: original })).suggestion.text ?? '';
    } catch (err) {
      if (n === asked) drawTrouble(body, el, trouble(err), again);
      return;
    }
    if (n !== asked) return;
    const suggested = `${lead}${got.trim()}${trail}`;
    draw(el, body, s, original, suggested);
  }

  function draw(el: HTMLElement, body: HTMLElement, s: { sel: [number, number]; how: RewriteMode }, original: string, suggested: string, editing = false): void {
    el.dataset.aiState = 'ready';
    body.removeAttribute('aria-busy');
    const parts = wordDiff(original, suggested);
    const out: HTMLElement[] = [];
    out.push(mk('p', 'ms-ai-rw__what', `${labelOf(s.how)} · ${changeWords(parts)}`));
    let input: HTMLTextAreaElement | null = null;
    if (editing) {
      input = mk('textarea', 'ms-input ms-ai__input');
      input.id = 'ms-ai-rw-edit';
      input.rows = Math.min(8, Math.max(3, Math.ceil(suggested.length / 60)));
      input.value = suggested.trim();
      const lab = mk('label', 'ms-ai__tag', 'Yours');
      lab.htmlFor = input.id;
      out.push(lab, input);
    } else {
      // the diff, with the suggestion's copy icon (what is copied is the new words, plain)
      const view = copyable(suggested.trim(), { label: 'the suggested words', className: 'ms-ai-rw__diffwrap' });
      const text = view.querySelector('.ms-copyable__text')!;
      text.className = 'ms-copyable__text ms-ai-rw__diff';
      text.removeAttribute('title');
      text.replaceChildren(
        ...parts.map((p) => {
          if (p.op === 'same') return document.createTextNode(p.text);
          const x = mk(p.op === 'del' ? 'del' : 'ins', `ms-ai-rw__${p.op}`, p.text);
          x.title = p.op === 'del' ? 'Taken out' : 'Put in';
          return x;
        }),
      );
      out.push(view);
    }
    const ed = d.getEditor();
    if (ed && range && mixedMarks(ed, range.from, range.to)) out.push(mk('p', 'ms-ai__note', 'The selection has a link or formatting on part of it: accepting keeps the words, not those.'));
    const why = mk('p', 'ms-ai__why');
    why.setAttribute('role', 'alert');
    why.hidden = true;
    const accept = () => {
      const refused = apply(original, input ? `${/^\s*/.exec(original)![0]}${input.value.trim()}${/\s*$/.exec(original)![0]}` : suggested);
      if (refused) {
        why.textContent = refused;
        why.hidden = false;
        place();
      }
    };
    const acts = mk('div', 'ms-ai__acts');
    acts.append(
      btn('ms-btn--primary', 'Accept', accept, { 'data-ai-accept': '' }),
      editing ? btn('', 'Cancel edit', () => draw(el, body, s, original, suggested), { 'data-ai-edit': '' }) : btn('', 'Edit then accept', () => (draw(el, body, s, original, suggested, true), body.querySelector<HTMLElement>('textarea')?.focus()), { 'data-ai-edit': '' }),
      mk('span', 'ms-ai__grow'),
      btn('ms-btn--quiet', 'Other choices', () => router.go({ suggest: { kind: 'rewrite', sel: s.sel } }, true), { 'data-ai-other': '' }),
      btn('ms-btn--quiet', 'Reject', close, { 'data-ai-dismiss': '' }),
    );
    out.push(why, acts, mk('p', 'ms-ai__note', 'Written by AI: read it before you accept. Accepting changes the page like typing (⌘Z undoes it); ⌘S saves it.'));
    body.replaceChildren(...out);
    place();
  }

  /** Accept: one change on the canvas, as typing is; words why not, or null. */
  function apply(original: string, next: string): string | null {
    const no = d.readOnly();
    if (no) return no;
    const ed = d.getEditor();
    if (!ed || !range) return 'The page is not open any more.';
    const { from, to } = range;
    const now = selectionOf(ed, from, to);
    if (now.text !== original) return 'The selected words changed since you asked. Close this and select them again.';
    if (next === original) {
      close();
      return null;
    }
    const before = ed.state.doc;
    ed.view.dispatch(ed.state.tr.insertText(next, from, to).scrollIntoView());
    // a locked block (lock-ui.ts) turns the change away
    if (ed.state.doc.eq(before)) return 'This block is locked, so its words can’t be changed here.';
    const end = from + next.length;
    // the card goes first, then the words are selected and the canvas has the keys again (⌘Z, ⌘S)
    teardown(false);
    close();
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, from, end)).setMeta('addToHistory', false));
    ed.view.focus();
    toast('Changed with the AI’s suggestion. ⌘Z takes it back; ⌘S saves it.', 'ok', { action: { label: 'Undo', run: () => void ed.chain().focus().undo().run() } });
    return null;
  }

  function open(s: { sel: [number, number]; how?: RewriteMode }): void {
    const ed = d.getEditor();
    if (!ed) return;
    const k = `${s.sel[0]}-${s.sel[1]}|${s.how ?? ''}`;
    if (pop && key === k) return place();
    const sel = selectionOf(ed, s.sel[0], s.sel[1]);
    if (sel.text === null) {
      router.go({ suggest: null });
      return void toast(sel.why, 'info');
    }
    pop?.remove();
    range = { from: s.sel[0], to: s.sel[1] };
    mark(ed, range);
    key = k;
    const { el, body } = shell(s.how ? `Improve with AI: ${labelOf(s.how)}` : 'Improve with AI');
    pop = el;
    if (s.how) void ask(el, body, { sel: s.sel, how: s.how }, sel.text);
    else {
      el.dataset.aiState = 'choose';
      choices(body, s);
    }
    place();
    requestAnimationFrame(() => {
      if (pop !== el) return;
      (el.querySelector<HTMLElement>('.ms-ai-rw__choice') ?? el).focus();
    });
  }

  addEventListener('scroll', () => place(), true);
  addEventListener('resize', () => place());

  return {
    button,
    /** the URL changed (or the canvas was drawn): the card follows it */
    follow(): void {
      const s = router.route().suggest;
      if (!offered && d.where()) offer();
      if (s?.kind === 'rewrite' && d.where()) open(s);
      else if (pop || range) teardown(!s);
    },
    /** the canvas changed: the card stays beside the selection */
    update: place,
    /** asked again after AI was turned on or off on the server */
    offer,
  };
}

export type RewriteHelp = ReturnType<typeof rewriteHelp>;
