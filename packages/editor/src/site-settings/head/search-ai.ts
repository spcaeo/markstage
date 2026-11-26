// Settings → Search & AI (#/settings/search-ai?feed=<id>): what the build writes next to the pages for AI tools and
// feed readers: a Markdown copy of every page, the OKF bundle, llms.txt, the pages to leave out, and the feeds. Each
// switch says in one sentence what it is for and shows the addresses that will exist, with copy and open icons. Owner
// and administrator; the server's GET / PUT head (docs/HEAD-KIT.md), committed as the person and followed by a build.
import { copyable, siteUrl } from '../../copy';
import type { ScreenCtx } from '../../host';
import { ic } from '../../icons';
import { h, iconBtn, ht } from '../../panel-form';
import { isStale, issuesOf } from './check';
import { type FeedRow, type HeadDoc, type Raw, saveHead } from './doc';
import { feedsSection } from './feeds';
import { type BarState, saveBar, switchRow, uid } from './fields';
import { type Part, mountHeadPart } from './screen';

interface Draft {
  pages: boolean;
  okf: boolean;
  llms: boolean;
  skip: string[];
  feeds: FeedRow[];
}

const draftOf = (doc: HeadDoc): Draft => {
  const { markdown, feeds } = doc.head!;
  return structuredClone({ pages: markdown.pages, okf: markdown.okf, llms: markdown.llms, skip: markdown.skip, feeds });
};

/** The addresses a switch makes: each with copy and open icons, written out in full. */
function addresses(rows: [string, string][]): HTMLElement {
  const box = h('ul', 'ms-hk__addrs');
  for (const [what, path] of rows) {
    const url = siteUrl(path);
    const li = h('li');
    li.append(ht('span', 'ms-hk__what', `${what}: `), copyable(url, { label: `the address of ${what}`, open: url }));
    box.append(li);
  }
  return box;
}

