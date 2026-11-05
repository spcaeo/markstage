// Markstage for the example blog: a collection of Markdown posts and one of MDX guides, drawn with the blog's own CSS. It uses only
// the core blocks; its one editor pack keeps a reading post's list of contents live on the canvas
// (markstage/contents.ts). Each post is a page type (a guide, an article, a legal page) with a frame the
// post page follows (src/pages/posts/[id].astro, @markstage/astro/pages), and posts belong to topics (topics).
import { defineConfig } from '@markstage/astro';

export default defineConfig({
  siteName: 'Example blog',
  collections: [
    {
      id: 'posts',
      label: 'Posts',
      format: 'md',
      dir: 'src/content/posts',
      hasStatus: true,
      fields: { excerpt: 'description' },
      url: '/posts/{id}/',
      // a post without a frame of its own or of its type reads as an article
      frame: 'reading',
      settings: [
        { type: 'textarea', key: 'description', label: 'Excerpt' },
        // the post page crops the cover to 2:1 around its focal point
        { type: 'image', key: 'cover.src', alt: 'cover.alt', focal: 'cover.focal', label: 'Cover image' },
        { type: 'date', key: 'date', label: 'Publish date' },
        // picks one of the authors below (and co-authors), since the site keeps them as files
        { type: 'text', key: 'author', label: 'Author' },
        // a reading post lists its h2s above the text (src/pages/posts/[id].astro); `contents: false` only when off
        { type: 'switch', key: 'contents', label: 'Show contents', default: true },
      ],
    },
    {
      // guides are MDX (docs/MDX.md): the words and the components' simple settings are edited, the code is kept
      id: 'guides',
      label: 'Guides',
      format: 'mdx',
      dir: 'src/content/guides',
      fields: { excerpt: 'description' },
      url: '/guides/{id}/',
      settings: [
        { type: 'textarea', key: 'description', label: 'Excerpt' },
        { type: 'date', key: 'date', label: 'Publish date' },
        { type: 'text', key: 'author', label: 'Author' },
      ],
    },
  ],
  // how a post is laid out: full width, reading (with a list of contents) or plain (the text alone)
  frames: true,
  // what a post is for: a guide (the hub of a topic) starts from the Library's guide template and needs a topic; an
  // article links up to the guide of its topic; a legal page is plain (docs/API-PAGE-TYPES.md)
  pageTypes: {
    types: [
      {
        id: 'guide',
        label: 'Guide',
        description: 'The hub of a topic: what it is, and links down to its articles.',
        collections: ['posts'],
        frame: 'full',
        template: 'lib_guide-post',
        checks: [{ id: 'topic', label: 'A topic', field: 'topic', level: 'block' }],
      },
      {
        id: 'article',
        label: 'Article',
        description: 'Teaches one thing, and links up to the guide of its topic.',
        collections: ['posts'],
        frame: 'reading',
        checks: [
          { id: 'topic', label: 'A topic', field: 'topic' },
          { id: 'guide', label: 'Links to its guide', linksTo: { pageType: 'guide', sameField: 'topic' } },
          // the topic files' main page (markstage/topics/, docs/API-LINKS.md), checked by the Markstage server
          { id: 'up', label: 'Links up to its topic’s main page', links: 'pillar' },
        ],
      },
      { id: 'legal', label: 'Legal page', description: 'Terms and privacy: the text alone.', collections: ['posts'], frame: 'plain' },
    ],
  },
  // the blog's subjects (markstage/topics/<id>.json): each with its main page and groups; pages in a topic are
  // suggested to link to each other, and the post page lists them under "More on this topic" (docs/API-LINKS.md)
  topics: { follow: ['docs.example.com'] },
  // the people the posts are by: src/content/authors/<slug>.json, each with a page at /author/<slug>/
  // (src/pages/author/); a post names one in `author`, and may list more in `coAuthors`
  authors: { coAuthors: 'coAuthors' },
  // the blog's dark colours turn on with <html data-theme="dark"> (blog.css)
  themes: { dark: { attr: 'data-theme', value: 'dark' } },
  // covers are plain files served as they are (/uploads/…)
  media: { dir: 'public/uploads' },
  compat: { collection: 'posts' },
  editor: {
    css: ['./src/styles/blog.css'],
    // shell: the canvas is drawn inside the post's own page (its header, widths, frame), docs/CANVAS-FIDELITY.md
    canvas: { articleClass: 'post', bodyClass: 'post__body', shell: true },
    // a wide image breaks out of the text column (blog.css figure.wide)
    images: { widths: [{ id: 'normal', label: 'Normal' }, { id: 'wide', label: 'Wide', class: 'wide' }] },
    // the list of contents follows the headings on the canvas (EditorPack.shell)
    packs: [{ editor: './markstage/contents.ts' }],
  },
});
