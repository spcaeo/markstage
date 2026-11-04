// The dev API's media routes (docs/API.md "Media"), for `astro dev` on this machine: uploads go into the config's
// media folder (<media.dir>/<year>/<month>/<name>.<ext>, never overwriting), the list is that folder. No database:
// a file's id is a hash of its path; where an image is used, and its alt text, are read from the content (every
// entry of every collection), so the library's "Not used" and "Without alt text" work as on the server. Alt text
// is written where the image is used, so PATCH answers 409; an image nothing uses can be deleted. Like the server,
// only JPEG, PNG, GIF, WebP and AVIF are accepted, by their bytes (not the name), up to 10 MB; dev mode does not
// re-encode them.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readFile } from './content.mjs';

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif' };
const BY_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif' };

/** The image type of a file's first bytes, or null (SVG and everything else). */
export function sniff(buf) {
  const ascii = (a, b) => buf.subarray(a, b).toString('latin1');
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png';
  if (/^GIF8[79]a$/.test(ascii(0, 6))) return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp' && /^avi[fs]$/.test(ascii(8, 12))) return 'image/avif';
  return null;
}

const slugify = (s) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'image';

let sharp;
/** An image's width and height from its header (a file path or its bytes). */
async function size(input) {
  sharp ??= await import('sharp').then((m) => m.default).catch(() => null);
  if (!sharp) return {};
  const m = await sharp(input).metadata().catch(() => null);
  return m ? { width: m.width ?? null, height: m.height ?? null } : {};
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > MAX_BYTES) reject(Object.assign(new Error('too large'), { tooLarge: true }));
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const IMAGE = /\.(?:jpe?g|png|gif|webp|avif)$/i;
const MD_IMAGE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)/g;
const HTML_IMG = /<img\b[^>]*>/gi;
const attr = (tag, name) => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)?.slice(1).find((v) => v !== undefined) ?? null;
const BARE = /[^\s"'`()<>[\]]+\.(?:jpe?g|png|gif|webp|avif)(?=[\s"'`()<>#?\]]|$)/gi;

/**
 * Where each image of the media folder is used: Map<path inside the media folder, { usedBy, alt }>, read from every
 * entry. A reference matches when it ends with the image's path inside the folder ("../../assets/uploads/2026/03/a.jpg",
 * "2026/03/a.jpg" and "/uploads/2026/03/a.jpg" all name 2026/03/a.jpg). The alt text is the first one written for
 * it: Markdown ![alt](…), <img alt>, or an `alt` next to the path in the frontmatter or JSON.
 */
export function mediaUsage(cfg, inMedia, readFrontmatter) {
  const map = new Map(inMedia.map((r) => [r, { usedBy: [], alt: '' }]));
  const find = (ref) => {
    let s = String(ref).split(/[?#]/)[0];
    try {
      s = decodeURI(s);
    } catch {
      // kept as written
    }
    const parts = s.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.' && p !== '..');
    for (let i = 0; i < parts.length; i++) {
      const hit = map.get(parts.slice(i).join('/'));
      if (hit) return hit;
    }
    return null;
  };
  for (const c of cfg.collections) {
    if (!fs.existsSync(c.absDir)) continue;
    for (const f of fs.readdirSync(c.absDir)) {
      if (!f.endsWith(c.ext)) continue;
      let raw;
      try {
        raw = readFile(c, path.join(c.absDir, f), readFrontmatter);
      } catch {
        continue;
      }
      const title = String((c.fields?.title ?? 'title').split('.').reduce((o, k) => (o == null ? undefined : o[k]), raw.data) ?? raw.id);
      const seen = new Set();
      const use = (ref, alt) => {
        const u = find(ref);
        if (!u) return;
        if (!seen.has(u)) {
          seen.add(u);
          u.usedBy.push({ collection: c.id, id: raw.id, title });
        }
        if (!u.alt && typeof alt === 'string' && alt.trim()) u.alt = alt.trim();
      };
      // an `alt` next to the path: { src: '2026/03/a.jpg', alt: '…' }
      const walk = (v) => {
        if (Array.isArray(v)) return v.forEach(walk);
        if (!v || typeof v !== 'object' || v instanceof Date) return;
        for (const x of Object.values(v)) if (typeof x === 'string' && IMAGE.test(x.split(/[?#]/)[0])) use(x, v.alt);
        Object.values(v).forEach(walk);
      };
      walk(raw.data);
      for (const m of raw.text.matchAll(MD_IMAGE)) use(m[2], m[1]);
      for (const [tag] of raw.text.matchAll(HTML_IMG)) {
        const src = attr(tag, 'src');
        if (src) use(src, attr(tag, 'alt'));
      }
      for (const [ref] of raw.text.matchAll(BARE)) use(ref);
    }
  }
  return map;
}

/** Handles /markstage/api/media…; true when it answered. ctx: { parts, method, req, res, cfg, send, HttpError, readFrontmatter }. */
export async function mediaRoute({ parts, method, req, res, cfg, send, HttpError, readFrontmatter }) {
  if (parts[0] !== 'media') return false;
  const root = cfg.root;
  const dir = path.resolve(root, cfg.media.dir);
  const rel = (abs) => path.relative(root, abs).split(path.sep).join('/');
  const idOf = (r) => `m_${crypto.createHash('sha1').update(r).digest('hex').slice(0, 20)}`;
  const urlOf = (r) => (r.startsWith('public/') ? `/${r.slice('public/'.length)}` : `/${r}`);
  const inMedia = (abs) => path.relative(dir, abs).split(path.sep).join('/');
  const used = () => mediaUsage(cfg, all().map(inMedia), readFrontmatter);
  const row = async (abs, withSize = false, u = null) => {
    const r = rel(abs);
    const st = fs.statSync(abs);
    const type = BY_EXT[path.extname(abs).slice(1).toLowerCase()];
    return {
      id: idOf(r),
      filename: path.basename(abs),
      path: r,
      url: urlOf(r),
      type,
      ...(withSize ? await size(abs) : { width: null, height: null }),
      bytes: st.size,
      alt: u?.alt ?? '',
      uploadedBy: 'u_dev',
      uploadedAt: st.mtime.toISOString(),
    };
  };
  const all = () => {
    const out = [];
    const walk = (d) => {
      if (!fs.existsSync(d)) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const abs = path.join(d, e.name);
        if (e.isDirectory()) walk(abs);
        else if (BY_EXT[path.extname(e.name).slice(1).toLowerCase()]) out.push({ abs, mtime: fs.statSync(abs).mtimeMs });
      }
    };
    walk(dir);
    return out.sort((a, b) => b.mtime - a.mtime).map((f) => f.abs);
  };
  const find = (mid) => {
    const abs = all().find((a) => idOf(rel(a)) === mid);
    if (!abs) throw new HttpError(404, 'not-found', 'There is no such file.');
    return abs;
  };

  if (parts.length === 1 && method === 'GET') {
    const q = (new URL(req.url, 'http://dev').searchParams.get('q') ?? '').toLowerCase();
    const params = new URL(req.url, 'http://dev').searchParams;
    const perPage = Math.min(Math.max(Number(params.get('perPage')) || 50, 1), 200);
    const page = Math.max(Number(params.get('page')) || 1, 1);
    const usage = used();
    const files = all().filter((a) => {
      const u = usage.get(inMedia(a));
      return (!q || rel(a).toLowerCase().includes(q) || u.alt.toLowerCase().includes(q)) && (!['1', 'true'].includes(params.get('unused') ?? '') || !u.usedBy.length);
    });
    const items = await Promise.all(files.slice((page - 1) * perPage, page * perPage).map((a) => row(a, true, usage.get(inMedia(a)))));
    send(res, 200, { items, total: files.length, page, perPage });
    return true;
  }
  if (parts.length === 1 && method === 'POST') {
    const name = String(new URL(req.url, 'http://dev').searchParams.get('filename') ?? '');
    if (!name || name.length > 200) throw new HttpError(422, 'invalid', 'Send the file name.', { fields: { filename: 'Send the file name.' } });
    let raw;
    try {
      raw = await readRaw(req);
    } catch (err) {
      if (err.tooLarge) throw new HttpError(413, 'too-large', 'The file is larger than 10 MB.');
      throw err;
    }
    const type = sniff(raw);
    if (!type) throw new HttpError(415, 'unsupported-type', 'Only images can be uploaded: JPEG, PNG, GIF, WebP or AVIF.');
    const now = new Date();
    const sub = path.join(dir, String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'));
    fs.mkdirSync(sub, { recursive: true });
    const base = slugify(path.basename(name).replace(/\.[^.]*$/, '')).slice(0, 80);
    let file = `${base}.${TYPES[type]}`;
    for (let n = 2; fs.existsSync(path.join(sub, file)); n++) file = `${base}-${n}.${TYPES[type]}`;
    const abs = path.join(sub, file);
    fs.writeFileSync(abs, raw, { flag: 'wx' });
    send(res, 201, await row(abs, true));
    return true;
  }
  const mid = parts[1];
  if (!/^m_[a-f0-9]{20}$/.test(mid ?? '')) throw new HttpError(404, 'not-found', 'There is no such file.');
  if (parts.length === 2 && method === 'GET') {
    const abs = find(mid);
    const u = used().get(inMedia(abs));
    send(res, 200, { ...(await row(abs, true, u)), usedBy: u.usedBy });
    return true;
  }
  if (parts.length === 2 && method === 'PATCH') {
    find(mid);
    throw new HttpError(409, 'dev-mode', 'In dev mode alt text is written where the image is used: select the image in the entry and edit its alt text there.');
  }
  if (parts.length === 2 && method === 'DELETE') {
    const abs = find(mid);
    const u = used().get(inMedia(abs));
    if (u.usedBy.length) throw new HttpError(409, 'in-use', `It is still used in ${u.usedBy.map((e) => e.title).join(', ')}.`, { usedBy: u.usedBy });
    fs.unlinkSync(abs);
    send(res, 200, { ok: true });
    return true;
  }
  if (parts.length === 3 && parts[2] === 'file' && method === 'GET') {
    const abs = find(mid);
    res.statusCode = 200;
    res.setHeader('Content-Type', BY_EXT[path.extname(abs).slice(1).toLowerCase()]);
    res.setHeader('Cache-Control', 'no-store');
    res.end(fs.readFileSync(abs));
    return true;
  }
  throw new HttpError(404, 'not-found', 'Dev mode has no such media route.');
}
