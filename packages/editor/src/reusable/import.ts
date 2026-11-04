// Import… in the Library (#/library?import=1&step=file|url|media, and &src=<address> for a web page): items from
// another place. Every way is a dry run first (what would come in, and every problem in words), then one commit. A
// file (a Markstage pack, or WordPress reusable blocks and patterns: its export or its database dump) keeps a pack's
// own folders; the parts of a web page become sections or snippets in "Imported", their pictures stored in Media;
// media come in bulk from addresses or a zip, as a job. The server fetches every address itself, through its guard
// (public addresses only), and every item passes the unsafe-link check.
import { ApiError } from '../api';
import { button, drawer, el, link, message, state, value } from '../admin/ui';
import type { ScreenCtx } from '../host';
import * as api from './api';

interface Deps {
  editor: boolean;
  /** the list reads again when it next shows (the drawer stays open with what came in) */
  done(): void;
}

const WAYS: [string, string, string][] = [
  ['file', 'A file', 'A Markstage pack (.json) from another site, or WordPress reusable blocks and patterns: its export (.xml) or its database dump (.sql).'],
  ['url', 'From a web page', 'Paste an address, pick parts of the page; they become sections or snippets, their pictures go into Media.'],
  ['media', 'Media in bulk', 'Pictures and files from a list of addresses, or a .zip.'],
];

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const problemList = (list: string[]) => (list.length ? el('ul.ms-lib__problems', ...list.map((x) => el('li', x))) : '');
/** A part's words, to recognise it by: read without loading anything (DOMParser runs no script and fetches nothing). */
const words = (html: string) => (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '').replace(/\s+/g, ' ').trim();

