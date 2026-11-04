// After a deploy, tell the outside world which pages changed (docs/OPERATIONS.md, docs/SEO.md section 4). Both
// hooks are optional, and neither can fail the job: the site is live already, so a failure is a warning on its step.
//   purge     the operator's CDN purge command (argv, no shell): stdin {"urls": [...]} or {"all": true}, exit 0
//   indexNow  {key, endpoint}: one POST with the changed addresses (Bing, Yandex and the others that share it);
//             the site serves the key at /<key>.txt. Needs the site's address (siteUrl); never on a whole-site change.
import { runCommand } from './jobs.mjs';

const MAX_URLS = 10_000; // IndexNow's limit per request

export function createAfterDeploy(app) {
  const { config, store } = app;
  const site = () => (config.siteUrl ? config.siteUrl.replace(/\/+$/, '') : null);
  const pathsOf = (url) => app.site?.pathsOf?.(url) ?? (url ? [url] : []);

  /** The site paths of an entry in every locale, from any of its texts (before and after a change). */
  function pagesOf(c, id, ...texts) {
    const out = new Set();
    for (const t of texts) {
      if (typeof t !== 'string') continue;
      try {
        for (const p of pathsOf(store.summarize(c, id, t).url)) out.add(p);
      } catch {
        // an unreadable text has no page to name
      }
    }
    return [...out];
  }

  async function run(step, changed) {
    const all = changed === 'all';
    const paths = all ? [] : [...new Set(changed ?? [])];
    if (!all && !paths.length) return;
    const base = site();
    const urls = paths.map((p) => (base ? base + p : p));

    if (config.purge) {
      await step('purge', async (log) => {
        log(`$ ${config.purge.command.join(' ')}\n${all ? 'everything' : urls.join('\n')}\n`);
        const { code } = await runCommand(config.purge.command, {
          cwd: config.contentRoot,
          env: config.commands.env,
          timeoutSeconds: config.purge.timeoutSeconds,
          stdin: JSON.stringify(all ? { all: true } : { urls }),
          onOutput: log,
        });
        if (code !== 0) log('[markstage] the purge did not go through: visitors may see the old page until the cache expires.\n');
        return code;
      }, { soft: true });
    }

    if (config.indexNow && base && !all) {
      await step('indexnow', async (log) => {
        const host = new URL(base).host;
        const body = { host, key: config.indexNow.key, keyLocation: `${base}/${config.indexNow.key}.txt`, urlList: urls.slice(0, MAX_URLS) };
        log(`POST ${config.indexNow.endpoint}\n${body.urlList.join('\n')}\n`);
        try {
          const res = await fetch(config.indexNow.endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json; charset=utf-8' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(15_000),
          });
          log(`${res.status} ${res.statusText}\n`);
          // 200 and 202 are accepted; anything else (403: the key file is not on the site) is a warning
          return res.status === 200 || res.status === 202 ? 0 : 1;
        } catch (e) {
          log(`could not reach ${config.indexNow.endpoint}: ${e.message}\n`);
          return 1;
        }
      }, { soft: true });
    }
  }

  return { run, pagesOf };
}
