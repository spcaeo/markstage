// #/media?q=&show=unused|no-alt|stock&page=<n>&item=<mid>&replace=<mid>&sel=<mid,…>: the media library. A grid of every uploaded image (search
// by name or alt text, only the unused ones, only those without alt text); upload with the button or by dropping
// files on the page; an image opens in the drawer with its alt text, where it is used and its addresses. "Edit
// image" (crop, rotate) saves a new file next to it and keeps the original. show=stock searches the site's stock
// photo provider, when there is one. Only an image nothing uses can be deleted (the server checks again). On "Not
// used", tick several (sel=) and delete them in one go, with Undo on the note that follows.
// "Replace everywhere" uploads the new file, then (replace=<new mid>) lists every entry it goes into before the swap.
import { ApiError } from '../api';
import type { ScreenCtx } from '../host';
import * as api from './api';
import { editImage } from '../views/image-edit';
import { stockInfo, stockView } from './stock';
import { jobPanel } from './jobs';
import { button, bytes, canManageUsers, chips, drawer, el, facts, failure, form, icon, isEditorPlus, link, message, page, searchBox, state, undoToast, value, when, whoami } from './ui';

const PER_PAGE = 48;
const SHOW: [string, string][] = [
  ['', 'All'],
  ['unused', 'Not used'],
  ['no-alt', 'Without alt text'],
];
const TYPES = 'image/jpeg,image/png,image/gif,image/webp,image/avif,image/heic,image/heif,.heic,.heif,application/pdf';

