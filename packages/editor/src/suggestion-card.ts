// One link suggestion as a card (docs/API-LINKS.md), shared by the topic part of a page's settings and the Links
// screen: the page to change (with its address, copy and open), why, the sentence with the words to link marked, and
// its buttons. Accept changes that page on the server (one commit, Undo on the toast); Skip remembers the choice for
// everyone; "Link these words" (the open page's own suggestions) links them on the canvas, saved with the page.
import { request } from './api';
import { copyable } from './copy';
import { toast } from './host';
import { ic } from './icons';
import { h } from './panel-form';
import { acceptSuggestion, marked, skipSuggestion, type Suggestion } from './topics';

const say = (e: unknown) => (e instanceof Error ? e.message : String(e));
const text = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, words: string) => Object.assign(h(tag, cls), { textContent: words });

export interface CardOpts {
  /** links the words on the open page's canvas; false when they are not there any more */
  linkHere?: (s: Suggestion) => boolean;
  /** after Accept or Skip (the list draws again); `undone` after an Undo */
  done: (s: Suggestion, what: 'accepted' | 'skipped' | 'linked' | 'undone') => void;
  /** go to an editor address (the page at the sentence) */
  open: (hash: string) => void;
  /** the card shows the page it links to (in the inbox) rather than the page it is on */
  showTarget?: boolean;
  /** Accept on a link out too (the Topic map's missing links): it changes the page the link is on, as for one in */
  accept?: boolean;
}

function button(label: string, iconName: string, run: () => void, kind = ''): HTMLButtonElement {
  const b = h('button', `ms-btn ms-btn--sm${kind ? ` ms-btn--${kind}` : ''}`);
  b.type = 'button';
  b.innerHTML = `${ic(iconName, 13)}<span></span>`;
  b.querySelector('span')!.textContent = label;
  b.addEventListener('click', run);
  return b;
}

/** Undo a link someone just accepted (the site's undo of that commit). */
export const undo = (commit: string) => request<{ undone: unknown[]; skipped: { title: string }[] }>('site/undo', { method: 'POST', body: JSON.stringify({ commit }) });

export function suggestionCard(s: Suggestion, o: CardOpts): HTMLElement {
  const card = h('article', `ms-sugg ms-sugg--${s.how}`);
  card.dataset.suggestion = s.id;
  card.tabIndex = -1;
  const inbound = s.dir === 'in';
  // the page to change (inbound: the other page) and the page the link goes to
  const head = h('div', 'ms-sugg__head');
  const where = inbound ? { title: s.fromTitle, url: s.fromUrl } : { title: s.toTitle, url: s.toUrl };
  head.append(text('strong', 'ms-sugg__title', where.title));
  if (where.url) head.append(copyable(where.url, { label: 'page address', open: where.url, className: 'ms-sugg__url' }));
  card.append(head);
  if (o.showTarget && inbound) card.append(text('p', 'ms-sugg__to', `Link to “${s.toTitle}”`));
  card.append(text('p', 'ms-sugg__why', s.reason));
  if (s.how === 'link' && s.sentence) {
    const [a, w, z] = marked(s);
    const q = h('blockquote', 'ms-sugg__sentence');
    q.append(document.createTextNode(a), text('mark', '', w), document.createTextNode(z));
    card.append(q);
  } else {
    const p = h('p', 'ms-sugg__add');
    p.append(document.createTextNode('No sentence for it yet. Write one with the words '), text('mark', '', s.anchor), document.createTextNode('.'));
    card.append(p);
  }
  const words = h('div', 'ms-sugg__words');
  words.append(text('span', 'ms-sugg__label', 'Words to link'), copyable(s.anchor, { label: 'words to link' }));
  card.append(words);

  const actions = h('div', 'ms-sugg__actions');
  const busy = (on: boolean) => actions.querySelectorAll('button').forEach((b) => (b.disabled = on));
  if (inbound || o.accept) {
    if (s.how === 'link')
      actions.append(
        button('Accept', 'check', async () => {
          busy(true);
          try {
            const r = await acceptSuggestion(s);
            card.classList.add('is-done');
            o.done(s, 'accepted');
            toast(`Linked “${s.anchor}” on “${s.fromTitle}”.${r.job ? ' Publishing it.' : ''}`, 'ok', r.commit ? { action: { label: 'Undo', run: () => void undo(r.commit!).then(() => (toast('Undone.', 'ok'), o.done(s, 'undone')), (e) => toast(say(e), 'error')) } } : {});
          } catch (e) {
            busy(false);
            toast(say(e), 'error');
          }
        }, 'primary'),
      );
  } else if (s.how === 'link' && o.linkHere) {
    actions.append(
      button('Link these words', 'link', () => {
        if (o.linkHere!(s)) {
          o.done(s, 'linked');
          toast(`Linked “${s.anchor}”. Save (⌘S) to keep it.`, 'ok');
        } else toast('Those words are not on the page any more.', 'info');
      }, 'primary'),
    );
  }
  actions.append(button(inbound ? 'Open the page' : s.how === 'link' ? 'Show me' : 'Open', 'open', () => o.open(s.open)));
  actions.append(
    button('Skip', 'x', async () => {
      busy(true);
      try {
        await skipSuggestion(s);
        o.done(s, 'skipped');
      } catch (e) {
        busy(false);
        toast(say(e), 'error');
      }
    }, 'quiet'),
  );
  card.append(actions);
  return card;
}
