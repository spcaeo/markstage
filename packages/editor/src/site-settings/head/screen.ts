// The frame both head parts share (Search & AI, Tracking): the title and the one-line lead, the settings loaded from
// the server, and the words for a site that does not use them or a server that does not offer them. What is in the
// middle (the form) is the part's own.
import { ApiError } from '../../api';
import type { ScreenCtx } from '../../host';
import { h, ht } from '../../panel-form';
import { config } from '../../runtime';
import { type HeadDoc, loadHead } from './doc';

/** What a part hands back: its form, whether it has unsaved changes, and a redraw for a changed URL. */
export interface Part {
  el: HTMLElement;
  dirty(): boolean;
  update(): void;
}

export function mountHeadPart(
  el: HTMLElement,
  ctx: ScreenCtx,
  o: { title: string; lead: string; /** the settings keys this part owns, for the file's own problems */ owns: string[]; make: (doc: HeadDoc, reload: () => Promise<void>) => Part },
): { update(c: ScreenCtx): void } {
  let part: Part | null = null;
  ctx.guard(() => !!part?.dirty());
  const intro = h('div', 'ms-locks__intro');
  intro.append(h('h2', 'ms-locks__title', o.title), ht('p', 'ms-locks__lead', o.lead));
  const note = (text: string) => ht('p', 'ms-locks__note', text);
  const show = (...rest: HTMLElement[]) => el.replaceChildren(intro, ...rest);

  /** What the file itself gets wrong (this part's keys, and the file as a whole), in the file's words. */
  const problems = (doc: HeadDoc) => {
    const mine = (doc.issues ?? []).filter((i) => i.path === '' || o.owns.some((k) => i.path === k || i.path.startsWith(`${k}.`)));
    if (!mine.length) return [];
    const box = h('div', 'ms-locks__note ms-hk__problems');
    box.setAttribute('role', 'status');
    box.append(ht('strong', '', `${doc.file ?? 'The settings file'} has settings the site cannot use, so it ignores them:`));
    const list = h('ul');
    for (const i of mine) list.append(ht('li', '', i.message));
    box.append(list, ht('span', '', 'Saving here writes what you see on this screen.'));
    return [box];
  };

  const load = async () => {
    const doc = await loadHead();
    if (!doc.enabled || !doc.head) return show(note('This site does not use these settings. A developer turns them on with “head” in markstage.config.'));
    const reload = async () => {
      part = null;
      await load();
    };
    part = o.make(doc, reload);
    show(...(doc.canEdit ? [] : [note('Only an owner or an administrator changes these.')]), ...problems(doc), part.el);
  };

  show(ht('p', 'ms-locks__lead', 'Loading…'));
  void load().catch((err) => {
    if (err instanceof ApiError && (err.status === 404 || err.status === 405)) {
      const file = config().head?.file ?? 'the head settings file';
      return show(note(`Not on this server yet: it offers no way to change these settings. Edit ${file} in the site instead.`));
    }
    show(note(`The settings did not load: ${(err as Error).message}`));
  });
  return { update: () => part?.update() };
}
