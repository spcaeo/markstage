// #/releases/<id>: one release. Where it stands (live, rolled back, going live now, blocked at its time), going live
// (the rules' answer in words, approvals, a reason, Publish now or Schedule…), its preview (up to date or why not, and
// building it), then its items (?tab=) or its share links (?tab=links). Each panel has its own URL: do=rename,
// do=schedule, do=cancel, do=rollback, do=picture, do=share (links.ts), item=<id> (what an item changes). A running
// publish or preview build is followed live and the release read again when it ends.
import type { ScreenCtx } from '../host';
import { echoDate } from '../dates';
import { ApiError } from '../api';
import { jobPanel, type JobPanel } from '../admin/jobs';
import { compare } from '../admin/diff';
import { textRows } from '../admin/revisions';
import { bytes, button, chips, drawer, el, failure, field, form, isEditorPlus, link, message, page, state, value, when, whoami } from '../admin/ui';
import { decisionWords } from '../environments/words';
import * as api from './api';
import { linksCard } from './links';
import { statusBadge, textArea } from './list';
import { KIND_WORDS, at, changedItems, currentApprovals, isOpen, previewWords, publishable, toLocal, fromLocal } from './words';

export function mountRelease(host: HTMLElement, ctx: ScreenCtx, rid: string) {
  let r: api.Release | null = null;
  let me: { id: string; editor: boolean } | null = null;
  let alive = true;
  let follow: JobPanel | null = null;
  let followed = '';
  const reasonBox = el('textarea.ms-input', { id: 'ms-rel-reason', rows: '2', maxlength: '500', placeholder: 'Why this goes live' });

  async function load(): Promise<void> {
    try {
      const [m, x] = await Promise.all([whoami(), api.get(rid)]);
      if (!alive) return;
      me = m.user ? { id: m.user.id, editor: isEditorPlus(m) } : null;
      r = x;
      draw();
    } catch (e) {
      if (!alive) return;
      const gone = e instanceof ApiError && (e.status === 404 || e.status === 403);
      page(host, 'Release', '').body.replaceChildren(gone ? state('denied', 'Not available to you', 'This release does not exist, or you cannot open it.') : failure(e, () => void load()));
    }
  }

  /** A change came back from the server: draw it. A 409 (someone changed it meanwhile) reads it again. */
  async function act(run: () => Promise<api.Release | { release: api.Release }>, done?: string): Promise<boolean> {
    try {
      const x = await run();
      r = 'release' in x ? x.release : x;
      if (done) ctx.toast(done, 'ok');
      draw();
      return true;
    } catch (e) {
      ctx.toast(e instanceof ApiError && e.status === 409 && !e.data?.items ? 'Someone changed this release meanwhile: here it is as it is now.' : message(e), 'error');
      void load();
      return false;
    }
  }

  function draw(): void {
    const x = r!;
    ctx.setTitle(`${x.name} · Releases`);
    const p = page(host, x.name, '');
    p.head.querySelector('.ms-adm-head__text')!.append(
      x.description ? el('p.ms-adm-intro', x.description) : '',
      el('p.ms-adm-sub', 'Made by ', x.createdBy.name ? value(x.createdBy.name, 'name') : 'someone', ' ', when(x.createdAt)),
    );
    const editable = isOpen(x) && !!me?.editor;
    p.actions.replaceChildren(
      el('a.ms-btn.ms-btn--quiet', { href: '#/releases' }, 'All releases'),
      statusBadge(x),
      editable ? button('Rename…', () => ctx.go({ params: { do: 'rename' } }, true), { small: true, kind: 'quiet' }) : '',
      editable ? button('Cancel the release…', () => ctx.go({ params: { do: 'cancel' } }, true), { small: true, kind: 'quiet' }) : '',
    );
    const layout = el('div.ms-adm-split');
    const main = el('div.ms-adm-split__main.ms-rel');
    layout.append(main);
    p.body.replaceChildren(layout);
    main.append(...[outcome(x), goLive(x), preview(x), checks(x)].filter((n): n is HTMLElement => !!n));
    // what is in it, or who it is shared with
    const tab = ctx.params().get('tab') === 'links' ? 'links' : '';
    main.append(el('div.ms-adm-row.ms-rel-tabs', chips(ctx, 'tab', 'Show', [['', `In it (${x.counts.items})`], ['links', `Share links (${x.links ?? 0})`]])));
    if (tab === 'links') {
      main.append(linksCard(layout, { ctx, target: { release: x.id }, what: 'this release', canMake: isOpen(x) && !!me?.editor, whyNot: isOpen(x) ? 'Editors and above share a release.' : 'A release is shared while it is open or scheduled.', changed: () => void refreshCount() }));
    } else main.append(itemsCard(x));
    panels(layout, x);
  }

  async function refreshCount(): Promise<void> {
    const x = await api.get(rid).catch(() => null);
    if (x && alive && r) {
      r.links = x.links;
      const chip = host.querySelector<HTMLElement>('.ms-rel-tabs [aria-pressed]:last-child');
      if (chip) chip.textContent = `Share links (${x.links ?? 0})`;
    }
  }

  // ---------- where it stands ----------
  function followJob(jid: string, intro: string, hint: string): HTMLElement {
    if (followed !== jid) {
      follow?.destroy();
      followed = jid;
      follow = jobPanel(jid, { quietSuccess: true, failedHint: hint, onEnd: () => void load() });
    }
    return el('section.ms-rel-follow', el('p.ms-adm-sub', intro), follow!.el);
  }

  function outcome(x: api.Release): HTMLElement | null {
    if (x.status === 'publishing' && x.job) return followJob(x.job, `“${x.name}” is going live: one commit, then the site is built, checked and put live.`, 'The live site is as it was: what the release wrote was put back.');
    if (followed && x.status !== 'publishing' && x.preview?.status !== 'building') {
      follow?.destroy();
      follow = null;
      followed = '';
    }
    const by = (p: api.Person | null) => (p?.name ? ` by ${p.id === me?.id ? 'you' : p.name}` : '');
    if (x.status === 'published')
      return el(
        'div.ms-adm-outcome.is-ok',
        { role: 'status' },
        el('strong', 'Live. '),
        `Went live${by(x.publishedBy)} `,
        when(x.publishedAt),
        x.commit ? el('span', ' · commit ', value(x.commit.slice(0, 7), 'commit')) : '',
        x.job ? el('span', ' · ', el('a', { href: `#/jobs/${encodeURIComponent(x.job)}` }, 'the log')) : '',
        me?.editor ? el('span', ' ', button('Roll back…', () => ctx.go({ params: { do: 'rollback' } }, true), { small: true, kind: 'quiet', icon: 'undo' })) : '',
      );
    if (x.status === 'rolled-back') return el('div.ms-adm-outcome', { role: 'status' }, el('strong', 'Rolled back. '), 'What it put live was taken off the site again.', x.revert ? el('span', ' Commit ', value(x.revert.slice(0, 7), 'commit')) : '');
    if (x.status === 'cancelled') return el('div.ms-adm-outcome', { role: 'status' }, el('strong', 'Cancelled. '), 'Nothing in it went live. Its share links no longer work.');
    if (x.blocked)
      return el('div.ms-adm-outcome.is-bad', { role: 'alert' }, el('strong', `It was due ${at(x.publishAt)} and is blocked. `), value(x.blocked.words, 'why it is blocked'), x.blocked.rule ? el('span', ' Rule: ', x.blocked.rule.name, '.') : '', ' It stays scheduled and goes live as soon as nothing stops it; or unschedule it.');
    if (x.error) return el('div.ms-adm-outcome.is-bad', { role: 'alert' }, el('strong', 'It did not go live. '), value(x.error, 'error message'), ' The live site is as it was.', x.job ? el('span', ' ', el('a', { href: `#/jobs/${encodeURIComponent(x.job)}` }, 'See the log.')) : '');
    return null;
  }

  // ---------- going live: the rules, approvals, the buttons ----------
  function goLive(x: api.Release): HTMLElement | null {
    if (!isOpen(x)) return null;
    const card = el('section.ms-adm-card.ms-rel-golive', el('h2.ms-adm-h2', x.status === 'scheduled' ? 'Scheduled' : 'Go live'));
    if (x.status === 'scheduled') card.append(el('p.ms-rel-when', `Goes live ${at(x.publishAt)}`, x.scheduledBy?.name ? el('span.ms-adm-sub', ` · set by ${x.scheduledBy.id === me?.id ? 'you' : x.scheduledBy.name}`) : ''));
    const d = x.decision;
    if (d) card.append(el(`div.ms-adm-outcome${d.effect === 'allow' ? '.is-ok' : d.effect === 'deny' ? '.is-bad' : ''}`, x.status === 'scheduled' ? `At that time: ${decisionWords(d)}` : decisionWords(d)));
    // approvals count for exactly what it holds now; a change to it needs them again
    const current = currentApprovals(x);
    if (x.approvals.length) {
      card.append(el('h3.ms-adm-h3', 'Approvals'), el('ul.ms-rel-approvals', ...x.approvals.map((a) => el(`li${a.sha === x.key ? '' : '.is-old'}`, value(a.name ?? 'someone', 'name'), el('span.ms-adm-sub', ` · ${a.role} · `), when(a.at), a.sha === x.key ? '' : el('span.ms-adm-sub', ' · for what it held before a change')))));
    }
    if (me && x.canApprove !== false && x.createdBy.id !== me.id && x.counts.items && !current.some((a) => a.userId === me!.id)) {
      const b = button('Approve it as it is now', () => void act(() => api.approve(x.id, x.version), 'Approved.').then((ok) => !ok && (b.disabled = false)), { icon: 'check' });
      b.addEventListener('click', () => (b.disabled = true));
      card.append(el('div.ms-adm-row', b, el('span.ms-adm-sub', 'Your approval counts for what it holds now; adding or taking out anything needs it again.')));
    }
    const go = button('Publish now', () => void publishNow(x, go), { kind: 'primary', icon: 'rocket' });
    const why = el('p.ms-adm-sub.ms-rel-why', { role: 'status' });
    const sync = () => {
      const p = publishable(x, reasonBox.value);
      go.disabled = !p.ok;
      why.textContent = p.ok || !d || d.effect !== 'needs' || p.why.startsWith('“') ? p.why : '';
      why.hidden = !why.textContent;
    };
    reasonBox.oninput = sync;
    sync();
    const wantsReason = d?.missing.some((m) => m.kind === 'reason');
    const sched = x.status === 'scheduled'
      ? [button('Change the time…', () => ctx.go({ params: { do: 'schedule' } }, true), { kind: 'quiet', icon: 'calendar' }), button('Unschedule', () => void act(() => api.unschedule(x.id, x.version), 'Unscheduled: it is open again.'), { kind: 'quiet' })]
      : [button('Schedule…', () => ctx.go({ params: { do: 'schedule' } }, true), { icon: 'calendar' })];
    card.append(wantsReason ? el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: 'ms-rel-reason' }, 'Reason'), reasonBox) : '', el('div.ms-adm-actions', go, ...sched), why);
    return card;
  }

  async function publishNow(x: api.Release, b: HTMLButtonElement): Promise<void> {
    b.disabled = true;
    b.classList.add('is-busy');
    try {
      const out = await api.publish(x.id, x.version, reasonBox.value.trim() || undefined);
      r = { ...out.release, job: out.release.job ?? out.job };
      draw();
    } catch (e) {
      b.classList.remove('is-busy');
      b.disabled = false;
      // 409 changed: names each item that changed on the site; 403 rule and 422 blocked: the server's words
      const named = e instanceof ApiError && Array.isArray(e.data?.items) ? ` ${(e.data!.items as { title?: string }[]).map((i) => i.title).filter(Boolean).join(', ')}` : '';
      ctx.toast(`${message(e)}${named && !message(e).includes('“') ? named : ''}`, 'error');
      void load();
    }
  }

  // ---------- the preview ----------
  function preview(x: api.Release): HTMLElement | null {
    if (!isOpen(x)) return null;
    const pv = x.preview;
    const w = previewWords(pv, x.status === 'scheduled');
    const card = el('section.ms-adm-card.ms-rel-preview', el('h2.ms-adm-h2', 'Preview'));
    if (pv?.status === 'building' && pv.job) card.append(followJob(pv.job, w.text, 'Nothing changed on the site.'));
    else card.append(el(`div.ms-adm-outcome${w.tone ? `.is-${w.tone}` : ''}`, { role: 'status' }, w.text));
    const acts = el('div.ms-adm-actions');
    if (w.build && x.counts.items) {
      const b = button(w.build, async () => {
        b.disabled = true;
        try {
          const out = await api.buildPreview(x.id);
          r = { ...x, preview: out.preview };
          draw();
        } catch (e) {
          b.disabled = false;
          ctx.toast(message(e), 'error');
        }
      }, { icon: 'refresh' });
      acts.append(b);
    }
    if (me?.editor && x.counts.items) acts.append(button('Share it…', () => ctx.go({ params: { tab: 'links', do: 'share', made: null } }, true), { kind: 'quiet', icon: 'link' }));
    if (acts.childElementCount) card.append(acts);
    if (!x.counts.items) card.append(el('p.ms-adm-sub', 'Put something in the release first.'));
    return card;
  }

  function checks(x: api.Release): HTMLElement | null {
    const c = x.checks;
    if (!isOpen(x) || !c?.done || !c.results?.length) return null;
    const failed = c.results.filter((y) => !y.ok);
    return el(
      'section.ms-adm-card',
      el('div.ms-adm-row', el('h2.ms-adm-h2', 'Checks'), el('span.ms-adm-grow'), el('span.ms-adm-sub', failed.length ? `${failed.length} did not pass` : 'All passed')),
      failed.length ? el('ul.ms-adm-list', ...failed.map((y) => el('li', el('strong', y.label), el('span.ms-adm-sub', ` · ${y.blocking ? 'stops the publish' : 'a warning'} · `), titleOf(x, y.entry)))) : el('p.ms-adm-sub', 'The site’s checks passed on every page in it, in the last preview.'),
    );
  }

  const titleOf = (x: api.Release, entry: string) => x.items?.find((i) => `${i.collection}/${i.entryId}` === entry)?.title ?? entry;

  // ---------- what is in it ----------
  function itemsCard(x: api.Release): HTMLElement {
    const card = el('section.ms-adm-card.ms-rel-items');
    const head = el('div.ms-adm-row', el('h2.ms-adm-h2', 'In this release'), el('span.ms-adm-grow'));
    if (isOpen(x)) head.append(button('Add a picture…', () => ctx.go({ params: { do: 'picture' } }, true), { small: true, icon: 'image' }));
    card.append(head);
    const list = x.items ?? [];
    if (!list.length) {
      card.append(state('empty', 'Nothing in it yet', isOpen(x) ? 'Open a page in the editor, then More → Add to a release…. A Library item: open it in the Library, then Add to a release….' : ''));
      return card;
    }
    if (isOpen(x)) card.append(el('p.ms-adm-sub', 'None of this is on the site yet. Pages: open one in the editor, then More → Add to a release…; adding a page again takes its latest words.'));
    const tb = el('tbody');
    for (const it of list) {
      const out = button('Take out', () => void takeOut(x, it), { small: true, kind: 'quiet' });
      const where = it.kind === 'entry' && it.collection && it.entryId ? el('a', { href: `#/e/${encodeURIComponent(it.collection)}/${encodeURIComponent(it.entryId)}` }, it.title) : it.kind === 'library' && it.libraryId ? el('a', { href: `#/library?open=${encodeURIComponent(it.libraryId)}` }, it.title) : el('span', it.title);
      const notes: (Node | string)[] = [];
      if (it.changedSince) notes.push(el('div.ms-rel-warn', { role: 'note' }, 'Changed on the site since it was added: add it again to take the latest, then publish.'));
      if (it.alsoIn.length) notes.push(el('div.ms-adm-sub', 'Also in ', ...it.alsoIn.flatMap((o, i) => [i ? ', ' : '', el('a', { href: `#/releases/${encodeURIComponent(o.id)}` }, o.name)])));
      tb.append(
        el(
          `tr${it.changedSince ? '.is-bad' : ''}`,
          el('td', where, el('span.ms-adm-sub', ` · ${it.isNew ? 'new' : 'changed'}`), ...notes),
          el('td', KIND_WORDS[it.kind]),
          el('td', it.url ? link(it.url, `the address of ${it.title}`) : el('span.ms-adm-none', '—')),
          el('td', it.addedBy.name ? value(it.addedBy.name, 'name') : '—', el('div.ms-adm-sub', when(it.addedAt))),
          el('td.ms-adm-cell--end', button(it.kind === 'media' ? 'See it' : 'What changes', () => ctx.go({ params: { item: it.id } }, true), { small: true, kind: 'quiet' }), isOpen(x) ? out : ''),
        ),
      );
    }
    card.append(el('table.ms-adm-table.ms-adm-table--rows.ms-rel-itemtable', el('thead', el('tr', el('th', 'What'), el('th', 'Kind'), el('th', 'Address'), el('th', 'Added by'), el('th', ''))), tb));
    const changed = changedItems(x);
    if (changed.length && isOpen(x)) card.prepend(el('div.ms-adm-outcome.is-bad', { role: 'alert' }, `${changed.length} item${changed.length === 1 ? '' : 's'} changed on the site since added: the release cannot go live until ${changed.length === 1 ? 'it is' : 'they are'} added again.`));
    return card;
  }

  async function takeOut(x: api.Release, it: api.ReleaseItem): Promise<void> {
    const answer = await ctx.ask(`Take “${it.title}” out of the release?`, it.kind === 'entry' ? 'The page stays as it is on the site and in the editor; only the release forgets it.' : 'The release forgets it; nothing on the site changes.', [['cancel', 'Keep it'], ['out', 'Take it out', 'ms-btn ms-btn--danger']]);
    if (answer === 'out') await act(() => api.removeItem(x.id, it.id), `Took “${it.title}” out.`);
  }

  // ---------- panels (each has its URL) ----------
  function panels(layout: HTMLElement, x: api.Release): void {
    const q = ctx.params();
    const close = () => ctx.go({ params: { do: null, item: null } }, true);
    const item = q.get('item');
    if (item) return itemPanel(layout, x, item, close);
    const what = q.get('do');
    if (!what || what === 'share') return;
    const titles: Record<string, string> = { rename: 'Rename the release', schedule: 'Schedule', cancel: 'Cancel the release', rollback: 'Roll back', picture: 'Add a picture' };
    const d = drawer(layout, titles[what] ?? 'Release', close);
    const needsOpen = ['rename', 'schedule', 'cancel', 'picture'].includes(what);
    if (needsOpen && !isOpen(x)) return void d.body.append(state('empty', 'Not now', 'This release is no longer open.'));
    if ((what === 'rename' || what === 'cancel' || what === 'rollback') && !me?.editor) return void d.body.append(state('denied', 'Not available to you', 'Editors and above do this.'));
    if (what === 'rename') {
      d.body.append(form([field('name', 'Name', { required: true, maxlength: 120, value: x.name }), textArea('description', 'What it is for', x.description)], 'Save', async (v) => {
        if (await act(() => api.rename(x.id, { version: x.version, name: v.name, description: v.description }), 'Saved.')) close();
      }));
    } else if (what === 'schedule') {
      const min = toLocal(new Date(Date.now() + 60_000).toISOString());
      d.body.append(
        el('p.ms-adm-sub', 'It goes live at that time on its own, if the rules allow it then. The preview is built as of that time, so it shows what will go live, dates included.'),
        form([field('at', 'Goes live at (your time)', { type: 'datetime-local', required: true, value: toLocal(x.publishAt) })], x.status === 'scheduled' ? 'Change the time' : 'Schedule', async (v) => {
          const iso = fromLocal(v.at);
          if (!iso) throw new Error('Pick a date and a time.');
          if (await act(() => api.schedule(x.id, x.version, iso), `Scheduled: goes live ${at(iso)}.`)) close();
        }),
      );
      const input = d.body.querySelector<HTMLInputElement>('input[name="at"]');
      if (input) echoDate(input);
      if (input) input.min = min;
    } else if (what === 'cancel') {
      d.body.append(
        el('p', 'Nothing in it goes live, and its share links stop working. The release is kept, marked cancelled.'),
        el('div.ms-adm-actions', button('Cancel the release', () => void act(() => api.cancel(x.id, x.version), 'Cancelled.').then((ok) => ok && close()), { kind: 'danger' }), button('Keep it', close, { kind: 'quiet' })),
      );
    } else if (what === 'rollback') {
      if (x.status !== 'published') return void d.body.append(state('empty', 'Not now', 'Only a release that is live can be rolled back.'));
      const reason = el('textarea.ms-input', { id: 'ms-rel-rb-reason', rows: '2', maxlength: '500' });
      d.body.append(
        el('p', 'Every file it put live goes back to what it was, in one commit, then the site is built and put live. A file someone changed since is left as it is (the log names it).'),
        el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: 'ms-rel-rb-reason' }, 'Reason'), reason),
        el('div.ms-adm-actions', button('Roll it back', async () => {
          try {
            const out = await api.rollback(x.id, reason.value.trim() || undefined);
            ctx.go({ params: { do: null } }, true);
            r = { ...out.release, status: 'publishing', job: out.job };
            draw();
          } catch (e) {
            ctx.toast(message(e), 'error');
          }
        }, { kind: 'danger', icon: 'undo' }), button('Keep it live', close, { kind: 'quiet' })),
      );
    } else if (what === 'picture') {
      const file = el('input.ms-input', { type: 'file', name: 'file', accept: 'image/*', id: 'ms-rel-pic' });
      d.body.append(
        el('p.ms-adm-sub', 'It goes into the media library, with its alt text, when the release goes live. Until then only the release has it.'),
        el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: 'ms-rel-pic' }, 'Picture'), file),
        form([field('alt', 'Alt text (what it shows, for people who cannot see it)', { maxlength: 500 })], 'Add it', async (v) => {
          const f = (file as HTMLInputElement).files?.[0];
          if (!f) throw new Error('Choose a picture first.');
          if (await act(() => api.addPicture(x.id, f, v.alt), `Added “${f.name}”.`)) close();
        }),
      );
    }
  }

  function itemPanel(layout: HTMLElement, x: api.Release, iid: string, close: () => void): void {
    const it = x.items?.find((i) => i.id === iid);
    const d = drawer(layout, it ? it.title : 'Item', close);
    d.el.classList.add('ms-rel-drawer--wide');
    if (!it) return void d.body.append(state('empty', 'Not in this release', 'It was taken out, or the address is wrong.'));
    d.body.append(el('p.ms-adm-sub', `${KIND_WORDS[it.kind]} · ${it.isNew ? 'new on the site' : 'a change to what the site has'} · ${bytes(it.bytes)}`), it.url ? el('p', link(it.url, `the address of ${it.title}`)) : '');
    if (it.kind === 'media') {
      d.body.append(el('img.ms-rel-pic', { src: api.itemFile(x.id, it.id), alt: it.alt ?? '' }), el('p.ms-adm-sub', it.alt ? el('span', 'Alt text: ', value(it.alt, 'alt text')) : 'No alt text.', it.width && it.height ? ` · ${it.width} × ${it.height}` : ''));
      return;
    }
    const slot = el('div', state('loading', 'Comparing…'));
    d.body.append(slot);
    api.itemText(x.id, it.id).then(
      (t) => {
        if (t.text === null) return void slot.replaceChildren(el('p.ms-adm-sub', 'Nothing to show.'));
        if (t.current === null) return void slot.replaceChildren(el('p.ms-adm-sub', 'New: the site does not have it yet. All of it:'), el('pre.ms-rel-text', t.text));
        const rows = compare(t.current, t.text);
        slot.replaceChildren(el('p.ms-adm-sub', isOpen(x) ? 'From what the site has now, to what the release puts live:' : 'From what the site had, to what the release put live:'), el('div.ms-adm-compare', { role: 'region', 'aria-label': 'What changes' }, ...textRows(rows, false)));
      },
      (e) => slot.replaceChildren(failure(e)),
    );
  }

  page(host, 'Release', '').body.replaceChildren(state('loading', 'Loading the release…'));
  void load();
  return {
    update(next: ScreenCtx) {
      ctx = next;
      if (r) draw();
    },
    destroy() {
      alive = false;
      follow?.destroy();
    },
  };
}
