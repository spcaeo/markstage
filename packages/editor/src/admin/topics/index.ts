// The Topic map (docs/API-LINKS.md): the site's subjects, each with its main page, its groups (each with a lead page) and
// its pages. Pages in a topic are suggested to link to each other, and the site's "More on this topic" block lists
// them. Every state is in the URL:
//   #/topic-map?action=new                       the list of topics, the "New topic" form
//   #/topic-map/<id>?group=<g>&page=<ref>&details=1&link=<id>&more=<g>   one topic as a journey (journey.ts, the
//                                             first view): which page links to which, with the words; group: one
//                                             group only; page: the page picked; details: its links in the side
//                                             panel; link: one connection or missing link there; more: groups shown
//                                             whole
//   #/topic-map/<id>?view=flow&group=&open=&page=&trail=&zoom=&options=&side=&deep=&age=&asof=
//                                             one topic as a river (flow.ts): the service page on top, the main page,
//                                             the group leads, their articles; a page picked shows where it comes from
//                                             and where it goes; the params are flow.ts's
//   #/topic-map/<id>?view=arrange&q=&page=<ref>  one topic as a board: drag pages between its places (q: the search in
//                                             the pages in no topic; page: the page picked)
//   #/topic-map/<id>?action=edit                 its name, words, service page and groups
//   #/topic-map/<id>?action=delete               delete it (its pages are then in no topic)
// Editors and above change topics; everyone may look.
import type { ScreenCtx } from '../../host';
import { config } from '../../runtime';
import '../../styles/links.css';
import { createTopic, deleteTopic, listTopics, placePage, topicsChanged, updateTopic, type PageRow, type Topic } from '../../topics';
import { button, drawer, el, failure, field, form, message, page, searchBox, select, state } from '../ui';
import { board, type Place } from './board';
import { flow, type Flow } from './flow';
import { journey, type Journey } from './journey';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const words = (v: string) =>
  v
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
// params a view keeps to itself: changing only these does not draw the screen again
const QUIET = ['q', 'page', 'details', 'link', 'more', 'group', 'open', 'trail', 'zoom', 'side', 'deep', 'age', 'asof', 'options'];
const VIEWS: [string, string][] = [
  ['journey', 'Journey'],
  ['flow', 'Flow'],
  ['arrange', 'Arrange'],
];

