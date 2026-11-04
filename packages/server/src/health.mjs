// Site health (docs/SEO.md section 4, docs/OPERATIONS.md), for owner and administrators: every live page with the
// publish-sheet findings (images without a description, links to drafts or nowhere, heading problems), search titles
// and descriptions used twice, the last deploy and recent failures, disk room, and field speed from Google's Chrome
// UX Report with the site's own key. And the CSV exports: pages, links, images and headings, site-wide or for one
// entry.
//   GET  /site/health                   everything above, in one answer
//   POST /site/health/speed {path?}     ask Google again for the site (no path) or one page
//   GET  /site/export/:kind?entry=      kind: pages | links | images | headings; entry: "<collection>/<id>"; a CSV
import fs from 'node:fs';
import path from 'node:path';
import { createCrux } from './crux.mjs';
import { addressOf, searchText } from './publish-rules.mjs';
import { can } from './roles.mjs';
import { badRequest, forbidden, notFound } from './util.mjs';

const textOf = (n) => (n?.text ?? '') + (n?.content ?? []).map(textOf).join(n?.type === 'doc' ? ' ' : '');
const ANCHOR = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const IMG = /<img\b[^>]*>/gi;
const attr = (tag, name) => new RegExp(`\\b${name}\\s*=\\s*(["'])([^"']*)\\1`, 'i').exec(tag)?.[2] ?? null;
const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i;
const YIELD_EVERY = 20;
const yieldNow = () => new Promise((r) => setImmediate(r));

/** Every link in an entry: [{href, text, rel, where}] (link marks, raw HTML), external ones too. */
export function linksOf(doc) {
  const out = [];
  let last = null; // the link the previous text node was in: neighbouring text nodes of one link are one link
  const visit = (n, at) => {
    if (!n || typeof n !== 'object') return;
    const m = (n.marks ?? []).find((x) => x.type === 'link');
    if (m && last && last.href === (m.attrs?.href ?? '') && last.where === at) last.text += n.text ?? '';
    else if (m) out.push((last = { href: m.attrs?.href ?? '', text: n.text ?? '', rel: m.attrs?.rel ?? '', where: at }));
    else if (n.type === 'text' || n.content) last = null;
    if (typeof n.attrs?.html === 'string') {
      for (const m of n.attrs.html.matchAll(ANCHOR)) {
        const href = attr(m[1], 'href');
        if (href !== null) out.push({ href, text: m[2].replace(/<[^>]*>/g, '').trim(), rel: attr(m[1], 'rel') ?? '', where: at });
      }
    }
    (n.content ?? []).forEach((ch, i) => visit(ch, n.type === 'doc' ? `block ${i + 1}` : at));
  };
  visit(doc, 'body');
  return out;
}

/** Every image in an entry: [{src, alt, where}] (image nodes, raw HTML, {src, alt} objects in the fields). */
export function imagesOf(doc, fields) {
  const out = [];
  const visit = (n, at) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'image') out.push({ src: n.attrs?.src ?? '', alt: n.attrs?.alt ?? '', where: at });
    if (typeof n.attrs?.html === 'string') for (const t of n.attrs.html.match(IMG) ?? []) out.push({ src: attr(t, 'src') ?? '', alt: attr(t, 'alt') ?? '', where: at });
    (n.content ?? []).forEach((ch, i) => visit(ch, n.type === 'doc' ? `block ${i + 1}` : at));
  };
  visit(doc, 'body');
  const walk = (v, where) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
    else if (v && typeof v === 'object') {
      if (typeof v.src === 'string' && IMAGE.test(v.src)) out.push({ src: v.src, alt: typeof v.alt === 'string' ? v.alt : '', where });
      for (const [k, x] of Object.entries(v)) if (k !== 'src') walk(x, where ? `${where}.${k}` : k);
    }
  };
  walk(fields, '');
  return out;
}

/** The headings of the body: [{level, text, where}]. */
export const headingsOf = (doc) =>
  (doc?.content ?? []).flatMap((n, i) => (n.type === 'heading' ? [{ level: Number(n.attrs?.level) || 1, text: textOf(n).trim(), where: `block ${i + 1}` }] : []));

/** One CSV cell: quoted when needed, and a leading = + - @ made inert (spreadsheets run those as formulas). */
export function cell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csv = (rows) => rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';

