// The feeds list of Search & AI: a row per feed (title, its address with copy and open, what it lists), the open one
// (#/settings/search-ai?feed=<id>) shown as a form under its row, and Add a feed. The rows edit the screen's draft; the
// screen saves it. A refusal from the server shows under the field it is about (`errors`, by the setting's path).
import { copyable, siteUrl } from '../../copy';
import { ic } from '../../icons';
import { h, iconBtn, ht } from '../../panel-form';
import type { FeedRow } from './doc';
import { textField, uid } from './fields';

export interface FeedsHost {
  feeds: FeedRow[];
  collections: { id: string; label: string }[];
  edit: boolean;
  /** the id of the feed shown open (from the URL), or null */
  open: string | null;
  /** the server's refusals by the setting's path ("feeds.0.path") */
  errors: Map<string, string>;
  /** open a feed (or close, null): it changes the URL, which redraws the screen */
  go(feed: string | null): void;
  /** the draft changed (typing): the Save bar follows */
  changed(): void;
  /** rows were added or removed: the whole list is drawn again */
  redraw(): void;
}

/** "/rss.xml" -> "rss", "/blog/rss.xml" -> "blog-rss"; unique among `taken`. */
function idFor(path: string, taken: string[]): string {
  const base = path.replace(/\.xml$/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 36) || 'feed';
  let id = base;
  for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`;
  return id;
}

/** A new feed with the first free address (/rss.xml, then /rss-2.xml …). */
export function newFeed(host: Pick<FeedsHost, 'feeds' | 'collections'>): FeedRow {
  let path = '/rss.xml';
  for (let i = 2; host.feeds.some((f) => f.path === path); i++) path = `/rss-${i}.xml`;
  return { id: idFor(path, host.feeds.map((f) => f.id)), title: '', description: '', path, collections: host.collections[0] ? [host.collections[0].id] : [], limit: 50 };
}

export function feedsSection(host: FeedsHost): HTMLElement {
  const sec = h('section', 'ms-locks__group');
  sec.append(
    h('h3', 'ms-locks__h', 'Feeds'),
    ht('p', 'ms-locks__lead', 'A feed lets people follow your newest pages in a feed reader. Each feed lists the live pages of the kinds you pick, newest first.'),
  );
  const list = h('div', 'ms-locks__rows ms-hk__feeds');
  list.setAttribute('role', 'list');
  if (!host.feeds.length) list.append(ht('p', 'ms-hk__empty', 'No feeds yet. A blog usually has one, at /rss.xml.'));
  host.feeds.forEach((f, i) => list.append(feedRow(host, f, i)));
  sec.append(list);
  if (host.edit) {
    const add = Object.assign(h('button', 'ms-btn ms-btn--sm', `${ic('plus', 14)}<span>Add a feed</span>`), { type: 'button' });
    add.addEventListener('click', () => {
      const f = newFeed(host);
      host.feeds.push(f);
      host.redraw();
      host.go(f.id);
    });
    sec.append(add);
  }
  return sec;
}

function feedRow(host: FeedsHost, f: FeedRow, i: number): HTMLElement {
  const open = host.open === f.id;
  const row = h('div', `ms-hk__feed${open ? ' is-picked' : ''}`);
  row.setAttribute('role', 'listitem');
  row.dataset.feed = f.id;
  const top = h('div', 'ms-locks__row');
  const name = h('div', 'ms-locks__name ms-hk__feedname');
  const title = ht('strong', '', f.title.trim() || 'New feed');
  const url = /^\/.*\.xml$/.test(f.path) ? siteUrl(f.path) : '';
  name.append(title);
  if (url) name.append(copyable(url, { label: `the address of ${f.title.trim() || 'this feed'}`, open: url, className: 'ms-locks__type' }));
  const tools = h('div', 'ms-locks__parts');
  const toggle = Object.assign(h('button', 'ms-btn ms-btn--sm ms-btn--quiet'), { type: 'button', textContent: open ? 'Close' : host.edit ? 'Edit' : 'Show' });
  toggle.setAttribute('aria-expanded', String(open));
  toggle.addEventListener('click', () => host.go(open ? null : f.id));
  tools.append(toggle);
  if (host.edit) {
    tools.append(
      iconBtn('trash', `Remove the feed ${f.title.trim() || f.path}`, () => {
        host.feeds.splice(i, 1);
        if (open) host.go(null);
        host.redraw();
        host.changed();
      }),
    );
  }
  top.append(name, tools);
  row.append(top);
  if (open) row.append(feedForm(host, f, i, title));
  return row;
}

function feedForm(host: FeedsHost, f: FeedRow, i: number, title: HTMLElement): HTMLElement {
  const at = `feeds.${i}`;
  const form = h('div', 'ms-hk__feedform');
  const text = (key: 'title' | 'description' | 'path', label: string, hint: string, placeholder: string, mono = false) => {
    const t = textField({
      label,
      hint,
      value: f[key],
      placeholder,
      mono,
      disabled: !host.edit,
      message: host.errors.get(`${at}.${key}`) ?? '',
      onInput: (v) => {
        f[key] = v;
        t.setMessage('');
        if (key === 'title') title.textContent = v.trim() || 'New feed';
        host.changed();
      },
    });
    return t.field;
  };
  form.append(
    text('title', 'Title', 'The name feed readers show, such as “Example Co blog”.', 'Example Co blog'),
    text('path', 'Address', 'Where the feed lives on your site. It ends in .xml, such as /rss.xml or /blog/rss.xml.', '/rss.xml', true),
    text('description', 'Short description (optional)', 'One line feed readers show under the title.', 'News and guides from Example Co'),
  );

  const kinds = h('fieldset', 'ms-hk__radios');
  const hintId = uid('ms-hk-hint');
  kinds.setAttribute('aria-describedby', hintId);
  kinds.append(ht('legend', 'ms-hk__label', 'What goes in it'));
  for (const c of host.collections) {
    const l = h('label', 'ms-hk__radio');
    const box = Object.assign(h('input'), { type: 'checkbox', checked: f.collections.includes(c.id), disabled: !host.edit });
    box.addEventListener('change', () => {
      f.collections = host.collections.map((x) => x.id).filter((id) => (id === c.id ? box.checked : f.collections.includes(id)));
      kinds.querySelector('.ms-hk__msg')?.replaceChildren();
      host.changed();
    });
    l.append(box, document.createTextNode(c.label));
    kinds.append(l);
  }
  kinds.append(ht('p', 'ms-hk__hint', 'Tick the kinds of page this feed lists. Drafts and pages not yet live are never in it.'));
  kinds.lastElementChild!.id = hintId;
  const msg = ht('p', 'ms-hk__msg', host.errors.get(`${at}.collections`) ?? '');
  msg.setAttribute('aria-live', 'polite');
  kinds.append(msg);
  form.append(kinds);

  const limit = textField({
    label: 'How many items',
    hint: 'How many of the newest pages the feed holds, from 1 to 500.',
    value: Number.isFinite(f.limit) ? String(f.limit) : '',
    type: 'number',
    disabled: !host.edit,
    message: host.errors.get(`${at}.limit`) ?? '',
    onInput: (v) => {
      f.limit = v.trim() === '' ? Number.NaN : Number(v);
      limit.setMessage('');
      host.changed();
    },
  });
  limit.input.classList.add('ms-hk__num');
  form.append(limit.field);
  return form;
}
