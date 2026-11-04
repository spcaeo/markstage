// #/revisions/<collection>/<id>?sha=<ref>&with=<ref>&view=text&all=1: an entry's history. The list holds what is live,
// your own autosaves (a version every few minutes while you write, kept even when you never saved) and every saved
// revision (git). Pick one to compare with the current text (or with another version, `with`):
//   side by side (default)  both versions as the site shows them, block by block, changed words marked; any one
//                           change can be put back on its own ("Restore this block"; pages: field by field)
//   view=text               the changed sentences with their words marked, as a list
// Unchanged stretches fold (all=1 shows them). Restoring always writes a new revision; nothing is lost.
import { ApiError } from '../api';
import type { ScreenCtx } from '../host';
import * as api from './api';
import { compare, tally, type Row } from './diff';
import { fieldCompare, fieldNamer, sideBySide } from './sidebyside';
import { button, el, failure, message, page, state, value, when } from './ui';
import { fmtDateTime, fmtTime } from '../dates';

const isAutosave = (ref: string) => ref.startsWith('autosave:');

/** What a saved version did, read from the server's commit message ("Update posts/x" -> "edited"). */
const VERBS: [RegExp, string][] = [
  [/^Update /, 'edited'],
  [/^Publish /, 'published'],
  [/^Unpublish /, 'unpublished'],
  [/^Schedule /, 'scheduled'],
  [/^Create /, 'created'],
  [/^Restore .* to the autosave/, 'restored an autosave of'],
  [/^Restore .* from trash/, 'brought back'],
  [/^(Restore|Take out) .+ from /, 'put back part of'],
  [/^Restore /, 'restored an earlier version of'],
  [/^Trash /, 'moved to the trash'],
  [/^(Move|Rename) /, 'moved'],
  [/^Code injection /, 'changed the code on'],
  [/^(Protect|Unprotect|Password)/, 'changed the password of'],
];
/** A saved version in people's words: "Olive Owner edited Hello World". */
export function revisionName(r: api.Revision, title: string): string {
  if (/^Revert /.test(r.message)) return `Put back after a publish that did not go through`;
  const verb = VERBS.find(([re]) => re.test(r.message))?.[1] ?? 'changed';
  return `${r.author.name} ${verb} ${title}`;
}

