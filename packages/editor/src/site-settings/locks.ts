// Settings → Locks (#/settings/locks?kind=articles&type=faq): the site's lock rules (config `locks`) as a list, a row
// per article box and page section, each with what can't be done there on every page (moved, deleted, changed).
// Owner and administrator change them (the server's GET / PUT site/locks, audited); where the server does not offer
// that (dev mode), the list shows the rules as markstage.config.mjs has them, read only. On one page an editor can
// still lift a rule with the block's padlock (lock-ui.ts).
import { ApiError, request } from '../api';
import { copyable } from '../copy';
import type { ScreenCtx } from '../host';
import { ic } from '../icons';
import { PARTS, type LockPart } from '../locks';
import { h, ht } from '../panel-form';
import { boxes, config, viewerRole } from '../runtime';

type Kind = 'articles' | 'pages';
type Rule = Partial<Record<LockPart, boolean>>;
interface LocksDoc {
  rules: Record<Kind, Record<string, Rule>>;
  kinds: Record<Kind, { type: string; label: string }[]>;
  version?: string;
}

const KINDS: [Kind, string, string][] = [
  ['articles', 'Article boxes', 'Boxes in an article, by block name (a run of the same box counts as one).'],
  ['pages', 'Page sections', 'Sections of a page, by section type.'],
];
const SAYS: Record<LockPart, string> = { move: 'moved', remove: 'deleted', edit: 'changed' };

/** Rules as {type: {move: true, …}}, only what holds (the server and the config may say it as a list). */
const tidy = (rules: Partial<Record<Kind, Record<string, unknown>>> | undefined): LocksDoc['rules'] => {
  const side = (r: Record<string, unknown> = {}) =>
    Object.fromEntries(
      Object.entries(r)
        .map(([type, v]) => [type, Object.fromEntries(PARTS.filter((w) => (Array.isArray(v) ? v.includes(w) : (v as Rule)?.[w] === true)).map((w) => [w, true]))] as const)
        .filter(([, v]) => Object.keys(v).length),
    );
  return { articles: side(rules?.articles), pages: side(rules?.pages) };
};

/** The rules and the kinds to list: the server's, else the config's (read only). */
async function load(): Promise<{ doc: LocksDoc; writable: boolean }> {
  try {
    const doc = await request<LocksDoc>('site/locks');
    // every box the editor knows (the built-in ones too), by the name the editor shows it with
    const known = new Map(boxes().map((b) => [b.name, b.label]));
    const articles = [...new Set([...known.keys(), ...doc.kinds.articles.map((k) => k.type)])].map((type) => ({ type, label: known.get(type) ?? doc.kinds.articles.find((k) => k.type === type)!.label }));
    return { doc: { ...doc, rules: tidy(doc.rules), kinds: { ...doc.kinds, articles } }, writable: ['owner', 'administrator'].includes(viewerRole()) };
  } catch (err) {
    if (!(err instanceof ApiError) || (err.status !== 404 && err.status !== 405)) throw err;
    const rules = tidy(config().locks as never);
    const known = new Set(boxes().map((b) => b.name));
    const kinds: LocksDoc['kinds'] = {
      articles: [...boxes().map((b) => ({ type: b.name, label: b.label })), ...Object.keys(rules.articles).filter((t) => !known.has(t)).map((type) => ({ type, label: type }))],
      pages: Object.keys(rules.pages).map((type) => ({ type, label: type })),
    };
    return { doc: { rules, kinds }, writable: false };
  }
}

