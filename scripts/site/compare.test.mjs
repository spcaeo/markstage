// The comparison cards and tables hold docs/COMPARISON.md exactly: every product, every row and every cell (its
// words and its sources), read here from the raw Markdown lines, not through the site's own parser. The kinds the
// cards are grouped by follow from the tables. The roadmap (site-content/roadmap.md) is the one list behind every
// "coming" badge, the README's Roadmap says the same, and no badge sits beside a yes.   npm run site:test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { buildSite, REPO_ROOT } from './build-site.mjs';
import { CARD_FACTS, KINDS, PRODUCTS, parseComparison } from './comparison-data.mjs';
import { itemsByRow, soonBadge, soonFinder } from './roadmap.mjs';
import { parseFrontMatter } from './markdown.mjs';

const read = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
const SOURCE = read('docs/COMPARISON.md');
const built = buildSite();
const page = (file) => built.files.find((f) => f.file === file)?.content;
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const squash = (s) => s.replace(/\s+/g, ' ').trim();

/** The comparison tables of COMPARISON.md from its lines: `{ h2, h3, head, rows: [[cell, ...]] }`. */
function rawTables(md) {
  const out = [];
  let h2 = '';
  let h3 = '';
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('## ')) [h2, h3] = [l.slice(3).trim(), ''];
    else if (l.startsWith('### ')) h3 = l.slice(4).trim();
    else if (l.startsWith('| Feature |')) {
      const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const t = { h2, h3, head: cells(l).slice(1).map((c) => c.replace(/\*\*/g, '')), rows: [] };
      for (i += 2; i < lines.length && lines[i].startsWith('|'); i++) t.rows.push(cells(lines[i]));
      i--;
      out.push(t);
    }
  }
  return out;
}
const TABLES = rawTables(SOURCE);
const lead = TABLES.filter((t) => t.h2.startsWith('Markstage vs '));
const group = (letter) => TABLES.filter((t) => t.h2.startsWith(`Group ${letter}:`));