export function mountTopics(host: HTMLElement, ctx: ScreenCtx) {
  const p = page(host, 'Topic map', 'The subjects of the site. Pages in a topic link to its main page and to each other, and the site lists them under “More on this topic”.');
  let items: Topic[] = [];
  let pages = new Map<string, PageRow>();
  let manage = false;
  let alive = true;
  let drawnKey = '';

  const key = () => {
    const params = new URLSearchParams(ctx.params());
    for (const k of QUIET) params.delete(k);
    return `${ctx.args.join('/')}?${params}`;
  };

  async function load(): Promise<void> {
    if (!config().topics) return void p.body.replaceChildren(state('empty', 'This site keeps no topics', 'A developer turns them on in the site config (topics). Until then pages are not grouped by subject.'));
    if (!items.length) p.body.replaceChildren(state('loading', 'Loading topics…'));
    try {
      const r = await listTopics();
      items = r.items;
      pages = new Map(r.pages.map((x) => [x.ref, x]));
      manage = r.can.manage;
      if (alive) render();
    } catch (e) {
      if (alive) p.body.replaceChildren(failure(e, () => void load()));
    }
  }

  function render(): void {
    drawnKey = key();
    const id = ctx.args[0];
    p.actions.replaceChildren();
    if (manage) p.actions.append(button('New topic', () => ctx.go({ args: [], params: { action: 'new' } }, true), { icon: 'plus', kind: 'primary' }));
    p.actions.append(button('Link health', () => ctx.open('#/links?view=health', true), { icon: 'monitor' }));
    if (!id) {
      jr?.destroy();
      jr = null;
      fl?.destroy();
      fl = null;
      return list();
    }
    const t = items.find((x) => x.id === id);
    if (!t) return void p.body.replaceChildren(state('denied', 'Not available to you', 'There is no such topic, or it was deleted.'));
    ctx.setTitle(`${t.title} · Topic map`);
    one(t);
  }

  function list(): void {
    ctx.setTitle('Topic map');
    const loose = [...pages.values()].filter((x) => !x.topic);
    const grid = el('div.ms-topics');
    for (const t of items) {
      const a = el('a.ms-topic-card', { href: `#/topic-map/${encodeURIComponent(t.id)}` }, el('h2', t.title), t.description ? el('p', t.description) : null, el('p.ms-topic-card__counts', el('span.ms-num', plural(t.counts.pages, 'page', 'pages')), ' · ', el('span.ms-num', `${t.counts.live} live`), t.counts.weak ? el('span.ms-topic-card__weak', ` · ${plural(t.counts.weak, 'page needs', 'pages need')} links`) : null), el('p.ms-topic-card__main', t.pillar ? `Main page: ${pages.get(t.pillar)?.title ?? t.pillar}` : 'No main page yet'));
      grid.append(a);
    }
    if (!items.length) grid.append(state('empty', 'No topics yet', manage ? 'Add one for each subject the site covers, then put its pages in it.' : 'An editor adds them.'));
    const unplaced = el('p.ms-topics__loose', loose.length ? `${plural(loose.length, 'page is', 'pages are')} in no topic yet. Open a topic to drag them in.` : 'Every page is in a topic.');
    p.body.replaceChildren(grid, unplaced);
    if (ctx.params().get('action') === 'new' && manage) newTopic();
  }

  function newTopic(): void {
    const close = () => ctx.go({ params: { action: null } }, true);
    const d = drawer(p.body, 'New topic', close);
    d.body.append(
      form([field('title', 'Name', { required: true, maxlength: 100, hint: 'What the topic is about, in a few words, such as “Data migration”.' }), field('description', 'What it covers (optional)')], 'Add topic', async (v) => {
        const r = await createTopic({ title: v.title, description: v.description });
        topicsChanged();
        ctx.toast(`Added the topic “${r.topic.title}”. Now put its pages in it.`, 'ok');
        ctx.go({ args: [r.topic.id], params: { action: null } }, true);
        await load();
      }),
    );
    d.el.querySelector<HTMLInputElement>('input')?.focus();
  }

  async function move(t: Topic, ref: string, to: Place): Promise<void> {
    try {
      const r = await placePage(ref, to.topic, { group: to.group, role: to.role, ...(to.index !== undefined ? { index: to.index } : {}) });
      topicsChanged();
      const title = pages.get(ref)?.title ?? ref;
      ctx.toast(r.topic ? `Moved “${title}”.` : `Took “${title}” out of “${t.title}”.`, 'ok');
      ctx.go({ params: { page: ref } });
      await load();
    } catch (e) {
      ctx.toast(message(e), 'error');
    }
  }

  let boardSlot: HTMLElement | null = null;
  let drawnQ = '';
  let jr: Journey | null = null;
  let fl: Flow | null = null;
  const view = () => (['arrange', 'flow'].includes(ctx.params().get('view') ?? '') ? ctx.params().get('view')! : 'journey');

  function one(t: Topic): void {
    jr?.destroy();
    jr = null;
    fl?.destroy();
    fl = null;
    boardSlot = null;
    const head = el('div.ms-tb-head', el('a.ms-tb-back', { href: '#/topic-map' }, '← All topics'), el('h2.ms-tb-title', t.title), el('p.ms-tb-counts', `${plural(t.counts.pages, 'page', 'pages')} · ${t.counts.weak ? plural(t.counts.weak, 'page needs', 'pages need') + ' links' : 'every live page has links in'}`));
    // Journey (which page links to which) and Arrange (the board); a click is a history entry
    const tabs = el('div.ms-adm-chips.ms-tb-views', { role: 'tablist', 'aria-label': 'Views' });
    for (const [v, label] of VIEWS) {
      const b = el('button.ms-adm-chip', { type: 'button', role: 'tab', 'aria-selected': String(v === view()), 'aria-pressed': String(v === view()) }, label);
      // the group shown stays (Journey and Flow both show one); the rest is the view's own
      b.addEventListener('click', () => v !== view() && ctx.go({ params: { ...Object.fromEntries(QUIET.map((k) => [k, null])), group: v === 'arrange' ? null : ctx.params().get('group'), view: v === 'journey' ? null : v } }, true));
      tabs.append(b);
    }
    const tools = el('div.ms-tb-tools', tabs);
    if (view() === 'arrange') tools.append(searchBox(ctx, 'q', 'Find a page in no topic'));
    tools.append(button('Its links', () => ctx.open(`#/links?view=inbox&topic=${encodeURIComponent(t.id)}`, true), { icon: 'link' }));
    if (manage) tools.append(button('Edit topic', () => ctx.go({ params: { action: 'edit' } }, true), { icon: 'settings' }));
    if (view() === 'journey') {
      jr = journey(ctx, t.id);
      p.body.replaceChildren(head, tools, jr.el);
    } else if (view() === 'flow') {
      fl = flow(ctx, t.id);
      p.body.replaceChildren(head, tools, fl.el);
    } else {
      boardSlot = el('div.ms-tb-slot');
      p.body.replaceChildren(head, tools, boardSlot);
      drawBoard(t);
      const picked = ctx.params().get('page');
      if (picked) boardSlot.querySelector<HTMLElement>(`[data-ref="${CSS.escape(picked)}"]`)?.scrollIntoView({ block: 'nearest' });
    }
    const action = ctx.params().get('action');
    if (action === 'edit' && manage) editTopic(t);
    if (action === 'delete' && manage) removeTopic(t);
  }

  /** The board alone (the search in the pages in no topic changed: the search box keeps its focus). */
  function drawBoard(t: Topic): void {
    const q = (ctx.params().get('q') ?? '').toLowerCase();
    drawnQ = q;
    const loose = [...pages.values()].filter((x) => !x.topic && (!q || x.title.toLowerCase().includes(q) || String(x.url ?? '').includes(q)));
    boardSlot?.replaceChildren(board({ topic: t, pages, loose, manage, focus: ctx.params().get('page'), move: (ref, to) => void move(t, ref, to), pick: (ref) => ctx.go({ params: { page: ref } }) }));
  }

  /** The picked page marked (focus on a card puts it in the URL; nothing draws again, so the focus stays). */
  function markPicked(): void {
    const picked = ctx.params().get('page');
    for (const c of boardSlot?.querySelectorAll<HTMLElement>('.ms-tb-card') ?? []) {
      c.classList.toggle('is-picked', c.dataset.ref === picked);
      c.setAttribute('aria-selected', String(c.dataset.ref === picked));
    }
  }

  function editTopic(t: Topic): void {
    const close = () => ctx.go({ params: { action: null } }, true);
    const d = drawer(p.body, `Edit “${t.title}”`, close);
    const choices: [string, string][] = [['', 'None'], ...[...pages.values()].sort((a, b) => a.title.localeCompare(b.title)).map((x) => [x.ref, x.title] as [string, string])];
    const groupRows = el('div.ms-tb-groups');
    const groups = t.groups.map((g) => ({ ...g }));
    const drawGroups = () => {
      groupRows.replaceChildren(el('p.ms-field__label', 'Groups'));
      groups.forEach((g, i) => {
        const input = el('input.ms-input', { 'aria-label': `Name of group ${i + 1}`, value: g.name });
        input.addEventListener('input', () => (g.name = input.value));
        const rm = button('Remove', () => (groups.splice(i, 1), drawGroups()), { icon: 'trash', small: true, kind: 'quiet', title: 'Its pages go to “Pages without a group”' });
        groupRows.append(el('div.ms-tb-grouprow', input, rm));
      });
      groupRows.append(button('Add a group', () => (groups.push({ id: '', name: 'New group', lead: null, members: [] }), drawGroups()), { icon: 'plus', small: true }));
    };
    drawGroups();
    d.body.append(
      form(
        [
          field('title', 'Name', { required: true, maxlength: 100, value: t.title }),
          field('description', 'What it covers', { value: t.description }),
          field('anchors', 'Words for links to the main page', { value: t.anchors.join(', '), hint: 'Comma between them, such as “data migration services, moving your data”. Suggestions use them.' }),
          field('keywords', 'Words that name the topic', { value: t.keywords.join(', '), hint: 'Sentences with these words are suggested for links to the main page.' }),
          select('money', 'Its service page', choices, t.money ?? ''),
          groupRows,
        ],
        'Save topic',
        async (v) => {
          // a removed group's pages stay in the topic, without a group
          const kept = groups.filter((g) => g.name.trim());
          const gone = t.groups.filter((g) => !kept.some((k) => k.id === g.id));
          const r = await updateTopic(t.id, t.version, {
            title: v.title,
            description: v.description,
            anchors: words(v.anchors),
            keywords: words(v.keywords),
            money: v.money || null,
            members: [...t.members, ...gone.flatMap((g) => [...(g.lead ? [g.lead] : []), ...g.members])],
            groups: kept.map((g) => ({ ...g, id: g.id || '' })),
          });
          topicsChanged();
          ctx.toast(`Saved “${r.topic.title}”.`, 'ok');
          close();
          await load();
        },
        { extra: [button('Delete topic', () => ctx.go({ params: { action: 'delete' } }, true), { icon: 'trash', kind: 'danger' })] },
      ),
    );
    d.el.querySelector<HTMLInputElement>('input')?.focus();
  }

  function removeTopic(t: Topic): void {
    const close = () => ctx.go({ params: { action: null } }, true);
    const d = drawer(p.body, `Delete “${t.title}”?`, close);
    d.body.append(
      el('p', `Its ${plural(t.counts.pages, 'page stays', 'pages stay')} on the site, in no topic. Their links stay as they are.`),
      el(
        'div.ms-adm-form__tools',
        button('Delete topic', async () => {
          try {
            await deleteTopic(t.id, t.version);
            topicsChanged();
            ctx.toast(`Deleted the topic “${t.title}”.`, 'ok');
            ctx.go({ args: [], params: { action: null } }, true);
            await load();
          } catch (e) {
            ctx.toast(message(e), 'error');
          }
        }, { kind: 'danger', icon: 'trash' }),
        button('Keep it', close),
      ),
    );
  }

  void load();
  return {
    update() {
      if (key() !== drawnKey) return render();
      if (jr) return jr.update();
      if (fl) return fl.update();
      const t = ctx.args[0] ? items.find((x) => x.id === ctx.args[0]) : null;
      if (t && (ctx.params().get('q') ?? '').toLowerCase() !== drawnQ) drawBoard(t);
      else markPicked();
    },
    destroy() {
      alive = false;
      jr?.destroy();
      fl?.destroy();
    },
  };
}
