// One Library item in the drawer (#/library?open=<id>): its picture, what it is, where a synced one is used (each
// address with copy and open), and for the people who may change it: name, description, folder, tags, its locks,
// Duplicate, Add to a release and Delete (a synced item still in use is turned into plain copies first, after a question). Each change
// is saved at once against the item's version (409: someone changed it meanwhile, it is read again).
import { ApiError } from '../api';
import { button, copyButton, drawer, el, facts, failure, link, message, state, value, when } from '../admin/ui';
import { screen, type ScreenCtx } from '../host';
import { humanize } from '../pages/schema';
import { md } from '../runtime';
import * as api from './api';
import { KIND_LABEL, picture } from './screen';

interface Deps {
  ctx: ScreenCtx;
  editor: boolean;
  me: string;
  /** the list reads again */
  changed(): void;
}

const PARTS: [keyof api.LibLocks, string][] = [
  ['move', 'moved'],
  ['remove', 'deleted'],
  ['edit', 'changed'],
];

/** What an item holds, as text to read and copy: a fragment as Markdown, a page or a section as its fields. */
function asText(it: api.LibItem): string {
  if (it.body.doc) return md().printBlocks((it.body.doc.content ?? []) as never);
  return JSON.stringify(it.kind === 'template' ? { ...it.body.frontmatter, ...(it.body.data as object) } : it.body.value, null, 2);
}

/** A picture file as a card picture: a PNG of at most 480 × 270 that fits the server's 200 KB, made smaller until it does. */
async function toThumb(file: File): Promise<Blob> {
  const img = await createImageBitmap(file);
  for (let w = 480; w >= 120; w = Math.round(w * 0.75)) {
    const scale = Math.min(1, w / img.width, (w * 9) / 16 / img.height);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * scale));
    c.height = Math.max(1, Math.round(img.height * scale));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const png = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    if (png && png.size <= 200 * 1024) return png;
  }
  throw new Error('This picture stays over 200 KB as a PNG: choose a simpler one.');
}

