// The one tracking loader for the IDs in head.tracking (@markstage/core/head TRACKERS): a small inline
// <script data-markstage-head> that Markstage writes from the IDs alone (never pasted code), and GTM's <noscript>
// iframe for right after <body>. Each ID is checked against its tool's pattern again here, so a value that slipped
// past the settings check still never reaches a page, and the only text put into the script is a checked ID.
//
// What the loader does on a page:
//   - It starts only when the visitor sees the page: a page the browser prerenders (on a hover, say) waits for
//     `prerenderingchange`, so a page nobody opened is never counted.
//   - Ahrefs, Skald and Plausible start at once, as async scripts. Each script reads its ID from its own attribute
//     (document.currentScript), so the attribute is set before the script is added.
//   - GA4: the gtag snippet (dataLayer, gtag('js'), gtag('config', ID)) and gtag.js, at once.
//   - GTM: the dataLayer start event and gtm.js. By default (`first-interaction`) on the visitor's first pointerdown,
//     keydown, scroll or touchstart, or 3.5 s after the page has loaded when idle (requestIdleCallback, 2 s limit),
//     whichever comes first; `at-once` starts it with the others.
//
// What a page's Content-Security-Policy must allow for it (csp, per tool). Hash-allowed inline script aside, the
// tools add scripts and talk to their own servers, so each needs its origins in script-src, connect-src, img-src or
// frame-src. Sources, read on 26 Nov 2026:
//   Google Tag Manager and Google Analytics 4: Google's guide "Use Tag Manager with a Content Security Policy",
//     https://developers.google.com/tag-platform/security/guides/csp. gtm.js and gtag.js come from
//     https://www.googletagmanager.com (script-src); Analytics without Ads features needs img-src
//     https://www.googletagmanager.com https://*.google-analytics.com, connect-src https://www.googletagmanager.com
//     https://*.google-analytics.com https://*.google.com, and frame-src https://www.googletagmanager.com (also what
//     the <noscript> iframe loads). https://*.google.com covers analytics.google.com, which Google also names for
//     measurement. Tags the owner adds inside a container (Ads, Floodlight, custom code) need more, which that guide
//     lists, and a Custom JavaScript variable needs 'unsafe-eval'; those are the owner's to add, not the kit's.
//   Ahrefs: its script, https://analytics.ahrefs.com/analytics.js, posts each event by XMLHttpRequest to
//     <its own origin>/api/event (and errors to /api/error): script-src and connect-src https://analytics.ahrefs.com.
//   Skald: https://app.skaldanalytics.com/traffic-js/skald.js sends each event by sendBeacon (or fetch) to
//     <its own origin>/traffic-beacon: script-src and connect-src https://app.skaldanalytics.com.
//   Plausible: https://plausible.io/js/script.js posts each event by fetch to https://plausible.io/api/event:
//     script-src and connect-src https://plausible.io.
// (Ahrefs, Skald and Plausible name no CSP in their help pages; their lines come from reading each script as it is served.)
//
//   trackingTags(tracking) -> {tools: ['gtm', …], head: '<script …>…</script>' | '', bodyStart: '<noscript …>…</noscript>' | '',
//                              csp: {scriptOrigins, connectOrigins, imgOrigins, frameOrigins}}
import { GTM_LOADS, TRACKERS } from '@markstage/core/head';

const GOOGLE_TAG = 'https://www.googletagmanager.com';

/** What each tool needs from a page's policy, by directive (the comment above says where each line comes from). */
export const TOOL_CSP = Object.freeze({
  gtm: {
    scriptOrigins: [GOOGLE_TAG],
    connectOrigins: [GOOGLE_TAG, 'https://*.google-analytics.com', 'https://*.google.com'],
    imgOrigins: [GOOGLE_TAG, 'https://*.google-analytics.com'],
    frameOrigins: [GOOGLE_TAG],
  },
  // GA4 alone loads no frame (only Tag Manager's <noscript> does)
  ga4: {
    scriptOrigins: [GOOGLE_TAG],
    connectOrigins: [GOOGLE_TAG, 'https://*.google-analytics.com', 'https://*.google.com'],
    imgOrigins: [GOOGLE_TAG, 'https://*.google-analytics.com'],
    frameOrigins: [],
  },
  ahrefs: { scriptOrigins: ['https://analytics.ahrefs.com'], connectOrigins: ['https://analytics.ahrefs.com'], imgOrigins: [], frameOrigins: [] },
  skald: { scriptOrigins: ['https://app.skaldanalytics.com'], connectOrigins: ['https://app.skaldanalytics.com'], imgOrigins: [], frameOrigins: [] },
  plausible: { scriptOrigins: ['https://plausible.io'], connectOrigins: ['https://plausible.io'], imgOrigins: [], frameOrigins: [] },
});

