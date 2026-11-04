// The links and topics screens (docs/API-LINKS.md) in astro dev: the dev API has no link map of its own, so with
// MARKSTAGE_DEV_SERVER set (a Markstage server in dev mode on this machine) it hands those requests on to that server
// and passes the answer back as it came. Without it the screens keep their "not available" answer.

const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+$/;
const MAX_BODY = 4 * 1024 * 1024;

/** The server's origin from MARKSTAGE_DEV_SERVER, or null; anything but a loopback origin is refused. */
export function forwardTarget(raw) {
  if (!raw) return null;
  const origin = String(raw).trim().replace(/\/+$/, '');
  if (!LOOPBACK.test(origin)) throw new Error(`MARKSTAGE_DEV_SERVER must be a server on this machine, such as http://127.0.0.1:18231, not "${raw}".`);
  return origin;
}

/** Which dev API requests go to the server: the link map, the topics, and the undo of an accepted link. */
export const forwarded = (parts) => parts[0] === 'links' || parts[0] === 'topics' || (parts[0] === 'site' && parts[1] === 'undo');

function readRaw(req, HttpError) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) reject(new HttpError(413, 'too-large', 'The request is too large.'));
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** True when it answered. */
export async function forwardRoute({ target, parts, req, res, url, HttpError }) {
  if (!target || !forwarded(parts)) return false;
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readRaw(req, HttpError);
  let r;
  try {
    r = await fetch(`${target}${url.pathname}${url.search}`, { method: req.method, headers: { 'Content-Type': req.headers['content-type'] ?? 'application/json' }, body });
  } catch {
    throw new HttpError(502, 'no-server', `The Markstage server at ${target} does not answer. Start it, or unset MARKSTAGE_DEV_SERVER.`);
  }
  res.statusCode = r.status;
  res.setHeader('Content-Type', r.headers.get('content-type') ?? 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(Buffer.from(await r.arrayBuffer()));
  return true;
}
