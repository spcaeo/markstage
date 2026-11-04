// The media library's stock photo search (#/media?show=stock&q=<words>&page=<n>), when the server has a provider set
// up (Unsplash or Pexels, the site's own key, kept on the server). Thumbnails come through the server; "Add to the
// library" has the server fetch the photo by its id and store it like an upload, with the photographer's credit.
import { ApiError } from '../api';
import type { ScreenCtx } from '../host';
import * as api from './api';
import { button, el, failure, message, state } from './ui';

type Info = { enabled: boolean; provider?: string; label?: string };
let info: Promise<Info> | null = null;
/** Whether stock search is set up (asked once per page). */
export const stockInfo = (): Promise<Info> => (info ??= api.stockInfo().catch((): Info => ({ enabled: false })));

/** The search results for the URL's q and page; `added` opens the new image. */
export function stockView(ctx: ScreenCtx, label: string, added: (m: api.Media) => void): HTMLElement {
  const q = ctx.params().get('q')?.trim() ?? '';
  const pageNo = Math.max(1, Number(ctx.params().get('page')) || 1);
  const box = el('div.ms-adm-stock');
  if (!q) {
    box.append(state('empty', `Search ${label}`, `Type what the photo should show in the search box. A photo you add is copied into the site’s own media, with its photographer’s name.`));
    return box;
  }
  box.append(state('loading', `Searching ${label}…`));
  void (async () => {
    let r: Awaited<ReturnType<typeof api.stockSearch>>;
    try {
      r = await api.stockSearch(q, pageNo);
    } catch (e) {
      box.replaceChildren(failure(e, () => ctx.go({ params: {} })));
      return;
    }
    if (ctx.params().get('q')?.trim() !== q) return;
    const g = el('ul.ms-adm-grid.ms-adm-grid--stock', { 'aria-label': `${label} photos` });
    for (const ph of r.items) {
      const add = button('Add to the library', async () => {
        add.disabled = true;
        add.lastElementChild!.textContent = 'Adding…';
        try {
          const m = await api.stockImport(ph.id);
          ctx.toast(`Added, with the credit to ${ph.author || label}.`, 'ok');
          added(m);
        } catch (e) {
          add.disabled = false;
          add.lastElementChild!.textContent = 'Add to the library';
          ctx.toast(e instanceof ApiError && e.status === 413 ? 'This photo is larger than the site takes.' : message(e), 'error');
        }
      }, { small: true, kind: 'primary', icon: 'download' });
      g.append(
        el('li', el('div.ms-adm-tile.ms-adm-tile--stock',
          el('span.ms-adm-tile__img', ph.thumb ? el('img', { src: api.apiUrl(ph.thumb), alt: ph.alt, loading: 'lazy' }) : null),
          el('span.ms-adm-tile__name', ph.alt || 'Untitled photo'),
          el('span.ms-adm-tile__meta', 'by ', ph.authorUrl ? el('a', { href: ph.authorUrl, target: '_blank', rel: 'noopener noreferrer', title: `${ph.author} on ${label} (opens in a new tab)` }, ph.author || 'the photographer') : ph.author),
          add,
        )),
      );
    }
    const pages = Math.min(50, Math.max(1, Math.ceil(r.total / r.perPage)));
    box.replaceChildren(
      el('p.ms-adm-count', `${r.total} photo${r.total === 1 ? '' : 's'} on ${label} for “${q}”`),
      r.items.length ? g : state('empty', 'Nothing found', 'Try other words.'),
      pages > 1
        ? el('div.ms-adm-row.ms-adm-paging',
            pageNo > 1 ? button('Previous', () => ctx.go({ params: { page: pageNo === 2 ? null : String(pageNo - 1) } }, true), { small: true }) : null,
            el('span.ms-adm-count', `Page ${pageNo} of ${pages}`),
            pageNo < pages ? button('Next', () => ctx.go({ params: { page: String(pageNo + 1) } }, true), { small: true }) : null,
          )
        : '',
    );
  })();
  return box;
}
