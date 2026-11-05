# Markstage API: preview render

Part of the API contract (docs/API.md: its conventions, prefix and errors apply here). Split out of docs/API.md;
docs/SECURITY.md has its security model.

The editor's device frame and "Open preview" use one URL per entry. The preview runs the author's HTML and the
site's own scripts, so it lives on its **own origin** (`preview.origin`, e.g. `https://preview.example.com`,
served by a second listener on `preview.port`, default 18245). It must never be the CMS origin, where those scripts
could act with the viewer's session. It should be a sibling host of the CMS (same site), so the preview cookie
works inside the editor's frame.

| Route | Answer |
|---|---|
| `GET preview/:c/:id[?region=en-US]` (API, signed in; `locale=` is the same) | `{url}`: `https://preview.example.com/markstage/preview/<c>/<id>/` (plus `?region=` when given). Dev mode: `{url, devServer: true}`, the site's own dev server (`preview.devServer` + the entry's path). `region` is a locale code from the site config (any case): the preview opens that locale's copy (`/en-us/blog/x/`); none: the address as is. `404` when no preview is set up, `409` when the collection has no page URL, `422 {regions}` for an unknown region |
| `PUT preview/:c/:id/state` (API) | `{baseVersion, doc?, frontmatter?, source?, data?, changes?}` (an autosave's body) → `{ok}`. The editor's unsaved state for the preview only: kept in the server's database (so a state sent to any server process reaches the preview, docs/SCALING.md), never written as an autosave. The preview shows it (HMR refreshes the frame) until the entry changes, a later autosave replaces it, or `DELETE preview/:c/:id/state`. `409` stale `baseVersion`, `422` unsafe link, `403` without the right to edit the entry |
| `GET /markstage/preview-auth?to=<path>` (CMS origin, not under `/api`) | Signed in: a page that posts a one-time ticket (60 s) and `to` to the preview origin in a form body, never in a URL. Else `401` "Sign in first". Framable only by the CMS itself |
| `POST /markstage/preview-enter` (preview origin) | `ticket`, `to` (form). With a fresh ticket, `Origin` must be the CMS: sets the HttpOnly preview cookie, bound to the CMS session (it ends with sign-out, revoke, timeout or a disabled user), `303` to the ticket's `to`. A repeat without a usable ticket (used, older than a minute; a browser re-posts the form when the frame reloads after a cold first page) but with a live preview cookie: `303` to `to` (the form's, a safe path, else `/`); `Origin: null` is accepted on this path. No cookie: `403` "This preview link has expired" with one link, "Open the preview again" (`preview-auth?to=`), and, when framed, `postMessage({markstage: 'preview-expired'})` to the CMS origin so the editor retries by itself. Any other `Origin`: `403`, the ticket untouched |
| `GET /markstage/preview/:c/:id/[?region=]` (preview origin) | Chooses that entry for this viewer, then `303` to its page path in that region (locale). No preview cookie: `303` to the CMS `preview-auth`. Unknown region: `400` |
| `GET /robots.txt` (preview origin; the CMS host the same) | `User-agent: *` / `Disallow: /`. Every answer on both hosts for a known host name, errors too, carries `X-Robots-Tag: noindex, nofollow`, in production as well |
| any other `/markstage/*` (preview origin) | `404`: Markstage's own addresses never reach the clone's dev server |
| anything else on the preview origin | Proxied to the site's dev server, with the HMR websocket. Pages are rendered with the viewer's own autosave of the chosen entry written into a private clone of the site, never the content repo. One viewer at a time per page load (serialized). Assets are not serialized. Answers carry `X-Robots-Tag: noindex`, `Cache-Control: no-store` and `frame-ancestors <CMS origin>`. Markstage cookies are removed before the request reaches site code |

- Live refresh: the editor keeps autosaving (`PUT .../autosave`). When the clone shows this viewer's state of that
  entry, the server rewrites it, and the dev server's HMR refreshes the frame (about 1.4 s on the pilot site).
