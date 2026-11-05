// The Markstage starter: a small Astro blog with the editor set up. `npm run dev` serves it on 127.0.0.1:18237
// with the editor at /markstage/ (no sign-in, this machine only); `npm run build` builds the blog alone into dist/.
// Posts are Markdown, guides are MDX (docs/MDX.md).
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import markstage from '@markstage/astro';

export default defineConfig({
  // your site's address, for canonical links (change it before you go live)
  site: 'https://www.example.com',
  trailingSlash: 'always',
  integrations: [mdx(), markstage()],
});
