// The canvas fidelity guard (docs/CANVAS-FIDELITY.md): opens one entry in the editor's canvas and its real page at
// the same window width, measures both, and fails when the canvas draws the text somewhere else or at another size
// than the page does. Run it against a site's `astro dev` (the editor at /markstage/):
//
//   node packages/editor/scripts/canvas-fidelity.mjs --base http://127.0.0.1:4321 \
//     --entry posts/hello-world=/blog/hello-world/ [--entry …] [--widths 1440,390] [--themes light,dark] \
//     [--sides ,outline] [--tolerance 2] [--shots <dir>] \
//     [--part aside=.aside …] [--frame-part contents='.contents a' …]
//
// or from a test: `import { checkFidelity } from '@markstage/editor/fidelity'`. What it compares, per width, theme
// (light, dark: the browser's colour scheme) and side panel (none, or one that narrows the canvas: the page is then
// measured in a window as wide as the canvas):
//   - the frame: the page's <html> data-* attributes (data-frame…) and lang, on the canvas's stand-in for <html>
//   - the text column: its left and right edges, height, font size and line height
//   - each paragraph, list, quotation and code block (directly in the text), heading (h2, h3), table, figure,
//     caption, image and embed (at any depth), and each of the site's own `parts` (name and selector: a note hung in
//     the margin, a card), in order: left and right edges, width, height (all but paragraphs), font size and line
//     height, and its top measured from the top of the text column
//   - every block of the text, whatever it is (`block`): its box and its look (colour, background, corners, border)
//   - the title (the first h1 of the article around the text): edges, font size, line height, and where it is drawn
//     above the text column
//   - the head (`head`): each box in the article above the text (title, byline, cover…) and each image in it, box
//     and look
//   - what follows the text in the article (`after`: an author box, related posts), from the text's bottom
//   - the page around the article (`frame`): every element of it (the site header, its logo, menu, buttons, the side
//     column, the footer), paired by tag and classes, so one the canvas lacks or adds is named; box and look. What
//     the page lays over the window (position: fixed) is left out: the canvas hides it by design.
//   - each of the site's `frameParts` (name and selector), found anywhere in the page around the text (a contents
//     list in the side column, its items): how many are shown, their edges, size and top from the text column's top
// `loose` (selectors): what the site's build draws that the canvas cannot (a code highlighter's classes and colours,
// `pre.astro-code`): paired by its tag only, its box compared, its look not.
// Lefts are measured from the page's left edge (the window's on the page, the stand-in's on the canvas). Tops of
// what comes after the text are measured from the text's bottom, so a word the build respells moves nothing there.
// A row fails when a length is off by more than `tolerance` px (font size by more than 0.1 px, line height by more
// than 0.5 px) or its look differs. Tops and heights use `topTolerance` (default: `tolerance`): raise it for a site
// whose build respells words, when a respelled word moves a line break. Both are measured with their images loaded,
// and the page after scrolling through once (what slides in on scroll comes to rest). The browser is closed when it
// is done, pass or fail.

const KINDS = [
  ['p', ':scope > p'],
  ['h2', 'h2'],
  ['h3', 'h3'],
  ['list', ':scope > :is(ul, ol)'],
  ['quote', ':scope > blockquote'],
  ['code', ':scope > pre'],
  ['table', 'table'],
  ['figure', 'figure'],
  ['caption', 'figcaption'],
  ['img', 'img'],
  ['embed', ':is(iframe, video)'],
  // every block of the text, whatever it is (a card, a callout, a block of the site's HTML): its box and its look
  ['block', ':scope > *'],
];

/** The look of a box: what a theme, a state or a stray rule changes without moving it. */
const LOOK = ['color', 'bg', 'radius', 'border'];

/**
 * Measures the text column `bodySel` and the page around it in the page open in `page` (Playwright): the text's own
 * parts (`kinds`), the head above the text in the article (title, byline, cover…), every element of the page outside
 * the article (`frame`: the site header, the side column, what comes after), and the site's `frameKinds`.
 */
