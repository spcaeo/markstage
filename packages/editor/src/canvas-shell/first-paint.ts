// What the page's first scripts make of <html> and <body> before the page is drawn (docs/CANVAS-FIDELITY.md): a
// `js` class (the site's rules for "scripts are on": a theme switch shown, a menu folded), the visitor's theme. The
// shell draws the page without its scripts, so without this it would draw the page as a browser with scripts off
// does (a header that shows its theme switch only with scripts on then hides it).
//
// The page's own inline scripts of <head> (the ones that run before the first paint) run in a frame of their own:
// sandboxed with no origin (no access to the editor, its storage or cookies) and with no network (a content security
// policy that lets inline scripts run and loads nothing, so no analytics or tag manager starts from the editor). A
// last script of ours reports <html>'s and <body>'s attributes as the scripts left them. Scripts later in the page
// (modules, what runs on scroll) are not run: a block pack draws their resting state (EditorPack.shell).

export type Attrs = [string, string][];
export interface FirstPaint {
  html: Attrs;
  body: Attrs;
}

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const attrs = (el: Element) => [...el.attributes].map((a) => ` ${a.name}="${esc(a.value)}"`).join('');

/** The page's inline classic scripts in <head>, in order (JSON, modules, speculation rules, src= ones: not run). */
export function headScripts(doc: Document): string[] {
  return [...doc.head.querySelectorAll('script:not([src])')]
    .filter((s) => /^(|text\/javascript|application\/javascript)$/i.test((s.getAttribute('type') ?? '').trim()))
    .map((s) => s.textContent ?? '');
}

/** The frame's document: the page's <html> and <body> with its head scripts, then the report. */
export function firstPaintDoc(doc: Document, nonce: string): string {
  const scripts = headScripts(doc)
    .map((s) => `<script>${s}</script>`)
    .join('');
  const report = `<script>parent.postMessage({ms:${JSON.stringify(nonce)},html:[...document.documentElement.attributes].map(a=>[a.name,a.value]),body:[...document.body.attributes].map(a=>[a.name,a.value])},'*')</script>`;
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'">`;
  return `<!doctype html><html${attrs(doc.documentElement)}><head>${csp}${scripts}</head><body${attrs(doc.body)}>${report}</body></html>`;
}

const cache = new Map<string, FirstPaint>();

/**
 * <html>'s and <body>'s attributes after the page's head scripts, in a frame as wide as `width` (a script may read
 * the window). The page's own attributes when it has no such scripts, or when the frame has not answered in time.
 *
 * `runner`: the address of an empty frame page that writes the document it is sent (the Markstage server's
 * /markstage/shell-frame, sandboxed by its own CSP header). A srcdoc frame takes on the editor page's CSP, and the
 * server's allows no inline script, so on a server the head scripts run there instead; in astro dev, in a srcdoc.
 */
export function firstPaint(doc: Document, width: number, height: number, timeout = 2000, runner?: string): Promise<FirstPaint> {
  const own: FirstPaint = { html: [...doc.documentElement.attributes].map((a) => [a.name, a.value]), body: [...doc.body.attributes].map((a) => [a.name, a.value]) };
  if (!headScripts(doc).length) return Promise.resolve(own);
  const nonce = crypto.randomUUID();
  const html = firstPaintDoc(doc, nonce);
  const key = `${width}:${html.replace(nonce, '')}`;
  const known = cache.get(key);
  if (known) return Promise.resolve(known);
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px;border:0;visibility:hidden;pointer-events:none`;
    const done = (r: FirstPaint) => {
      clearTimeout(timer);
      removeEventListener('message', onMessage);
      frame.remove();
      resolve(r);
    };
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { ms?: string; html?: unknown; body?: unknown } | null;
      if (e.source !== frame.contentWindow || d?.ms !== nonce || !isAttrs(d.html) || !isAttrs(d.body)) return;
      const r = { html: d.html, body: d.body };
      cache.set(key, r);
      done(r);
    };
    const timer = setTimeout(() => done(own), timeout);
    addEventListener('message', onMessage);
    if (runner) {
      // the frame has no origin of its own (sandbox): '*' is the only address a message to it can name
      frame.addEventListener('load', () => frame.contentWindow?.postMessage({ ms: nonce, html }, '*'), { once: true });
      frame.src = runner;
    } else frame.srcdoc = html;
    document.body.append(frame);
  });
}

const isAttrs = (v: unknown): v is Attrs => Array.isArray(v) && v.every((a) => Array.isArray(a) && a.length === 2 && typeof a[0] === 'string' && typeof a[1] === 'string' && /^[a-z][\w:.-]*$/i.test(a[0]));