export function mountLocks(el: HTMLElement, ctx: ScreenCtx): { update(c: ScreenCtx): void } {
  let state: { doc: LocksDoc; writable: boolean } | null = null;
  let draft: LocksDoc['rules'] | null = null;
  const dirty = () => !!state && !!draft && JSON.stringify(draft) !== JSON.stringify(state.doc.rules);
  ctx.guard(dirty);

  const draw = () => {
    el.replaceChildren();
    const intro = h('div', 'ms-locks__intro');
    intro.append(h('h2', 'ms-locks__title', 'Locks'), h('p', 'ms-locks__lead', 'What the site keeps in place on every page. On one page, an editor can still lift a lock with the block’s padlock.'));
    el.append(intro);
    if (!state || !draft) return void el.append(h('p', 'ms-locks__lead', 'Loading…'));
    if (!state.writable) el.append(h('p', 'ms-locks__note', ['owner', 'administrator'].includes(viewerRole()) ? 'Read only for now: the rules are in markstage.config.mjs (`locks`). Change them there.' : 'Only an owner or an administrator changes these.'));
    const picked = { kind: ctx.params().get('kind'), type: ctx.params().get('type') };
    for (const [kind, title, about] of KINDS) {
      const list = state.doc.kinds[kind];
      if (!list.length) continue;
      const sec = h('section', 'ms-locks__group');
      sec.append(h('h3', 'ms-locks__h', title), h('p', 'ms-locks__lead', about));
      const table = h('div', 'ms-locks__rows');
      table.setAttribute('role', 'list');
      for (const { type, label } of list) {
        const rule = draft[kind][type] ?? {};
        const row = h('div', `ms-locks__row${PARTS.some((w) => rule[w]) ? ' is-locked' : ''}${picked.kind === kind && picked.type === type ? ' is-picked' : ''}`);
        row.setAttribute('role', 'listitem');
        row.dataset.type = type;
        const name = h('div', 'ms-locks__name');
        name.innerHTML = ic(PARTS.some((w) => rule[w]) ? 'lock' : 'unlock', 14);
        // the name people know it by, then its type in the config (once, when they are the same)
        if (label !== type) name.append(Object.assign(h('strong'), { textContent: label }));
        name.append(copyable(type, { label: `the ${label} type`, className: 'ms-locks__type' }));
        const parts = h('div', 'ms-locks__parts');
        for (const w of PARTS) {
          const l = h('label', 'ms-locks__part');
          const c = Object.assign(h('input'), { type: 'checkbox', checked: !!rule[w], disabled: !state.writable });
          c.setAttribute('aria-label', `${label}: can't be ${SAYS[w]}`);
          c.addEventListener('change', () => {
            const next = { ...(draft![kind][type] ?? {}), [w]: c.checked };
            if (!PARTS.some((x) => next[x])) delete draft![kind][type];
            else draft![kind][type] = Object.fromEntries(PARTS.filter((x) => next[x]).map((x) => [x, true]));
            draw();
            el.querySelector<HTMLElement>(`[data-type="${CSS.escape(type)}"] input[aria-label$="${SAYS[w]}"]`)?.focus();
          });
          l.append(c, document.createTextNode(`Can't be ${SAYS[w]}`));
          parts.append(l);
        }
        row.append(name, parts);
        table.append(row);
      }
      sec.append(table);
      el.append(sec);
    }
    if (state.writable) {
      const bar = h('div', 'ms-locks__bar');
      const save = Object.assign(h('button', 'ms-btn ms-btn--primary'), { type: 'button', textContent: 'Save the rules', disabled: !dirty() });
      const undo = Object.assign(h('button', 'ms-btn ms-btn--quiet'), { type: 'button', textContent: 'Discard', disabled: !dirty() });
      save.addEventListener('click', () => void store());
      undo.addEventListener('click', () => ((draft = structuredClone(state!.doc.rules)), draw()));
      bar.append(save, undo, h('span', 'ms-locks__note', dirty() ? 'Not saved yet. Every page follows the rules once saved.' : 'Every page follows these rules.'));
      el.append(bar);
    }
    el.querySelector('.is-picked')?.scrollIntoView({ block: 'center' });
  };

  const store = async () => {
    if (!state || !draft) return;
    try {
      const r = await request<{ rules: LocksDoc['rules']; version?: string }>('site/locks', { method: 'PUT', body: JSON.stringify({ rules: draft, version: state.doc.version }) });
      state.doc = { ...state.doc, rules: tidy(r.rules), version: r.version };
      draft = structuredClone(state.doc.rules);
      // this editor follows the new rules at once (the padlocks, the grip, the Outline)
      config().locks = state.doc.rules;
      ctx.toast('The lock rules are saved; every page follows them.', 'ok');
    } catch (err) {
      ctx.toast(err instanceof ApiError && err.status === 409 ? 'Someone changed the rules meanwhile: reload to see theirs.' : `Not saved: ${(err as Error).message}`, 'error');
    }
    draw();
  };

  draw();
  void load().then(
    (s) => {
      state = s;
      draft = structuredClone(s.doc.rules);
      draw();
    },
    (err) => el.replaceChildren(ht('p', 'ms-locks__note', `The lock rules did not load: ${(err as Error).message}`)),
  );
  return { update: () => draw() };
}
