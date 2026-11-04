// The site's markstage.config loader lives in core (@markstage/core/site-config), shared with the Markstage server;
// this subpath keeps the integration's own import and the public @markstage/astro/config working.
export * from '@markstage/core/site-config';
