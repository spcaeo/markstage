// The place chip in the top bar (docs/ENVIRONMENTS.md, docs/EDITOR-UX.md section 2): on a server with environments
// set up it says where this copy is, in plain words (grey "On my computer", amber "Staging", green "Live site"), and
// links to #/environments; outside production a thin ribbon in the environment's colour runs across the top of the
// window, so nobody mistakes staging for the live site. In astro dev the chip says "On my computer" with the branch
// checked out, and links nowhere. A server with no `environment` in its config shows neither.
import { badgeWords } from './words';
import * as api from './api';

export async function mountEnvBadge(head: HTMLElement): Promise<void> {
  let info: api.EnvInfo | api.LocalEnv;
  try {
    info = await api.where();
  } catch {
    // an older server, or none: the header stays as it is
    return;
  }
  if (!info.configured) return;
  const w = badgeWords(info);
  const a = document.createElement(w.link ? 'a' : 'span');
  a.className = `ms-envbadge is-${w.tone}${info.production ? ' is-production' : ''}${w.link ? '' : ' is-local'}`;
  if (a instanceof HTMLAnchorElement) a.href = '#/environments';
  a.title = w.title;
  a.setAttribute('aria-label', w.aria);
  const name = document.createElement('strong');
  name.textContent = w.label;
  a.append(name);
  if (w.branch) {
    const branch = document.createElement('span');
    branch.className = 'ms-envbadge__branch';
    branch.textContent = w.branch;
    a.append(branch);
  }
  if (!('local' in info) && info.ribbon) document.documentElement.style.setProperty('--ms-env-ribbon', info.ribbon);
  if (head.classList.contains('ms-head__place')) head.append(a);
  else head.prepend(a);
  if (w.ribbon) {
    const ribbon = document.createElement('div');
    ribbon.className = 'ms-envribbon';
    ribbon.setAttribute('aria-hidden', 'true');
    document.body.append(ribbon);
  }
}
