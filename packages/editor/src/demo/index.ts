// The live demo (docs/DEMO.md): the real editor on the example blog, as static files, with no server. Only a demo
// build has this module: the client module imports it when the build's config has `demo` (packages/astro
// client.mjs), so a normal editor build holds none of it (packages/astro test/build-editor.test.mjs checks).
//
// installDemo() runs before start(): every request to the API prefix is answered here (standin.ts) instead of by a
// server, a link that would download from the API is made here, and the strip above the editor says what this is.
import { readFrontmatter, setFrontmatter } from '@markstage/core';
import { md, type ClientConfig, type DemoConfig } from '../runtime';
import { createStandIn, type Recorded } from './standin';
import { DemoStore } from './store';
import { DemoScreen } from './ui';

const session = (): Storage | null => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

export function installDemo(config: ClientConfig & { demo: DemoConfig }): void {
  const demo = config.demo;
  const apiPath = new URL(config.api, location.href).pathname.replace(/\/*$/, '/');
  const realFetch = window.fetch.bind(window);
  const store = new DemoStore(session());
  const data: Promise<Recorded> = realFetch(new URL(demo.data, location.href).href, { credentials: 'same-origin' }).then((r) => (r.ok ? (r.json() as Promise<Recorded>) : ({} as Recorded)), () => ({}) as Recorded);
  let answer: ReturnType<typeof createStandIn> | null = null;
  const standIn = async () =>
    (answer ??= createStandIn({
      recorded: await data,
      collections: config.collections,
      site: new URL(demo.site, location.href).pathname.replace(/\/*$/, '/'),
      md: () => md() as never,
      readFrontmatter,
      setFrontmatter,
      store,
    }));

  const screen = new DemoScreen({
    install: demo.install,
    changes: () => store.changedFiles(),
    last: () => {
      const s = store.saves().at(-1);
      return s ? { file: s.file, title: s.title, before: s.before, after: s.after } : null;
    },
    reset: () => {
      store.reset();
      const url = new URL(location.href);
      url.searchParams.delete('changes');
      // the same address again: a reload (a replace to it would only move to its #hash)
      history.replaceState(history.state, '', url.href);
      location.reload();
    },
  });

  /** The API path of a URL on this origin (relative to the prefix), or null when it is not one. */
  const apiOf = (url: string): string | null => {
    const u = new URL(url, location.href);
    return u.origin === location.origin && u.pathname.startsWith(apiPath) ? u.pathname.slice(apiPath.length) + u.search : null;
  };

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = apiOf(url);
    if (path === null) return realFetch(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : null;
    const a = (await standIn())(method, path, body);
    if (a.saved) {
      const s = a.saved;
      // after the editor has taken the answer and drawn "Saved"
      setTimeout(() => screen.showSaved({ file: s.file, title: s.title, before: s.before, after: s.after }), 150);
    }
    if (a.refused) setTimeout(() => screen.notInDemo(), 0);
    return new Response(method === 'HEAD' ? null : JSON.stringify(a.body), { status: a.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  };

  /** A link to the API (Download, the Inbox's CSV): an entry's own file is made here, anything else is refused. */
  const follow = (href: string): boolean => {
    const path = apiOf(href);
    if (path === null) return false;
    const m = /^collections\/([^/]+)\/entries\/([^/?]+)\/download/.exec(path);
    if (!m) {
      screen.notInDemo();
      return true;
    }
    void (async () => {
      const r = (await standIn())('GET', `collections/${m[1]}/entries/${m[2]}/source`);
      const src = (r.body as { source?: string }).source;
      if (typeof src !== 'string') return screen.notInDemo();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([src], { type: 'text/markdown' }));
      a.download = `${decodeURIComponent(m[2])}.md`;
      clickLink.call(a);
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    })();
    return true;
  };
  const clickLink = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (!follow(this.href)) clickLink.call(this);
  };
  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (a && follow(a.href)) e.preventDefault();
    },
    true,
  );

  const mount = () => screen.mountBanner();
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
}
