// What Markstage edits in this site, and how the editor draws it (docs/CONFIG.md has every key). The same file is
// read by `astro dev` (the editor at /markstage/) and by a Markstage server (the Docker image, docs/DOCKER.md).
//
// It is a plain object on purpose, with no import: a Markstage server reads this file at start, before the site's
// own packages are installed. The type comment below still gives an editor's autocomplete.

/** @type {import('@markstage/astro').MarkstageConfig} */
export default {
  siteName: 'My blog',
  collections: [
    {
      id: 'posts',
      label: 'Posts',
      format: 'md',
      dir: 'src/content/posts',
      // drafts and scheduled posts (`draft`, `publishAt`) stay off the built site (src/lib/live.ts)
      hasStatus: true,
      fields: { excerpt: 'description' },
      url: '/posts/{id}/',
      settings: [
        { type: 'textarea', key: 'description', label: 'Excerpt' },
        { type: 'date', key: 'date', label: 'Publish date' },
        { type: 'tags', key: 'tags', label: 'Tags' },
      ],
    },
    {
      // guides are MDX (docs/MDX.md): the words and the components' simple settings are edited, the code is kept
      id: 'guides',
      label: 'Guides',
      format: 'mdx',
      dir: 'src/content/guides',
      hasStatus: true,
      fields: { excerpt: 'description' },
      url: '/guides/{id}/',
      settings: [
        { type: 'textarea', key: 'description', label: 'Excerpt' },
        { type: 'date', key: 'date', label: 'Publish date' },
      ],
    },
  ],
  // pictures added in the editor are saved here and served as they are (/uploads/…)
  media: { dir: 'public/uploads' },
  // the site's dark colours turn on with <html data-theme="dark"> (site.css): the editor can show both
  themes: { dark: { attr: 'data-theme', value: 'dark' } },
  editor: {
    css: ['./src/styles/site.css'],
    // the canvas is drawn inside the post's own page (its header, width and fonts): docs/CANVAS-FIDELITY.md
    canvas: { articleClass: 'post', bodyClass: 'post__body', shell: true },
  },
  // "Edit this page" on the built site, for people signed in to your Markstage server. Set MARKSTAGE_CMS_URL to
  // its address (https on a real server; the Docker image sets it for its own builds). Without it, no button.
  ...(process.env.MARKSTAGE_CMS_URL ? { editButton: { cms: process.env.MARKSTAGE_CMS_URL } } : {}),
};
