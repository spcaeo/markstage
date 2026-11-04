// Site health, addresses (the site's health hook): what the host serves for every address the build knows.
//   #/health?show=broken|chains|redirects&q=&page=   a broken address with the pages that link to it (each opens
//                    its entry), a redirect chain hop by hop, or every redirect; a search past one page of rows.
// The summary line on "The site" says when it was last checked, with Check again.
import type { ScreenCtx } from '../host';
import * as api from './api';
import { button, el, failure, link, message, searchBox, state, when } from './ui';

export const ADDRESS_SHOWS: api.AddressShow[] = ['broken', 'chains', 'redirects'];

/** The chips for the addresses (when the site has the hook and it has answered). */
export function addressChips(a: api.AddressStatus | undefined): [string, string][] {
  if (!a?.on || !a.counts) return [];
  return [['broken', `Broken addresses (${a.counts.broken})`], ['chains', `Redirect chains (${a.counts.chains})`], ['redirects', `Redirects (${a.counts.redirects})`]];
}

/** "The site" line: counts, when, Check again (null when the site has no hook). */
/** What the hook's failure means, in plain words (the raw message, with its server path, stays in the tooltip). */
export function hookWords(message: string): string {
  if (/no build at/i.test(message)) return 'No build yet: publish once and this fills in.';
  if (/longer than/i.test(message)) return 'The last check took too long and was stopped. It runs again after the next publish.';
  if (/did not print JSON|must print/i.test(message)) return 'The last check answered in a shape the editor cannot read. Ask whoever runs the server.';
  return `The last check failed: ${message.replace(/^The health hook stopped with code \d+: /, '').replace(/\/[^\s]+\/dist/g, 'the build folder')}`;
}

export function addressesLine(a: api.AddressStatus | undefined, ctx: ScreenCtx, reload: () => void): Node | null {
  if (!a?.on) return null;
  const again = button('Check again', async () => {
    again.disabled = true;
    try {
      const r = await api.checkAddresses();
      ctx.toast(r.on && r.error ? `The check failed: ${r.error.message}` : 'Checked every address again.', r.on && r.error ? 'error' : 'ok');
      reload();
    } catch (e) {
      again.disabled = false;
      ctx.toast(message(e), 'error');
    }
  }, { small: true, kind: 'quiet', icon: 'refresh' });
  if (a.running && !a.counts) return el('span', el('span.ms-adm-sub', 'Checking every address of the build…'));
  const c = a.counts;
  return el('span',
    c ? el('span', { title: 'Every address the built site answers, each language copy counted. Moved addresses lists only the redirects kept with the content, so its number is smaller.' }, `${c.pages} pages, ${c.redirects} redirects`) : 'Not checked yet',
    c ? el('div.ms-adm-sub', 'Counted on the built site, every language copy included; Moved addresses lists only the redirects kept with the content.') : null,
    c && (c.broken || c.chains) ? el('span.ms-adm-sub.is-bad', ` · ${c.broken} broken, ${c.chains} chain${c.chains === 1 ? '' : 's'}`) : null,
    a.at ? el('span.ms-adm-sub', ' · checked ', when(a.at), a.stale ? ' (before the last deploy)' : '') : null,
    a.error ? el('span.ms-adm-sub.is-bad', { title: a.error.message }, ` · ${hookWords(a.error.message)}`) : null,
    ' ', again,
  );
}

const entryLink = (e: { collection: string; id: string; title: string } | null | undefined, path: string) =>
  e ? el('span', el('a', { href: `#/e/${encodeURIComponent(e.collection)}/${encodeURIComponent(e.id)}` }, e.title), ' ', link(path, 'address', 'ms-adm-sub')) : link(path, 'address');

/** The list for show=broken|chains|redirects, loaded a page at a time. */
export function addressesCard(ctx: ScreenCtx, show: api.AddressShow): HTMLElement {
  const card = el('section.ms-adm-card.ms-adm-card--flush', { 'aria-label': 'Addresses' }, state('loading', 'Loading…'));
  const q = ctx.params().get('q') ?? '';
  const page = Math.max(Number(ctx.params().get('page')) || 1, 1);
  api.siteAddresses(show, q, page).then(
    (r) => {
      const head = el('div.ms-adm-row.ms-adm-pad', r.total > r.perPage || q ? searchBox(ctx, 'q', 'Search addresses') : null, el('span.ms-adm-grow'), el('span.ms-adm-count', `${r.total} ${show === 'broken' ? 'broken address' : show === 'chains' ? 'chain' : 'redirect'}${r.total === 1 ? '' : 's'}`));
      if (!r.items.length) {
        const empty = show === 'broken' ? 'No broken addresses' : show === 'chains' ? 'No redirect chains' : 'No redirects';
        return void card.replaceChildren(head, state('empty', q ? 'Nothing matches' : empty, q ? 'Try another search.' : 'From the last check of the build.'));
      }
      const t = el('table.ms-adm-table.ms-adm-table--rows');
      if (show === 'broken') {
        t.append(el('thead', el('tr', el('th', 'Address (not served)'), el('th', 'Linked from'))));
        t.append(el('tbody', ...(r.items as { path: string; linkedFrom: { path: string; entry: { collection: string; id: string; title: string } | null }[] }[]).map((b) =>
          el('tr', el('td', link(b.path, 'broken address')), el('td', el('ul.ms-adm-issues', ...b.linkedFrom.map((l) => el('li', entryLink(l.entry, l.path)))))))));
      } else if (show === 'chains') {
        t.append(el('thead', el('tr', el('th', 'From'), el('th', 'Hops'), el('th', 'Ends at'))));
        t.append(el('tbody', ...(r.items as { hops: string[]; from: string; to: string }[]).map((c) =>
          el('tr', el('td', link(c.from, 'old address')), el('td', el('ol.ms-adm-hops', ...c.hops.slice(1, -1).map((h) => el('li', link(h, 'hop'))))), el('td', link(c.to, 'final address'))))));
      } else {
        t.append(el('thead', el('tr', el('th', 'Old address'), el('th', 'Goes to'), el('th', 'Answer'))));
        t.append(el('tbody', ...(r.items as { path: string; status: number; redirectsTo?: string }[]).map((x) =>
          el('tr', el('td', link(x.path, 'old address')), el('td', x.redirectsTo ? link(x.redirectsTo, 'new address') : el('span.ms-adm-none', '—')), el('td', String(x.status))))));
      }
      const pages = Math.max(1, Math.ceil(r.total / r.perPage));
      const paging = pages > 1
        ? el('div.ms-adm-row.ms-adm-paging.ms-adm-pad',
            page > 1 ? button('Previous', () => ctx.go({ params: { page: page === 2 ? null : String(page - 1) } }, true), { small: true }) : null,
            el('span.ms-adm-count', `Page ${page} of ${pages}`),
            page < pages ? button('Next', () => ctx.go({ params: { page: String(page + 1) } }, true), { small: true }) : null)
        : null;
      card.replaceChildren(head, t, ...(paging ? [paging] : []));
    },
    (e) => card.replaceChildren(failure(e)),
  );
  return card;
}
