// The preview agent: runs the responsive checks inside the framed page and answers the editor's screen check by
// postMessage, the one way the editor talks to the frame (a production preview is on its own origin, docs/API.md
// "Device checks in the frame"; in dev the Astro integration starts the agent on the site's pages with the dev
// server's own origin). For a preview server it is built alone into dist/preview-agent.js (scripts/build-agent.mjs)
// and added to every proxied page as
//   <script src="/markstage/preview-agent.js" data-cms="<CMS origin> …" async></script>
// Messages:
//   page -> editor  { markstage: 'ready' }                     (the agent listens: the editor may ask now)
//   page -> editor  { markstage: 'rendered', path, width }     (the page has loaded, again after each navigation)
//   editor -> page  { markstage: 'measure', run }   page -> editor  { markstage: 'measured', run, result }
//     (run: the editor's number for the request, echoed so it can drop an answer for a screen it left)
//   editor -> page  { markstage: 'reveal', id }                (scrolls to that issue's element and outlines it)
//   editor -> page  { markstage: 'mark', words }               (highlights the words a locale respells; the page
//                                                               answers { markstage: 'marked', count })
//   editor -> page  { markstage: 'reveal-word', word }         (scrolls to its next highlighted occurrence)
//   editor -> page  { markstage: 'theme', attr, value, on }    (the site's dark scheme on <html>, config `themes`)
// Other parts of the editor add their own messages with onRequest() (the pages editor: 'page:…'), behind the same
// rule: a message counts only from the page's parent, and only when its origin is one of `cms`. Messages from the
// page go to the parent's origin when the browser tells it (location.ancestorOrigins) and it is one of `cms`, else
// to each `cms` origin (the browser drops the ones that are not the parent's); never to '*'.
import { markWords, measure, reveal, revealWord } from './measure';

export type AgentRequest =
  | { markstage: 'measure'; run?: number }
  | { markstage: 'reveal'; id: number }
  | { markstage: 'mark'; words: string[] }
  | { markstage: 'reveal-word'; word: string }
  | { markstage: 'theme'; attr: string; value: string; on: boolean };

/** Answers a request it knows (returns true); `reply` posts back to the editor that asked. */
export type RequestHandler = (msg: { markstage: string } & Record<string, unknown>, reply: (msg: object) => void) => boolean | void;

interface Hub {
  cms: Set<string> | null;
  handlers: Map<string, RequestHandler>;
}

/** One per window, kept on it: Astro's view transitions may run the head scripts again. */
function hub(win: Window): Hub {
  const w = win as Window & { __markstageAgent?: Hub };
  return (w.__markstageAgent ??= { cms: null, handlers: new Map() });
}

/** Adds the messages of another part of the editor (`name` keeps a second registration from doubling it). */
export function onRequest(name: string, handler: RequestHandler, win: Window = window): void {
  hub(win).handlers.set(name, handler);
}

/** Posts to the editor (the parent), pinned to a `cms` origin. */
export function post(msg: object, win: Window = window): void {
  const cms = hub(win).cms;
  if (!cms || win.parent === win) return;
  const pinned = win.location.ancestorOrigins?.[0];
  for (const origin of pinned && cms.has(pinned) ? [pinned] : cms) win.parent.postMessage(msg, origin);
}

/** Loads the images still waiting below the fold and waits for them and the fonts (2.5 s at most), so sizes count. */
async function settle(win: Window): Promise<void> {
  const doc = win.document;
  const imgs = [...doc.images];
  for (const img of imgs) if (img.loading === 'lazy') img.loading = 'eager';
  const loaded = (i: HTMLImageElement) =>
    new Promise<void>((r) => {
      i.addEventListener('load', () => r(), { once: true });
      i.addEventListener('error', () => r(), { once: true });
    });
  await Promise.race([Promise.all([doc.fonts?.ready, ...imgs.filter((i) => !i.complete).map(loaded)]), new Promise((r) => win.setTimeout(r, 2500))]);
}

