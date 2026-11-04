// The site's pages, as the editor's link tools know them: every entry with an address (the link field searches
// them, the link preview and the SEO check look a path up: is there a page, is it a draft) and the site's special
// links (offered first). From the shell's shared light index, taken when an entry first opens.
import { siteIndex, type EntrySummary } from './api';
import { specialLinks } from './links';
import { collection, type ClientConfig } from './runtime';
import type { LinkTarget } from './toolbar';

export class SitePages {
  targets: LinkTarget[] = [];
  private byUrl = new Map<string, EntrySummary>();

  /** True once the lists have loaded. */
  get known(): boolean {
    return this.byUrl.size > 0;
  }

  async load(cfg: ClientConfig): Promise<void> {
    this.take(cfg, await siteIndex().catch(() => [] as EntrySummary[]));
  }

  /** The pages from an index already in hand. */
  take(cfg: ClientConfig, list: EntrySummary[]): void {
    const withUrl = new Set(cfg.collections.filter((c) => c.hasUrl).map((c) => c.id));
    const all = list.filter((e) => withUrl.has(e.collection));
    this.targets = [
      ...specialLinks().map((l) => ({ title: l.label, url: l.href, kind: 'special' as const })),
      ...all.flatMap((e) => (e.url ? [{ title: e.title, url: e.url, kind: collection(e.collection)?.format === 'md' ? ('article' as const) : ('page' as const) }] : [])),
    ];
    this.byUrl = new Map(all.flatMap((e) => (e.url ? [[e.url, e] as const] : [])));
  }

  /** The entry at `path` (with or without its trailing slash). */
  at(path: string): EntrySummary | undefined {
    return this.byUrl.get(path) ?? this.byUrl.get(path.endsWith('/') ? path.slice(0, -1) : `${path}/`);
  }

  /** The pages whose title or address has `q` (the pages editor's link field). */
  search(q: string): { href: string; label: string }[] {
    const n = q.trim().toLowerCase();
    return this.targets.filter((l) => !n || l.title.toLowerCase().includes(n) || l.url.toLowerCase().includes(n)).slice(0, 30).map((l) => ({ href: l.url, label: l.title }));
  }
}
