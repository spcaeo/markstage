// #/snippets is the Library now (reusable/): an old link (a bookmark, a note) lands on its snippets, with what it
// searched for and the snippet it had open (ids are kept: the server moved the snippets into the Library as they were).
import { registerScreen } from '../host';

registerScreen({
  name: 'snippets',
  label: 'Snippets',
  icon: 'duplicate',
  nav: null,
  mount: (_el, ctx) => {
    const was = ctx.params();
    const q = new URLSearchParams({ kind: 'snippet' });
    for (const k of ['q', 'open']) if (was.get(k)) q.set(k, was.get(k)!);
    ctx.open(`#/library?${q}`, false);
  },
});