function make(doc: HeadDoc, ctx: ScreenCtx, reload: () => Promise<void>): Part {
  const edit = doc.canEdit;
  let draft = draftOf(doc);
  // blank rows are not settings: they do not make the form dirty and are not saved
  const snap = () => JSON.stringify({ ...draft, skip: draft.skip.map((p) => p.trim()).filter(Boolean) });
  const base = snap();
  let errors = new Map<string, string>();
  let stale = false;
  let saving = false;
  const dirty = () => snap() !== base;
  const state = (): BarState => ({ dirty: dirty(), saving, stale });

  const bar = saveBar({
    save: 'Save the settings',
    saved: 'Saved.',
    unsaved: 'Not saved yet. The site builds these files once it is saved.',
    onSave: () => void store(),
    onDiscard: () => void reload(),
    onReload: () => void reload(),
  });
  const root = h('div', 'ms-hk');
  const changed = () => bar.render(state());

  const copies = () => {
    const sec = h('section', 'ms-locks__group');
    sec.append(h('h3', 'ms-locks__h', 'Copies for AI tools'), ht('p', 'ms-locks__lead', 'Plain-text versions of your site that AI tools and search assistants read faster and more reliably than the pages themselves. Nothing here changes how a page looks.'));
    const rows = h('div', 'ms-locks__rows ms-hk__switches');
    const add = (key: 'pages' | 'okf' | 'llms', label: string, hint: string, urls: [string, string][]) => {
      const s = switchRow({ label, hint, checked: draft[key], disabled: !edit, onChange: (on) => ((draft[key] = on), draw()) });
      if (draft[key]) s.extra.append(addresses(urls));
      rows.append(s.row);
    };
    add('pages', 'A Markdown copy of every page', 'Each page also exists as plain text at its own address with .md added (the home page is /index.md, /about/ is /about.md). AI tools use it instead of reading the page’s layout.', [['Home page copy', '/index.md']]);
    add('okf', 'A bundle of the whole site (OKF)', 'A folder of small text files: /okf/index.md lists every page and each page has its own file, linked together, so a tool can read the whole site without a browser.', [['Bundle index', '/okf/index.md']]);
    add('llms', 'An llms.txt file', 'A short file that tells AI tools what the site is and where its pages are, plus a longer one with the pages’ text. It is the same idea as robots.txt, but for AI.', [
      ['Short file', '/llms.txt'],
      ['Long file', '/llms-full.txt'],
    ]);
    sec.append(rows);
    if (draft.pages || draft.okf || draft.llms) sec.append(ht('p', 'ms-hk__hint', 'These addresses work once the site has been built with your change.'));
    return sec;
  };

  const skip = () => {
    const sec = h('section', 'ms-locks__group');
    sec.append(h('h3', 'ms-locks__h', 'Pages to leave out'), ht('p', 'ms-locks__lead', 'A page listed here gets no Markdown copy and is left out of the bundle and llms.txt. Pages you hide from search engines are already left out. Write each address as it is on your site, starting with /, such as /thank-you/.'));
    const rows = h('div', 'ms-hk__skips');
    draft.skip.forEach((path, i) => {
      const line = h('div', 'ms-hk__skip');
      const box = h('div', 'ms-hk__field');
      const input = Object.assign(h('input', 'ms-input ms-input--code'), { type: 'text', value: path, placeholder: '/thank-you/', disabled: !edit });
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.setAttribute('aria-label', `Address of page ${i + 1} to leave out`);
      const msg = ht('p', 'ms-hk__msg', errors.get(`markdown.skip.${i}`) ?? '');
      msg.setAttribute('aria-live', 'polite');
      msg.id = uid('ms-hk-msg');
      input.setAttribute('aria-invalid', String(!!msg.textContent));
      if (msg.textContent) input.setAttribute('aria-describedby', msg.id);
      input.addEventListener('input', () => {
        draft.skip[i] = input.value;
        msg.textContent = '';
        input.setAttribute('aria-invalid', 'false');
        input.removeAttribute('aria-describedby');
        changed();
      });
      box.append(input, msg);
      line.append(box);
      if (edit)
        line.append(
          iconBtn('trash', `Stop leaving out page ${i + 1}`, () => {
            draft.skip.splice(i, 1);
            draw();
            changed();
          }),
        );
      rows.append(line);
    });
    if (!draft.skip.length) rows.append(ht('p', 'ms-hk__empty', 'No pages are left out.'));
    sec.append(rows);
    if (edit) {
      const add = Object.assign(h('button', 'ms-btn ms-btn--sm', `${ic('plus', 14)}<span>Leave out a page</span>`), { type: 'button' });
      add.addEventListener('click', () => {
        draft.skip.push('');
        draw();
        const inputs = root.querySelectorAll<HTMLInputElement>('.ms-hk__skip input');
        inputs[inputs.length - 1]?.focus();
        changed();
      });
      sec.append(add);
    }
    return sec;
  };

  const draw = () => {
    const picked = ctx.params().get('feed');
    root.replaceChildren(
      copies(),
      skip(),
      feedsSection({
        feeds: draft.feeds,
        collections: doc.collections ?? [],
        edit,
        open: picked,
        errors,
        go: (feed) => ctx.go({ params: { feed } }, true),
        changed,
        redraw: draw,
      }),
    );
    if (edit) root.append(bar.el);
    bar.render(state());
    root.querySelector('.is-picked')?.scrollIntoView({ block: 'nearest' });
  };

  const store = async () => {
    if (!dirty() || saving) return;
    saving = true;
    errors = new Map();
    draft.skip = draft.skip.map((p) => p.trim()).filter(Boolean);
    changed();
    const raw: Raw = { ...(doc.settings ?? {}) };
    const md = raw.markdown && typeof raw.markdown === 'object' && !Array.isArray(raw.markdown) ? (raw.markdown as Raw) : {};
    raw.markdown = { ...md, pages: draft.pages, okf: draft.okf, llms: draft.llms, skip: draft.skip };
    raw.feeds = draft.feeds.map((f) => ({ id: f.id, title: f.title.trim(), ...(f.description.trim() ? { description: f.description.trim() } : {}), path: f.path.trim(), collections: f.collections, limit: f.limit }));
    try {
      await saveHead(doc, raw, ctx, 'The settings are saved. The site builds them now.', () => void reload());
      await reload();
    } catch (err) {
      saving = false;
      if (isStale(err)) stale = true;
      else {
        errors = issuesOf(err);
        // the first feed with a problem opens, so the message is in view
        const bad = [...errors.keys()].map((k) => /^feeds\.(\d+)\./.exec(k)?.[1]).find((n) => n !== undefined);
        const feed = bad === undefined ? null : draft.feeds[Number(bad)]?.id ?? null;
        if (feed) ctx.go({ params: { feed } }, true);
        ctx.toast(`Not saved: ${(err as Error).message}`, 'error');
      }
      draw();
    }
  };

  draw();
  return { el: root, dirty, update: draw };
}

export function mountSearchAi(el: HTMLElement, ctx: ScreenCtx): { update(c: ScreenCtx): void } {
  return mountHeadPart(el, ctx, {
    title: 'Search & AI',
    lead: 'Make your pages easy for AI tools and feed readers to read: Markdown copies, a bundle of the whole site, llms.txt and feeds. Markstage builds them with your site.',
    owns: ['markdown', 'feeds'],
    make: (doc, reload) => make(doc, ctx, reload),
  });
}