async function measure(page, bodySel, rootSel, kinds, frameKinds = [], loose = []) {
  return page.evaluate(
    ([bodySel, rootSel, kinds, frameKinds, loose]) => {
      const body = document.querySelector(bodySel);
      if (!body) return null;
      const root = document.querySelector(rootSel) ?? document.documentElement;
      const b = body.getBoundingClientRect();
      const r1 = (n) => Math.round(n * 10) / 10;
      // what the editor adds and the page does not have: its own controls (marked as the editor's UI, or a control
      // of its own classes only with no image in it: a padlock, a toolbar; a site element the editor only decorates,
      // ul.ms-tight, or wraps, span.ms-image__frame around the image, is the page's), what the page lays over the
      // window (hidden in the canvas by design), the dev toolbar
      const EDITOR = /^(ms-|ProseMirror|is-)/;
      const editorClasses = (el) => el.classList.length > 0 && [...el.classList].every((c) => EDITOR.test(c));
      const pageContent = (el) => !!el.querySelector('img') || [...el.querySelectorAll('[class]')].some((d) => !editorClasses(d) && !(d instanceof SVGElement));
      const own = (el) => el.hasAttribute('data-ms-ui') || (editorClasses(el) && (el.localName === 'button' || el.getAttribute('contenteditable') === 'false') && !pageContent(el));
      // a box the editor wraps around the page's blocks (a node view's wrapper: div.ms-faqwrap around div.faq and what
      // the pack draws after it, div.ms-raw around a block of the site's HTML) stands for the blocks in it
      const unwrap = (el) => (/^(div|span)$/.test(el.localName) && editorClasses(el) && !own(el) && el.children.length ? [...el.children].flatMap(unwrap) : [el]);
      const skip = (el) => {
        // the canvas's own parts beside the text (the block handle)
        if (el.closest('.ms-canvas') && !body.contains(el)) return true;
        for (let e = el; e && e !== root; e = e.parentElement) {
          // what holds the text (the stand-ins, the canvas) and the editor's head are the page's own places
          if (e.contains(body) || e.classList.contains('ms-headslot')) continue;
          if (own(e) || e.localName === 'astro-dev-toolbar' || getComputedStyle(e).position === 'fixed') return true;
          if (e.classList.contains('ms-pg-covered') || e.classList.contains('ms-pg-readers') || e.classList.contains('ms-pg-fixed')) return true;
        }
        return false;
      };
      const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !skip(el);
      // `loose`: what the site's build draws and the canvas cannot (a code highlighter's classes and colours): paired
      // by its tag, its look not compared
      const isLoose = (el) => loose.some((sel) => el.matches(sel));
      const sig = (el) => (isLoose(el) ? el.localName : `${el.localName}${[...el.classList].filter((c) => !c.startsWith('ms-') && !c.startsWith('ProseMirror') && !/^is-/.test(c)).map((c) => `.${c}`).join('')}`);
      const box = (el, from = b.top) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          sig: sig(el),
          loose: isLoose(el),
          left: r1(r.left),
          right: r1(r.right),
          width: r1(r.width),
          height: r1(r.height),
          top: r1(r.top - from),
          bottom: r1(r.bottom - b.top),
          fontSize: parseFloat(cs.fontSize),
          lineHeight: parseFloat(cs.lineHeight) || null,
          color: cs.color,
          bg: cs.backgroundColor === 'rgba(0, 0, 0, 0)' ? '' : cs.backgroundColor + (cs.backgroundImage === 'none' ? '' : ' +image'),
          radius: cs.borderRadius,
          border: cs.borderStyle === 'none' ? '' : `${cs.borderWidth} ${cs.borderStyle} ${cs.borderColor}`,
          text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
        };
      };
      const frame = {};
      for (const a of root.attributes) if ((a.name.startsWith('data-') && a.name !== 'data-theme') || a.name === 'lang') frame[a.name] = a.value;
      const items = {};
      const inText = [...body.querySelectorAll('*')];
      for (const [kind, sel] of kinds) {
        const all = new Set(body.querySelectorAll(sel));
        const found = inText.filter((el) => all.has(el));
        items[kind] = (kind === 'block' ? found.flatMap(unwrap) : found).filter((el) => shown(el) && el.getBoundingClientRect().width > 1).map((el) => box(el));
      }
      const article = body.closest('article') ?? body.parentElement;
      // the title above the text (its top is negative: measured from the text column's top)
      const h1 = [...article.querySelectorAll('h1')].find((el) => shown(el));
      items.title = h1 ? [box(h1)] : [];
      // the head: each box in the article before the text (the editor's parts have no box of their own: display
      // contents), and the images in it
      const before = (el) => el.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING;
      const parentBox = (el) => {
        let p = el.parentElement;
        while (p && getComputedStyle(p).display === 'contents') p = p.parentElement;
        return p;
      };
      items.head = [...article.querySelectorAll('*')].filter((el) => before(el) && !body.contains(el) && shown(el) && (parentBox(el) === article || el.localName === 'img')).map((el) => box(el));
      // the page around the article: every element, its top from the text's top when it comes before the text and
      // from the text's bottom when after it (a word respelled in the text moves nothing after it then); the side
      // column beside the text is as tall as the text, so its height is only compared when it ends above the text
      const around = [...root.querySelectorAll(root === document.documentElement ? 'body *' : '.ms-pg-body *')].filter((el) => !article.contains(el) && !el.contains(article) && !(el instanceof SVGElement && el.localName !== 'svg') && shown(el));
      items.frame = around.map((el) => {
        const after = !before(el);
        const m = box(el, after ? b.bottom : b.top);
        const r = el.getBoundingClientRect();
        m.beside = r.bottom > b.top + 1 && r.top < b.bottom - 1;
        return m;
      });
      // after the text in the article (an author box, related posts): from the text's bottom too
      items.after = [...article.querySelectorAll('*')].filter((el) => !before(el) && !body.contains(el) && el !== body && shown(el) && parentBox(el) === article).map((el) => box(el, b.bottom));
      // around the text: shown ones only (an element with no box, or inside a closed fold, is not on the screen)
      for (const [kind, sel] of frameKinds) items[kind] = [...root.querySelectorAll(sel)].filter((el) => el.getClientRects().length > 0 && !el.closest('.ms-canvas')).map((el) => box(el));
      return { frame, body: box(body), items };
    },
    [bodySel, rootSel, kinds, frameKinds, loose],
  );
}

