# @markstage/core

The core of Markstage: Markdown and MDX in and out of the editor's document, with block packs, front matter, and
surgical saves (a save changes only the lines that changed, so `git diff` shows exactly the edit). It has no
framework in it; [@markstage/astro](https://www.npmjs.com/package/@markstage/astro) and
[@markstage/server](https://www.npmjs.com/package/@markstage/server) use it, and install it for you.

It needs Node.js 22.13 or newer.

```js
import { createConverter } from '@markstage/core';

const md = createConverter();
const { frontmatter, doc } = md.mdToDoc(text);   // Markdown -> the editor's document
const next = md.docToMd(doc, text);               // back, changing only the lines that changed
```

Other entry points: `/verify` (the site checks), `/locks`, `/csp`, `/release`, `/json` (JSON entries, with a
Keystatic adapter at `/json/keystatic`), `/site-config`, `/authors`, `/page-types`, `/topics`, `/links`,
`/link-map` and `/link-suggest`. The architecture:
[docs/ARCHITECTURE.md](https://github.com/spcaeo/markstage/blob/main/docs/ARCHITECTURE.md).

## Licence

Markstage is source-available under the Elastic License 2.0 (LICENSE), free to use and self-host, including for
your clients' sites. NOTICE has the details. Source, issues and docs: https://github.com/spcaeo/markstage