export function mountRevisions(host: HTMLElement, ctx: ScreenCtx) {
  const [c, id] = ctx.args;
  const p = page(host, 'History', '');
  let entry: Awaited<ReturnType<typeof api.getEntry>> | null = null;
  let list: api.Revision[] = [];
  let autos: api.Autosave[] = [];
  let alive = true;
  let seq = 0;

  async function load(): Promise<void> {
    if (!c || !id) {
      p.body.replaceChildren(state('denied', 'Not available to you', 'Open the history from an entry.'));
      return;
    }
    p.body.replaceChildren(state('loading', 'Loading the history…'));
    try {
      [entry, list, autos] = await Promise.all([api.getEntry(c, id), api.revisions(c, id), api.autosaves(c, id).catch(() => [])]);
    } catch (e) {
      p.body.replaceChildren(failure(e, () => void load()));
      return;
    }
    if (!alive) return;
    p.head.querySelector('h1')!.textContent = `History of “${entry.title || id}”`;
    ctx.setTitle(`History · ${entry.title || id}`);
    p.actions.replaceChildren(button('Back to the entry', () => ctx.open(`#/e/${encodeURIComponent(c)}/${encodeURIComponent(id)}`), { icon: 'article' }));
    render();
  }

  /** A version's name in plain words. */
  function nameOf(ref: string): string {
    if (ref === 'current') return 'Now';
    if (ref === 'live') return 'Live on the site';
    if (isAutosave(ref)) {
      const a = autos.find((x) => `autosave:${x.id}` === ref);
      return a ? `Your autosave, ${fmtDateTime(a.savedAt)}` : 'Your autosave';
    }
    const r = list.find((x) => x.sha === ref);
    return r ? `${r.author.name}’s version, ${fmtDateTime(r.date)}` : 'An earlier version';
  }

  const title = () => entry?.title || id;

  function render(): void {
    if (!entry) return;
    const q = ctx.params();
    // default: the newest revision before the current one, so there is something to compare
    const sha = q.get('sha') ?? list[1]?.sha ?? list[0]?.sha ?? null;
    const withRef = q.get('with') ?? 'current';
    const item = (ref: string, title: string | Node, meta: (string | Node | null)[], badge?: HTMLElement) => {
      const a = el('a.ms-adm-rev', { href: '#', 'aria-current': ref === sha ? 'true' : undefined }, el('span.ms-adm-rev__msg', title), el('span.ms-adm-rev__meta', ...meta.filter((x): x is string | Node => x !== null), badge ?? null));
      a.addEventListener('click', (e) => {
        e.preventDefault();
        ctx.go({ params: { sha: ref } }, true);
      });
      return el('li', a);
    };
    const side = el('nav.ms-adm-revside', { 'aria-label': 'Versions' });
    if (entry.url) side.append(el('ol.ms-adm-revs', { 'aria-label': 'Live' }, item('live', 'Live on the site', ['What visitors see now'])));
    if (autos.length) {
      side.append(
        el('h3.ms-adm-revgroup', 'Your autosaves'),
        el('ol.ms-adm-revs', { 'aria-label': 'Your autosaves, newest first' }, ...autos.map((a) => item(`autosave:${a.id}`, `Autosave, ${fmtTime(a.savedAt)}`, [when(a.savedAt), ' · only you see these']))),
      );
    }
    side.append(
      el('h3.ms-adm-revgroup', `Saved versions (${list.length})`),
      el('ol.ms-adm-revs', { 'aria-label': 'Saved versions, newest first' }, ...list.map((r, i) => item(r.sha, revisionName(r, title()), [when(r.date)], i === 0 ? el('span.ms-adm-badge.ms-adm-badge--ok', 'Current') : undefined))),
    );
    const main = el('div.ms-adm-split__main');
    p.body.replaceChildren(el('div.ms-adm-revlayout', side, main));
    if (!sha) {
      main.append(state('empty', 'No history yet', 'This entry has not been committed.'));
      return;
    }
    void showCompare(main, sha, withRef);
  }

  async function showCompare(main: HTMLElement, sha: string, withRef: string): Promise<void> {
    const mine = ++seq;
    main.replaceChildren(state('loading', 'Comparing…'));
    let r: Awaited<ReturnType<typeof api.compare>>;
    try {
      r = await api.compare(c, id, sha, withRef, true);
    } catch (e) {
      if (mine === seq) main.replaceChildren(failure(e));
      return;
    }
    if (mine !== seq || !alive || !entry) return;
    const q = ctx.params();
    const view = q.get('view') === 'text' ? 'text' : 'side';
    const all = q.get('all') === '1';
    const rev = list.find((x) => x.sha === sha);
    const isCurrent = list[0]?.sha === sha;
    const labels: [string, string] = [nameOf(sha), nameOf(withRef)];

    const pick = el('select.ms-input.ms-adm-select', { 'aria-label': 'Compare with' }, el('option', { value: 'current' }, 'now (the saved text)'));
    if (entry.url && sha !== 'live') pick.append(el('option', { value: 'live', selected: withRef === 'live' }, 'what is live'));
    for (const x of list.slice(1)) if (x.sha !== sha) pick.append(el('option', { value: x.sha, selected: x.sha === withRef }, `${fmtDateTime(x.date)} · ${revisionName(x, title()).slice(0, 60)}`));
    pick.addEventListener('change', () => ctx.go({ params: { with: pick.value === 'current' ? null : pick.value } }, true));
    const views = el('div.ms-adm-seg', { role: 'group', 'aria-label': 'How to show it' },
      segment('Side by side', view === 'side', () => ctx.go({ params: { view: null } }, true)),
      segment('Text changes', view === 'text', () => ctx.go({ params: { view: 'text' } }, true)),
    );
    const toggle = button(all ? 'Changes only' : 'Everything', () => ctx.go({ params: { all: all ? null : '1' } }, true), { small: true, kind: 'quiet' });

    const head = el('header.ms-adm-revhead',
      el('div.ms-adm-stack',
        el('h2.ms-adm-h2', rev ? revisionName(rev, title()) : labels[0]),
        el('p.ms-adm-sub', ...(rev ? [when(rev.date)] : isAutosave(sha) ? ['Kept for you only. It was never saved as a revision.'] : sha === 'live' ? ['The text the last publish put on the site.'] : [])),
        // the git words, for developers: the commit message and its ID
        rev ? el('details.ms-adm-details.ms-adm-revdetails', el('summary', 'Details'), el('div.ms-adm-stack.ms-adm-sub', el('span', 'Saved as ', value(rev.message || '(no message)', 'commit message')), el('span', 'Revision ', value(rev.sha, 'revision ID', 'ms-adm-mono')))) : null,
      ),
      el('div.ms-adm-row', wholeRestore(sha, isCurrent)),
    );
    const bar = el('div.ms-adm-row.ms-adm-revbar', el('span', 'Compared with'), pick, views, el('span.ms-adm-grow'), toggle);

    if (r.from.source === null) {
      const why = sha === 'live' ? (r.from.deployed === false ? 'Nothing has been published from this server yet.' : 'This entry is not on the live site.') : 'The entry did not exist in this version.';
      main.replaceChildren(head, bar, state('empty', 'Nothing to compare', why));
      return;
    }
    if (r.to.source === null) {
      main.replaceChildren(head, bar, state('empty', 'Nothing to compare', withRef === 'live' ? 'This entry is not on the live site.' : 'The entry did not exist in that version.'));
      return;
    }
    const rows = compare(r.from.source, r.to.source);
    const t = tally(rows);
    const summary = t.added + t.removed + t.changed === 0 ? 'Same text.' : `${[t.changed && `${t.changed} changed`, t.added && `${t.added} added`, t.removed && `${t.removed} removed`].filter(Boolean).join(', ')}, from ${labels[0].toLowerCase().startsWith('your') ? 'your autosave' : 'this version'} to ${labels[1].toLowerCase()}.`;
    // putting one change back is a save of the current text: only when the right side is the current text
    const canRestore = withRef === 'current' && entry.can?.edit !== false && r.to.version !== undefined;
    // a restore adds a revision: the compare stays on this version (the default "the one before" would move)
    const restoreSome = (body: Parameters<typeof api.saveEntry>[2]) => {
      if (!q.get('sha')) ctx.go({ params: { sha } });
      return restoreSomething(body);
    };

    let body: HTMLElement;
    if (view === 'text') body = el('div.ms-adm-compare', { role: 'region', 'aria-label': 'What changed' }, ...textRows(rows, all));
    else if (entry.format === 'json' && r.from.data && r.to.data) {
      body = fieldCompare(r.from.data, r.to.data, { labels, all, name: fieldNamer(c), onRestore: canRestore ? (changes, what) => restoreSome({ version: r.to.version!, changes, message: `${what} from ${labels[0]}` }) : undefined });
    } else if (r.from.doc && r.to.doc) {
      try {
        const toDoc = r.to.doc;
        const blocks = sideBySide(r.from.doc, toDoc, { labels, all, onRestore: canRestore ? (content, what) => restoreSome({ version: r.to.version!, doc: { ...toDoc, content }, message: `${what} from ${labels[0]}` }) : undefined });
        // the settings (frontmatter) above the text, field by field, when they differ
        const fa = r.from.frontmatter ?? {};
        const fb = r.to.frontmatter ?? {};
        const settings = JSON.stringify(fa) === JSON.stringify(fb)
          ? null
          : el('section.ms-adm-stack', { 'aria-label': 'Settings' }, el('h3.ms-adm-h3', 'Settings'), fieldCompare(fa, fb, {
              labels,
              all: false,
              name: fieldNamer(c),
              settable: () => true,
              // a top-level key is set as a whole (null removes it); the server refuses status keys here
              onRestore: canRestore ? (changes, what) => restoreSome({ version: r.to.version!, frontmatter: Object.fromEntries(changes.map((ch) => [ch.path.split('.')[0], ch.path.includes('.') ? fa[ch.path.split('.')[0]] ?? null : ch.delete ? null : ch.value])), message: `${what} from ${labels[0]}` }) : undefined,
            }));
        body = el('div.ms-adm-stack', settings, settings ? el('h3.ms-adm-h3', 'Text') : null, blocks);
      } catch (e) {
        body = el('div', el('p.ms-adm-form__err', { role: 'alert' }, `This version cannot be drawn side by side (${message(e)}). Here are its text changes.`), el('div.ms-adm-compare', ...textRows(rows, all)));
      }
    } else body = el('div', el('p.ms-adm-sub', 'This version cannot be read as a document; here are its text changes.'), el('div.ms-adm-compare', ...textRows(rows, all)));

    main.replaceChildren(
      head,
      bar,
      el('p.ms-adm-lead', summary),
      body,
      r.diff ? el('details.ms-adm-rawdiff', el('summary', 'Line-by-line (for developers)'), el('div.ms-adm-code', value(r.diff, 'diff'))) : '',
    );
  }

  /** "Restore this version" for a saved revision or an autosave (not for the current one or what is live). */
  function wholeRestore(sha: string, isCurrent: boolean): HTMLElement | null {
    if (isCurrent || sha === 'live' || entry?.can?.edit === false) return null;
    const auto = isAutosave(sha);
    const rev = list.find((x) => x.sha === sha);
    return button(auto ? 'Restore this autosave' : 'Restore this version', async () => {
      const at = auto ? autos.find((a) => `autosave:${a.id}` === sha)?.savedAt : rev?.date;
      const ok = await ctx.ask(auto ? 'Restore this autosave?' : 'Restore this version?', `The entry gets the text it had${at ? ` on ${fmtDateTime(at)}` : ''}, as a new revision. The current text stays in the history. Whether it is live does not change.`, [['cancel', 'Cancel'], ['go', 'Restore', 'ms-btn ms-btn--primary']]);
      if (ok !== 'go') return;
      try {
        const fresh = await api.getEntry(c, id);
        if (auto) await api.restoreAutosave(c, id, sha.slice('autosave:'.length), fresh.version);
        else await api.restore(c, id, sha, fresh.version);
        await reload();
        ctx.go({ params: { sha: null, with: null } }, true);
        // said once the history shows it (a person, or a test, moving on at the toast lands on the new state)
        ctx.toast('Restored. It is a new revision now.', 'ok');
      } catch (e) {
        ctx.toast(restoreWords(e), 'error');
      }
    }, { kind: 'primary', icon: 'history' });
  }

  async function restoreSomething(body: Parameters<typeof api.saveEntry>[2]): Promise<void> {
    try {
      await api.saveEntry(c, id, body);
      ctx.toast(`${body.message?.split(' from ')[0] ?? 'Restored'}: done. It is a new revision.`, 'ok');
    } catch (e) {
      ctx.toast(restoreWords(e), 'error');
    }
    await reload();
    render();
  }

  async function reload(): Promise<void> {
    [entry, list, autos] = await Promise.all([api.getEntry(c, id), api.revisions(c, id), api.autosaves(c, id).catch(() => [])]);
  }

  void load();
  return {
    update: () => render(),
    destroy: () => {
      alive = false;
    },
  };
}