function checks(win: Window): RequestHandler {
  return (msg, reply) => {
    if (msg.markstage === 'measure') {
      const run = Number.isInteger(msg.run) ? msg.run : null;
      void settle(win).then(() => reply({ markstage: 'measured', run, result: measure(win) }));
    } else if (msg.markstage === 'reveal' && Number.isInteger(msg.id)) reveal(win, msg.id as number);
    else if (msg.markstage === 'mark' && Array.isArray(msg.words)) {
      const words = msg.words.filter((w): w is string => typeof w === 'string').slice(0, 500);
      reply({ markstage: 'marked', count: markWords(win, words) });
    } else if (msg.markstage === 'reveal-word' && typeof msg.word === 'string') revealWord(win, msg.word);
    else if (msg.markstage === 'theme' && typeof msg.attr === 'string' && typeof msg.value === 'string') theme(win, msg.attr, msg.value, msg.on === true);
    else return false;
    return true;
  };
}

/** The site's dark scheme on or off: a data- attribute or a class on <html> (config `themes`), back as it was when off. */
function theme(win: Window, attr: string, value: string, on: boolean): void {
  if (!/^(class|data-[a-z0-9-]+)$/.test(attr)) return;
  const root = win.document.documentElement;
  if (attr === 'class') {
    if (/^[a-z][a-z0-9_-]*$/.test(value)) root.classList.toggle(value, on);
    return;
  }
  const w = win as Window & { __markstageThemeWas?: string | null };
  if (on) {
    if (!('__markstageThemeWas' in w)) w.__markstageThemeWas = root.getAttribute(attr);
    root.setAttribute(attr, value);
  } else if ('__markstageThemeWas' in w) {
    const was = w.__markstageThemeWas;
    if (was === null || was === undefined) root.removeAttribute(attr);
    else root.setAttribute(attr, was);
    delete w.__markstageThemeWas;
  }
}

/** Starts the agent in `win` for the editors at `cms` (one listener per window). A second agent on the page (the
 *  Astro integration's in `astro dev`, and the preview server's tag over the same dev server) adds its origins: the
 *  first one to run must not shut out the other's editor, so the editors new to the page hear it is ready. */
export function listen(win: Window, cms: Set<string>): void {
  if (win.parent === win) return;
  const h = hub(win);
  h.handlers.set('checks', checks(win));
  if (h.cms) {
    const added = [...cms].filter((o) => !h.cms!.has(o));
    for (const o of added) h.cms.add(o);
    const pinned = win.location.ancestorOrigins?.[0];
    const to = pinned ? added.filter((o) => o === pinned) : added;
    const loaded = win.document.readyState === 'complete';
    for (const origin of to) {
      win.parent.postMessage({ markstage: 'ready' }, origin);
      if (loaded) win.parent.postMessage({ markstage: 'rendered', path: win.location.pathname, width: win.document.documentElement.clientWidth }, origin);
    }
    return;
  }
  const allowed = (h.cms = new Set(cms));
  win.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== win.parent || !allowed.has(e.origin)) return;
    const msg = e.data as ({ markstage?: unknown } & Record<string, unknown>) | null;
    if (typeof msg?.markstage !== 'string') return;
    const reply = (m: object) => win.parent.postMessage(m, e.origin);
    for (const handler of h.handlers.values()) if (handler(msg as { markstage: string }, reply)) break;
  });
  post({ markstage: 'ready' }, win);
  const rendered = () => post({ markstage: 'rendered', path: win.location.pathname, width: win.document.documentElement.clientWidth }, win);
  if (win.document.readyState === 'complete') rendered();
  else win.addEventListener('load', rendered, { once: true });
  win.document.addEventListener('astro:page-load', rendered);
}

// as a classic script added by the preview server: its tag names the CMS origins (read now, before any await)
const script = document.currentScript as HTMLScriptElement | null;
const cms = new Set((script?.dataset.cms ?? '').split(/\s+/).filter(Boolean));
if (cms.size) listen(window, cms);