- The dev server runs on an odd loopback port from `preview.ports`, which is checked free. With `preview.warm`
  (the default when `origin` is set) it starts together with Markstage, is asked for the site's home page once
  (Astro compiles the shared layout then), and is kept running: the log says `Preview warm in N s`, and the first
  page a writer opens after a restart or a deploy of a new Markstage does not wait for it. The warm-up runs in the
  background; a page asked for meanwhile waits for it (the editor's canvas says "Preparing the preview…", opens the
  frame again once by itself after a minute, then offers Try again). With `warm: false` it starts on the first
  request (about 4 s warm, 40 s on a cold server with the first page's compile; the first time ever also copies
  the site's `node_modules`, 15 s) and stops after `preview.idleMinutes` (default 10) without use.
- An autosave with an unsafe link (`422`) shows a plain "cannot be previewed yet" page. If the dev server cannot
  start, the page shows the site's own error message.
- Config: `preview: { origin, port, ports: [18247, 18299], command: ["npx", "astro", "dev", "--host",
  "127.0.0.1", "--port", "{port}", "--ignore-lock"], idleMinutes, startSeconds, warm, settleFile, settleMs, env,
  devServer, dir }`. `--ignore-lock` keeps Astro 7 in the foreground. `settleFile`
  (`.astro/data-store.json`) is how the server knows the dev server has re-read a change.

### Device checks in the frame (the preview agent)

The device frame is on another origin, so the editor cannot read the page to run the responsive checks. Instead
the preview origin adds the **preview agent** to every HTML page it proxies. The agent measures the page in place
and talks to the editor by `postMessage`.

- **The script.** `GET /markstage/preview-agent.js` on the preview origin serves `<editorDir>/preview-agent.js`.
  The editor build must emit `src/device/agent.ts` there as one self-contained **classic** script (not a module),
  because the agent reads `document.currentScript`. If the file is missing, no tag is added, and the editor shows
  "The checks cannot reach this preview."
- **The tag.** It goes just before `</head>` (else `</body>`, else at the end):
  `<script src="/markstage/preview-agent.js" data-cms="https://cms.example.com [loopback aliases]" async></script>`.
  `data-cms` lists the CMS origins, space-separated. Pages that are compressed, not HTML, or over 16 MB pass through
  unchanged. Content-Length is fixed and the site's ETag is dropped. The dev server is asked for
  `Accept-Encoding: identity`.
- **Messages.** Every message is an object with a `markstage` key:

| Direction | Message | When |
|---|---|---|
| page → editor | `{markstage: 'ready'}` | the agent is listening: the page has rendered (again after each HMR reload). The page editor's canvas shows "Preparing the preview…" until the first one |
| page → editor | `{markstage: 'preview-expired'}` | not from the agent: the preview's own 403 page (preview-enter without a usable ticket or cookie) says the frame holds no page; the editor opens it again on a fresh preview URL once, then offers Try again |
| page → editor | `{markstage: 'rendered', path, width}` | the page has loaded, and again after each client-side navigation (`astro:page-load`); the editor measures on it |
| editor → page | `{markstage: 'measure', run?}` | the editor wants the checks (after `ready`, or after a resize); `run` is its own request number |
| page → editor | `{markstage: 'measured', run, result: Measured}` | the answer, `run` echoed: `{width, sideways, issues: [{id, kind: 'overflow'\|'image'\|'tap'\|'font', text, label}]}`. The agent first loads lazy images and waits for fonts (2.5 s at most) |
| editor → page | `{markstage: 'reveal', id}` | scroll to an issue's element and outline it |
| editor → page | `{markstage: 'mark', words}` / `{markstage: 'reveal-word', word}` | highlight the words a locale respells (the page answers `{markstage: 'marked', count}`) / scroll to the next one |

- **Origins, the agent's side.** It sends `ready` to each `data-cms` origin; the browser drops the ones that are not
  the parent's (one console line each). It answers only messages whose `source` is `window.parent` and whose
  `origin` is in `data-cms`, and replies to that origin. It does nothing when not framed. Source:
  `packages/editor/src/device/agent.ts`; `markstage build-editor` writes it into the editor build (`editorDir`), and
  `npm run build:agent -w packages/editor` builds it alone to `packages/editor/dist/preview-agent.js`.
- **Origins, the editor's side.** It accepts a message only when `event.source === frame.contentWindow` and
  `event.origin` is the preview origin (`new URL(previewUrl).origin`). It posts to the frame with that origin as
  `targetOrigin`, never `'*'`.
- Only the CMS can frame the preview (`frame-ancestors`), so no other page can talk to the agent.
- If the site sends its own CSP in dev, its `script-src` must allow `'self'`. Astro's dev server sends none.
- Proven in Chromium against the real site's `astro dev`, with the built agent. The CMS page frames the preview at
  390 px. The hand-off signs the frame in, and the page arrives with the tag. `ready` and `measured` (run echoed,
  width 390, real issues) reach the CMS page from the preview origin only. A message from the page itself, posing as the parent, gets no answer. A foreign origin
  cannot frame the preview.

### Section gallery, and "Edit this page" on the live site

`GET preview/gallery`, `GET preview/gallery/:c` (every section type and variation drawn alone through the preview),
`GET site/edit-button` and `GET site/entry-at?path=` (the live site's edit link, its cookie and the entry at an
address): docs/API-EDIT.md.
