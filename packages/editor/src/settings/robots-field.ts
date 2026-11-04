// "Hide from search engines" in Post settings: one switch over the site's robots key (config `hreflang.robots`, a
// list such as ["index", "follow"]), drawn for every collection with a page and settings. On, "noindex" takes the
// place of "index" and every other directive stays (pages/robots.ts); the site, its sitemap and hreflang honour it.
import { h } from '../panel-form';
import { indexable, withIndex } from '../pages/robots';
import { config, type SettingField } from '../runtime';
import { lockField } from '../field-access';
import type { DrawnField, FieldCtx } from './fields';

export const HIDE_LABEL = 'Hide from search engines';
export const HIDE_HINT = 'The page stays on the site but search engines are asked not to list it.';

/** The frontmatter key that holds the page's robots directives, when the site names one. */
export const robotsKey = (): string | null => config().locales?.hreflang?.robots ?? null;

/** True when the drawer should add the switch: the site names the key and no setting already covers it. */
export const wantsRobots = (defs: SettingField[], hasUrl: boolean): string | null => {
  const key = robotsKey();
  return key && hasUrl && !defs.some((d) => 'key' in d && d.key === key) ? key : null;
};

let uid = 0;

export function robotsField(key: string, ctx: FieldCtx): DrawnField {
  const el = h('div', 'ms-field ms-field--switch');
  const id = `ms-set-robots-${++uid}`;
  const lab = h('label', 'ms-switch');
  lab.htmlFor = id;
  const input = h('input', 'ms-switch__box');
  input.type = 'checkbox';
  input.id = id;
  lab.append(input, Object.assign(h('span', 'ms-switch__label'), { textContent: HIDE_LABEL }));
  el.append(lab, Object.assign(h('span', 'ms-field__hint'), { textContent: HIDE_HINT }));
  const hidden = () => !indexable(ctx.edits.get(key));
  input.addEventListener('change', () => {
    const next = withIndex(ctx.edits.get(key), !input.checked);
    if (next) ctx.edits.set(key, next);
  });
  const sync = () => void (input.checked = hidden());
  sync();
  if (!ctx.edits.may(key)) lockField(el);
  return { el, sync, focus: () => input.focus() };
}