/** Waits for the images (the page loads them as they scroll in; the canvas as it is drawn), at most `ms`. */
async function imagesIn(page, ms = 10_000) {
  await page.evaluate(
    (ms) =>
      Promise.race([
        Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => ((i.onload = r), (i.onerror = r)))))),
        new Promise((r) => setTimeout(r, ms)),
      ]),
    ms,
  );
}

/**
 * One entry at one width, in one theme (light or dark), with one of the editor's side panels open or none (`side`:
 * outline, seo…, which narrows the canvas: the page is then measured at the canvas's width). `entry` is
 * `<collection>/<id>`, `pagePath` its page. `bodyClass`: the site's canvas.bodyClass (the page's text element).
 * `parts`: the site's own elements to measure too, `[name, selector]`. Returns {ok, failures, canvas, page}.
 */
export async function compareOne(browser, { base, entry, pagePath, width, height = 900, theme = 'light', side = '', bodyClass, parts = [], frameParts = [], loose = [], tolerance = 2, topTolerance, shots }) {
  const kinds = [...KINDS, ...parts];
  // reduced motion: transitions end at once (a site's own rule), so what is measured is what stays on screen
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', colorScheme: theme });
  try {
    const bodySel = bodyClass
      .split(/\s+/)
      .filter(Boolean)
      .map((c) => `.${c}`)
      .join('');
    const ed = await ctx.newPage();
    await ed.goto(`${base}/markstage/#/e/${entry}${side ? `?side=${side}` : ''}`);
    await ed.waitForSelector('.ms-canvas > .ProseMirror', { timeout: 60_000 });
    // the drawer takes its width from the window: the editor's column is then as wide as the page's window
    const navW = await ed.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.ms-app')).paddingLeft) || 0);
    if (navW) await ed.setViewportSize({ width: width + navW, height });
    const shell = await ed.waitForSelector('.ms-sheet.is-shell .ms-canvas > .ProseMirror', { timeout: 20_000 }).then(
      () => true,
      () => false,
    );
    await ed.evaluate(() => document.fonts.ready);
    // the canvas scrolled through once too, as a writer would: the page's lazy images around the text load
    await ed.evaluate(async () => {
      let box = document.querySelector('.ms-canvas');
      while (box && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
      if (!box) return;
      for (let y = 0; y < box.scrollHeight; y += box.clientHeight / 2) {
        box.scrollTop = y;
        await new Promise((r) => setTimeout(r, 20));
      }
      box.scrollTop = 0;
    });
    await imagesIn(ed);
    // the "click any text" hint and the like are the editor's, not the page's
    await ed.waitForTimeout(400);
    const canvas = await measure(ed, '.ms-canvas > .ProseMirror', '.ms-pg', kinds, frameParts, loose);
    // the page in a window as wide as the canvas (a side panel takes room from it)
    const pageWidth = side ? await ed.evaluate(() => document.querySelector('.ms-sheet').clientWidth) : width;
    const pg = await ctx.newPage();
    await pg.setViewportSize({ width: pageWidth, height });
    await pg.goto(`${base}${pagePath}`);
    await pg.waitForSelector(bodySel);
    await pg.evaluate(() => document.fonts.ready);
    // the page as a reader leaves it: scrolled through once, so what slides in on scroll has come to rest
    await pg.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight / 2) {
        scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 20));
      }
      scrollTo(0, 0);
      // and a box that scrolled with it (a long contents list keeping its item in view) back at its top too
      for (const el of document.querySelectorAll('*')) if (el.scrollTop) el.scrollTop = 0;
    });
    await imagesIn(pg);
    await pg.waitForTimeout(400);
    // the page's <body> sits at the window's left; the canvas's stand-in at the canvas's: lefts are from there
    const page = await measure(pg, bodySel, 'html', kinds, frameParts, loose);
    const dx = await ed.evaluate(() => document.querySelector('.ms-pg')?.getBoundingClientRect().left ?? 0);
    if (canvas && dx) shift(canvas, dx);
    if (shots) {
      const name = `${entry.replace(/\W+/g, '-')}-${width}-${theme}${side ? `-${side}` : ''}`;
      await ed.screenshot({ path: `${shots}/${name}-canvas.png` });
      await pg.screenshot({ path: `${shots}/${name}-page.png` });
    }
    const failures = [];
    if (!shell) failures.push('the canvas is not drawn in the page shell (canvas.shell off, or the page could not be read)');
    if (!canvas || !page) return { ok: false, failures: [...failures, !page ? 'the page has no text element' : 'the canvas has no text'], canvas, page };
    for (const [k, v] of Object.entries(page.frame)) if (canvas.frame[k] !== v) failures.push(`frame: <html ${k}="${v}"> on the page, "${canvas.frame[k] ?? '(none)'}" on the canvas`);
    const topTol = topTolerance ?? tolerance;
    const near = (a, b, t) => a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= t);
    const cmp = (label, c, p, keys) => {
      for (const k of keys) {
        const t = k === 'top' || k === 'height' ? topTol : k === 'fontSize' ? 0.1 : k === 'lineHeight' ? 0.5 : tolerance;
        if (!near(c[k], p[k], t)) failures.push(`${label} ${k}: page ${p[k]}, canvas ${c[k]} ("${p.text}")`);
      }
    };
    cmp('text column', canvas.body, page.body, ['left', 'right', 'height', 'fontSize', 'lineHeight']);
    const rows = { body: { page: page.body, canvas: canvas.body } };
    const BOX = ['left', 'right', 'width', 'height', 'top'];
    for (const kind of [...kinds.map(([k]) => k), 'title', 'head', 'after', 'frame', ...frameParts.map(([k]) => k)]) {
      const ps = page.items[kind];
      const cs = canvas.items[kind];
      const keys =
        kind === 'p' || kind === 'title'
          ? ['left', 'right', 'fontSize', 'lineHeight', 'top']
          : kind === 'block' || kind === 'head' || kind === 'after' || kind === 'frame'
            ? [...BOX, 'fontSize', ...LOOK]
            : ['left', 'right', 'width', 'height', 'fontSize', 'top'];
      const pairs = kind === 'block' || kind === 'head' || kind === 'after' || kind === 'frame' ? align(ps, cs, kind, failures) : (ps.length !== cs.length && failures.push(`${kind}: ${ps.length} on the page, ${cs.length} on the canvas`), ps.slice(0, cs.length).map((p, i) => [p, cs[i]]));
      for (const [p, c] of pairs) cmp(`${kind} ${p.sig ?? ''}`.trim(), c, p, keys.filter((k) => !(k === 'height' && kind === 'frame' && p.beside) && !(p.loose && LOOK.includes(k))));
      rows[kind] = { page: ps.length, canvas: cs.length, worst: worst(pairs) };
    }
    return { ok: failures.length === 0, failures, rows, canvas, page };
  } finally {
    await ctx.close();
  }
}

