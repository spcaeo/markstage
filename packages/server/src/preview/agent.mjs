// The preview agent: a small script from the editor build (packages/editor src/device/agent.ts, built to
// `preview-agent.js`) that the preview origin adds to every page it proxies. The editor frames previews from another
// origin and cannot read their DOM, so the agent measures the page in place (sideways overflow, wide images, small
// tap targets, small text) and answers the editor by postMessage. The message protocol is in
// docs/API-PREVIEW.md. Its script tag names the CMS origins it may talk to (`data-cms`); it sends to those only and
// ignores messages from any other origin.
import fs from 'node:fs';
import path from 'node:path';

const FILE = 'preview-agent.js';
/** A page larger than this is passed through unchanged (no checks) rather than held in memory. */
const MAX_HTML = 16 * 1024 * 1024;

const attr = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** `html` with `tag` added just before </head> (else </body>, else at the end). */
export function injectTag(html, tag) {
  for (const re of [/<\/head\s*>/i, /<\/body\s*>/i]) {
    const m = re.exec(html);
    if (m) return html.slice(0, m.index) + tag + html.slice(m.index);
  }
  return html + tag;
}

export function createAgent(config, cmsOrigins) {
  const file = config.editorDir ? path.join(config.editorDir, FILE) : null;
  const src = `${config.basePath}/${FILE}`;
  const tag = `<script src="${src}" data-cms="${attr(cmsOrigins.join(' '))}" async></script>`;
  const available = () => Boolean(file && fs.existsSync(file));

  /** Serve the agent script on the preview origin (public: it holds no data). false when not built. */
  function serve(res) {
    if (!available()) return false;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    fs.createReadStream(file).pipe(res);
    return true;
  }

  /** Would this upstream response get the agent? (an uncompressed HTML page of a sane size) */
  function wants(headers) {
    if (!available()) return false;
    if (!/^text\/html\b/i.test(String(headers['content-type'] ?? ''))) return false;
    const enc = String(headers['content-encoding'] ?? 'identity').toLowerCase();
    if (enc !== 'identity') return false;
    const len = Number(headers['content-length']);
    return !(Number.isFinite(len) && len > MAX_HTML);
  }

  /**
   * Pipe an upstream HTML response to `res` with the agent added. `writeHead(length)` sends the status and headers
   * (length null: unknown); the body is buffered since its length changes. An overlong body goes through as it came.
   * `broken()` answers when the upstream breaks off before anything was sent.
   */
  function pipeInjected(up, res, writeHead, broken) {
    const chunks = [];
    let size = 0;
    let passthrough = false;
    up.on('data', (c) => {
      if (passthrough) return res.write(c);
      chunks.push(c);
      size += c.length;
      if (size > MAX_HTML) {
        passthrough = true;
        writeHead(null);
        for (const b of chunks.splice(0)) res.write(b);
      }
    });
    up.on('end', () => {
      if (!up.complete || res.headersSent !== passthrough) return;
      if (passthrough) return res.end();
      const body = Buffer.from(injectTag(Buffer.concat(chunks).toString('utf8'), tag), 'utf8');
      writeHead(body.length);
      res.end(body);
    });
    // a dev server that dies mid-page: a plain error rather than half a page
    up.on('error', () => (res.headersSent ? res.destroy() : broken()));
  }

  return { src, tag, available, serve, wants, pipeInjected };
}