const restoreWords = (e: unknown) =>
  e instanceof ApiError && e.status === 409 ? 'The entry changed since you opened this. It has been reloaded: try again.' : e instanceof ApiError && e.status === 403 ? 'This entry is live: changing it needs the publish right.' : message(e);

function segment(label: string, on: boolean, go: () => void): HTMLButtonElement {
  const b = el('button.ms-adm-seg__btn', { type: 'button', 'aria-pressed': on ? 'true' : 'false' }, label);
  b.addEventListener('click', go);
  return b;
}

/** The rows as blocks of prose; runs of more than two unchanged blocks fold into "n unchanged" (unless `all`). */
export function textRows(rows: Row[], all: boolean): HTMLElement[] {
  const out: HTMLElement[] = [];
  const block = (r: Row) => {
    const b = el(`div.ms-adm-cmp.ms-adm-cmp--${r.kind}`);
    if (r.kind === 'del') b.append(el('span.ms-adm-cmp__tag', 'Removed'));
    if (r.kind === 'ins') b.append(el('span.ms-adm-cmp__tag', 'Added'));
    if (r.kind === 'change') b.append(el('span.ms-adm-cmp__tag', 'Changed'));
    const text = el('p.ms-adm-cmp__text');
    for (const piece of r.pieces) text.append(piece.kind === 'same' ? piece.text : el(piece.kind === 'del' ? 'del' : 'ins', piece.text));
    b.append(text);
    return b;
  };
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].kind !== 'same' || all) {
      out.push(block(rows[i]));
      continue;
    }
    let j = i;
    while (j < rows.length && rows[j].kind === 'same') j++;
    const run = rows.slice(i, j);
    // keep one block of context at each side of a change
    const lead = i > 0 ? 1 : 0;
    const trail = j < rows.length ? 1 : 0;
    if (run.length <= lead + trail + 1) run.forEach((r) => out.push(block(r)));
    else {
      if (lead) out.push(block(run[0]));
      const hidden = run.slice(lead, run.length - trail);
      const fold = el('button.ms-adm-fold', { type: 'button' }, `${hidden.length} unchanged block${hidden.length === 1 ? '' : 's'}`);
      fold.addEventListener('click', () => fold.replaceWith(...hidden.map(block)));
      out.push(fold);
      if (trail) out.push(block(run[run.length - 1]));
    }
    i = j - 1;
  }
  return out;
}
