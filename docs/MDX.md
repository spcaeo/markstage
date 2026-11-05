# MDX in Markstage

MDX is Markdown that can also hold code: `import` and `export` lines, `{expressions}`, and components written like
HTML tags (`<Callout type="tip">…</Callout>`). Markstage edits `.mdx` files with two promises, the same as for
Markdown:

1. **A save changes only what the writer changed.** Open and save with no edit, and the file is byte for byte the
   same. Edit one paragraph, and only that paragraph changes in the git diff.
2. **The writer cannot break the code.** Imports, exports, expressions and the components' code are kept exactly as
   written. A writer changes the words, and a component's simple settings.

Markstage is pre-release. MDX support is new in the next release (see [CHANGELOG.md](../CHANGELOG.md)).

## Set it up

A collection of `.mdx` files is a collection with `format: 'mdx'` in `markstage.config.mjs`
([CONFIG.md](CONFIG.md)):

```js
export default defineConfig({
  collections: [
    { id: 'guides', label: 'Guides', format: 'mdx', dir: 'src/content/guides', url: '/guides/{id}/' },
  ],
});
```

The site renders the files as it always does (for Astro, the `@astrojs/mdx` integration). The example blog has one
MDX guide with a `Callout` and a `Chart`: `examples/blog/src/content/guides/writing-in-mdx.mdx`.

A collection holds one format: all its files are `.mdx`. A folder that mixes `.md` and `.mdx` files is two
collections, or one of them converted.

The collection works like a Markdown one. The list, new entries (from a template too), history and restore, rename,
delete and the trash are tested on `.mdx` files; settings, the SEO panel and publishing go through the same code as
for Markdown.

## What writers can do

| On the page | What it is | What the writer can do |
| --- | --- | --- |
| Paragraphs, headings, lists, quotes, tables, code blocks, images, links | Markdown | Everything, as in a Markdown file. |
| `import` and `export` at the top | Code | Nothing: a quiet locked line, "Uses 2 components: Callout, Chart". It cannot be deleted, moved or changed on the canvas. |
| `<Callout type="tip">` with text inside | A component that holds text | A card with its name and settings. The text inside is typed in like any other text. |
| `<Chart data={saves} height={160} />` | A component | A card with its name and settings. |
| A setting written as text, a number or on/off: `type="tip"`, `height={160}`, `animate` | A literal prop | Changed in the side panel (click the card). The save rewrites only that value, in its own quote style. |
| A setting that is code: `data={saves}`, `{...props}` | An expression prop | Shown read-only in the side panel, with a copy button. |
| `{year}` or `{/* a note */}` on its own line | An expression | A quiet locked line with the code shown. |
| `<Badge>New</Badge>` inside a sentence | Inline JSX | One token, kept as written. The words around it are edited as usual. |

Inside a sentence, a few tags are simply formatting: `<strong>`, `<b>`, `<em>`, `<i>`, `<del>` and `<s>` with no
attributes are bold, italic and strikethrough; `<br />` is a line break; a plain `<a href="…">` is a link.

### What stays read-only, and why

- **Imports, exports and expressions.** They are code; a change there can stop the site building.
- **Expression and spread props** (`data={rows}`, `{...props}`). Same reason.
- **A component inside a list item or a quotation.** Its settings are shown but kept as written, because the
  indentation they sit in cannot be rewritten safely. The text around it is editable.
- **A list item or quotation that holds code over several lines** (a component whose tag spans lines, inside a
  list). The whole list or quotation is kept as written, shown as code. Change it in Source mode.
- **The text inside a component** is editable when the component sits at the top level of the file (or inside
  another component) with its opening and closing tags on lines of their own. A component written on one line
  (`<Note>Short text</Note>`) is a card with its inside shown as written.

### What the writer types never becomes code

Typed `<`, `{` and a line starting with `import` or `export` are written escaped (`\<`, `\{`, `&#101;xport`), so
they show as typed and the file still builds.

### Roles

A contributor (and any role without the raw HTML right) may change words and literal settings, and may remove a
component like any block. Adding or changing code is refused with "Your role cannot add or change code or raw HTML
in an MDX file. Ask an editor." Editors and above may change the code in Source mode.

## Source mode

Source mode shows the raw `.mdx` file. People whose role allows it can change anything there, code included; the
save is checked like any other.

## A file Markstage cannot read

If the MDX reader cannot read a file (a tag left open, a stray `<` or `{`), or cannot write it back exactly as it
is, the file opens **read-only in Source mode** with a plain message and the line:

> This MDX file cannot be shown on the canvas (line 6), so it is open read-only in Source mode. Expected a closing
> tag for `<Callout>`. A developer can fix it in the file.

Nothing can be saved over it from the editor; the server refuses such a save too (`422 invalid-mdx`). Fix the file
in your code editor and reload.

A few things that are valid Markdown are not valid MDX: an HTML comment (`<!-- -->`, use `{/* */}`), an autolink
(`<https://…>`, use `[text](url)`), indented code (use a fenced block) and `<br>` (use `<br />`).

## The canvas

The canvas shows the page's own design around the text (the site's CSS, its header and widths, as for Markdown).
Components are drawn as cards, not as the site renders them: the canvas does not run the site's component code.
To see the real components, use "Preview page", or "What readers see" where the canvas is drawn
inside the page ([CANVAS-FIDELITY.md](CANVAS-FIDELITY.md)): both show the page as the site renders it.

The block menu offers the Markdown blocks in an MDX file. A site's own boxes from a block pack are HTML, which MDX
reads as code, so they are not offered there; an image has no caption or width setting in MDX for the same reason.

## How it works

`@markstage/core` reads `.mdx` with `remark-mdx` (pinned to 3.1.1; its licence is in NOTICE) on top of the same reader as Markdown.

- Each block keeps its exact source. On save, the blocks the writer did not change are written back as they were,
  byte for byte; only changed blocks are printed again (the same surgical save as Markdown,
  [ARCHITECTURE.md](ARCHITECTURE.md)).
- A changed literal prop is written in place: the reader finds that attribute's value in the original tag and
  replaces just it. A string keeps its quote (`"` or `'`; that quote inside the value becomes `&quot;` or `&#39;`).
  A number or a boolean is written as `{n}`, a bare flag turned off as `={false}`.
- When a file opens, Markstage checks that writing it back with no edit gives the same bytes. If not, the file is
  treated as unreadable (above), so a save can never quietly change code.

Tests: `packages/core/test/mdx.test.mjs` (a corpus of MDX files: byte-identical round trips, one-paragraph edits,
prop edits, files refused), `packages/editor/test/mdx.test.ts` (the cards and the side panel's settings),
`packages/server/test/mdx.test.mjs` (the collection on the server) and `packages/server/e2e/mdx.e2e.mjs` (the
example guide in a browser: a paragraph and the Callout's type edited, and the git diff is exactly those two lines).
