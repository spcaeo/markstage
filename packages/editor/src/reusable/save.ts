// Save from anywhere into the Library: the grip menu's "Save section to Library…" and the More menu's "Save selection
// to Library…" keep blocks as a snippet or a section (Synced: the page keeps them as a use the server follows, listed
// in its frontmatter `synced`); the More menu's "Save page as template…" keeps the whole page, without what belongs
// to one page only (slug, dates, author; the server takes them out too). Stored in the saved shape, like an entry.
import type { Editor, JSONContent } from '@tiptap/core';
import { modalize } from '../shell';
import type { Entry } from '../api';
import { toast } from '../host';
import { collection, viewerRole } from '../runtime';
import type { FrontmatterEdits } from '../settings/state';
import * as api from './api';

const EDITORS = ['owner', 'administrator', 'editor'];
/** Fields that belong to one page, never to a template. */
const OWN = new Set(['slug', 'id', 'date', 'pubDate', 'publishDate', 'published', 'updated', 'updatedDate', 'modified', 'lastmod', 'created', 'author', 'authors', 'draft']);
/** Fields a page made from a template fills in, when the template has them. */
const FILL = ['title', 'description', 'excerpt', 'seoTitle', 'seoDescription'];

type Synced = { id: string; version: string };
let edits: FrontmatterEdits | null = null;
/** The open entry's frontmatter, where a synced item is listed (side-setup.ts). */
export const useEdits = (e: FrontmatterEdits) => void (edits = e);

/** Lists a synced item in the open entry's frontmatter (once). */
export function listSynced(it: Pick<api.LibItem, 'id' | 'version'>): void {
  if (!edits) return;
  const list = (edits.get('synced') as Synced[] | undefined) ?? [];
  if (!list.some((s) => s.id === it.id)) edits.set('synced', [...list, { id: it.id, version: it.version }]);
}

/** A name to start from: the first heading's words, else the opening words. */
export const guess = (doc: JSONContent) => {
  const text = (n: JSONContent): string => n.text ?? (n.content ?? []).map(text).join(' ');
  const first = (doc.content ?? []).find((n) => n.type === 'heading') ?? doc.content?.[0];
  const t = first ? text(first).replace(/\s+/g, ' ').trim() : '';
  return t.length > 60 ? `${t.slice(0, 59).trimEnd()}…` : t;
};

interface Field {
  el: HTMLElement;
  input: HTMLInputElement;
}
const field = (label: string, value: string, attrs: Record<string, string> = {}): Field => {
  const el = Object.assign(document.createElement('label'), { className: 'ms-snipsave__field' });
  const input = Object.assign(document.createElement('input'), { className: 'ms-input', value });
  for (const [k, v] of Object.entries(attrs)) input.setAttribute(k, v);
  el.append(Object.assign(document.createElement('span'), { textContent: label }), input);
  return { el, input };
};
const check = (label: string, on = false) => {
  const el = Object.assign(document.createElement('label'), { className: 'ms-snipsave__check' });
  const input = Object.assign(document.createElement('input'), { type: 'checkbox', checked: on });
  el.append(input, ` ${label}`);
  return { el, input };
};
/** The folders already in the Library, offered as the folder field's suggestions. */
const folders = (input: HTMLInputElement) => {
  const list = Object.assign(document.createElement('datalist'), { id: `ms-libfolders-${Math.random().toString(36).slice(2, 8)}` });
  input.setAttribute('list', list.id);
  void api.all().then((r) => list.replaceChildren(...[...new Set(r.items.map((i) => i.folder).filter(Boolean))].sort().map((f) => Object.assign(document.createElement('option'), { value: f }))), () => undefined);
  return list;
};

/** A dialog with a title, a line, the fields and Cancel / Save; `save` runs on Save (or Enter in a field). */
function dialog(title: string, line: string, parts: HTMLElement[], save: () => boolean | void, onClose: () => void): HTMLDialogElement {
  const dlg = document.createElement('dialog');
  dlg.className = 'ms-dialog ms-snipsave';
  const tools = Object.assign(document.createElement('div'), { className: 'ms-dialog__tools' });
  tools.innerHTML = `<button type="button" class="ms-btn" value="cancel">Cancel</button><button type="button" class="ms-btn ms-btn--primary" value="save">Save</button>`;
  dlg.append(Object.assign(document.createElement('h2'), { textContent: title }), Object.assign(document.createElement('p'), { textContent: line }), ...parts, tools);
  const go = () => save() !== false && dlg.close();
  tools.querySelector('[value=save]')!.addEventListener('click', go);
  tools.querySelector('[value=cancel]')!.addEventListener('click', () => dlg.close());
  dlg.addEventListener('keydown', (e) => e.key === 'Enter' && (e.target as HTMLElement).matches('input.ms-input') && (e.preventDefault(), go()));
  dlg.addEventListener('close', () => (dlg.remove(), onClose()));
  document.body.append(dlg);
  modalize(dlg);
  dlg.showModal();
  return dlg;
}

