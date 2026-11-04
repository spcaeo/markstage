// The light index of the site (docs/API.md "The light index"): every entry of every collection with only what the
// editor's shell needs at boot (the palette, the drawer counts, the link field's targets), in one answer from the
// content index, with an ETag so a repeat costs a 304 and no bytes.
//   GET /index   {items: [{collection, id, title, url, status, modified, group?, held?}]}
import { sha1 } from '../util.mjs';

export function lightIndexRoutes(router, app) {
  const { store } = app;

  router.add('GET', '/index', (ctx) => {
    const items = [];
    for (const c of store.collections) {
      for (const e of store.index(c).values()) {
        const s = store.summaryOf(c, e);
        items.push({ collection: c.id, id: e.id, title: s.title, url: s.url, status: s.status, modified: s.modified, ...(s.group ? { group: s.group } : {}), ...(s.held ? { held: s.held } : {}) });
      }
    }
    const body = JSON.stringify({ items });
    const etag = `"${sha1(body)}"`;
    const res = ctx.res;
    res.setHeader('ETag', etag);
    // the browser keeps it and asks again with If-None-Match; the answer is private to the signed-in person
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('Vary', 'Cookie');
    if (ctx.req.headers['if-none-match'] === etag) {
      res.statusCode = 304;
      res.end();
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(body);
  });
}
