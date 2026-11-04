// The Topic map's Flow view without a browser: its model (src/admin/topics/flow-model.ts: codes, link counts, the
// groups open at first and in the URL, the pages round one page, the trail) and its layout (flow-river.ts: the river,
// the step, the zoom that fits), each layout run through the layout check the browser test runs too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageOf, buildFlow, countLinks, defaultOpen, letters, openFrom, openParam, stepSides, walk, type FlowGroup } from '../src/admin/topics/flow-model.ts';
import { CARD, checkLayout, crossLine, fitZoom, GOAL, INDENT, perRow, riverLayout, rounded, stepGap, stepLayout, widthOf, ZOOM_MIN, type Layout, type RiverGroup } from '../src/admin/topics/flow-river.ts';
import type { JourneyMap } from '../src/topics.ts';

const NOW = Date.parse('2026-10-30T12:00:00Z');
const ink = { light: '#2b2f36', dark: '#e8e9ec' };

/** A topic: a main page, a service page, `groups` groups of `each` articles (each group with a lead), links as given. */
function topic(groups: number, each: number, links: [string, string, number?][] = []): JourneyMap {
  const page = (ref: string, place: string, group: string | null = null) => ({ ref, title: `Page ${ref}`, url: `/${ref}/`, place, group, in: 1, out: 1, external: 0, live: true, status: 'published', published: '2026-01-01T00:00:00Z', modified: '2026-02-01T00:00:00Z', problems: [], edit: '', updated: null });
  const pages = [page('m', 'pillar'), page('s', 'money')];
  const gs = [];
  for (let g = 0; g < groups; g++) {
    gs.push({ id: `g${g}`, name: `Group ${g}`, lead: `g${g}-lead` });
    pages.push(page(`g${g}-lead`, 'lead', `g${g}`));
    for (let i = 0; i < each + (g === 0 ? 1 : 0); i++) pages.push(page(`g${g}-a${i}`, 'member', `g${g}`));
  }
  const edges = links.flatMap(([from, to, n = 1], j) => Array.from({ length: n }, (_, i) => ({ id: `e${j}-${i}`, pair: `${from}>${to}`, from, to, anchor: `words ${i}`, sentence: '', at: null, section: null, status: 'ok', href: '', address: '', warn: [], open: '' })));
  return { topic: { id: 't', title: 'T', pillar: 'm', money: 's', moneyGuessed: false, groups: gs }, pages, edges, missing: [], numbers: { visits: false, leads: false } } as unknown as JourneyMap;
}

const riverGroups = (groups: FlowGroup[]): RiverGroup[] => groups.map((g) => ({ ...g }));
const river = (d: JourneyMap, open?: Set<string>, row = 5) => {
  const m = buildFlow(d, { group: null, asOf: null, now: NOW });
  return riverLayout({ groups: riverGroups(m.groups), main: 'm', service: 's', mainColour: ink, count: countLinks(m.conns), open: open ?? new Set(m.groups.map((g) => g.key)), perRow: row });
};
const box = (l: Layout, id: string) => l.boxes.find((b) => b.id === id)!;

test('codes: groups take letters A on without M and S; leads are 1, articles 2 on; M and S', () => {
  assert.deepEqual(letters(14).join(''), 'ABCDEFGHIJKLNO');
  const m = buildFlow(topic(2, 2), { group: null, asOf: null, now: NOW });
  assert.deepEqual([...m.all.values()].map((n) => n.code), ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'M', 'S']);
  assert.equal(ageOf({ published: '2026-09-01T00:00:00Z', modified: null }, NOW), 'new');
  assert.equal(ageOf({ published: '2024-01-01T00:00:00Z', modified: '2025-01-01T00:00:00Z' }, NOW), 'stale');
});

