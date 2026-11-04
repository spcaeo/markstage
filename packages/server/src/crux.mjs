// Field speed from Google's Chrome UX Report (docs/SEO.md section 4): LCP, INP and CLS at the 75th percentile, on
// phones and on desktops, for the whole site or one page. Only with the site's own key (config `crux`: key or
// keyFile; never a key from anywhere else), sent in a header, never in a URL or a log. Google updates the data once
// a day, so answers are kept in the database and asked again at most once an hour per page.

const METRICS = ['largest_contentful_paint', 'interaction_to_next_paint', 'cumulative_layout_shift'];
const SHORT = { largest_contentful_paint: 'lcp', interaction_to_next_paint: 'inp', cumulative_layout_shift: 'cls' };
const FORMS = { phone: 'PHONE', desktop: 'DESKTOP' };
// Google's thresholds for "good" and "poor" (web.dev/vitals): lcp and inp in ms, cls unitless
const LIMITS = { lcp: [2500, 4000], inp: [200, 500], cls: [0.1, 0.25] };
const FRESH_MS = 3600_000;

/** good | needs-work | poor for a metric's p75. */
export const rate = (metric, p75) => (p75 === null || p75 === undefined ? null : p75 <= LIMITS[metric][0] ? 'good' : p75 <= LIMITS[metric][1] ? 'needs-work' : 'poor');

export function createCrux(app) {
  const { db, config, clock } = app;
  const get = (k) => db.prepare('SELECT value FROM kv WHERE key = ?').get(k)?.value;
  const set = (k, v) => db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);
  const site = () => (config.siteUrl ? config.siteUrl.replace(/\/+$/, '') : null);

  /** One question to Google: {lcp, inp, cls} p75s with ratings, or {none: true} when there are too few visitors. */
  async function ask(target, form) {
    const body = { ...(target.url ? { url: target.url } : { origin: target.origin }), formFactor: FORMS[form], metrics: METRICS };
    const res = await fetch(config.crux.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': config.crux.key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) return { none: true };
    if (!res.ok) {
      const why = res.status === 400 || res.status === 403 ? 'Google refused the key (check it is a Chrome UX Report API key for this project).' : `Google answered ${res.status}.`;
      throw Object.assign(new Error(why), { status: res.status });
    }
    const data = await res.json();
    const out = {};
    for (const m of METRICS) {
      const raw = data?.record?.metrics?.[m]?.percentiles?.p75;
      const p75 = raw === undefined ? null : Number(raw);
      out[SHORT[m]] = { p75, rating: rate(SHORT[m], p75) };
    }
    out.period = data?.record?.collectionPeriod?.lastDate ?? null;
    return out;
  }

  /** The kept answer for a page (path) or the whole site (path null): {phone, desktop, fetchedAt} or null. */
  function cached(p = null) {
    const v = get(`crux:${p ?? '*'}`);
    return v ? JSON.parse(v) : null;
  }

  /** Ask Google again (at most once an hour per target unless the last try failed). */
  async function refresh(p = null) {
    if (!config.crux) return { off: true };
    const base = site();
    if (!base) return { off: true, why: 'The site has no address (siteUrl in markstage.config).' };
    const prev = cached(p);
    if (prev && !prev.error && clock() - Date.parse(prev.fetchedAt) < FRESH_MS) return prev;
    const target = p ? { url: base + p } : { origin: base };
    const out = { fetchedAt: new Date(clock()).toISOString() };
    try {
      for (const form of Object.keys(FORMS)) out[form] = await ask(target, form);
    } catch (e) {
      out.error = e.name === 'TimeoutError' ? 'Google did not answer in time.' : e.message;
    }
    set(`crux:${p ?? '*'}`, JSON.stringify(out));
    return out;
  }

  return { cached, refresh, on: () => !!config.crux && !!site() };
}
