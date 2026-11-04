// A local stand-in for the Unsplash API (search, photo, download count) and its image host, for the stock photo
// tests (unit and browser). Only the key `fixture-stock-key` is accepted. Photos are small coloured PNGs.
import http from 'node:http';
import zlib from 'node:zlib';

export const STOCK_KEY = 'fixture-stock-key';

/** A real w×h PNG: a soft diagonal blend from `a` to `b` (RGB triples). */
export function colorPng(w, h, a = [70, 110, 200], b = [240, 180, 90]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const t = (x / w + y / h) / 2;
      for (let k = 0; k < 3; k++) raw[y * (w * 3 + 1) + 1 + x * 3 + k] = Math.round(a[k] + (b[k] - a[k]) * t);
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const COLORS = { p1: [[40, 90, 160], [120, 200, 220]], p2: [[200, 80, 60], [250, 210, 120]], p3: [[50, 140, 90], [200, 230, 150]] };

/** Start it on `port` (0: any free port). Resolves with { base, host, seen, close }. */
export function fakeUnsplash({ port = 0, image = (id, small) => colorPng(small ? 160 : 480, small ? 110 : 320, ...(COLORS[id] ?? [])) } = {}) {
  const seen = { auth: [], tracked: 0, paths: [] };
  let base;
  const photo = (id, host = base) => ({
    id,
    width: 480,
    height: 320,
    alt_description: `photo ${id}`,
    user: { name: 'Ada Lens', links: { html: 'https://unsplash.example/@ada' } },
    links: { html: `https://unsplash.example/photos/${id}`, download_location: `${base}/photos/${id}/download` },
    urls: { small: `${host}/img/${id}-small.png`, regular: `${host}/img/${id}.png` },
  });
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, base);
    seen.paths.push(u.pathname);
    const img = /^\/img\/([a-z0-9]+)(-small)?\.png$/.exec(u.pathname);
    if (img) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(img[1] === 'notimage' ? Buffer.from('<html>') : image(img[1], !!img[2]));
    }
    seen.auth.push(req.headers.authorization);
    if (req.headers.authorization !== `Client-ID ${STOCK_KEY}`) return res.writeHead(401).end();
    const json = (v) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(v));
    if (u.pathname === '/search/photos') return json({ total: 3, results: ['p1', 'p2', 'p3'].map((id) => photo(id)) });
    if (u.pathname === '/photos/offhost') return json(photo('offhost', 'http://198.51.100.7'));
    if (u.pathname === '/photos/notimage') return json({ ...photo('notimage'), urls: { regular: `${base}/img/notimage.png` } });
    if (/^\/photos\/p\d\/download$/.test(u.pathname)) {
      seen.tracked++;
      return json({ url: 'x' });
    }
    if (/^\/photos\/p\d$/.test(u.pathname)) return json(photo(u.pathname.split('/')[2]));
    res.writeHead(404).end();
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      ok({ base, host: new URL(base).host, seen, close: () => server.close() });
    });
  });
}