const opened = (it: api.LibItem) => ({ action: { label: 'Library', run: () => (location.hash = `#/library?open=${encodeURIComponent(it.id)}`) } });

/**
 * Asks for a name, a folder, whether it is a section or a snippet, synced, and (a snippet) whether everyone may use
 * it, then keeps the blocks. The editor takes the focus back when the dialog closes.
 */
export function saveToLibrary(editor: Editor, doc: JSONContent, count: number): void {
  const editor_ = EDITORS.includes(viewerRole());
  const name = field('Name', guess(doc), { maxlength: '100', required: '' });
  const folder = field('Folder', '', { maxlength: '60', placeholder: 'None' });
  const asSection = check('A section (a part of a page), not a snippet', count > 1);
  const synced = check('Synced: every page that uses it follows when it changes');
  const shared = check('Everyone can use it', true);
  const parts: HTMLElement[] = [name.el, folder.el, folders(folder.input)];
  if (editor_) parts.push(asSection.el, synced.el);
  parts.push(shared.el);
  const sync = () => {
    // sections and synced items are for everyone (only a snippet can be kept to yourself)
    const forAll = editor_ && (asSection.input.checked || synced.input.checked);
    shared.input.disabled = forAll;
    if (forAll) shared.input.checked = true;
  };
  asSection.input.addEventListener('change', sync);
  synced.input.addEventListener('change', sync);
  sync();
  dialog(
    'Save to the Library',
    `${count} block${count === 1 ? '' : 's'}, to put in again from the Library beside the page, or the block menu.`,
    parts,
    () => {
      const n = name.input.value.trim();
      if (!n) {
        name.input.focus();
        return false;
      }
      const kind: api.LibKind = editor_ && asSection.input.checked ? 'section' : 'snippet';
      const sync = editor_ && synced.input.checked;
      void api.create({ kind, name: n, body: { doc }, folder: folder.input.value.trim(), synced: sync, shared: shared.input.checked }).then(
        (it) => {
          if (sync) listSynced(it);
          toast(sync ? `Saved “${it.name}” to the Library, synced: this page now follows it.` : `Saved “${it.name}” to the Library.`, 'ok', opened(it));
        },
        (e) => toast(`Not saved to the Library: ${(e as Error).message}`, 'error'),
      );
    },
    () => editor.view.focus(),
  );
  name.input.select();
}

/** The fields a template keeps: everything but what belongs to one page. */
export function templateFields(fm: Record<string, unknown>, own: string[] = []): Record<string, unknown> {
  const out = Object.fromEntries(Object.entries(fm).filter(([k]) => !OWN.has(k) && !own.includes(k)));
  // a canonical address names one page (the SEO settings')
  for (const [k, v] of Object.entries(out)) if (v && typeof v === 'object' && !Array.isArray(v) && 'canonical' in v) out[k] = Object.fromEntries(Object.entries(v).filter(([x]) => x !== 'canonical'));
  return out;
}

/** What a page is made of: an article's settings and blocks, or a page's data (its sections). */
export type PageParts = { frontmatter: Record<string, unknown>; doc: JSONContent } | { data: Record<string, unknown> };

/**
 * The whole page as a template of its collection: its blocks (or sections), their order and locks, its settings;
 * never its address, dates or author. `unsaved`: the page has changes the template would not have (a page's data is
 * read as saved), said in the dialog.
 */
export function saveAsTemplate(entry: Entry, parts: PageParts, done: () => void, unsaved = false): void {
  const name = field('Name', `${entry.title} (template)`.slice(0, 100), { maxlength: '100', required: '' });
  const description = field('What it is for', '', { maxlength: '200', placeholder: 'One line: when to start a page from it' });
  const folder = field('Folder', 'Page templates', { maxlength: '60' });
  dialog(
    'Save page as template',
    `New pages can start from it (New → Start from). It keeps the ${'doc' in parts ? 'blocks' : 'sections'}, their order and locks, and the settings; never the address, dates or author.${unsaved ? ' Your unsaved changes are not in it: save first to keep them.' : ''}`,
    [name.el, description.el, folder.el, folders(folder.input)],
    () => {
      const n = name.input.value.trim();
      if (!n) {
        name.input.focus();
        return false;
      }
      // the page's own address field too (`uri`), and its place among its siblings
      const own = [collection(entry.collection)?.addressKey, 'order'].filter((k): k is string => !!k);
      const kept = templateFields('doc' in parts ? parts.frontmatter : parts.data, own);
      const body = 'doc' in parts ? { frontmatter: kept, doc: parts.doc } : { data: kept };
      void api.create({ kind: 'template', name: n, description: description.input.value.trim(), folder: folder.input.value.trim(), collection: entry.collection, body: { ...body, _fill: FILL.filter((k) => k in kept) } }).then(
        (it) => toast(`Saved “${it.name}” as a template for ${entry.collection}.`, 'ok', opened(it)),
        (e) => toast(`The template was not saved: ${(e as Error).message}`, 'error'),
      );
    },
    done,
  );
  name.input.select();
}