// A string for the script: JSON, with < escaped so that no value, whatever it holds, can end the script element.
const lit = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

// The loader's pieces, one per tool, as code over `ids` (the checked IDs) and `add(src, attribute?)`.
const PIECES = {
  ahrefs: (id) => `add('https://analytics.ahrefs.com/analytics.js','data-key',${lit(id)});`,
  skald: (id) => `add('https://app.skaldanalytics.com/traffic-js/skald.js','data-site',${lit(id)});`,
  plausible: (id) => `add('https://plausible.io/js/script.js','data-domain',${lit(id)});`,
  ga4: (id) => `w.gtag=w.gtag||function(){w.dataLayer.push(arguments)};w.gtag('js',new Date());w.gtag('config',${lit(id)});add('${GOOGLE_TAG}/gtag/js?id='+${lit(id)});`,
};

/** The Tag Manager part: `gtm()` starts it once; started at once, or on the first interaction with an idle fallback. */
function gtmPiece(id, load) {
  const start = `var g=0;function gtm(){if(g)return;g=1;w.dataLayer.push({'gtm.start':new Date().getTime(),event:'gtm.js'});add('${GOOGLE_TAG}/gtm.js?id='+${lit(id)})}`;
  if (load === 'at-once') return `${start}gtm();`;
  return (
    `${start}['pointerdown','keydown','scroll','touchstart'].forEach(function(e){w.addEventListener(e,gtm,{once:true,passive:true})});` +
    `function later(){setTimeout(function(){'requestIdleCallback' in w?w.requestIdleCallback(gtm,{timeout:2000}):gtm()},3500)}` +
    `d.readyState==='complete'?later():w.addEventListener('load',later);`
  );
}

/** The loader script text for these checked IDs (the Tag Manager one with its `load`). */
function loader(ids, load) {
  const parts = ['w.dataLayer=w.dataLayer||[];'];
  for (const k of ['ahrefs', 'skald', 'plausible', 'ga4']) if (ids[k]) parts.push(PIECES[k](ids[k]));
  if (ids.gtm) parts.push(gtmPiece(ids.gtm, load));
  return (
    `(function(w,d){function add(src,attr,value){var s=d.createElement('script');s.async=true;if(attr)s.setAttribute(attr,value);s.src=src;d.head.appendChild(s)}` +
    `function start(){${parts.join('')}}` +
    `d.prerendering?d.addEventListener('prerenderingchange',start,{once:true}):start()})(window,document);`
  );
}

const EMPTY_CSP = () => ({ scriptOrigins: [], connectOrigins: [], imgOrigins: [], frameOrigins: [] });

/** What a page that already loads a tool itself carries (a site moving to the kit one part at a time). */
export const OWN_TAG = Object.freeze({
  gtm: /googletagmanager\.com\/gtm\.js/i,
  ga4: /googletagmanager\.com\/gtag\/js/i,
  ahrefs: /analytics\.ahrefs\.com\/analytics\.js/i,
  skald: /skaldanalytics\.com\/traffic-js\//i,
  plausible: /plausible\.io\/js\//i,
});

export function trackingTags(tracking) {
  // each ID again against its tool's pattern: a value that does not fit is dropped, never written
  const ids = {};
  for (const [k, t] of Object.entries(TRACKERS)) {
    const v = tracking?.[k];
    if (typeof v === 'string' && t.pattern.test(v.trim())) ids[k] = v.trim();
  }
  const tools = Object.keys(TRACKERS).filter((k) => ids[k]);
  if (!tools.length) return { tools: [], head: '', bodyStart: '', csp: EMPTY_CSP() };
  const load = GTM_LOADS.includes(tracking?.gtmLoad) ? tracking.gtmLoad : GTM_LOADS[0];
  const csp = EMPTY_CSP();
  for (const k of tools) for (const d of Object.keys(csp)) for (const o of TOOL_CSP[k][d]) if (!csp[d].includes(o)) csp[d].push(o);
  // no style attribute (a CSP problem): `hidden` and width/height 0 keep the frame out of sight
  const bodyStart = ids.gtm ? `<noscript data-markstage-head><iframe src="${GOOGLE_TAG}/ns.html?id=${ids.gtm}" height="0" width="0" hidden tabindex="-1" aria-hidden="true" title="Google Tag Manager"></iframe></noscript>` : '';
  return { tools, head: `<script data-markstage-head>${loader(ids, load)}</script>`, bodyStart, csp };
}