/** A Markdown cell's words and its footnote ids, as a reader sees them. */
const mdCell = (c) => ({
  text: squash(c.replace(/\[\^[\w-]+\]/g, '').replace(/<\/?(sub|br)\s*\/?>/gi, ' ').replace(/`/g, '')),
  refs: [...c.matchAll(/\[\^([\w-]+)\]/g)].map((m) => m[1]),
});
/** The same for a rendered cell: the badge's word and the roadmap badge are not part of the fact. */
const htmlCell = (c) => ({
  text: squash(
    unescape(
      c
        .replace(/<span class="mk-l">[^<]*<\/span>/g, '')
        .replace(/<span class="soon-wrap">[\s\S]*?<\/a><\/span>/g, '')
        .replace(/<sup class="fn">[\s\S]*?<\/sup>/g, '')
        .replace(/<\/?(code|strong|em)>/g, '')
        .replace(/<[^>]+>/g, ' '),
    ),
  ),
  refs: [...c.matchAll(/href="[^"]*#fn-([\w-]+)"/g)].map((m) => m[1]),
});

/** A rendered comparison table by its caption id: head names and rows of `{ feature, cells }`. */
function htmlTable(html, captionId) {
  const t = new RegExp(`<table class="cmp"[^>]*><caption id="${captionId}">[\\s\\S]*?</table>`).exec(html)?.[0];
  assert.ok(t, `no table ${captionId}`);
  const head = [...t.match(/<thead>[\s\S]*?<\/thead>/)[0].matchAll(/<th scope="col" class="(?:ms|pc)"[^>]*>([\s\S]*?)<\/th>/g)].map((m) => unescape(m[1].replace(/<[^>]+>/g, '')));
  const rows = [...t.matchAll(/<tr data-row="[^"]*"><th scope="row" class="feat">([\s\S]*?)<\/th>([\s\S]*?)<\/tr>/g)].map((m) => ({
    feature: m[1],
    cells: [...m[2].matchAll(/<td [^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]),
  }));
  return { head, rows, groups: (t.match(/<tr class="grp"/g) ?? []).length };
}

/** Every row of `tables` (raw) against the rendered table: same products, rows, cells, words and sources. */
function sameTable(raw, rendered, label) {
  const head = raw[0].head;
  for (const t of raw) assert.deepEqual(t.head, head, `${label}: every table of a group has the same products`);
  assert.deepEqual(rendered.head, head, `${label}: products`);
  const rows = raw.flatMap((t) => t.rows);
  assert.equal(rendered.rows.length, rows.length, `${label}: rows`);
  let cells = 0;
  const byFeature = new Map(rendered.rows.map((r) => [htmlCell(r.feature).text, r]));
  for (const row of rows) {
    const feature = mdCell(row[0]).text;
    const r = byFeature.get(feature);
    assert.ok(r, `${label}: no row "${feature}"`);
    assert.equal(r.cells.length, head.length, `${label} / ${feature}: cells`);
    head.forEach((p, i) => {
      assert.deepEqual(htmlCell(r.cells[i]), mdCell(row[i + 1]), `${label} / ${feature} / ${p}`);
      cells++;
    });
  }
  assert.equal(cells, rows.length * head.length);
  return cells;
}

describe('the comparison pages hold every fact of docs/COMPARISON.md', () => {
  const full = page('compare/full/index.html');
  const short = page('compare/index.html');

  test('the tables are there: the lead table, Group A in 6 sections, Group B in 4', () => {
    assert.equal(lead.length, 1);
    assert.ok(group('A').length >= 5 && group('B').length >= 3);
  });

  test('/compare/full/: the lead table, Group A and Group B, every cell with its words and sources', () => {
    let cells = sameTable(lead, htmlTable(full, 'cap-lead'), 'lead');
    const a = htmlTable(full, 'cap-a');
    const b = htmlTable(full, 'cap-b');
    assert.equal(a.groups, group('A').length, 'one group heading row per ### section of Group A');
    assert.equal(b.groups, group('B').length);
    cells += sameTable(group('A'), a, 'Group A') + sameTable(group('B'), b, 'Group B');
    const all = TABLES.reduce((n, t) => n + t.rows.length * t.head.length, 0);
    assert.equal(cells, all, 'every cell of every comparison table');
    // the source numbers link to the list on the same page
    for (const m of full.matchAll(/<sup class="fn"><a href="#(fn-[\w-]+)"/g)) assert.match(full, new RegExp(`<li id="${m[1]}"`));
  });

  test('/compare/: the lead table, with sources one click away on /compare/full/', () => {
    sameTable(lead, htmlTable(short, 'cap-lead'), 'compare lead');
    assert.match(short, /<sup class="fn"><a href="full\/#fn-ms-arch"/);
  });

  test('a card for Markstage and every product of the tables, each fact as the tables say it', () => {
    const names = [...new Set(TABLES.flatMap((t) => t.head))].filter((n) => n !== 'Markstage');
    assert.deepEqual(PRODUCTS.map((p) => p.name).sort(), names.sort(), 'PRODUCTS lists exactly the products of the tables');
    const cards = [...short.matchAll(/<li class="pcard[^"]*" data-p="([^"]+)" data-k="([^"]*)">([\s\S]*?)<\/li>/g)];
    const slugs = cards.map((c) => c[1]);
    assert.equal(slugs.length, names.length + 1, 'one card per product, plus Markstage');
    assert.deepEqual([...slugs].sort(), ['markstage', ...PRODUCTS.map((p) => p.slug)].sort());
    // the lead three first, after Markstage
    assert.deepEqual(slugs.slice(0, 4), ['markstage', 'wordpress', 'ghost', 'prismic']);
    // each fact is the first cell of its row: Group A, then Group B, then the lead table
    const cellOf = (name, feature) => {
      for (const t of [...group('A'), ...group('B'), ...lead]) {
        const i = t.head.indexOf(name);
        const row = t.rows.find((r) => mdCell(r[0].split(/<br>|<sub>/)[0]).text === feature);
        if (i >= 0 && row) return mdCell(row[i + 1]);
      }
      return null;
    };
    for (const [, slug, , html] of cards) {
      const name = slug === 'markstage' ? 'Markstage' : PRODUCTS.find((p) => p.slug === slug).name;
      const facts = [...html.matchAll(/<dt>([^<]*)<\/dt><dd>([\s\S]*?)<\/dd>/g)];
      assert.deepEqual(
        facts.map((f) => f[1]),
        CARD_FACTS.map((f) => f.label),
        name,
      );
      CARD_FACTS.forEach((f, i) => assert.deepEqual(htmlCell(facts[i][2]), cellOf(name, f.feature), `${name}: ${f.label}`));
    }
  });

  test('the kinds follow the tables', () => {
    const inA = new Set(group('A')[0].head);
    const selfHost = (name) => {
      for (const t of group('B')) {
        const i = t.head.indexOf(name);
        const row = t.rows.find((r) => mdCell(r[0]).text === 'Self-host');
        if (i >= 0 && row) return row[i + 1].trim();
      }
      return null;
    };
    // the file calls WordPress and Ghost "mature publishing platforms"
    assert.match(SOURCE, /WordPress and Ghost are mature\s+publishing platforms/);
    for (const p of PRODUCTS) {
      const want = inA.has(p.name) ? 'git' : ['WordPress', 'Ghost'].includes(p.name) ? 'publishing' : selfHost(p.name).startsWith('✗') ? 'hosted' : 'app';
      assert.equal(p.kind, want, p.name);
      assert.ok(KINDS.some((k) => k.id === p.kind));
    }
  });

  test('each alternatives page about a product of the tables opens with its "Markstage vs X" pair', () => {
    for (const p of PRODUCTS) {
      const html = page(`alternatives/${p.slug}/index.html`);
      if (!html) continue;
      const pair = /<ul class="pcards pair"[\s\S]*?<\/ul>/.exec(html)?.[0];
      assert.ok(pair, `${p.slug} has no pair`);
      assert.deepEqual([...pair.matchAll(/data-p="([^"]+)"/g)].map((m) => m[1]), ['markstage', p.slug]);
      assert.ok(html.indexOf('pcards pair') < html.indexOf('<div class="prose">'), `${p.slug}: the pair comes first`);
    }
  });

  test('the parser agrees with the raw lines', () => {
    const data = parseComparison(SOURCE);
    assert.deepEqual(data.lead.products, lead[0].head);
    assert.deepEqual(data.groups.map((g) => g.sections.length), [group('A').length, group('B').length]);
    assert.equal(data.notes.size, (SOURCE.match(/^\[\^[\w-]+\]:/gm) ?? []).length);
  });
});

describe('the roadmap is the one list behind every "coming" badge', () => {
  const { meta } = parseFrontMatter(read('site-content/roadmap.md'));
  const items = meta.items;
  const byId = new Map(items.map((i) => [i.id, i]));
  const data = parseComparison(SOURCE);
  const rowsOf = (feature) => [data.lead, ...data.groups.flatMap((g) => g.sections)].flatMap((t) => t.rows.filter((r) => r.feature === feature));

  test('every item has an id, a title, a line and a known status, and ids are unique', () => {
    assert.ok(items.length > 0);
    assert.equal(byId.size, items.length);
    for (const it of items) {
      assert.match(it.id, /^[a-z0-9-]+$/);
      assert.ok(it.title && it.what, it.id);
      assert.ok(['in-progress', 'planned', 'shipped'].includes(it.status), it.id);
    }
  });

  test('each row an item names is in COMPARISON.md, and Markstage does not have it yet (never ✓)', () => {
    for (const it of items)
      for (const feature of it.rows ?? []) {
        const rows = rowsOf(feature);
        assert.ok(rows.length, `${it.id}: no row "${feature}" in COMPARISON.md`);
        for (const r of rows) assert.notEqual(r.cells.Markstage.mark, 'yes', `${it.id}: Markstage already has "${feature}"`);
      }
    assert.throws(() => soonFinder({ items: [{ id: 'x', title: 'X', status: 'planned', rows: ['Self-host'] }] }, '')('Self-host', { mark: 'yes' }), /already has/);
  });

  test('every badge on the site names an item that is not shipped, and sits only beside a mark that is not ✓', () => {
    let badges = 0;
    for (const f of built.files) {
      for (const m of f.content.matchAll(/class="soon [a-z-]+"[^>]*data-item="([^"]+)"/g)) {
        badges++;
        const it = byId.get(m[1]);
        assert.ok(it, `${f.file}: a badge for "${m[1]}", which site-content/roadmap.md lacks`);
        assert.notEqual(it.status, 'shipped', `${f.file}: "${m[1]}" is shipped but still shows a badge`);
      }
      for (const td of f.content.matchAll(/<td [^>]*data-m="([^"]+)"[^>]*>((?:(?!<\/td>)[\s\S])*class="soon [\s\S]*?)<\/td>/g)) assert.notEqual(td[1], 'yes', `${f.file}: a "coming" badge beside ✓`);
    }
    assert.ok(badges > 0);
    // in the tables, each badged row is one the roadmap names
    const full = page('compare/full/index.html');
    const rowsWithBadge = [...full.matchAll(/<tr data-row="[^"]*"><th scope="row" class="feat">([^<]*)[\s\S]*?<\/tr>/g)].filter((m) => /class="soon /.test(m[0])).map((m) => unescape(m[1]));
    const named = [...itemsByRow({ items: items.map((i) => ({ ...i, rows: i.rows ?? [] })) }).keys()];
    assert.ok(rowsWithBadge.length > 0);
    for (const r of rowsWithBadge) assert.ok(named.includes(r), r);
  });

  test('a shipped item shows no badge', () => {
    assert.equal(soonBadge({ id: 'x', title: 'X', status: 'shipped' }, ''), '');
    assert.equal(itemsByRow({ items: [{ id: 'x', status: 'shipped', rows: ['MDX'] }] }).size, 0);
  });

  test('/roadmap/ has every item that is not shipped, by its id', () => {
    const html = page('roadmap/index.html');
    for (const it of items.filter((i) => i.status !== 'shipped')) assert.match(html, new RegExp(`<li class="rm-item" id="${it.id}">`), it.id);
  });

  test("the README's Roadmap lists the same items, under the same status", () => {
    const readme = read('README.md');
    const section = /^## Roadmap\n([\s\S]*?)(?=^## )/m.exec(readme)[1];
    const list = (heading) => {
      const at = section.indexOf(`${heading}\n`);
      assert.ok(at >= 0, `README Roadmap has no "${heading}"`);
      const block = section.slice(at).split(/\n\n(?=\S)/)[1] ?? '';
      return [...block.matchAll(/^- \*\*(.+?)\*\*/gm)].map((m) => m[1].replace(/[.:,]$/, ''));
    };
    const titles = (status) => items.filter((i) => i.status === status).map((i) => i.title);
    assert.deepEqual(list('Being built now, for 0.4.0:'), titles('in-progress'));
    assert.deepEqual(list('Planned, later:'), titles('planned'));
  });

  test('prose that says something is coming links to its line on the roadmap', () => {
    const dir = path.join(REPO_ROOT, 'site-content');
    const files = ['faq.md', ...fs.readdirSync(path.join(dir, 'alternatives')).map((f) => `alternatives/${f}`)];
    for (const f of files) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const para of text.split(/\n\s*\n/)) {
        if (!/coming in 0\.4\.0|\bis planned\b|\bare planned\b|\[planned\]/i.test(para)) continue;
        const ids = [...para.matchAll(/\/roadmap\/#([a-z0-9-]+)/g)].map((m) => m[1]);
        assert.ok(ids.length, `${f}: "${squash(para).slice(0, 80)}" names no roadmap item`);
        for (const id of ids) {
          assert.ok(byId.has(id), `${f}: /roadmap/#${id} is not an item`);
          assert.notEqual(byId.get(id).status, 'shipped', `${f}: ${id} is shipped`);
          // "coming in 0.4.0" only for an item being built for 0.4.0
          if (/coming in 0\.4\.0/i.test(para) && !/planned/i.test(para)) assert.equal(byId.get(id).status, 'in-progress', `${f}: ${id}`);
        }
      }
    }
  });
});