test('link counts: the links from one page to another; a missing link counts none', () => {
  const m = buildFlow(topic(1, 1, [['m', 'g0-lead', 3], ['g0-lead', 'm']]), { group: null, asOf: null, now: NOW });
  const n = countLinks(m.conns);
  assert.equal(n('m', 'g0-lead'), 3);
  assert.equal(n('g0-lead', 'm'), 1);
  assert.equal(n('g0-lead', 's'), 0);
  assert.deepEqual([0, 1, 2, 7, 20].map(widthOf), [1, 2, 3, 8, 8]);
});

test('folding: a small topic opens with every group; a big one with the largest three; the URL says otherwise', () => {
  const small = buildFlow(topic(3, 2), { group: null, asOf: null, now: NOW });
  assert.equal(defaultOpen(small.groups, small.nodes.length).size, 3);
  const d = topic(10, 4);
  // group 0 has one article more; 1 and 2 come first on the tie
  const big = buildFlow(d, { group: null, asOf: null, now: NOW });
  const pages = big.nodes.length;
  assert.ok(pages > 40);
  assert.deepEqual([...defaultOpen(big.groups, pages)], ['g0', 'g1', 'g2']);
  assert.deepEqual([...openFrom(null, big.groups, pages)], ['g0', 'g1', 'g2']);
  assert.deepEqual([...openFrom('g4,nope,g5', big.groups, pages)], ['g4', 'g5']);
  assert.equal(openFrom('none', big.groups, pages).size, 0);
  assert.equal(openFrom('all', big.groups, pages).size, 10);
  assert.equal(openParam(new Set(['g0', 'g1', 'g2']), big.groups, pages), null);
  assert.equal(openParam(new Set(['g5', 'g4']), big.groups, pages), 'g4,g5');
  assert.equal(openParam(new Set(), big.groups, pages), 'none');
  assert.equal(openParam(new Set(big.groups.map((g) => g.key)), big.groups, pages), 'all');
});

test('round one page: comes from, goes to and both ways, in code order; the trail walks on and back', () => {
  const m = buildFlow(topic(2, 2, [['g0-a1', 'g0-lead'], ['g0-lead', 'g0-a0'], ['g0-a0', 'g0-lead'], ['g0-lead', 'm'], ['b' as string, 'x'], ['g1-a0', 'g0-lead'], ['g0-lead', 's']]), { group: null, asOf: null, now: NOW });
  assert.deepEqual(stepSides(m, 'g0-lead'), { from: ['g0-a1', 'g1-a0'], to: ['m', 's'], both: ['g0-a0'] });
  assert.deepEqual(walk([], 'm', 'g0-lead'), ['m']);
  assert.deepEqual(walk(['m'], 'g0-lead', 'g0-a0'), ['m', 'g0-lead']);
  // back to a page on the trail: the trail ends before it
  assert.deepEqual(walk(['m', 'g0-lead'], 'g0-a0', 'm'), []);
  assert.deepEqual(walk(['m', 'g0-lead'], 'g0-a0', 'g0-lead'), ['m']);
});

test('the river: goal bar on top, the main page under it, the leads in a row, the articles stacked and indented', () => {
  const l = river(topic(3, 2, [['m', 's', 2], ['m', 'g0-lead', 3], ['g0-lead', 'g0-a0']]));
  assert.deepEqual(checkLayout(l), []);
  const s = box(l, 's');
  const m = box(l, 'm');
  assert.deepEqual([s.kind, s.y, s.w, s.h], ['goal', 0, GOAL.w, GOAL.h]);
  assert.equal(m.y, GOAL.h + 48);
  assert.equal(s.x + s.w / 2, m.x + m.w / 2, 'the goal and the main page share a middle');
  const leads = ['g0-lead', 'g1-lead', 'g2-lead'].map((r) => box(l, r));
  assert.ok(leads.every((b) => b.y === m.y + CARD.h + 64));
  const a0 = box(l, 'g0-a0');
  const a1 = box(l, 'g0-a1');
  assert.equal(a0.x, leads[0].x + INDENT);
  assert.equal(a1.y - a0.y, CARD.h + 16);
  // each line as wide as the links it carries; a link not there is a thin dotted line
  const line = (id: string) => l.lines.find((x) => x.id === id)!;
  assert.equal(line('m>s').width, 3);
  assert.equal(line('m>g0-lead').width, 4);
  assert.equal(line('g0-lead>g0-a0').width, 2);
  assert.deepEqual([line('m>g1-lead').width, line('m>g1-lead').none], [1, true]);
  assert.match(line('m>g1-lead').d, /Q/, 'its corners are rounded');
});

