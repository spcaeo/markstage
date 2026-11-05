// AI link suggestions (docs/API-AI.md "links"), beside the page's own in Post settings → Topic and links
// (settings/topic-box.ts), at ?s=1&suggest=links. The AI picks pages of the site from its link index and words of this
// article to link to them; the server checks each (the page is there, live or a draft the writer may see, not
// linked yet; the words are in the text). Each comes with its page (address with copy and open), why, and the words,
// and Add link or Dismiss. Add link links the first place the words stand unlinked: one change on the canvas, ⌘Z
// takes it back, ⌘S saves it (the surgical save writes only that link). Nothing changes until the writer adds one.
import '../styles/ai.css';
import { copyable } from '../copy';
import { ic } from '../icons';
import { aiInfo, offTrouble, suggestLinks, trouble, type AiLink, type AiTrouble, type SuggestBody } from './api';
import type { Card } from './card';

export interface LinksSpec {
  /** what to ask for, read when asked (the text as it is then) */
  body(): Extract<SuggestBody, { kind: 'links' }>;
  /** adds the link on the canvas; words when it can't */
  add(l: AiLink): string | null;
  /** Close, Escape: the place closes the card (the URL follows) */
  close(): void;
}

const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const btn = (cls: string, text: string, data: string, run: () => void) => {
  const b = mk('button', `ms-btn ms-btn--sm ${cls}`.trim(), text);
  b.type = 'button';
  b.dataset[data] = '';
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    run();
  });
  return b;
};

export function linksCard(spec: LinksSpec): Card {
  const el = mk('section', 'ms-ai ms-ai-links');
  el.setAttribute('aria-labelledby', 'ms-ai-links-title');
  el.dataset.msUi = '';
  el.tabIndex = -1;
  const head = mk('header', 'ms-ai__head');
  const h = mk('h3', 'ms-ai__title');
  h.id = 'ms-ai-links-title';
  h.innerHTML = ic('sparkle', 14);
  h.append('Suggested links');
  const x = mk('button', 'ms-iconbtn ms-ai__x');
  x.type = 'button';
  x.innerHTML = ic('x', 14);
  x.setAttribute('aria-label', 'Close the suggested links');
  x.title = 'Close (Esc)';
  x.addEventListener('click', (e) => (e.stopPropagation(), spec.close()));
  head.append(h, x);
  const body = mk('div', 'ms-ai__body');
  body.setAttribute('aria-live', 'polite');
  el.append(head, body);
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    e.preventDefault();
    spec.close();
  });

  let alive = true;
  let asked = 0;
  let waitTimer = 0;
  let items: (AiLink & { state: 'open' | 'added' })[] = [];
  let dropped = 0;
  let model: string | null = null;

  async function ask(): Promise<void> {
    const n = ++asked;
    clearTimeout(waitTimer);
    el.dataset.aiState = 'loading';
    const busy = mk('p', 'ms-ai__state', 'Asking the AI for links to the site’s pages…');
    busy.setAttribute('role', 'status');
    body.setAttribute('aria-busy', 'true');
    body.replaceChildren(busy);
    const info = await aiInfo();
    if (!alive || n !== asked) return;
    if (!info.on) return drawTrouble(offTrouble(info));
    try {
      const r = await suggestLinks(spec.body());
      if (!alive || n !== asked) return;
      items = r.links.map((l) => ({ ...l, state: 'open' }));
      dropped = r.dropped;
      model = r.model;
      draw();
    } catch (err) {
      if (alive && n === asked) drawTrouble(trouble(err));
    }
  }

  function drawTrouble(t: AiTrouble): void {
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

  function item(l: (typeof items)[number]): HTMLElement {
    const li = mk('li', `ms-ai-links__item${l.state === 'added' ? ' is-done' : ''}`);
    li.dataset.aiLink = l.to;
    const to = mk('div', 'ms-ai-links__to');
    to.append(mk('strong', 'ms-ai-links__title', l.title));
    if (l.status === 'draft') to.append(mk('span', 'ms-ai-links__draft', 'Draft'));
    to.append(copyable(l.url, { label: 'page address', open: l.url, className: 'ms-ai-links__url' }));
    const words = mk('div', 'ms-ai-links__words');
    words.append(mk('span', 'ms-ai__tag', 'Words to link'), copyable(l.words, { label: 'words to link', className: 'ms-ai__text' }));
    li.append(to, mk('p', 'ms-ai-links__why', l.reason), words);
    if (l.status === 'draft') li.append(mk('p', 'ms-ai__note', 'A draft: the link leads nowhere until that page is published.'));
    const why = mk('p', 'ms-ai__why');
    why.setAttribute('role', 'alert');
    why.hidden = true;
    const acts = mk('div', 'ms-ai__acts');
    if (l.state === 'added') acts.append(mk('span', 'ms-ai-links__added', 'Linked. ⌘S saves it.'));
    else
      acts.append(
        btn('ms-btn--primary', 'Add link', 'aiAccept', () => {
          const refused = spec.add(l);
          if (refused) {
            why.textContent = refused;
            why.hidden = false;
            return;
          }
          l.state = 'added';
          draw();
        }),
        btn('ms-btn--quiet', 'Dismiss', 'aiDismissOne', () => {
          items = items.filter((y) => y !== l);
          draw();
          (el.querySelector<HTMLElement>('[data-ai-accept]') ?? el).focus();
        }),
      );
    li.append(why, acts);
    return li;
  }

  function draw(): void {
    el.dataset.aiState = 'ready';
    body.removeAttribute('aria-busy');
    const out: HTMLElement[] = [];
    const open = items.filter((l) => l.state === 'open').length;
    if (!items.length) out.push(mk('p', 'ms-ai__state', dropped ? 'No links to suggest this time.' : 'No links to suggest this time: the AI found no page of the site this text should link to.'));
    else out.push(mk('p', 'ms-ai-links__lead', open ? `${open} link${open === 1 ? '' : 's'} to the site’s own pages. Read each before you add it.` : 'All done. ⌘S saves the links you added.'));
    if (items.length) {
      const list = mk('ol', 'ms-ai-links__list');
      list.append(...items.map(item));
      out.push(list);
    }
    if (dropped) out.push(mk('p', 'ms-ai__note', `${dropped} more ${dropped === 1 ? 'idea was' : 'ideas were'} left out: a page the site does not have, words that are not in the text, or a page this one links to already.`));
    const acts = mk('div', 'ms-ai__acts');
    acts.append(mk('span', 'ms-ai__grow'), btn('ms-btn--quiet', 'Suggest again', 'aiRetry', () => void ask()), btn('ms-btn--quiet', 'Close', 'aiDismiss', () => spec.close()));
    out.push(acts, mk('p', 'ms-ai__note', `Written by AI${model ? ` (${model})` : ''}. Nothing changes until you add a link; ⌘Z takes one back.`));
    body.replaceChildren(...out);
  }

  void ask();
  requestAnimationFrame(() => {
    if (alive && el.isConnected && !el.contains(document.activeElement)) el.focus();
  });
  return {
    el,
    sync: () => {},
    destroy: () => {
      alive = false;
      clearTimeout(waitTimer);
      el.remove();
    },
  };
}
