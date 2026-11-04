---
title: "Glossary: Astro, git-based CMS and visual editing terms"
description: "Plain-English meanings of the words used around Astro content editing: git-based CMS, headless CMS, content collections, front matter and more."
h1: "Glossary"
checked: "2026-11-03"
---

## Astro

A web framework for content sites. It builds pages from components and content files, and by default sends
finished HTML to the browser.

## Content collections

Astro's way to group content of the same shape, such as blog posts or product pages. A collection can read
Markdown, MDX, Markdoc, YAML, TOML or JSON files, or load from an outside source, and can check each entry against a
schema.

## Front matter

The block of settings at the top of a Markdown file, between two `---` lines: the title, date, description and
other fields, written in YAML.

## Markdown

A plain-text way to write formatted text: `#` for a heading, `*` for a list, `[text](link)` for a link. It is easy
to read and to compare in git.

## MDX

Markdown that can also contain components and code. Markstage does not edit MDX; it edits Markdown and JSON.

## JSON

A plain-text format for structured data. Markstage uses it for pages made of typed sections, menus, authors and
settings.

## Headless CMS

A content system with no front end of its own. It stores content, usually in a database, and your site reads it
through an API.

## Git-based CMS

A content system that keeps content as files in a git repository instead of a database. Every change is a commit
you can review, compare and undo.

## Visual editing

Editing while seeing the page as visitors will see it. It ranges from a preview beside a form to typing directly on
the page.

## On-page (inline) editing

The strongest kind of visual editing: you click the text on the page and type. Markstage edits text and rich text
this way, on the site's own design.

## Live preview

A preview that updates as you type, usually shown beside the form you type into.

## Static site

A site built ahead of time into plain HTML files. It is fast and simple to host, because no code runs on each
visit.

## Server rendering (SSR) and adapters

Building a page on each request instead of ahead of time. In Astro this needs an adapter for the host (Node,
Vercel, Netlify, Cloudflare). Some editors need it; Markstage does not.

## Environment

A place where a copy of the site runs: on your computer (local), for review (staging), or for the public
(production). In Markstage each is a git branch plus a server.

## Promotion

Moving changes up from one environment to the next, for example from staging to production. In Markstage it is a
git merge, so design and content move together.

## Release

A named bundle of changes that are previewed together and go live together, now or at a set time.

## Share link

A private address that lets someone without an account see a draft or a release. Markstage's share links expire
and are kept out of search engines.

## Roles

What each person may do: write their own drafts, edit everything, publish, manage people. Markstage has five
built-in roles and custom roles.

## Single sign-on (SSO)

Signing in with an account your organisation already has, such as Google Workspace or Microsoft Entra ID. Markstage
supports any OpenID Connect provider.

## MCP (Model Context Protocol)

A standard way for AI assistants to use a tool. Through Markstage's MCP server, an AI agent can draft changes as a
person; a person still reviews and publishes.

## Source-available

Software whose code you can read, change and run, under a licence with some limits. Markstage is source-available
under the Elastic License 2.0: free to self-host, but not to resell as a hosted service.

## Self-hosted

Run on a server you control, rather than as someone else's hosted service.
