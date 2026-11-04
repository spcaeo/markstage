// Numbers line up (owner, 2026-10-28): in every table the editor draws, a column whose values are all numbers
// (counts, money, percentages, sizes, durations; numeric.ts) is right-aligned, its header too, with tabular figures;
// text columns stay left. Found by reading the cells, so a screen needs nothing: each table is checked as it appears
// or changes. The canvas is the site's own content and is left alone.
import { numericColumns } from './numeric';
import './styles/num-columns.css';

function mark(table: HTMLTableElement): void {
  const body = [...table.tBodies].flatMap((b) => [...b.rows]);
  // a cell spanning columns or rows would shift the columns: such a table is left as drawn
  if (!body.length || [...table.rows].some((r) => [...r.cells].some((c) => c.colSpan > 1 || c.rowSpan > 1))) return;
  const num = numericColumns(body.map((r) => [...r.cells].map((c) => c.textContent ?? '')));
  for (const r of table.rows) [...r.cells].forEach((c, i) => c.classList.toggle('ms-num', num.has(i)));
}

let queued = false;
function sweep(): void {
  queued = false;
  for (const t of document.querySelectorAll('table')) if (!t.closest('.ProseMirror, [contenteditable="true"]')) mark(t);
}

if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  new MutationObserver((records) => {
    // typing in the canvas changes no table out here
    if (records.every((r) => (r.target instanceof Element ? r.target : r.target.parentElement)?.closest('.ProseMirror'))) return;
    if (!queued) (queued = true), requestAnimationFrame(sweep);
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
}