test('the river in rows: a big topic, folded but three, rows of five fed by the channel on the left', () => {
  const d = topic(13, 4);
  const m = buildFlow(d, { group: null, asOf: null, now: NOW });
  const open = defaultOpen(m.groups, m.nodes.length);
  const l = river(d, open, 5);
  assert.deepEqual(checkLayout(l), []);
  const leads = m.groups.map((g) => box(l, g.lead!));
  assert.equal(new Set(leads.map((b) => b.y)).size, 3, 'three rows');
  assert.ok(leads.filter((b) => b.folded).length === 10);
  assert.equal(l.boxes.filter((b) => b.col.startsWith('a:')).length, 5 + 4 + 4, 'only the open groups show their articles');
  // the second row's line runs down the channel at x 0, left of every card
  const second = l.lines.find((x) => x.to === m.groups[5].lead)!;
  assert.ok(second.pts.some(([x]) => x === 0));
  assert.ok(l.boxes.every((b) => b.x >= INDENT));
  // every group open: still no overlap, nothing under a card
  assert.deepEqual(checkLayout(river(d, new Set(m.groups.map((g) => g.key)), 5)), []);
  assert.deepEqual(checkLayout(river(d, new Set(m.groups.map((g) => g.key)), 4)), []);
});

test('the river with pieces missing: no lead page, no main page, no service page, one group', () => {
  const groups: RiverGroup[] = [
    { key: 'a', name: 'A', letter: 'A', colour: ink, lead: null, members: ['x', 'y'] },
    { key: 'b', name: 'B', letter: 'B', colour: ink, lead: 'b1', members: [] },
  ];
  const base = { groups, mainColour: ink, count: () => 0, open: new Set(['a', 'b']), perRow: 5 };
  for (const l of [riverLayout({ ...base, main: 'm', service: 's' }), riverLayout({ ...base, main: null, service: 's' }), riverLayout({ ...base, main: 'm', service: null }), riverLayout({ ...base, groups: [groups[1]], main: 'm', service: 's' })]) assert.deepEqual(checkLayout(l), []);
  const l = riverLayout({ ...base, main: null, service: null });
  assert.deepEqual(checkLayout(l), []);
  assert.equal(box(l, 'none:a').ref, null);
  assert.equal(box(l, 'none:main').y, 0, 'with no service page, the main page is on top');
});

test('the step: comes from, the page with To fix and Both ways under it, goes to; one trunk in, one out', () => {
  const l = stepLayout({ focus: 'p', gap: 88, from: ['a', 'b', 'c'], to: ['d', 'e'], both: ['f', 'g'], fixes: 2 });
  assert.deepEqual(checkLayout(l), []);
  const p = box(l, 'p');
  const fix = box(l, 'fix');
  assert.deepEqual([box(l, 'a').x, p.x, box(l, 'd').x], [0, CARD.w + 88, 2 * (CARD.w + 88)]);
  assert.equal(fix.y, p.y + CARD.h + 16);
  assert.equal(fix.h, 48 + 2 * 72);
  assert.equal(box(l, 'head:both').y, fix.y + fix.h + 32);
  assert.ok(box(l, 'f').y > box(l, 'head:both').y);
  // every line in comes down the one trunk between the columns
  const trunk = new Set(l.lines.filter((x) => x.to === 'p').map((x) => x.pts[1][0]));
  assert.deepEqual([...trunk], [CARD.w + 44]);
  assert.ok(l.lines.every((x) => x.colour === null && x.width === 1), 'one grey line style');
  // an empty side says so; no fixes, no box
  const bare = stepLayout({ focus: 'p', gap: 96, from: [], to: [], both: [], fixes: 0 });
  assert.deepEqual(checkLayout(bare), []);
  assert.deepEqual(bare.boxes.filter((b) => b.kind === 'note').map((b) => b.say), ['none-in', 'none-out']);
  assert.equal(bare.boxes.some((b) => b.kind === 'fix'), false);
  assert.deepEqual(checkLayout(stepLayout({ focus: 'p', gap: 48, from: Array.from({ length: 30 }, (_, i) => `f${i}`), to: ['t'], both: [], fixes: 5 })), []);
});