export function mountMedia(host: HTMLElement, ctx: ScreenCtx) {
  const p = page(host, 'Images & files', 'Every image and document (PDF) uploaded to the site. Drop files anywhere on this page to upload them.');
  p.bar.hidden = false;
  const layout = el('div.ms-adm-split');
  const progress = el('div.ms-adm-uploads', { role: 'status', 'aria-live': 'polite' });
  let people = new Map<string, string>();
  let list: { items: api.Media[]; total: number; page: number; perPage: number } | null = null;
  let loadedFor = '';
  let alive = true;
  let me: api.Me | null = null;
  // the tick box to focus again after the grid is drawn anew (a tick changes the URL)
  let refocus: string | null = null;

  const picker = el('input', { type: 'file', accept: TYPES, multiple: true, hidden: true });
  picker.addEventListener('change', () => {
    void uploadAll([...(picker.files ?? [])]);
    picker.value = '';
  });
  p.actions.append(picker, button('Upload', () => picker.click(), { kind: 'primary', icon: 'upload' }));

  // drop files anywhere on the screen
  const zone = p.root;
  zone.addEventListener('dragover', (e) => {
    if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
    e.preventDefault();
    zone.classList.add('is-drop');
  });
  zone.addEventListener('dragleave', (e) => {
    if (e.target === zone || !zone.contains(e.relatedTarget as Node)) zone.classList.remove('is-drop');
  });
  zone.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    zone.classList.remove('is-drop');
    void uploadAll([...e.dataTransfer.files]);
  });

  async function uploadAll(files: File[]): Promise<void> {
    let last: api.Media | null = null;
    for (const f of files) {
      const row = el('div.ms-adm-upload', el('span.ms-adm-upload__name', f.name), el('span.ms-adm-upload__state', 'Uploading…'));
      progress.append(row);
      try {
        last = await api.upload(f);
        row.classList.add('is-done');
        row.lastElementChild!.textContent = 'Uploaded';
        setTimeout(() => row.remove(), 4000);
      } catch (e) {
        row.classList.add('is-bad');
        row.lastElementChild!.textContent = e instanceof ApiError && e.status === 415 ? 'Not an image this site takes (JPEG, PNG, GIF, WebP or AVIF).' : e instanceof ApiError && e.status === 413 ? message(e) : message(e);
      }
    }
    loadedFor = '';
    // the last upload opens, ready for its alt text
    if (last) ctx.go({ params: { item: last.id, page: null, show: null, q: null } }, true);
    else void render();
  }

  const query = () => {
    const q = ctx.params();
    return { q: q.get('q') ?? '', show: q.get('show') ?? '', page: Math.max(1, Number(q.get('page')) || 1) };
  };

  async function render(): Promise<void> {
    const q = query();
    const stock = await stockInfo();
    if (!alive) return;
    const show = stock.enabled ? [...SHOW, ['stock', `${stock.label} photos`] as [string, string]] : SHOW;
    p.bar.replaceChildren(searchBox(ctx, 'q', q.show === 'stock' ? `Search ${stock.label}` : 'Search by name or alt text'), chips(ctx, 'show', 'Show', show));
    if (q.show === 'stock' && stock.enabled) {
      layout.replaceChildren(el('div.ms-adm-split__main', progress, stockView(ctx, stock.label ?? 'stock', (m) => {
        loadedFor = '';
        ctx.go({ params: { item: m.id, show: null, q: null, page: null } }, true);
      })));
      p.body.replaceChildren(layout);
      return;
    }
    const key = JSON.stringify(q);
    if (key !== loadedFor) {
      if (!list) p.body.replaceChildren(state('loading', 'Loading media…'));
      try {
        if (!people.size) people = new Map((await api.usersBrief()).map((u) => [u.id, u.name]));
        me ??= await whoami().catch(() => null);
        const r = await api.mediaList({ q: q.q || undefined, unused: q.show === 'unused', page: q.page, perPage: PER_PAGE });
        // gone, or the URL moved on while this loaded: the newer render draws (never an old list under new filters)
        if (!alive || JSON.stringify(query()) !== key) return;
        list = r;
        loadedFor = key;
      } catch (e) {
        if (!alive || JSON.stringify(query()) !== key) return;
        p.body.replaceChildren(failure(e, () => void render()));
        return;
      }
      if (!alive) return;
    }
    grid(q);
  }

  function grid(q: ReturnType<typeof query>): void {
    const items = list!.items.filter((m) => q.show !== 'no-alt' || !m.alt.trim());
    const open = ctx.params().get('item');
    const g = el('ul.ms-adm-grid', { 'aria-label': 'Images' });
    // several at once, on "Not used": editors any file, authors their own (the server checks again); not in dev
    const pickable = (m: api.Media) => q.show === 'unused' && !!me?.user && !me.devMode && (isEditorPlus(me) || (me.user.role === 'author' && m.uploadedBy === me.user.id));
    const can = items.filter(pickable);
    const sel = new Set((ctx.params().get('sel') ?? '').split(',').filter((id) => can.some((m) => m.id === id)));
    const select = (next: Set<string>, focus: string | null = null) => {
      refocus = focus;
      ctx.go({ params: { sel: next.size ? [...next].join(',') : null } }, false);
    };
    for (const m of items) {
      const doc = isDocument(m);
      const a = el('a.ms-adm-tile', { href: '#', 'aria-label': doc ? `${m.filename}, a document` : `${m.filename}${m.alt ? `: ${m.alt}` : ', no alt text'}` },
        doc
          ? el('span.ms-adm-tile__img.ms-adm-tile__doc', icon('file', 34), el('span', 'PDF'))
          : el('span.ms-adm-tile__img', el('img', { src: api.mediaFile(m.id), alt: m.alt, loading: 'lazy', width: m.width ?? undefined, height: m.height ?? undefined })),
        el('span.ms-adm-tile__name', m.filename),
        el('span.ms-adm-tile__meta', doc ? `PDF · ${bytes(m.bytes)}` : `${m.width ?? '?'}×${m.height ?? '?'} · ${bytes(m.bytes)}`),
        m.alt.trim() || doc ? null : el('span.ms-adm-badge.ms-adm-badge--invited', 'No alt text'),
        m.derivedFrom ? el('span.ms-adm-badge', 'Edited') : null,
      );
      a.addEventListener('click', (e) => {
        e.preventDefault();
        ctx.go({ params: { item: m.id } }, true);
      });
      const li = el(`li${m.id === open ? '.is-open' : ''}${sel.has(m.id) ? '.is-picked' : ''}`, a);
      if (pickable(m)) {
        const box = el('input.ms-adm-tile__pick', { type: 'checkbox', checked: sel.has(m.id), 'aria-label': `Select ${m.filename}`, 'data-mid': m.id });
        box.addEventListener('change', () => {
          const next = new Set(sel);
          if (box.checked) next.add(m.id);
          else next.delete(m.id);
          select(next, m.id);
        });
        li.append(box);
      }
      g.append(li);
    }
    const pages = Math.max(1, Math.ceil(list!.total / PER_PAGE));
    const paging = pages > 1
      ? el('div.ms-adm-row.ms-adm-paging',
          q.page > 1 ? button('Previous', () => ctx.go({ params: { page: q.page === 2 ? null : String(q.page - 1), item: null } }, true), { small: true }) : null,
          el('span.ms-adm-count', `Page ${q.page} of ${pages}`),
          q.page < pages ? button('Next', () => ctx.go({ params: { page: String(q.page + 1), item: null } }, true), { small: true }) : null,
        )
      : null;
    const count = el('p.ms-adm-count', `${list!.total} image${list!.total === 1 ? '' : 's'}${q.q ? ` matching “${q.q}”` : ''}${q.show === 'unused' ? ', not used anywhere' : ''}`);
    const n = sel.size;
    const del = button(`Delete ${n} file${n === 1 ? '' : 's'}`, async () => {
      del.disabled = true;
      try {
        const r = await api.deleteMediaMany([...sel]);
        loadedFor = '';
        const k = r.deleted.length;
        const left = r.skipped.length ? ` Left: ${r.skipped.map((s) => `“${s.filename ?? s.id}” (${s.reason.replace(/\.$/, '').toLowerCase()})`).join(', ')}.` : '';
        if (k) undoToast(ctx, `Deleted ${k} file${k === 1 ? '' : 's'}.${left}`, r.commit, () => {
          loadedFor = '';
          if (alive) void render();
        });
        else ctx.toast(`Nothing was deleted.${left}`, 'error');
        ctx.go({ params: { sel: null, item: null } }, false);
      } catch (e) {
        del.disabled = false;
        ctx.toast(message(e), 'error');
      }
    }, { kind: 'danger', icon: 'trash', small: true });
    const bar = can.length
      ? el('div.ms-adm-row.ms-adm-selbar', { role: 'toolbar', 'aria-label': 'Selected files' },
          el('span.ms-adm-count', n ? `${n} selected` : 'Tick the files to delete, or select them all.'),
          n < can.length ? button(`Select all ${can.length} on this page`, () => select(new Set(can.map((m) => m.id))), { small: true, kind: 'quiet' }) : null,
          n ? button('Select none', () => select(new Set()), { small: true, kind: 'quiet' }) : null,
          el('span.ms-adm-grow'),
          n ? del : null)
      : null;
    // nothing listed yet: an owner or administrator can register the files the site already has
    const manager = !!me?.user && !me.devMode && canManageUsers(me);
    const findFiles = manager && !items.length && !q.q && !q.show
      ? button('Find the site’s existing files', async () => {
          findFiles!.disabled = true;
          try {
            const r = await api.indexMedia();
            loadedFor = '';
            ctx.toast(r.added.length ? `Found ${r.added.length} file${r.added.length === 1 ? '' : 's'} already on the site.${r.skipped.length ? ` ${r.skipped.length} left out.` : ''}` : 'No new files under the site’s uploads folder.', r.added.length ? 'ok' : 'info');
            if (alive) void render();
          } catch (e) {
            findFiles!.disabled = false;
            ctx.toast(message(e), 'error');
          }
        }, { kind: 'primary', icon: 'search' })
      : null;
    const empty = q.q || q.show
      ? state('empty', 'Nothing matches', 'Try another search or filter.')
      : state('empty', 'No images yet', findFiles ? 'Pictures the site already has can be listed here without moving them; new ones come in with Upload, or drop files here.' : 'Upload one with the button, or drop files here.', findFiles ?? undefined);
    const main = el('div.ms-adm-split__main', progress, count, bar, items.length ? g : empty, paging);
    layout.replaceChildren(main);
    p.body.replaceChildren(layout);
    if (refocus) g.querySelector<HTMLElement>(`[data-mid="${CSS.escape(refocus)}"]`)?.focus();
    refocus = null;
    if (open) void itemDrawer(open);
  }

  let follow: ReturnType<typeof jobPanel> | null = null;
  async function itemDrawer(mid: string): Promise<void> {
    const close = () => ctx.go({ params: { item: null } }, true);
    const d = drawer(layout, 'Image', close);
    d.body.append(state('loading', 'Loading…'));
    let m: api.Media;
    try {
      m = await api.mediaItem(mid);
    } catch (e) {
      d.body.replaceChildren(failure(e));
      return;
    }
    if (!alive || ctx.params().get('item') !== mid) return;
    d.el.querySelector('h2')!.textContent = m.filename;
    // after Replace everywhere: the publish that follows, in place
    const jid = ctx.params().get('job');
    follow?.destroy();
    follow = jid ? jobPanel(jid, { failedHint: 'Your changes are saved; the site stays as it was.', quietSuccess: false }) : null;
    const used = m.usedBy ?? [];
    const usage = used.length
      ? el('ul.ms-adm-list', ...used.map((u) => el('li', el('a', { href: `#/e/${encodeURIComponent(u.collection)}/${encodeURIComponent(u.id)}` }, u.title || u.id), el('span.ms-adm-sub', ` ${u.collection}`))))
      : el('p.ms-adm-none', 'Not used in any entry.');
    const me = await whoami().catch(() => null);
    if (!alive || ctx.params().get('item') !== mid) return;
    // astro dev keeps no alt text of its own: it is the one written where the image is used (its PATCH is a 409)
    const altDev = el('div.ms-field.ms-adm-field', el('span.ms-field__label', 'Alt text'), m.alt ? value(m.alt, 'alt text') : el('span.ms-adm-none', 'None written'), el('p.ms-field__hint', 'In development the alt text is the one written where the image is used: change it in that entry.'));
    const altForm = form(
      [altField(m.alt)],
      'Save alt text',
      async (v) => {
        const r = await api.updateMedia(m.id, v.alt);
        list = list && { ...list, items: list.items.map((x) => (x.id === r.id ? { ...x, alt: r.alt } : x)) };
        ctx.toast('Alt text saved.', 'ok');
        // the tile follows (its badge and its name for screen readers)
        const tile = layout.querySelector<HTMLElement>('.ms-adm-grid li.is-open .ms-adm-tile');
        if (tile) {
          tile.querySelector('.ms-adm-badge')?.remove();
          tile.setAttribute('aria-label', `${r.filename}${r.alt ? `: ${r.alt}` : ', no alt text'}`);
          tile.querySelector('img')?.setAttribute('alt', r.alt);
          if (!r.alt.trim()) tile.append(el('span.ms-adm-badge.ms-adm-badge--invited', 'No alt text'));
        }
      },
    );
    const del = button('Delete', async () => {
      if ((await ctx.ask(`Delete ${m.filename}?`, 'It is removed from the site in the next build. This cannot be undone here (the file stays in the site’s history).', [['cancel', 'Cancel'], ['go', 'Delete', 'ms-btn ms-btn--danger']])) !== 'go') return;
      try {
        await api.deleteMedia(m.id);
        loadedFor = '';
        ctx.toast(`Deleted ${m.filename}.`, 'ok');
        close();
      } catch (e) {
        ctx.toast(e instanceof ApiError && e.status === 409 ? 'It is still used, so it was not deleted.' : message(e), 'error');
      }
    }, { kind: 'danger', icon: 'trash' });
    const edit = button('Edit image', async () => {
      const out = await editImage(api.mediaFile(m.id), m.path);
      if (!out) return;
      try {
        const n = await api.upload(new File([out.file], out.name, { type: out.file.type }), m.id);
        loadedFor = '';
        ctx.toast('Saved as a new image. The original is kept.', 'ok');
        ctx.go({ params: { item: n.id, show: null, page: null, q: null } }, true);
      } catch (e) {
        ctx.toast(message(e), 'error');
      }
    }, { icon: 'crop' });
    // a new file in every entry that uses this one (server only: the dev API has no such route), editors and above
    const swap = used.length && me && !me.devMode && isEditorPlus(me) ? replaceButton(m) : null;
    const swapWith = ctx.params().get('replace');
    if (swapWith) return swap ? replaceView(d, m, swapWith) : void d.body.replaceChildren(state('denied', 'Not available to you', 'Replacing an image everywhere is for editors and above, for an image in use.'));
    if (used.length) {
      del.disabled = true;
      del.title = 'Used in content: take it out of those entries first.';
    }
    const itemLink = (id: string, text: string) => {
      const a = el('a', { href: `#/media?item=${encodeURIComponent(id)}` }, text);
      a.addEventListener('click', (e) => {
        e.preventDefault();
        ctx.go({ params: { item: id, show: null, q: null, page: null } }, true);
      });
      return a;
    };
    const lineage: [string, Node | string][] = [];
    if (m.derivedFrom) lineage.push(['Edited from', itemLink(m.derivedFrom, 'the original image')]);
    if (m.derivatives?.length) lineage.push([`Edits (${m.derivatives.length})`, el('span.ms-adm-stack', ...m.derivatives.map((x) => itemLink(x.id, x.filename)))]);
    if (m.credit) {
      // the credit to show with it, then where it came from
      lineage.push(['Photo by', value(`${m.credit.author} on ${m.credit.label}`, 'photo credit')]);
      if (m.credit.authorUrl) lineage.push(['Photographer', link(m.credit.authorUrl, 'photographer page')]);
      if (m.credit.sourceUrl) lineage.push([`On ${m.credit.label}`, link(m.credit.sourceUrl, `photo on ${m.credit.label}`)]);
    }
    const doc = isDocument(m);
    d.body.replaceChildren(
      ...(follow ? [follow.el] : []),
      doc
        ? el('figure.ms-adm-figure.ms-adm-figure--doc', icon('file', 48), el('figcaption.ms-adm-row', el('a.ms-btn.ms-btn--sm', { href: api.mediaFile(m.id), download: m.filename }, 'Download'), el('span.ms-adm-sub', 'A document: visitors download it from the link you put in the text.')))
        : el('figure.ms-adm-figure', el('img', { src: api.mediaFile(m.id), alt: m.alt, width: m.width ?? undefined, height: m.height ?? undefined }), el('figcaption.ms-adm-row', edit, el('span.ms-adm-sub', 'Crop or rotate: saved as a new file, this one stays.'))),
      ...(doc ? [] : [me?.devMode ? altDev : altForm]),
      el('div.ms-adm-row', el('h3.ms-adm-h3', `Used in ${used.length} entr${used.length === 1 ? 'y' : 'ies'}`), el('span.ms-adm-grow'), swap),
      usage,
      el('h3.ms-adm-h3', 'Details'),
      facts([
        ['Address', link(m.url, 'image address')],
        ['File', value(m.path, 'file path')],
        ['Name', value(m.filename, 'file name')],
        ['Size', doc ? `${bytes(m.bytes)} · ${m.type}` : `${m.width ?? '?'} × ${m.height ?? '?'} px · ${bytes(m.bytes)} · ${m.type}`],
        ['Uploaded', el('span', when(m.uploadedAt), m.uploadedBy ? ` by ${people.get(m.uploadedBy) ?? 'a removed user'}` : '')],
        ['Media ID', value(m.id, 'media ID')],
        ...lineage,
      ]),
      el('div.ms-adm-actions', del),
    );
  }

  /** Upload the new image, then show every entry it goes into (replaceView). */
  function replaceButton(m: api.Media): HTMLElement {
    const pick = el('input', { type: 'file', accept: 'image/*', hidden: true, 'aria-label': 'The new image' });
    pick.addEventListener('change', async () => {
      const f = pick.files?.[0];
      pick.value = '';
      if (!f) return;
      try {
        const n = await api.upload(f);
        loadedFor = '';
        ctx.go({ params: { item: m.id, replace: n.id } }, true);
      } catch (e) {
        ctx.toast(message(e), 'error');
      }
    });
    return el('span', pick, button('Replace everywhere…', () => pick.click(), { small: true, icon: 'image' }));
  }

  /** The plan: each entry the new image goes into (title, uses, address), then one change across them, with Undo. */
  async function replaceView(d: { el: HTMLElement; body: HTMLElement }, m: api.Media, withId: string): Promise<void> {
    const back = () => ctx.go({ params: { replace: null } }, true);
    d.el.querySelector('h2')!.textContent = 'Replace everywhere';
    d.body.replaceChildren(state('loading', 'Finding every entry that uses it…'));
    let n: api.Media;
    let plan: api.ReplacePlan;
    try {
      [n, plan] = await Promise.all([api.mediaItem(withId), api.replacePlan(m.id, withId)]);
    } catch (e) {
      d.body.replaceChildren(failure(e), el('div.ms-adm-row', button('Back', back, { kind: 'quiet' })));
      return;
    }
    if (!alive || ctx.params().get('replace') !== withId) return;
    const entries = plan.entries;
    const live = entries.filter((e) => e.status === 'published').length;
    const uses = entries.reduce((k, e) => k + e.count, 0);
    const thumb = (x: api.Media) => el('figure.ms-adm-swap__img', el('img', { src: api.mediaFile(x.id), alt: x.alt, width: x.width ?? undefined, height: x.height ?? undefined }), el('figcaption', value(x.filename, 'file name')));
    const t = el('table.ms-adm-table', el('thead', el('tr', el('th', 'Entry'), el('th', 'Uses'), el('th', 'Status'))));
    t.append(
      el('tbody', ...entries.map((e) =>
        el('tr',
          el('td', el('div.ms-adm-stack', value(e.title || e.id, 'title', 'ms-adm-strong'), e.url ? link(e.url, 'address', 'ms-adm-sub') : null)),
          el('td', String(e.count)),
          el('td', e.status === 'published' ? el('span.ms-adm-badge', 'Live') : el('span.ms-adm-sub', e.status === 'draft' ? 'Draft' : e.status)),
        ))),
    );
    const go = button('Replace everywhere', async () => {
      go.disabled = true;
      try {
        const r = await api.replaceMedia(m.id, n.id);
        loadedFor = '';
        const k = r.entries.length;
        undoToast(ctx, `Replaced in ${k} entr${k === 1 ? 'y' : 'ies'}.${r.job ? ' Publishing the live pages.' : ''}`, r.commit, () => {
          loadedFor = '';
          if (alive) void render();
        });
        // the panel follows the build (QA F10): a failure says so there, with Try the build again
        ctx.go({ params: { item: n.id, replace: null, show: null, page: null, q: null, job: r.job ?? null } }, true);
      } catch (e) {
        go.disabled = false;
        ctx.toast(message(e), 'error');
      }
    }, { kind: 'primary', icon: 'image' });
    const swapRow = el('div.ms-adm-swap', thumb(m), el('span.ms-adm-swap__arrow', { 'aria-label': 'becomes' }, '→'), thumb(n));
    if (!entries.length) return void d.body.replaceChildren(swapRow, state('empty', 'Nothing uses it now', 'No entry has this image any more, so there is nothing to replace.'), el('div.ms-adm-row', button('Back', back, { kind: 'quiet' })));
    d.body.replaceChildren(
      swapRow,
      el('p', `${uses} use${uses === 1 ? '' : 's'} in ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}.${live ? ` ${live} ${live === 1 ? 'is' : 'are'} live, so the site is published again.` : ''} The old image stays in the library, and the change can be undone from the note that follows.`),
      el('section.ms-adm-card.ms-adm-card--flush', t),
      el('div.ms-adm-row', go, button('Cancel', back, { kind: 'quiet' })),
    );
  }

  void render();
  return {
    update: () => void render(),
    destroy: () => {
      alive = false;
    },
  };
}

/** A download (PDF), not an image: no picture, no alt text, no crop. */
const isDocument = (m: api.Media) => m.type === 'application/pdf';

/** The alt text box: what the image shows, for people who cannot see it. */
function altField(alt: string): HTMLElement {
  const id = `ms-adm-alt-${Math.random().toString(36).slice(2, 7)}`;
  const t = el('textarea.ms-input.ms-input--area', { id, name: 'alt', rows: 3, maxlength: 500 });
  t.value = alt;
  return el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: id }, 'Alt text'), t, el('p.ms-field__hint', 'What the image shows, for people who cannot see it. Leave it empty only for decoration.'), el('p.ms-adm-field__err', { 'data-err': 'alt', role: 'alert' }));
}
