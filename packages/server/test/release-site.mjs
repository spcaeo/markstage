// A fixture site for releases and share links: a build that writes a real page per live entry (with the time it was
// built as, so a build "as of" another time is told apart), the shared Library items, and the pictures; a deploy
// that copies the whole build live. A server with the build folder checked (verify.public) and a share origin.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadCore } from '../src/content/converter.mjs';
import { TMP_ROOT, freePort, makeFixture, startServer } from './helpers.mjs';

const BUILD = `import fs from 'node:fs';
import path from 'node:path';
const at = process.env.MARKSTAGE_BUILD_TIME ?? new Date().toISOString();
const now = Date.parse(at);
if (process.env.FAIL_MARKER && fs.existsSync(process.env.FAIL_MARKER + '.build')) { console.error('build exploded'); process.exit(2); }
fs.rmSync('dist', { recursive: true, force: true });
const page = (url, title, body) => {
  fs.mkdirSync('dist' + url, { recursive: true });
  fs.writeFileSync('dist' + url + 'index.html', '<!doctype html><meta name="built" content="' + at + '"><title>' + title + '</title><main>' + body + '</main><script src="/site.js"></script>');
};
const live = [];
for (const f of fs.readdirSync('src/content/blog').filter((f) => f.endsWith('.md')).sort()) {
  const t = fs.readFileSync('src/content/blog/' + f, 'utf8');
  if (/^draft: true$/m.test(t)) continue;
  const when = /^publishAt: "?([^"\\n]+)"?$/m.exec(t);
  if (when && Date.parse(when[1]) > now) continue;
  const id = f.replace(/\\.md$/, '');
  live.push(id);
  page('/blog/' + id + '/', /^title: (.*)$/m.exec(t)[1], t.split(/^---$/m).slice(2).join('---').trim());
}
for (const f of fs.readdirSync('src/content/pages').filter((f) => f.endsWith('.json')).sort()) {
  const d = JSON.parse(fs.readFileSync('src/content/pages/' + f, 'utf8'));
  page(d.uri, d.title, JSON.stringify(d.sections ?? []));
}
const lib = [];
for (const kind of ['template', 'section', 'snippet']) {
  const dir = 'markstage/library/' + kind;
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) lib.push(JSON.parse(fs.readFileSync(dir + '/' + f, 'utf8')).name);
}
fs.writeFileSync('dist/library.json', JSON.stringify(lib));
if (fs.existsSync('src/assets/uploads')) fs.cpSync('src/assets/uploads', 'dist/uploads', { recursive: true });
fs.writeFileSync('dist/site.js', 'document.documentElement.dataset.site = "1";');
fs.writeFileSync('dist/robots.txt', 'User-agent: *\\nAllow: /\\n');
fs.writeFileSync('dist/404.html', '<!doctype html><title>Not found</title>');
fs.writeFileSync('dist/index.json', JSON.stringify(live));
console.log('built ' + live.length + ' posts as of ' + at);
`;

const DEPLOY = `import fs from 'node:fs';
const live = process.env.LIVE_DIR;
if (process.env.FAIL_MARKER && fs.existsSync(process.env.FAIL_MARKER + '.deploy')) { console.error('deploy refused'); process.exit(3); }
const tmp = live + '.tmp-' + process.pid;
fs.cpSync('dist', tmp, { recursive: true });
fs.rmSync(live, { recursive: true, force: true });
fs.renameSync(tmp, live);
console.log('deployed');
`;

/** A fresh release site and server; `clock` is the settable fake clock the server reads ({now}). */
export async function releaseServer({ share = true, overrides = {}, checks = true, sharePort: fixed = null } = {}) {
  const fx = makeFixture({ checks });
  fs.writeFileSync(path.join(fx.site, 'scripts/build.mjs'), BUILD);
  fs.writeFileSync(path.join(fx.site, 'scripts/deploy.mjs'), DEPLOY);
  fx.git('add', '-A');
  fx.git('commit', '-q', '-m', 'The release fixture build');
  const clock = { now: Date.parse('2026-11-02T09:00:00.000Z') };
  const sharePort = fixed ?? (await freePort());
  const shareOrigin = `http://127.0.0.1:${sharePort}`;
  const srv = await startServer(fx, {
    clock,
    core: await loadCore(),
    overrides: { verify: { public: 'dist' }, scheduler: { intervalSeconds: 3600 }, ...(share ? { share: { origin: shareOrigin, port: sharePort } } : {}), ...overrides },
  });
  return { fx, srv, clock, shareOrigin };
}

/** Every file under `dir`, as {relative path: sha256}. */
export function treeOf(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else out[path.relative(dir, abs)] = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

/** A copy of a folder in the test scratch space (a preview build is removed once its release is live). */
export function keep(dir) {
  const to = path.join(TMP_ROOT, `kept-${crypto.randomBytes(4).toString('hex')}`);
  fs.cpSync(dir, to, { recursive: true });
  return to;
}
