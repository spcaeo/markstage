---
title: From draft to live
description: Drafts, scheduled posts and publishing, in three short steps.
date: 2026-10-24
tags:
  - publishing
---

A post has a status. The editor shows it, and the site's build respects it.

## Draft

A draft (`draft: true`) is listed in the editor but never built, so readers cannot see it yet. This starter
ships one: open the editor and look for "A draft post".

## Scheduled

A post with a future `publishAt` stays out of the build until that time. A Markstage server rebuilds the site
when the time comes.

## Live

Everything else is live. With `npm run dev` you commit and deploy as you always do. With a Markstage server,
**Publish** commits the change, builds the site and switches to the new release in one step; if the build
fails, the live site stays as it was.