/** Moves the canvas's boxes so their lefts are from its stand-in's left edge, as the page's are from the window's. */
function shift(m, dx) {
  const move = (b) => {
    b.left = Math.round((b.left - dx) * 10) / 10;
    b.right = Math.round((b.right - dx) * 10) / 10;
  };
  move(m.body);
  for (const list of Object.values(m.items)) list.forEach(move);
}

/**
 * Pairs the page's elements with the canvas's by what they are (tag and classes), in order: one the canvas lacks or
 * adds is a failure of its own ("the page's fieldset.theme is not on the canvas"), not a shift of every one after it.
 */
function align(ps, cs, kind, failures) {
  const pairs = [];
  let i = 0;
  let j = 0;
  const LOOK_AHEAD = 40;
  while (i < ps.length && j < cs.length) {
    if (ps[i].sig === cs[j].sig) {
      pairs.push([ps[i++], cs[j++]]);
      continue;
    }
    const inC = cs.slice(j, j + LOOK_AHEAD).findIndex((c) => c.sig === ps[i].sig);
    const inP = ps.slice(i, i + LOOK_AHEAD).findIndex((p) => p.sig === cs[j].sig);
    if (inC >= 0 && (inP < 0 || inC <= inP)) {
      for (const c of cs.slice(j, j + inC)) failures.push(`${kind}: the canvas has ${c.sig} ("${c.text}") the page does not have`);
      j += inC;
    } else if (inP >= 0) {
      for (const p of ps.slice(i, i + inP)) failures.push(`${kind}: the page's ${p.sig} ("${p.text}") is not on the canvas`);
      i += inP;
    } else {
      failures.push(`${kind}: the page's ${ps[i].sig} ("${ps[i].text}") is not on the canvas`);
      failures.push(`${kind}: the canvas has ${cs[j].sig} ("${cs[j].text}") the page does not have`);
      i++;
      j++;
    }
  }
  for (const p of ps.slice(i)) failures.push(`${kind}: the page's ${p.sig} ("${p.text}") is not on the canvas`);
  for (const c of cs.slice(j)) failures.push(`${kind}: the canvas has ${c.sig} ("${c.text}") the page does not have`);
  return pairs;
}