export function mountLibItem(host: HTMLElement, id: string, d: Deps): void {
  const { ctx } = d;
  const dw = drawer(host, 'Library item', () => ctx.go({ params: { open: null } }, true));
  dw.body.replaceChildren(state('loading', 'Loading…'));
  let it: api.LibItem & { uses?: api.LibUse[]; history?: api.LibChange[] };

  const may = () => (it.shared ? d.editor : it.createdBy === d.me || d.editor);
  const save = async (patch: Partial<api.LibDraft>, said: string) => {
    try {
      it = { ...it, ...(await api.update(id, { ...patch, version: it.version })) };
      ctx.toast(said, 'ok');
      d.changed();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        ctx.toast('Someone changed this meanwhile; here it is as it is now.', 'info');
        d.changed();
      } else ctx.toast(`Not saved: ${message(e)}`, 'error');
    }
  };

  const text = (label: string, start: string, run: (v: string) => void, multi = false) => {
    const i = multi ? el('textarea.ms-input', { rows: '2', maxlength: '200', 'aria-label': label }) : el('input.ms-input', { value: start, maxlength: '100', 'aria-label': label });
    if (multi) (i as HTMLTextAreaElement).value = start;
    const go = () => (i.value.trim() !== start ? run(i.value.trim()) : undefined);
    i.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && !(multi && (e as KeyboardEvent).shiftKey) && (e.preventDefault(), go()));
    i.addEventListener('change', go);
    return i;
  };

  async function remove(): Promise<void> {
    const used = it.synced ? (it.uses?.length ?? it.usedOn ?? 0) : 0;
    const answer = await ctx.ask(
      `Delete “${it.name}”?`,
      used ? `${used} page${used === 1 ? ' uses' : 's use'} it. They keep what they show now, as their own copy, and stop following it.` : 'It leaves the Library. Pages made from it, or that hold a copy, keep theirs.',
      [['cancel', 'Cancel'], ['delete', used ? 'Make copies and delete' : 'Delete', 'ms-btn ms-btn--danger']],
    );
    if (answer !== 'delete') return;
    try {
      await api.remove(id, used > 0);
      ctx.toast(`Deleted “${it.name}”.`, 'ok');
      ctx.go({ params: { open: null } }, true);
      d.changed();
    } catch (e) {
      ctx.toast(`Not deleted: ${message(e)}`, 'error');
    }
  }

  // the card's picture: any image, made a small PNG here; or none (the card then draws its kind)
  function pictureRow(): HTMLElement {
    const file = el('input', { type: 'file', accept: 'image/*', hidden: true, 'aria-label': 'A picture for the card' });
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      try {
        it = { ...it, ...(await api.putThumb(id, await toThumb(f))) };
        ctx.toast('Picture saved.', 'ok');
        d.changed();
        draw();
      } catch (e) {
        ctx.toast(`Not saved: ${message(e)}`, 'error');
      }
    });
    const drop = async () => {
      try {
        it = { ...it, ...(await api.removeThumb(id)), thumb: null };
        ctx.toast('Picture removed.', 'ok');
        d.changed();
        draw();
      } catch (e) {
        ctx.toast(`Not removed: ${message(e)}`, 'error');
      }
    };
    return el('div.ms-adm-row', file, button(it.thumb ? 'Change picture…' : 'Add a picture…', () => file.click(), { small: true, icon: 'image' }), it.thumb ? button('Remove picture', () => void drop(), { small: true, kind: 'quiet' }) : '');
  }

  function draw(): void {
    const rows: [string, Node | string][] = [];
    if (may()) {
      rows.push(
        ['Name', text('Name', it.name, (v) => v && void save({ name: v }, `Renamed to “${v}”.`))],
        ['Description', text('Description (one line)', it.description, (v) => void save({ description: v }, 'Description saved.'), true)],
        ['Folder', text('Folder', it.folder, (v) => void save({ folder: v }, v ? `Moved to ${v}.` : 'Out of its folder.'))],
        ['Tags', text('Tags, separated by commas', it.tags.join(', '), (v) => void save({ tags: v.split(',').map((t) => t.trim()).filter(Boolean) }, 'Tags saved.'))],
      );
    } else rows.push(['Name', value(it.name, 'name')], ['Description', it.description ? value(it.description, 'description') : el('span.ms-adm-none', 'none')], ['Folder', it.folder ? value(it.folder, 'folder') : el('span.ms-adm-none', 'none')]);
    rows.push(['Kind', [KIND_LABEL[it.kind], it.sectionType ? humanize(it.sectionType) : '', it.collection ? `for ${humanize(it.collection)}` : ''].filter(Boolean).join(' · ')]);
    if (it.synced) rows.push(['Synced', 'Every page that uses it follows its changes']);
    // locks: what no one may do to it on the pages that use it (synced) or that start from it (a template)
    if (d.editor && (it.synced || it.kind === 'template')) {
      const box = el('div.ms-lib__locks');
      for (const [w, label] of PARTS) {
        const c = el('input', { type: 'checkbox', checked: !!it.locks?.[w] });
        c.addEventListener('change', () => void save({ locks: { ...it.locks, [w]: c.checked } }, c.checked ? `It can't be ${label} now.` : `It can be ${label} again.`));
        box.append(el('label.ms-snip__check', c, ` ${label}`));
      }
      rows.push(["Can't be", box]);
    } else if (it.locks && PARTS.some(([w]) => it.locks![w])) rows.push(["Can't be", PARTS.filter(([w]) => it.locks![w]).map(([, l]) => l).join(', ')]);
    if (it.imported) rows.push(['Imported from', it.imported.source ? value(it.imported.source, 'source') : humanize(it.imported.from)]);
    if (it.createdByName) rows.push(['Made by', value(it.createdByName, 'name')]);
    rows.push(['Last changed', el('span', when(it.updatedAt))], ['Reference', value(it.id, 'reference')]);

    const body = asText(it);
    const parts: (Node | string)[] = [el('div.ms-lib__bigpic', picture(it))];
    if (may()) parts.push(pictureRow());
    parts.push(facts(rows));
    if (it.synced) {
      const uses = it.uses ?? [];
      parts.push(el('h3.ms-adm-h3', `Used on ${uses.length} page${uses.length === 1 ? '' : 's'}`));
      if (uses.length) {
        const ul = el('ul.ms-lib__uses');
        for (const u of uses) ul.append(el('li', el('a', { href: `#/e/${encodeURIComponent(u.collection)}/${encodeURIComponent(u.id)}` }, u.title), u.url ? el('span.ms-adm-sub', ' · ', link(u.url, 'the page address')) : ''));
        parts.push(ul);
      } else parts.push(el('p.ms-adm-sub', 'No page uses it yet.'));
    }
    parts.push(el('div.ms-adm-row.ms-snip__head', el('h3.ms-adm-h3', 'What it holds'), copyButton(it.body.doc ? 'it as Markdown' : 'its fields', () => body)), el('pre.ms-snip__md', body || '(empty)'));
    // a shared item is a file in the site's repo: its commits are its history
    if (it.history?.length) {
      const ol = el('ol.ms-lib__history');
      for (const h of it.history.slice(0, 10)) ol.append(el('li', el('span', when(h.date)), ' · ', value(h.author, 'name'), ' · ', value(h.message, 'commit message'), ' ', value(h.sha.slice(0, 7), 'commit')));
      parts.push(el('h3.ms-adm-h3', 'History'), ol);
    }
    parts.push(el('p.ms-adm-sub', it.kind === 'template' ? 'New → pick this template to start a page from it.' : 'On a page, open Library in the header and drag it where it goes (or press Enter on it to put it after the block you are in).'));
    const acts = el('div.ms-adm-row');
    if (it.kind === 'template') acts.append(button('New page from it', () => ctx.open(`#/new/${encodeURIComponent(it.collection ?? '')}?template=${encodeURIComponent(it.id)}`, true), { small: true, kind: 'primary', icon: 'plus' }));
    if (d.editor || !it.shared) acts.append(button('Duplicate', () => void api.duplicate(id).then((x) => (ctx.toast(`Made “${x.name}”.`, 'ok'), ctx.go({ params: { open: x.id } }, true), d.changed()), (e) => ctx.toast(`Not duplicated: ${message(e)}`, 'error')), { small: true, icon: 'duplicate' }));
    // a change that goes live with a release, not now (the server refuses a synced item, in its words)
    if (it.shared && d.editor && screen('releases')) acts.append(button('Add to a release…', () => ctx.open(`#/releases/add?lib=${encodeURIComponent(it.id)}`, true), { small: true, icon: 'rocket' }));
    if (may()) acts.append(button('Delete…', () => void remove(), { small: true, kind: 'danger', icon: 'trash' }));
    parts.push(acts);
    dw.body.replaceChildren(...parts);
  }

  void api.item(id).then(
    (x) => {
      it = x;
      draw();
    },
    (e) => dw.body.replaceChildren(e instanceof ApiError && (e.status === 404 || e.status === 403) ? state('denied', 'Not available to you', 'This item does not exist, or it is someone else’s and not shared.') : failure(e)),
  );
}
