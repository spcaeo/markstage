// The pages of entries that are not live: protected (behind a password), drafts and entries scheduled for later
// (authors-files isLive, the site's own rule). A site moves its protected pages out of the output folder after the
// build (docs/DEPLOY.md, dist-private), and that may run after the head kit, so the kit finds them itself from the
// entry files: such a page gets no Markdown copy, is in no list, and is not touched at all. Every locale's copy of
// the entry counts (core localePath).
import fs from 'node:fs';
import path from 'node:path';
import { localePath } from '@markstage/core';
import { urlOf } from '../config.mjs';
import { ID } from '../content.mjs';
import { isLive } from '../authors-files.mjs';
import { readEntry } from './feeds.mjs';
import { pathKey } from './paths.mjs';

/** A Set of page keys (paths.mjs pathKey) of every entry that is not live, in every locale. */
export function notLivePages(cfg, readFrontmatter) {
  const keys = new Set();
  const locales = cfg.locales?.list?.length ? cfg.locales.list : [{ prefix: '' }];
  for (const c of cfg.collections) {
    if (!c.absDir || !fs.existsSync(c.absDir)) continue;
    for (const name of fs.readdirSync(c.absDir)) {
      if (!name.endsWith(c.ext)) continue;
      const id = name.slice(0, -c.ext.length);
      if (!ID.test(id)) continue;
      const data = readEntry(c, path.join(c.absDir, name), readFrontmatter);
      if (!data || typeof data !== 'object' || isLive(data)) continue;
      const url = urlOf(c, { id, data });
      if (!url || /^https?:\/\//i.test(url)) continue;
      for (const l of locales) keys.add(pathKey(localePath(l, url)));
    }
  }
  return keys;
}
