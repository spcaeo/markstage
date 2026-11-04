// Checks of the fresh build, between build and deploy (so a failure still leaves the live site untouched):
// - verify (config `verify: {public, private}`): every locale copy of the entries a job changed is where its status
//   says. Published: a page in the public output, none in the private one. Protected: the reverse. Draft,
//   scheduled, unpublished or deleted: in neither. A moved entry's old addresses: gone, or a redirect stub.
//   The site emits all locale copies from one source, so a build that drops one (say /en-us/) is caught here.
// - checks with `after: 'build'` (e.g. an hreflang check of the built pages): run per entry, blocking ones stop it.
import fs from 'node:fs';
import path from 'node:path';
import { isWithin } from './config.mjs';
import { runCommand } from './jobs.mjs';
import { entryEnv, parseIssues } from './content/validate.mjs';

/** The built file of a site path in an output folder, or null. */
export function builtFile(dir, p) {
  const rel = decodeURI(p).replace(/^\/+/, '');
  const candidates = p.endsWith('/') ? [path.join(dir, rel, 'index.html')] : [path.join(dir, rel), path.join(dir, rel, 'index.html'), path.join(dir, `${rel}.html`)];
  return candidates.find((f) => isWithin(dir, f) && fs.existsSync(f) && fs.statSync(f).isFile()) ?? null;
}

export const isRedirectStub = (file) => /<meta[^>]+http-equiv=["']?refresh/i.test(fs.readFileSync(file, 'utf8').slice(0, 4000));

export function createVerify(app) {
  const { config, store } = app;
  const pathsOf = (url) => app.site?.pathsOf?.(url) ?? (url ? [url] : []);

  /** What the build must show for an entry: { label, paths, state: 'public'|'private'|'gone'|'moved', c, id, text }. */
  function expect(c, id, text, beforeText = null) {
    const summary = text !== null ? store.summarize(c, id, text) : beforeText !== null ? store.summarize(c, id, beforeText) : null;
    if (!summary?.url) return null;
    const fields = text !== null ? store.fieldsOf(c, text) : {};
    const state = text === null || summary.status !== 'published' ? 'gone' : fields.protected === true ? 'private' : 'public';
    return { label: `${c.id}/${id}`, paths: pathsOf(summary.url), state, c, id, text };
  }

  /** A moved entry's old addresses (every locale): gone from the build, or redirect stubs. */
  const moved = (c, id, oldUrl) => (oldUrl ? { label: `${c.id}/${id} (old address)`, paths: pathsOf(oldUrl), state: 'moved', c, id, text: null } : null);

  function problems(t) {
    const out = [];
    for (const p of t.paths) {
      const pub = builtFile(config.verify.public, p);
      const priv = config.verify.private ? builtFile(config.verify.private, p) : null;
      if (t.state === 'public' && !pub) out.push(`${p} is missing from the build`);
      if (t.state === 'public' && priv) out.push(`${p} is also in the private output`);
      if (t.state === 'private' && pub && !isRedirectStub(pub)) out.push(`${p} is public, but the entry is protected`);
      if (t.state === 'private' && config.verify.private && !priv) out.push(`${p} is missing from the private output`);
      if (t.state === 'gone' && pub && !isRedirectStub(pub)) out.push(`${p} is still built, but the entry is not live`);
      if (t.state === 'gone' && priv) out.push(`${p} is still in the private output, but the entry is not live`);
      if (t.state === 'moved' && pub && !isRedirectStub(pub)) out.push(`${p} (the old address) is still a page`);
    }
    return out;
  }

  /** The afterBuild hook for these targets (null ones are skipped). */
  function afterBuild(targets) {
    const list = targets.filter(Boolean);
    const post = config.checks.filter((k) => k.after === 'build');
    if (!list.length || (!config.verify && !post.length)) return null;
    return async (step) => {
      if (config.verify) {
        await step('verify', (log) => {
          let bad = 0;
          for (const t of list) {
            const found = problems(t);
            bad += found.length;
            log(found.length ? found.map((f) => `FAIL ${t.label}: ${f}`).join('\n') + '\n' : `ok ${t.label}: ${t.state} at ${t.paths.join(', ')}\n`);
          }
          return bad ? { code: 1, reason: `on ${list[0].label}: a locale copy is not where its status says (see the log)` } : 0;
        });
      }
      const withText = list.filter((t) => t.text !== null);
      for (const check of post) {
        if (!withText.length) break;
        await step(`check: ${check.label}`, async (log) => {
          let failed = 0;
          for (const t of withText) {
            let output = '';
            const { code, timedOut } = await runCommand(check.command, {
              cwd: config.contentRoot,
              env: { ...entryEnv(config, t.c, t.id), MARKSTAGE_URLS: t.paths.join(' '), MARKSTAGE_DIST: config.verify?.public ?? '' },
              timeoutSeconds: check.timeoutSeconds,
              stdin: t.text,
              onOutput: (s) => {
                if (output.length < 200_000) output += s;
              },
            });
            const ok = code === 0 && !timedOut;
            const issues = parseIssues(output);
            log(`${ok ? 'pass' : check.blocking ? 'FAIL' : 'warn'} ${t.label}\n${ok ? '' : issues.length ? issues.map((i) => `  ${i.severity}: ${i.message}`).join('\n') + '\n' : output.slice(0, 4000)}`);
            if (!ok && check.blocking) failed++;
          }
          return failed ? { code: 1, reason: `on ${withText[0].label}: ${check.label}` } : 0;
        });
      }
    };
  }

  return { expect, moved, afterBuild };
}
