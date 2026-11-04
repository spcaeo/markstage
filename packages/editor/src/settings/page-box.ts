// The Page box (docs/API-PAGE-TYPES.md): what the page is (its type: a money page, an article…), how the site lays it
// out (its frame: full width, reading, plain; "as its type" or "as its collection" when it has no choice of its own),
// and what its type still needs (the type's checks of the saved page, with "Check again"). At the top of Post
// settings for an article, at the top of the sections list for a page. The type and frame are pending changes like
// every other setting (⌘S saves); an existing page's type changes for owners, administrators and editors only.
import { ic } from '../icons';
import { h } from '../panel-form';
import { aLabel, frameKey, framesConfig, inheritedFrame, pageChecks, typeKey, typeOf, typesFor, type PageChecks } from '../page-types';
import { viewerRole } from '../runtime';
import '../styles/page-box.css';
import type { DrawnField } from './fields';

export interface PageBoxCtx {
  collection: string;
  /** the pending values (Post settings' edits, or the page model's) */
  edits: { get(path: string): unknown; set(path: string, value: unknown): void; may?(path: string): boolean };
  /** the saved entry's id, for its checks (null: not saved yet) */
  id: () => string | null;
  /** the type the saved file has (an existing page's type changes for editors and above) */
  savedType: () => unknown;
  /** the pending values differ from the saved file (the checks are of the saved page) */
  dirty: () => boolean;
}

const EDITORS = ['owner', 'administrator', 'editor'];
let uid = 0;
/** An element with plain text in it (labels and messages are the site's words: never HTML). */
const t = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text: string) => Object.assign(h(tag, cls), { textContent: text });

