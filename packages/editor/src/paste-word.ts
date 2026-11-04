// Text pasted from Word (Outlook and the like: anything with Word's "Mso" classes and "mso-" styles): its list
// paragraphs become real bulleted or numbered lists (nested by their level), its Title and Heading styles become
// headings, and its office markup (o:p, conditional comments, mso- styles, font runs, table sizes) goes, so the
// canvas gets plain blocks it knows (QA pass 2, N3). Anything not from Word passes through unchanged; the editor's
// own schema then drops what it does not keep (colours, fonts).
const FROM_WORD = /class=["']?Mso|mso-|urn:schemas-microsoft-com:office/i;
// a list marker Word draws as text: "·", "o", "§", "-", "1.", "a)", "iv."
const MARKER = /^\s*(?:[·•o§▪■◦\-–]|\d{1,3}[.)]|[a-zA-Z][.)]|[ivxlc]{1,6}[.)])\s*$/i;
const ORDERED = /^\s*(?:\d{1,3}[.)]|[a-zA-Z][.)]|[ivxlc]{1,6}[.)])/i;
// attributes that mean nothing on the canvas (the schema keeps href, src, alt, colspan, rowspan)
const DROP_ATTRS = ['style', 'class', 'lang', 'align', 'valign', 'width', 'height', 'border', 'cellspacing', 'cellpadding', 'bgcolor', 'color', 'face', 'size'];

/** Pasted HTML with Word's lists and headings made real and its office markup removed. */
export function cleanWordHtml(html: string): string {
  if (!FROM_WORD.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const body = doc.body;
  for (const el of body.querySelectorAll('o\\:p, xml, style, meta, link, script')) el.remove();
  dropComments(body);
  headings(body);
  lists(body);
  tidy(body);
  return body.innerHTML.trim();
}

function dropComments(root: Node): void {
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  const gone: Node[] = [];
  while (walker.nextNode()) gone.push(walker.currentNode);
  for (const c of gone) c.parentNode?.removeChild(c);
}

/** Word's Title and Heading N paragraphs as headings: the title and the first two levels h2, the rest h3. */
function headings(root: Element): void {
  for (const p of root.querySelectorAll('p')) {
    const cls = p.getAttribute('class') ?? '';
    let level: number | null = null;
    if (/\bMsoTitle\b/.test(cls)) level = 2;
    else if (/\bMsoSubtitle\b/.test(cls)) level = 3;
    else {
      const m = /\bMsoHeading(\d)\b/.exec(cls) ?? /\bMso(?:Heading)?(\d)\b/.exec(cls);
      if (m) level = Number(m[1]) <= 2 ? 2 : 3;
    }
    if (level === null) continue;
    const h = root.ownerDocument!.createElement(`h${level}`);
    h.innerHTML = p.innerHTML;
    p.replaceWith(h);
  }
}

const isListPara = (el: Element): el is HTMLElement => el.tagName === 'P' && (/\bMsoList/.test(el.getAttribute('class') ?? '') || /mso-list\s*:/i.test(el.getAttribute('style') ?? ''));
const levelOf = (el: Element): number => Number(/mso-list\s*:[^;]*\blevel(\d+)/i.exec(el.getAttribute('style') ?? '')?.[1] ?? 1);

/** The marker Word draws as text at the start of a list paragraph: removed; says whether the list is numbered. */
function takeMarker(p: HTMLElement): boolean {
  // Word's own marker run (mso-list:Ignore), or the first run whose words are only a marker
  const run = [...p.children].find((c) => /mso-list\s*:\s*ignore/i.test(c.getAttribute('style') ?? '') || MARKER.test(c.textContent ?? ''));
  if (run) {
    const ordered = ORDERED.test(run.textContent ?? '');
    run.remove();
    return ordered;
  }
  // plain text: "· First" or "1. First"
  const first = p.firstChild;
  if (first?.nodeType === Node.TEXT_NODE) {
    const m = /^\s*((?:[·•o§▪■◦\-–]|\d{1,3}[.)]|[a-zA-Z][.)]|[ivxlc]{1,6}[.)]))[\s ]+/i.exec(first.textContent ?? '');
    if (m) {
      first.textContent = (first.textContent ?? '').slice(m[0].length);
      return ORDERED.test(m[1]!);
    }
  }
  return false;
}

/** Runs of list paragraphs (in the body, a cell, anywhere) as lists, nested by their Word level. */
function lists(root: Element): void {
  const doc = root.ownerDocument!;
  const parents = new Set<Element>();
  for (const p of root.querySelectorAll('p')) if (isListPara(p) && p.parentElement) parents.add(p.parentElement);
  for (const parent of parents) {
    const kids = [...parent.children];
    let i = 0;
    while (i < kids.length) {
      if (!isListPara(kids[i]!)) {
        i++;
        continue;
      }
      const run: HTMLElement[] = [];
      while (i < kids.length && isListPara(kids[i]!)) run.push(kids[i++] as HTMLElement);
      // the list goes where the run was; each paragraph becomes an item at its level
      const stack: HTMLElement[] = [];
      let top: HTMLElement | null = null;
      let topId: string | null = null;
      for (const p of run) {
        const level = Math.max(1, levelOf(p));
        const id = /mso-list\s*:\s*(l\d+)/i.exec(p.getAttribute('style') ?? '')?.[1] ?? null;
        const ordered = takeMarker(p);
        // another of Word's lists, or bullets after numbers: a new list beside the last one
        if (level === 1 && stack.length && (stack[0]!.tagName !== (ordered ? 'OL' : 'UL') || id !== topId)) stack.length = 0;
        if (level === 1) topId = id;
        while (stack.length > level) stack.pop();
        while (stack.length < level) {
          const list = doc.createElement(ordered ? 'ol' : 'ul');
          if (!stack.length) {
            if (!top) {
              top = list;
              run[0]!.before(list);
            } else top.after(list), (top = list);
          } else {
            const last = stack[stack.length - 1]!.lastElementChild ?? stack[stack.length - 1]!.appendChild(doc.createElement('li'));
            last.append(list);
          }
          stack.push(list);
        }
        const li = doc.createElement('li');
        li.innerHTML = p.innerHTML.replace(/^(?:\s|&nbsp;| )+/, '');
        stack[stack.length - 1]!.append(li);
        p.remove();
      }
    }
  }
}

/** Office attributes and font runs go; a paragraph of only spaces goes. */
function tidy(root: Element): void {
  for (const el of root.querySelectorAll('*')) {
    for (const a of DROP_ATTRS) el.removeAttribute(a);
    for (const a of [...el.attributes]) if (/^(?:xmlns|v:|o:|w:|mso)/i.test(a.name) || a.name.startsWith('on')) el.removeAttribute(a.name);
  }
  for (const el of [...root.querySelectorAll('span, font')]) el.replaceWith(...el.childNodes);
  for (const p of [...root.querySelectorAll('p')]) if (!(p.textContent ?? '').replace(/[\s ]/g, '') && !p.querySelector('img')) p.remove();
}
