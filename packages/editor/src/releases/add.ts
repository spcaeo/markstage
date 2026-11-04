// #/releases/add?c=<collection>&id=<entry> (from the editor's More menu) or ?lib=<item> (from the Library), with
// to=<release> or to=new: put a page or a shared Library item into a release, so it goes live with it rather than on
// its own. A page open in the editor goes with its unsaved changes, which then leave the editor (they wait in the
// release, not on the site). What the server refuses (a synced Library item, a page with nothing to release, a lock)
// is said in its own words.
import type { ScreenCtx } from '../host';
import { getEntry } from '../api';
import { button, el, failure, isEditorPlus, message, page, state, whoami } from '../admin/ui';
import * as lib from '../reusable/api';
import * as api from './api';
import { openEntry } from './open-entry';
import { countWords, whenWords, STATUS_WORDS } from './words';

type Target =
  | { kind: 'entry'; collection: string; id: string; title: string; version: string; status: string | null; hash: string | null; dirty: boolean }
  | { kind: 'library'; item: lib.LibItem };

export function mountAdd(host: HTMLElement, ctx: ScreenCtx) {
  let alive = true;
  let target: Target | null = null;
  let releases: api.Release[] = [];
  let editor = false;
  /** the Library fields as typed, kept while the screen redraws (the release choice is in the URL) */
  const fields: Record<string, string> = {};

  async function load(): Promise<void> {
    const q = ctx.params();
    const c = q.get('c');
    const id = q.get('id');
    const libId = q.get('lib');
    try {
      const me = await whoami();
      editor = isEditorPlus(me);
      if (c && id) {
        const open = openEntry(c, id);
        const e = await getEntry(c, id);
        target = { kind: 'entry', collection: c, id, title: e.title || id, version: open?.version ?? e.version, status: e.status ?? null, hash: open?.hash ?? null, dirty: !!open?.dirty };
      } else if (libId) target = { kind: 'library', item: await lib.item(libId) };
      else return void page(host, 'Add to a release', '').body.replaceChildren(state('empty', 'Nothing to add', 'Open a page in the editor, or an item in the Library, and choose Add to a release there.'));
      const [open, sched] = await Promise.all([api.list('open'), api.list('scheduled')]);
      releases = [...open.releases, ...sched.releases];
      if (alive) draw();
    } catch (e) {
      if (alive) page(host, 'Add to a release', '').body.replaceChildren(failure(e, () => void load()));
    }
  }

  function draw(): void {
    const t = target!;
    const name = t.kind === 'entry' ? t.title : t.item.name;
    ctx.setTitle(`Add “${name}” to a release`);
    const what =
      t.kind === 'entry'
        ? t.dirty
          ? `“${name}”, with your unsaved changes. They go into the release, not on the site, and leave the editor once added: the editor shows the page as it is saved.`
          : `“${name}” as it is saved now.${t.status === 'draft' ? ' The draft goes live with the release.' : ' It is live already: the release takes it only if it differs from the live page.'}`
        : `A change to the Library item “${name}”: make it below. The Library keeps the item as it is until the release goes live.`;
    const p = page(host, 'Add to a release', what, { narrow: true });
    const to = ctx.params().get('to') ?? (releases[0]?.id ?? 'new');
    const err = el('p.ms-adm-form__err', { role: 'alert' });
    const list = el('div.ms-rel-pick', { role: 'radiogroup', 'aria-label': 'Which release' });
    for (const r of releases) list.append(choice(r.id, to === r.id, el('span.ms-rel-pick__name', r.name), el('span.ms-adm-sub', ` · ${r.blocked ? 'Blocked' : STATUS_WORDS[r.status]}${whenWords(r) ? ` · ${whenWords(r)}` : ''} · ${countWords(r.counts)}`)));
    const nameBox = el('input.ms-input', { id: 'ms-rel-newname', maxlength: '120', placeholder: 'Spring pricing', 'aria-label': 'The new release’s name' });
    if (editor) list.append(choice('new', to === 'new', el('span.ms-rel-pick__name', 'A new release'), el('span.ms-rel-pick__new', nameBox)));
    else if (!releases.length) list.append(el('p.ms-adm-sub', 'There is no open release, and editors and above make them. Ask an editor.'));
    const add = button('Add to the release', () => void go(add, err, nameBox), { kind: 'primary', icon: 'plus' });
    const back = button('Cancel', () => leave(null), { kind: 'quiet' });
    const cards: HTMLElement[] = [];
    if (t.kind === 'library') cards.push(libFields(t.item));
    cards.push(el('section.ms-adm-card', el('h2.ms-adm-h2', 'Which release'), list, err, el('div.ms-adm-actions', add, back)));
    p.body.replaceChildren(...cards);
    add.disabled = !releases.length && !editor;
    if (to === 'new') nameBox.focus();
  }

  /** The Library item's fields as the release will make them (the Library keeps them as they are meanwhile). */
  function libFields(it: lib.LibItem): HTMLElement {
    const box = (key: string, label: string, val: string, max: number, multi = false) => {
      const id = `ms-rel-lib-${key}`;
      const i = multi ? el('textarea.ms-input', { id, name: key, rows: '2', maxlength: String(max) }) : el('input.ms-input', { id, name: key, maxlength: String(max) });
      i.value = (fields[key] ??= val);
      i.addEventListener('input', () => (fields[key] = i.value));
      return el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: id }, label), i);
    };
    return el(
      'section.ms-adm-card.ms-rel-libfields',
      el('h2.ms-adm-h2', 'The change'),
      box('name', 'Name', it.name, 100),
      box('description', 'Description (one line)', it.description, 200, true),
      box('folder', 'Folder', it.folder, 100),
      box('tags', 'Tags, separated by commas', it.tags.join(', '), 400),
    );
  }

  /** What the fields change, as the server takes it; nothing when they are as the item is. */
  function libChange(it: lib.LibItem): Record<string, unknown> | null {
    const v = (k: string, was: string) => (fields[k] ?? was).trim();
    const tags = v('tags', it.tags.join(', ')).split(',').map((x) => x.trim()).filter(Boolean);
    const next = { name: v('name', it.name), description: v('description', it.description), folder: v('folder', it.folder), tags };
    const same = next.name === it.name && next.description === it.description && next.folder === it.folder && tags.join('\n') === it.tags.join('\n');
    return same ? null : next;
  }

  function choice(id: string, on: boolean, ...label: (Node | string)[]): HTMLElement {
    const input = el('input', { type: 'radio', name: 'ms-rel-to', value: id, checked: on });
    input.addEventListener('change', () => ctx.go({ params: { to: id } }, false));
    return el(`label.ms-rel-pick__row${on ? '.is-on' : ''}`, input, ...label);
  }

  async function go(b: HTMLButtonElement, err: HTMLElement, nameBox: HTMLInputElement): Promise<void> {
    const t = target!;
    const to = ctx.params().get('to') ?? (releases[0]?.id ?? 'new');
    err.textContent = '';
    if (to === 'new' && !nameBox.value.trim()) {
      err.textContent = 'Give the new release a name.';
      nameBox.focus();
      return;
    }
    const change = t.kind === 'library' ? libChange(t.item) : null;
    if (t.kind === 'library') {
      // a synced item still goes to the server, which says why it cannot be in a release
      if (!change && !t.item.synced) return void (err.textContent = 'Change something first: the release holds a change, and the item as it is is live already.');
      if (change && !change.name) return void (err.textContent = 'The item needs a name.');
    }
    b.disabled = true;
    b.classList.add('is-busy');
    // a release made here for this, and refused what it was made for, goes again (cancelled: nothing is left empty)
    let made: api.Release | null = null;
    try {
      if (to === 'new') made = await api.make({ name: nameBox.value.trim() });
      const rid = made?.id ?? to;
      let into: api.Release;
      if (t.kind === 'entry') {
        const open = openEntry(t.collection, t.id);
        const content = open?.dirty ? await open.content() : {};
        into = (await api.addEntry(rid, { collection: t.collection, id: t.id, version: open?.version ?? t.version, ...content })).release;
        made = null;
        if (open?.dirty) {
          // the changes are in the release now: back on the entry (this screen's URL has none, and the editor reads
          // the entry from the URL; the hash changes at once), which then shows as saved
          ctx.open(open.hash, false);
          await open.release();
        }
      } else {
        const it = t.item;
        into = (await api.addLibrary(rid, { libraryId: it.id, version: it.version, item: { kind: it.kind, ...change } })).release;
      }
      ctx.toast(`Added to “${into.name}”.`, 'ok', { action: { label: 'Open the release', run: () => ctx.open(`#/releases/${encodeURIComponent(into.id)}`, true) } });
      leave(into.id);
    } catch (e) {
      if (made) void api.cancel(made.id, made.version).catch(() => undefined);
      // the server's own words: a synced item, nothing to release, a lock, a right missing
      err.textContent = message(e);
      b.disabled = false;
      b.classList.remove('is-busy');
    }
  }

  /** Back where the person came from: the open entry, the Library item, else the release. */
  function leave(rid: string | null): void {
    const t = target!;
    if (t.kind === 'entry') ctx.open(t.hash ?? `#/e/${encodeURIComponent(t.collection)}/${encodeURIComponent(t.id)}`, false);
    else if (rid || history.length < 2) ctx.open(`#/library?open=${encodeURIComponent(t.item.id)}`, false);
    else history.back();
  }

  page(host, 'Add to a release', '', { narrow: true }).body.replaceChildren(state('loading', 'Loading…'));
  void load();
  return {
    update(next: ScreenCtx) {
      const before = ctx.params();
      ctx = next;
      const now = ctx.params();
      if (['c', 'id', 'lib'].some((k) => before.get(k) !== now.get(k))) void load();
      else if (target) draw();
    },
    destroy() {
      alive = false;
    },
  };
}