/** The largest difference per measure over the paired elements (for the report). */
function worst(pairs) {
  const out = {};
  for (const k of ['left', 'right', 'width', 'height', 'fontSize', 'lineHeight', 'top']) {
    let m = 0;
    for (const [p, c] of pairs) if (typeof p[k] === 'number' && typeof c[k] === 'number' && !(k === 'height' && p.beside)) m = Math.max(m, Math.abs(p[k] - c[k]));
    out[k] = Math.round(m * 10) / 10;
  }
  out.look = pairs.filter(([p, c]) => !p.loose && LOOK.some((k) => p[k] !== undefined && p[k] !== c[k])).length;
  return out;
}

/** Every entry at every width; the browser is closed at the end, pass or fail. */
export async function checkFidelity({ playwright, base, entries, widths = [1440, 390], themes = ['light'], sides = [''], bodyClass, parts, frameParts, loose, tolerance, topTolerance, shots }) {
  const pw = playwright ?? (await import('playwright'));
  const browser = await pw.chromium.launch();
  const results = [];
  try {
    for (const { entry, page: pagePath } of entries) {
      for (const width of widths) {
        for (const theme of themes) {
          for (const side of sides) results.push({ entry, pagePath, width, theme, side, ...(await compareOne(browser, { base, entry, pagePath, width, theme, side, bodyClass, parts, frameParts, loose, tolerance, topTolerance, shots })) });
        }
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}

/**
 * A Post settings switch that takes a part of the page away (a contents list): with the entry open on the canvas at
 * `width`, counts the shown `hides` elements of the page around the canvas, turns the switch named `label` off, counts
 * again, turns it back on and counts once more. Nothing is saved (the switch ends as it was). Returns
 * {ok, before, off, after, failures}; ok when before > 0, off = 0 and after = before.
 */
export async function checkSwitch({ playwright, base, entry, label, hides, width = 1440, height = 900 }) {
  const pw = playwright ?? (await import('playwright'));
  const browser = await pw.chromium.launch();
  try {
    const page = await (await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' })).newPage();
    await page.goto(`${base}/markstage/#/e/${entry}?s=1`);
    await page.waitForSelector('.ms-sheet.is-shell .ms-canvas > .ProseMirror', { timeout: 60_000 });
    const box = page.getByLabel(label, { exact: true });
    await box.waitFor({ timeout: 20_000 });
    const count = () => page.evaluate((sel) => [...document.querySelectorAll(`.ms-pg ${sel}`)].filter((el) => el.getClientRects().length > 0).length, hides);
    // the shell follows a change a moment after it (PageShell.changed)
    const settle = () => page.waitForTimeout(500);
    await settle();
    const before = await count();
    await box.uncheck();
    await settle();
    const off = await count();
    await box.check();
    await settle();
    const after = await count();
    const failures = [];
    if (!before) failures.push(`"${hides}": none shown with "${label}" on`);
    if (off) failures.push(`"${hides}": ${off} still shown with "${label}" off`);
    if (after !== before) failures.push(`"${hides}": ${before} before, ${after} after turning "${label}" back on`);
    return { ok: failures.length === 0, before, off, after, failures };
  } finally {
    await browser.close();
  }
}

/** One line per entry and width, and the failures under it. */
export function report(results) {
  const lines = [];
  for (const r of results) {
    lines.push(`${r.ok ? 'PASS' : 'FAIL'}  ${r.entry} at ${r.width}px${r.theme ? `, ${r.theme}` : ''}${r.side ? `, ${r.side} open` : ''}  (${r.pagePath})`);
    if (r.rows) {
      const b = r.rows.body;
      lines.push(`      text column: page ${b.page.left}–${b.page.right} ${b.page.fontSize}/${b.page.lineHeight}px, canvas ${b.canvas.left}–${b.canvas.right} ${b.canvas.fontSize}/${b.canvas.lineHeight}px`);
      for (const [kind, v] of Object.entries(r.rows)) {
        if (kind === 'body' || (!v.page && !v.canvas)) continue;
        const w = v.worst;
        lines.push(`      ${kind.padEnd(6)} page ${v.page}, canvas ${v.canvas}; worst: left ${w.left}, right ${w.right}, width ${w.width}, height ${w.height}, font ${w.fontSize}, top ${w.top}${w.look ? `, look differs on ${w.look}` : ''}`);
      }
    }
    for (const f of r.failures.slice(0, 12)) lines.push(`      - ${f}`);
    if (r.failures.length > 12) lines.push(`      … and ${r.failures.length - 12} more`);
  }
  return lines.join('\n');
}

// the command line
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const get = (k) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const entries = [];
  const parts = [];
  const frameParts = [];
  args.forEach((a, i) => {
    if (a !== '--entry' && a !== '--part' && a !== '--frame-part') return;
    const at = args[i + 1].indexOf('=');
    const pair = [args[i + 1].slice(0, at), args[i + 1].slice(at + 1)];
    if (a === '--entry') entries.push({ entry: pair[0], page: pair[1] });
    else (a === '--part' ? parts : frameParts).push(pair);
  });
  const base = get('--base');
  if (!base || !entries.length) {
    console.error('usage: canvas-fidelity.mjs --base <dev server> --entry <collection>/<id>=<page path> … [--widths 1440,390] [--themes light,dark] [--sides ,outline] [--body-class "prose post__body"] [--part <name>=<selector> …] [--frame-part <name>=<selector> …] [--tolerance 2] [--shots <dir>]');
    process.exit(2);
  }
  const results = await checkFidelity({
    base,
    entries,
    widths: (get('--widths') ?? '1440,390').split(',').map(Number),
    themes: (get('--themes') ?? 'light').split(','),
    sides: (get('--sides') ?? '').split(','),
    bodyClass: get('--body-class') ?? 'ms-body',
    parts,
    frameParts,
    loose: args.flatMap((a, i) => (a === '--loose' ? [args[i + 1]] : [])),
    tolerance: get('--tolerance') ? Number(get('--tolerance')) : undefined,
    topTolerance: get('--top-tolerance') ? Number(get('--top-tolerance')) : undefined,
    shots: get('--shots'),
  });
  console.log(report(results));
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