export function healthRoutes(router, app) {
  const { store, config, db } = app;
  const crux = createCrux(app);
  app.crux = crux;
  const need = (ctx) => {
    if (!can(ctx.user, 'site.health')) throw forbidden('Only owners and administrators can see the site’s health.');
  };

  /**
   * Every entry (or one) read once: [{c, id, text, f (preflight findings), path, url}]. The findings are kept per
   * file version (preflight.mjs), and the loop yields to other requests every few entries, so a check-up of a big
   * site never holds the server.
   */
  async function pages(only = null) {
    const known = app.preflight.knownPages();
    const site = config.siteUrl ? config.siteUrl.replace(/\/+$/, '') : null;
    const out = [];
    let n = 0;
    for (const c of store.collections) {
      if (only && only.c !== c.id) continue;
      for (const id of store.ids(c)) {
        if (only && only.id !== id) continue;
        if (++n % YIELD_EVERY === 0) await yieldNow();
        let text;
        let f;
        try {
          text = store.read(c, id).text;
          f = app.preflight.findings(c, id, text, { known, duplicates: false });
        } catch {
          continue;
        }
        const p = app.preflight.pathsOf(f.summary.url)[0] ?? null;
        out.push({ c, id, text, f, path: p, url: p && site ? site + p : p, status: f.summary.status ?? 'published' });
      }
    }
    return out;
  }

  /**
   * Search titles and descriptions used by more than one live page: [{what, text, entries}]. An entry with no URL is
   * not a page, and entries at one address are one page (a topic at its main page's address): not duplicates.
   */
  function duplicates(list) {
    const groups = new Map();
    for (const e of list) {
      if (e.status !== 'published' || addressOf(e.f.summary.url) === null) continue;
      const s = searchText(e.c, e.f.fields ?? {});
      for (const what of ['title', 'description']) {
        if (!s[what]) continue;
        const k = `${what}\u0000${s[what].replace(/\s+/g, ' ').toLowerCase()}`;
        if (!groups.has(k)) groups.set(k, { what, text: s[what], entries: [] });
        groups.get(k).entries.push({ collection: e.c.id, id: e.id, title: e.f.summary.title || e.id, at: addressOf(e.f.summary.url) });
      }
    }
    return [...groups.values()].filter((g) => new Set(g.entries.map((x) => x.at)).size > 1).map((g) => ({ ...g, entries: g.entries.map(({ at, ...x }) => x) }));
  }

  const NOT_DEPLOYS = ['backup', 'env-plan', 'env-preview', 'release-preview', 'import', 'media-import', 'library-sync'];
  function lastDeploy() {
    const commit = db.prepare('SELECT value FROM kv WHERE key = ?').get('deploy.head')?.value ?? null;
    // the last job that put the site live: never a backup, a plan, a preview or an import (QA F8)
    const job = db.prepare(`SELECT id, kind, finished_at, user_id FROM jobs WHERE status = 'succeeded' AND kind NOT IN (${NOT_DEPLOYS.map(() => '?').join(', ')}) ORDER BY finished_at DESC, rowid DESC LIMIT 1`).get(...NOT_DEPLOYS);
    const failed = db
      .prepare("SELECT id, kind, collection, entry_id, finished_at, error FROM jobs WHERE status = 'failed' AND finished_at > COALESCE(?, '') ORDER BY finished_at DESC LIMIT 5")
      .all(job?.finished_at ?? null)
      .map((r) => ({ id: r.id, kind: r.kind, entry: r.collection ? `${r.collection}/${r.entry_id}` : null, at: r.finished_at, error: r.error }));
    const past = JSON.parse(db.prepare('SELECT value FROM kv WHERE key = ?').get('deploy.history')?.value ?? '[]');
    // a rollback needs the site's command and a release before this one
    return { commit, at: job?.finished_at ?? null, job: job?.id ?? null, kind: job?.kind ?? null, failedSince: failed, blocked: app.jobs.blocked(), canRollBack: !!config.commands.rollback && past.length > 0 };
  }

  function disk() {
    let free = null;
    let total = null;
    try {
      const s = fs.statfsSync(config.dataDir);
      free = s.bavail * s.bsize;
      total = s.blocks * s.bsize;
    } catch {
      // not every system answers
    }
    const row = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes FROM media').get();
    return { free, total, media: { files: row.n, bytes: row.bytes } };
  }

  router.add('GET', '/site/health', async (ctx) => {
    need(ctx);
    const list = await pages();
    const live = list.filter((e) => e.status === 'published');
    const rows = live.map((e) => {
      const s = searchText(e.c, e.f.fields ?? {});
      return {
        collection: e.c.id,
        id: e.id,
        title: e.f.summary.title || e.id,
        path: e.path,
        url: e.url,
        words: e.c.format === 'md' ? textOf(e.f.parsed.doc).split(/\s+/).filter(Boolean).length : null,
        searchTitle: s.title?.length ?? 0,
        description: s.description?.length ?? 0,
        altText: e.f.altText.length,
        links: e.f.links.map(({ href, problem, sure, target }) => ({ href, problem, sure, target })),
        headings: e.f.headings.length,
        speed: e.path ? crux.cached(e.path) : null,
      };
    });
    const built = config.verify?.public && fs.existsSync(config.verify.public);
    return {
      pages: rows,
      counts: {
        live: live.length,
        drafts: list.length - live.length,
        altText: rows.filter((r) => r.altText).length,
        links: rows.filter((r) => r.links.length).length,
        headings: rows.filter((r) => r.headings).length,
        longTitles: rows.filter((r) => r.searchTitle > 60).length,
        noDescription: rows.filter((r) => !r.description).length,
      },
      duplicates: duplicates(list),
      deploy: lastDeploy(),
      build: { known: !!built },
      disk: disk(),
      speed: { on: crux.on(), why: !config.crux ? 'off' : !config.siteUrl ? 'no-site-url' : null, site: crux.cached(null) },
      backup: app.backup?.status() ?? { on: false },
      alerts: app.alerts?.status() ?? { email: false, slack: false, webhook: false },
      // form messages whose team alert did not go (they are in the Inbox; the mail is tried again)
      // and the CRM: each form that sends there, whether it can (the environment), and the messages not sent
      forms: { alertFailed: Number(app.db.prepare("SELECT COUNT(*) AS n FROM form_messages WHERE alert = 'failed'").get().n), geoip: (({ file, ...g }) => g)(app.geo?.status() ?? { on: false }), crm: app.forms?.crm.status() ?? { forms: [], failed: 0 }, leads: app.forms?.leads?.status() ?? { forms: [], failed: 0 } },
      // what the host serves for every address the build knows (the site's health hook)
      addresses: app.addresses?.status() ?? { on: false },
    };
  });

  router.add('POST', '/site/health/speed', async (ctx) => {
    need(ctx);
    const p = ctx.body?.path ?? null;
    if (p !== null && (typeof p !== 'string' || !p.startsWith('/') || p.startsWith('//') || p.length > 512)) throw badRequest('path must be a page path like /blog/x/.');
    if (!crux.on()) throw badRequest(config.crux ? 'The site has no address (siteUrl in markstage.config).' : 'Speed data is off: the server has no Chrome UX Report key (crux in config.json).');
    return crux.refresh(p);
  });

  router.add('GET', '/site/export/:kind', async (ctx) => {
    need(ctx);
    const kind = /^(pages|links|images|headings)$/.exec(ctx.params.kind)?.[1];
    if (!kind) throw notFound('No such export.');
    const one = ctx.query.get('entry');
    let only = null;
    if (one) {
      const m = /^([a-z0-9_-]+)\/([a-z0-9][a-z0-9-]*)$/i.exec(one);
      if (!m) throw badRequest('entry must be "<collection>/<id>".');
      only = { c: store.collection(m[1]).id, id: m[2] };
    }
    const list = await pages(only);
    if (only && !list.length) throw notFound('No such entry.');
    const rows = [];
    const site = config.siteUrl ? config.siteUrl.replace(/\/+$/, '') : null;
    if (kind === 'pages') {
      rows.push(['collection', 'id', 'title', 'status', 'address', 'search title', 'search title length', 'description', 'description length', 'words', 'images', 'images without alt', 'links', 'links to fix', 'h1', 'heading problems']);
      for (const e of list) {
        const s = searchText(e.c, e.f.fields ?? {});
        const hs = e.c.format === 'md' ? headingsOf(e.f.parsed.doc) : [];
        rows.push([e.c.id, e.id, e.f.summary.title, e.status, e.url, s.title, s.title?.length ?? 0, s.description, s.description?.length ?? 0, e.c.format === 'md' ? textOf(e.f.parsed.doc).split(/\s+/).filter(Boolean).length : '', imagesOf(e.f.parsed.doc, e.f.fields).length, e.f.altText.length, linksOf(e.f.parsed.doc).length, e.f.links.length, hs.filter((h) => h.level === 1).length, e.f.headings.length]);
      }
    } else if (kind === 'links') {
      rows.push(['page', 'link', 'text', 'inside the site', 'rel', 'problem', 'where']);
      for (const e of list) {
        const problems = new Map(e.f.links.map((l) => [l.href, l.problem === 'not-live' ? `goes to “${l.target?.title}”, not live` : 'goes to no page']));
        for (const l of linksOf(e.f.parsed.doc)) {
          const inside = l.href.startsWith('/') && !l.href.startsWith('//') ? 'yes' : site && l.href.startsWith(site) ? 'yes' : /^https?:/i.test(l.href) ? 'no' : '';
          rows.push([e.url, l.href, l.text, inside, l.rel, problems.get(l.href) ?? '', l.where]);
        }
      }
    } else if (kind === 'images') {
      rows.push(['page', 'image', 'alt text', 'where']);
      for (const e of list) for (const i of imagesOf(e.f.parsed.doc, e.f.fields)) rows.push([e.url, i.src, i.alt, i.where]);
    } else {
      rows.push(['page', 'level', 'heading', 'where']);
      for (const e of list) for (const h of e.c.format === 'md' ? headingsOf(e.f.parsed.doc) : []) rows.push([e.url, `H${h.level}`, h.text, h.where]);
    }
    const name = `${only ? `${only.c}-${only.id}` : 'site'}-${kind}.csv`;
    ctx.res.statusCode = 200;
    ctx.res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    ctx.res.setHeader('Cache-Control', 'no-store');
    ctx.res.setHeader('Content-Disposition', `attachment; filename="${path.basename(name)}"`);
    // a byte-order mark so spreadsheet apps read the text as UTF-8
    ctx.res.end(`﻿${csv(rows)}`);
  });
}
