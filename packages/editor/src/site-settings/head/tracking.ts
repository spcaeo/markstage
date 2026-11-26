// Settings → Tracking (#/settings/tracking): one field per analytics tool, by its ID only (Markstage writes the loader
// itself, so no pasted code runs), each ID checked as it is typed with the pattern the build uses; when Google Tag
// Manager loads; a note that consent banners live inside the tag manager. Owner and administrator; the server's
// GET / PUT head (docs/HEAD-KIT.md), committed as the person and followed by a build.
import type { ScreenCtx } from '../../host';
import { h, ht } from '../../panel-form';
import { type Tracker, isStale, issuesOf, trackerOk } from './check';
import { type HeadDoc, type Raw, saveHead } from './doc';
import { type BarState, saveBar, textField, uid } from './fields';
import { type Part, mountHeadPart } from './screen';

const LOADS: [string, string][] = [
  ['first-interaction', 'On the first click, key or scroll (faster pages)'],
  ['at-once', 'At once'],
];
interface Draft {
  ids: Record<string, string>;
  gtmLoad: string;
}

const draftOf = (doc: HeadDoc): Draft => ({ ids: Object.fromEntries((doc.trackers ?? []).map((t) => [t.id, doc.head?.tracking[t.id] ?? ''])), gtmLoad: doc.head?.tracking.gtmLoad ?? 'first-interaction' });
const wrong = (t: Tracker, v: string) => `“${v.trim()}” is not a ${t.label} ID (such as ${t.example}).`;

function make(doc: HeadDoc, ctx: ScreenCtx, reload: () => Promise<void>): Part {
  const trackers = doc.trackers ?? [];
  const edit = doc.canEdit;
  let draft = draftOf(doc);
  const base = JSON.stringify(draft);
  let stale = false;
  let saving = false;
  const dirty = () => JSON.stringify(draft) !== base;
  const blocked = () => trackers.some((t) => !trackerOk(t, draft.ids[t.id] ?? ''));
  const state = (): BarState => ({ dirty: dirty(), blocked: blocked(), saving, stale });

  const bar = saveBar({
    save: 'Save the tracking',
    saved: 'Saved.',
    unsaved: 'Not saved yet. Every page gets the change once it is saved and the site is built.',
    onSave: () => void store(),
    onDiscard: () => void reload(),
    onReload: () => void reload(),
  });

  const root = h('div', 'ms-hk');
  const group = h('section', 'ms-locks__group');
  group.append(h('h3', 'ms-locks__h', 'Tools'), ht('p', 'ms-locks__lead', 'Type the ID of each tool you use. Leave a field empty to keep that tool off.'));
  const fields = h('div', 'ms-hk__fields');
  for (const t of trackers) {
    const f = textField({
      label: t.label,
      hint: t.hint,
      value: draft.ids[t.id] ?? '',
      placeholder: t.example,
      mono: true,
      disabled: !edit,
      onInput: (v) => {
        draft.ids[t.id] = v;
        f.setMessage(trackerOk(t, v) ? '' : wrong(t, v));
        bar.render(state());
      },
    });
    f.input.dataset.tracker = t.id;
    fields.append(f.field);
  }
  group.append(fields);

  const load = h('fieldset', 'ms-hk__radios');
  const hintId = uid('ms-hk-hint');
  load.setAttribute('aria-describedby', hintId);
  load.append(ht('legend', 'ms-hk__label', 'When should Google Tag Manager load?'));
  const name = uid('ms-hk-load');
  for (const [value, text] of LOADS) {
    const l = h('label', 'ms-hk__radio');
    const r = Object.assign(h('input'), { type: 'radio', name, value, checked: draft.gtmLoad === value, disabled: !edit });
    r.addEventListener('change', () => {
      if (r.checked) draft.gtmLoad = value;
      bar.render(state());
    });
    l.append(r, document.createTextNode(text));
    load.append(l);
  }
  const loadHint = ht('p', 'ms-hk__hint', 'Loading it on the first click, key press or scroll keeps pages fast. “At once” also counts visitors who leave without touching the page. It only matters when a Tag Manager ID is set.');
  loadHint.id = hintId;
  load.append(loadHint);
  group.append(load);

  const consent = ht('p', 'ms-locks__note', 'Cookie consent banners belong inside your tag manager. Markstage does not add one.');
  root.append(group, consent);
  if (edit) root.append(bar.el);
  bar.render(state());

  const store = async () => {
    if (!dirty() || blocked() || saving) return;
    saving = true;
    bar.render(state());
    const raw: Raw = { ...(doc.settings ?? {}) };
    const t: Raw = {};
    for (const k of trackers) if (draft.ids[k.id]?.trim()) t[k.id] = draft.ids[k.id]!.trim();
    if (Object.keys(t).length || draft.gtmLoad !== 'first-interaction') t.gtmLoad = draft.gtmLoad;
    if (Object.keys(t).length) raw.tracking = t;
    else delete raw.tracking;
    try {
      await saveHead(doc, raw, ctx, 'The tracking is saved. Every page gets it once the site is built.', () => void reload());
      await reload();
    } catch (err) {
      saving = false;
      if (isStale(err)) stale = true;
      else {
        // the server's refusal, under the field it is about
        for (const [path, message] of issuesOf(err)) {
          const id = /^tracking\.(\w+)$/.exec(path)?.[1];
          const input = id ? root.querySelector<HTMLInputElement>(`[data-tracker="${id}"]`) : null;
          input?.setAttribute('aria-invalid', 'true');
          input?.closest('.ms-hk__field')?.querySelector('.ms-hk__msg')?.replaceChildren(message);
        }
        ctx.toast(`Not saved: ${(err as Error).message}`, 'error');
      }
      bar.render(state());
    }
  };

  return { el: root, dirty, update: () => undefined };
}

export function mountTracking(el: HTMLElement, ctx: ScreenCtx): { update(c: ScreenCtx): void } {
  return mountHeadPart(el, ctx, {
    title: 'Tracking',
    lead: 'Add your analytics and tag tools by their ID. Markstage writes the code itself into every page, so nothing is pasted and nothing unknown can run.',
    owns: ['tracking'],
    make: (doc, reload) => make(doc, ctx, reload),
  });
}
