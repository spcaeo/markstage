// The licence words of scripts/check-licence.mjs. Markstage is source-available under the Elastic License 2.0:
// "source-available, free to self-host", never "open source" and never MIT.
//
// One narrow exception: the comparison files may name another product's licence when that is its real licence
// ("Decap CMS | MIT"), never as Markstage's. They are docs/COMPARISON.md, site-content/ and the site pages built
// from them (site/compare/, site/alternatives/; npm run site:test proves site/ is exactly that build). In those
// files "MIT" is allowed in a table cell that is not Markstage's column and in a sentence that does not name
// Markstage. "Open source" gets no exception anywhere.

export const CLAIM = /\bopen[\s-]?source\b|\bMIT\b|\bMIT[\s-]licen[cs]ed\b/i;
// words that say what Markstage is not, or name the packages it uses, are fine
export const FINE = /\b(not|never) ["“]?(open[\s-]?source|MIT)\b|\bopen-source packages\b/i;
export const COMPARISON_FILES = /^(docs\/COMPARISON\.md|site-content\/.+\.md|site\/(compare|alternatives)\/.+\.html)$/;

const OTHER_LICENCE = /\bMIT\b/g;
const MARKSTAGE = /markstage/i;

const claims = (text) => CLAIM.test(text) && !FINE.test(text);
const tagless = (html) => html.replace(/<[^>]+>/g, ' ');
const sentences = (text) => text.split(/(?<=[.!?;])\s+/);
/** A sentence or cell about another product may name its licence; one that names Markstage may not. */
const segmentClaims = (text) => claims(MARKSTAGE.test(text) ? text : text.replace(OTHER_LICENCE, ''));
/** A table row: Markstage's own column is checked as a claim about Markstage; the other cells as segments. */
const rowClaims = (cells, markstageColumn) => cells.some((c, i) => (i === markstageColumn ? claims(c) : segmentClaims(c)));

const markdownCells = (line) => line.trim().replace(/^\||\|$/g, '').split('|');
const isMarkdownRow = (line) => line.trim().startsWith('|');
const isMarkdownRule = (line) => /^\s*\|?\s*:?-{3,}/.test(line);

/** `<table>` HTML on one line: the header's Markstage column, then each body row. */
function htmlTablesClaim(html) {
  return [...html.matchAll(/<table\b[\s\S]*?<\/table>/gi)].some(([table]) => {
    const rows = [...table.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map(([tr]) => [...tr.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) => tagless(m[1])));
    const head = /<thead\b/i.test(table) ? rows.shift() : null;
    const column = head ? head.findIndex((c) => MARKSTAGE.test(c)) : -1;
    return (head && rowClaims(head, -1)) || rows.some((cells) => rowClaims(cells, column));
  });
}

/** Lines of a comparison file that claim "open source" or MIT for Markstage. */
function comparisonHits(rel, lines) {
  const html = rel.endsWith('.html');
  const hits = [];
  let column = -1;
  lines.forEach((line, i) => {
    if (!html && isMarkdownRow(line)) {
      // a row followed by a rule (| --- |) is a header: it says which column is Markstage's
      if (isMarkdownRule(lines[i + 1] ?? '')) column = markdownCells(line).findIndex((c) => MARKSTAGE.test(c));
      if (!isMarkdownRule(line) && CLAIM.test(line) && rowClaims(markdownCells(line), column)) hits.push(i);
      return;
    }
    column = -1;
    if (!CLAIM.test(line) || FINE.test(line)) return;
    const rest = html ? tagless(line.replace(/<table\b[\s\S]*?<\/table>/gi, ' ')) : line;
    if ((html && htmlTablesClaim(line)) || sentences(rest).some(segmentClaims)) hits.push(i);
  });
  return hits;
}

/** `[{ line, text }]` for each line of a tracked file that calls Markstage open source or MIT. */
export function licenceHits(rel, text) {
  const lines = text.split('\n');
  const found = COMPARISON_FILES.test(rel) ? comparisonHits(rel, lines) : lines.flatMap((line, i) => (claims(line) ? [i] : []));
  return found.map((i) => ({ line: i + 1, text: lines[i].trim().slice(0, 120) }));
}