export function mountImport(host: HTMLElement, ctx: ScreenCtx, d: Deps): void {
  const params = ctx.params();
  const step = params.get('step') ?? '';
  const close = () => ctx.go({ params: { import: null, step: null, src: null } }, true);
  const dw = drawer(host, 'Import into the Library', close);
  if (!d.editor) return void dw.body.replaceChildren(state('denied', 'Not available to you', 'Editors, administrators and the owner bring items into the Library.'));
  const to = (s: string | null) => ctx.go({ params: { step: s, src: null } }, true);
  const back = button('Back', () => to(null), { small: true, kind: 'quiet', icon: 'up' });
  const out = el('div.ms-lib__out', { 'aria-live': 'polite' });
  const fail = (e: unknown) => out.replaceChildren(el('p.ms-adm-sub.is-bad', message(e)));
  // what came in, then the list shows it (`folder`: where to look)
  const finished = (r: api.ImportResult, folder: string | null) => {
    const skipped = r.skipped?.length ?? 0;
    const text = `Imported ${count(r.created.length, 'item')}${r.media ? ` and ${count(r.media, 'file')} into Media` : ''}${skipped ? `; ${count(skipped, 'item')} already here, kept as they are` : ''}.`;
    ctx.toast(text, r.created.length ? 'ok' : 'info');
    d.done();
    out.replaceChildren(el('p', text), problemList(r.problems), el('div.ms-adm-row', button('Show them', () => ctx.go({ params: { import: null, step: null, src: null, folder } }, true), { small: true, kind: 'primary' })));
  };

  if (!step) {
    const list = el('div.ms-lib__ways');
    for (const [s, title, text] of WAYS) {
      const b = el('button.ms-lib__way', { type: 'button' }, el('strong', title), el('span.ms-adm-sub', text));
      b.addEventListener('click', () => to(s));
      list.append(b);
    }
    return void dw.body.replaceChildren(el('p.ms-adm-sub', 'Each way shows what would come in first; nothing changes until you import.'), list);
  }

  if (step === 'file') {
    const input = el('input.ms-input', { type: 'file', accept: '.json,.xml,.sql,application/json,text/xml', 'aria-label': 'The file to import' });
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      out.replaceChildren(state('loading', `Reading ${f.name}…`));
      try {
        const pre = await api.previewFile(f);
        const clash = pre.items.some((i) => i.exists);
        const choice = el('select.ms-input.ms-adm-select', { 'aria-label': 'When an item is already here' }, el('option', { value: 'skip' }, 'Keep the one here (skip it)'), el('option', { value: 'copy' }, 'Bring it in as a copy'));
        const ul = el('ul.ms-lib__preview');
        for (const i of pre.items) ul.append(el('li', el('strong', i.name), el('span.ms-adm-sub', ` · ${i.kind}${i.exists ? ' · already here' : ''}`)));
        const go = button(`Import ${count(pre.items.length, 'item')}`, async () => {
          go.disabled = true;
          try {
            // a pack keeps its own folders; anything else lands in "Imported"
            finished(await api.importFile(f, clash ? (choice.value as 'skip' | 'copy') : undefined), /\.json$/i.test(f.name) ? null : 'Imported');
          } catch (e) {
            go.disabled = false;
            fail(e);
          }
        }, { kind: 'primary', small: true, icon: 'upload' });
        out.replaceChildren(
          el('p', `${f.name}: ${count(pre.items.length, 'item')}${pre.media ? `, ${count(pre.media, 'file')} for Media` : ''}.`),
          ul,
          problemList(pre.problems),
          clash ? el('label.ms-adm-datewrap', el('span', 'Already here'), choice) : '',
          pre.items.length ? el('div.ms-adm-row', go) : el('p.ms-adm-sub', 'Nothing in it to import.'),
        );
      } catch (e) {
        fail(e);
      }
    });
    return void dw.body.replaceChildren(back, el('h3.ms-adm-h3', 'A file'), el('p.ms-adm-sub', WAYS[0]![2]), input, out);
  }

  if (step === 'url') {
    const url = el('input.ms-input', { type: 'url', placeholder: 'https://', 'aria-label': 'The page’s address', value: params.get('src') ?? '' });
    const kind = el('select.ms-input.ms-adm-select', { 'aria-label': 'Bring them in as' }, el('option', { value: 'section' }, 'Sections'), el('option', { value: 'snippet' }, 'Snippets'));
    const read = async () => {
      const u = url.value.trim();
      if (!/^https?:\/\//.test(u)) return void (url.focus(), ctx.toast('Paste a full address, starting with https://.', 'info'));
      // the address is the drawer's state: a reload or a shared link reads the same page again
      if (params.get('src') !== u) return ctx.go({ params: { src: u } }, true);
      out.replaceChildren(state('loading', 'Reading the page…'));
      try {
        const page = await api.readPage(u);
        const ul = el('ul.ms-lib__parts');
        for (const part of page.parts) {
          const c = el('input', { type: 'checkbox', value: part.id, 'aria-label': part.label });
          const text = words(part.html);
          ul.append(el('li', el('label', c, el('span', el('strong', part.label), el('span.ms-adm-sub', ` · ${part.images ? count(part.images, 'picture') : 'no pictures'}`), el('span.ms-lib__words', text.length > 160 ? `${text.slice(0, 160)}…` : text)))));
        }
        const check = button('Check the ticked parts', async () => {
          const ids = [...ul.querySelectorAll<HTMLInputElement>('input:checked')].map((c) => c.value);
          if (!ids.length) return ctx.toast('Tick the parts to bring in first.', 'info');
          check.disabled = true;
          const k = kind.value as api.LibKind;
          try {
            const pre = await api.previewParts(page.url, ids, k);
            const go = button(`Import ${count(pre.items.length, 'item')}`, async () => {
              go.disabled = true;
              try {
                finished(await api.importParts(page.url, ids, k), 'Imported');
              } catch (e) {
                go.disabled = false;
                if (e instanceof ApiError && e.status === 409) return void out.replaceChildren(el('p.ms-adm-sub.is-bad', 'The page changed since it was read: read it again.'));
                fail(e);
              }
            }, { kind: 'primary', small: true, icon: 'upload' });
            out.replaceChildren(
              el('p', `Into “Imported”: ${count(pre.items.length, k === 'snippet' ? 'snippet' : 'section')}${pre.media ? `, ${count(pre.media, 'picture')} stored in Media` : ''}.`),
              el('ul.ms-lib__preview', ...pre.items.map((i) => el('li', el('strong', i.name), el('span.ms-adm-sub', ` · ${i.images ? count(i.images, 'picture') : 'no pictures'}`)))),
              problemList(pre.problems),
              pre.items.length ? el('div.ms-adm-row', go, button('Back to the parts', () => out.replaceChildren(parts), { small: true, kind: 'quiet' })) : el('p.ms-adm-sub', 'Nothing left to import in these parts.'),
            );
          } catch (e) {
            fail(e);
          } finally {
            check.disabled = false;
          }
        }, { small: true, kind: 'primary' });
        const parts = el(
          'div',
          el('p', el('strong', page.title || 'Untitled page'), el('span.ms-adm-sub', ` · ${count(page.parts.length, 'part')}`)),
          link(page.url, 'The page’s address'),
          page.parts.length ? ul : el('p.ms-adm-sub', 'Nothing on this page to bring in.'),
          page.parts.length ? el('div.ms-adm-row', el('label.ms-adm-datewrap', el('span', 'As'), kind), check) : '',
        );
        out.replaceChildren(parts);
      } catch (e) {
        fail(e);
      }
    };
    url.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), void read()));
    dw.body.replaceChildren(back, el('h3.ms-adm-h3', 'From a web page'), el('p.ms-adm-sub', WAYS[1]![2]), el('div.ms-adm-row', url, button('Read the page', () => void read(), { small: true })), out);
    if (params.get('src')) void read();
    return;
  }

  // media in bulk: addresses (one a line) or a zip; a folder of files goes through Media's own upload
  const urls = el('textarea.ms-input', { rows: '5', placeholder: 'One address a line', 'aria-label': 'Addresses of pictures and files' });
  const zip = el('input.ms-input', { type: 'file', accept: '.zip,application/zip', 'aria-label': 'A .zip of pictures and files' });
  // one or the other: choosing a zip clears the addresses, typing addresses lets go of the zip
  zip.addEventListener('change', () => zip.files?.length && ((urls.value = ''), out.replaceChildren()));
  urls.addEventListener('input', () => ((zip.value = ''), out.replaceChildren()));
  const send = (dry: boolean) => {
    const z = zip.files?.[0];
    return z ? api.mediaZip(z, dry) : api.mediaUrls(urls.value.split('\n').map((s) => s.trim()).filter(Boolean), dry);
  };
  const check = button('Check them', async () => {
    if (!zip.files?.[0] && !urls.value.trim()) return ctx.toast('Paste addresses or choose a .zip first.', 'info');
    check.disabled = true;
    out.replaceChildren(state('loading', 'Checking…'));
    try {
      const pre = await send(true);
      const good = pre.items.filter((i) => !i.problem).length;
      const go = button(`Bring in ${count(good, 'file')}`, async () => {
        go.disabled = true;
        try {
          const r = await send(false);
          ctx.toast('Bringing them in as a job; Publishing shows how it goes.', 'ok');
          out.replaceChildren(el('p', `Bringing in ${count(good, 'file')}. `, r.job ? el('a', { href: `#/jobs/${encodeURIComponent(r.job.id)}` }, 'Follow it on the Publishing page') : ''));
        } catch (e) {
          go.disabled = false;
          fail(e);
        }
      }, { kind: 'primary', small: true, icon: 'upload' });
      out.replaceChildren(
        el('ul.ms-lib__preview', ...pre.items.map((i) => el(i.problem ? 'li.is-bad' : 'li', i.url ? link(i.url, 'The address') : value(i.name ?? '', 'The file name'), i.problem ? el('span.ms-adm-sub', ` · ${i.problem}`) : ''))),
        good ? el('div.ms-adm-row', go) : el('p.ms-adm-sub', 'None of these can be brought in.'),
      );
    } catch (e) {
      fail(e);
    } finally {
      check.disabled = false;
    }
  }, { small: true });
  dw.body.replaceChildren(back, el('h3.ms-adm-h3', 'Media in bulk'), el('p.ms-adm-sub', `${WAYS[2]![2]} A folder of files: drop it on Media.`), urls, el('p.ms-adm-sub', 'or'), zip, el('div.ms-adm-row', check), out);
}
