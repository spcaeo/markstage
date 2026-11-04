// The Markstage example: a plain Astro blog. `npm run dev` serves it on 127.0.0.1:18233 with the editor at
// /markstage/ (markstage.config.mjs); `npm run build` builds the blog alone.
import { defineConfig } from 'astro/config';
import markstage from '@markstage/astro';

export default defineConfig({
  trailingSlash: 'always',
  integrations: [markstage()],
});
