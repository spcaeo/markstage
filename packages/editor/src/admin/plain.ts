// A notice for a writer, in plain words, with the technical detail kept for an administrator: on hover (the title),
// and, with `fold`, under a small "Details" fold. Screens that used to say "set backup.dir in the server config" say
// "Backups are not set up on this server yet. Ask whoever runs the server." and keep the key in the detail.
import { el } from './ui';

export function plain(text: string, detail: string | null, fold = false): HTMLElement {
  if (!detail) return el('span', text);
  if (!fold) return el('span.ms-adm-plain', { title: detail }, text);
  return el('details.ms-adm-fold', el('summary', text), el('p.ms-adm-sub', detail));
}