export function pageBox(ctx: PageBoxCtx): DrawnField & { recheck: () => void } {
  const n = ++uid;
  const types = typesFor(ctx.collection);
  const fr = framesConfig();
  const el = h('section', 'ms-pagebox');
  el.setAttribute('aria-label', 'Page');

  // what the page is
  const typeSel = h('select', 'ms-input');
  typeSel.id = `ms-pagebox-type-${n}`;
  const typeHint = h('div', 'ms-field__hint');
  if (types.length) {
    const f = h('div', 'ms-field');
    const lab = t('label', 'ms-field__label', 'Page type');
    lab.htmlFor = typeSel.id;
    typeSel.append(new Option('No type', ''), ...types.map((x) => new Option(x.label, x.id)));
    typeSel.addEventListener('change', () => {
      ctx.edits.set(typeKey(), typeSel.value || null);
      // the type's locks hold now (the padlocks draw again)
      dispatchEvent(new Event('ms-lock-rules'));
      sync();
    });
    f.append(lab, typeSel, typeHint);
    el.append(f);
  }

  // how the site lays it out
  const frameBox = h('fieldset', 'ms-pagebox__frames');
  const radios: HTMLInputElement[] = [];
  const frameHint = h('div', 'ms-field__hint');
  if (fr?.list.length) {
    frameBox.append(t('legend', 'ms-field__label', 'Frame'));
    const choice = (value: string, label: HTMLElement) => {
      const lab = h('label', 'ms-pagebox__frame');
      const r = h('input');
      Object.assign(r, { type: 'radio', name: `ms-pagebox-frame-${n}`, value });
      r.addEventListener('change', () => {
        ctx.edits.set(frameKey(), r.value || null);
        sync();
      });
      radios.push(r);
      lab.append(r, label);
      frameBox.append(lab);
    };
    choice('', h('span', 'ms-pagebox__inherit'));
    for (const f of fr.list) choice(f.id, t('span', '', f.label));
    frameBox.append(frameHint);
    el.append(frameBox);
  }

  // what its type still needs
  const checks = h('div', 'ms-pagebox__checks');
  checks.setAttribute('aria-live', 'polite');
  el.append(checks);
  let result: PageChecks | null = null;
  let checking = false;
  let failed = '';
  const run = async () => {
    const id = ctx.id();
    if (!id || !types.length) return void ((result = null), drawChecks());
    checking = true;
    failed = '';
    drawChecks();
    try {
      result = await pageChecks(ctx.collection, id);
    } catch (e) {
      result = null;
      failed = e instanceof Error ? e.message : String(e);
    }
    checking = false;
    drawChecks();
  };
  let drawnFor = '';
  const drawChecks = () => {
    drawnFor = `${String(ctx.edits.get(typeKey()) ?? '')}|${ctx.dirty()}`;
    checks.replaceChildren();
    const type = typeOf(ctx.collection, ctx.edits.get(typeKey()));
    if (!type || !type.checks.length) return;
    const head = h('div', 'ms-pagebox__checkhead');
    head.append(t('span', 'ms-field__label', `What ${aLabel(type.label)} needs`));
    const again = h('button', 'ms-btn ms-btn--sm');
    again.type = 'button';
    again.innerHTML = `${ic('refresh', 13)}<span>Check again</span>`;
    again.disabled = checking || !ctx.id();
    again.addEventListener('click', () => void run());
    head.append(again);
    checks.append(head);
    if (checking) return void checks.append(t('p', 'ms-field__hint', 'Checking the page…'));
    if (failed) return void checks.append(t('p', 'ms-pagebox__note is-bad', `The checks could not run: ${failed}`));
    if (!ctx.id()) return void checks.append(t('p', 'ms-field__hint', 'Checked once the page is saved.'));
    // the saved page's checks; another type chosen and not saved yet: its checks once saved
    if (!result || result.type?.id !== type.id) return void checks.append(t('p', 'ms-field__hint', `Save (⌘S), then check again: the checks are of the saved page.`));
    const list = h('ul', 'ms-pagebox__list');
    for (const k of result.checks) {
      const li = h('li', `ms-pagebox__check ${k.ok ? 'is-ok' : k.level === 'block' ? 'is-block' : 'is-warn'}`);
      li.innerHTML = ic(k.ok ? 'check' : k.level === 'block' ? 'x' : 'alert', 14);
      const words = h('div', 'ms-pagebox__words');
      words.append(t('span', 'ms-pagebox__label', k.label));
      if (!k.ok) words.append(t('span', 'ms-pagebox__msg', `${k.level === 'block' ? 'Needed to publish. ' : ''}${k.message ?? ''}`));
      li.append(words);
      li.setAttribute('aria-label', `${k.label}: ${k.ok ? 'done' : k.level === 'block' ? 'missing, needed to publish' : 'missing'}`);
      list.append(li);
    }
    checks.append(list);
    if (ctx.dirty()) checks.append(t('p', 'ms-field__hint', 'These are the saved page’s. Save (⌘S), then check again.'));
  };

  const sync = () => {
    const tv = ctx.edits.get(typeKey());
    const type = typeOf(ctx.collection, tv);
    if (types.length) {
      // a value that is not one of the types (an old file) shows as it is, so nothing changes by itself
      if (tv && !type && ![...typeSel.options].some((o) => o.value === String(tv))) typeSel.append(new Option(`${String(tv)} (not a type here)`, String(tv)));
      typeSel.value = tv ? String(tv) : '';
      const saved = ctx.savedType();
      const mayChange = ctx.edits.may?.(typeKey()) !== false && (!ctx.id() || !saved || EDITORS.includes(viewerRole()));
      typeSel.disabled = !mayChange;
      typeHint.textContent = !mayChange && ctx.edits.may?.(typeKey()) !== false ? 'Only an owner, administrator or editor can change what type of page this is.' : (type?.description ?? 'What the page is for: it brings a frame, a template, locks and checks.');
    }
    if (fr?.list.length) {
      const fv = ctx.edits.get(frameKey());
      const inh = inheritedFrame(ctx.collection, type);
      const inherit = radios[0].nextElementSibling as HTMLElement;
      inherit.textContent = inh ? `As its ${inh.from === 'type' ? 'type' : 'collection'} (${inh.frame.label})` : 'As its collection';
      const own = fr.list.find((f) => f.id === fv);
      for (const r of radios) {
        r.checked = r.value === (own ? own.id : '');
        r.disabled = ctx.edits.may?.(frameKey()) === false;
      }
      frameHint.textContent = (own ?? inh?.frame)?.hint ?? '';
    }
    // the checks draw again when the type or the saved state changes (not at every key typed elsewhere)
    if (`${String(tv ?? '')}|${ctx.dirty()}` !== drawnFor) drawChecks();
  };

  sync();
  void run();
  return { el, sync, focus: () => (types.length ? typeSel : radios[0])?.focus(), recheck: () => void run() };
}