test('zoom: the width filled, a small map up to 125%, a tall one at 100%, never under 93%; rows by width', () => {
  assert.equal(fitZoom({ w: 1400, h: 900 }, { w: 600, h: 300 }), 1.25);
  assert.equal(fitZoom({ w: 1400, h: 900 }, { w: 1100, h: 3000 }), 1);
  assert.equal(fitZoom({ w: 900, h: 900 }, { w: 1400, h: 600 }), ZOOM_MIN);
  assert.equal(fitZoom({ w: 1400, h: 900 }, { w: 600, h: 300 }, true), 1, 'the step never zooms past 100%');
  assert.deepEqual([1224, 1432, 1800].map(perRow), [4, 5, 6]);
  // the step's columns closer together on a narrow canvas, so it never scrolls sideways
  assert.deepEqual([1100, 930, 866, 600].map(stepGap), [96, 80, 48, 48]);
  for (const w of [1100, 930, 866]) assert.ok(stepLayout({ focus: 'p', gap: stepGap(w), from: ['a'], to: ['b'], both: [], fixes: 0 }).w * ZOOM_MIN + 96 <= w, `${w}px`);
  // a river of `perRow` groups fits its canvas at the least zoom
  for (const w of [1224, 1432, 1800]) {
    const l = river(topic(perRow(w), 1), undefined, perRow(w));
    assert.ok(l.w * ZOOM_MIN + 96 <= w, `${w}px: ${l.w}`);
  }
});

test('the layout check finds what breaks the rules', () => {
  const card = (id: string, x: number, y: number, col = id) => ({ id, kind: 'card' as const, ref: id, x, y, ...CARD, col, group: null });
  const bad: Layout = {
    boxes: [card('a', 0, 0, 'c'), card('b', 4, 124, 'c'), card('c', 400, 0), card('d', 300, 300)],
    lines: [{ id: 'l', from: 'c', to: 'x', d: '', pts: [[300, 360], [600, 360]], colour: null, width: 1, none: false }],
    w: 700,
    h: 500,
  };
  const fail = checkLayout(bad).join('\n');
  assert.match(fail, /a and b overlap or are closer than 8px/);
  assert.match(fail, /b: x 4 is not on the 8px grid/);
  assert.match(fail, /b: y 124 is not on the 8px grid/);
  assert.match(fail, /column c is not left-aligned/);
  assert.match(fail, /line l runs under d/);
});

test('paths: corners rounded, never more than half a side; a line between two cards edge to edge', () => {
  assert.equal(rounded([[0, 0], [0, 100], [100, 100]]), 'M0 0L0 92Q0 100 8 100L100 100');
  assert.equal(rounded([[0, 0], [0, 6], [100, 6]]), 'M0 0L0 3Q0 6 3 6L100 6');
  const a = { id: 'a', kind: 'card' as const, ref: 'a', x: 0, y: 0, ...CARD, col: 'a', group: null };
  assert.match(crossLine(a, { ...a, id: 'b', x: 400 }), /^M240 60C/);
  assert.match(crossLine(a, { ...a, id: 'b', y: 400 }), /^M120 120C/);
});
