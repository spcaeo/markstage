// Site settings (#/settings/<part>): what an owner or administrator sets for the whole site, a part at a time (Locks,
// Alerts, the promotion rules at #/settings/environments/rules, the custom roles at #/settings/roles), with the parts
// as links at the top. Tokens
// (#/settings/tokens) are each person's own, so everyone signed in reaches that part. My alerts (#/my-alerts) is each
// person's own; the shell imports this file with the admin screens.
import { registerScreen, type ScreenCtx } from '../host';
import '../styles/site-settings.css';
import { mountRules } from '../environments/rules';
import { mountTokens } from '../environments/tokens';
import { mountRoles } from '../roles';
import { viewerRole } from '../runtime';
import { mountAlerts } from './alerts';
import { mountLocks } from './locks';
import { mountMyAlerts } from './my-alerts';

const MANAGERS = ['owner', 'administrator'];
const PARTS: Record<string, { title: string; href?: string; everyone?: boolean; mount: (el: HTMLElement, ctx: ScreenCtx) => { update(c: ScreenCtx): void } }> = {
  locks: { title: 'Locks', mount: mountLocks },
  alerts: { title: 'Alerts', mount: mountAlerts },
  environments: { title: 'Promotion rules', href: '#/settings/environments/rules', mount: mountRules },
  roles: { title: 'Roles', mount: mountRoles },
  tokens: { title: 'Tokens', everyone: true, mount: mountTokens },
};

registerScreen({
  name: 'settings',
  label: 'Site settings',
  icon: 'sliders',
  nav: 'admin',
  group: 'site',
  menuLabel: 'Site settings',
  roles: MANAGERS,
  mount(el, ctx) {
    const manager = MANAGERS.includes(viewerRole());
    const allowed = Object.keys(PARTS).filter((k) => manager || PARTS[k]!.everyone);
    const asked = ctx.args[0] ?? '';
    const part = PARTS[asked] ? asked : allowed[0]!;
    el.classList.add('ms-site-settings');
    // a link opened by someone whose role can't change these says so plainly
    if (!allowed.includes(part)) {
      ctx.setTitle('Not available · Site settings');
      const p = Object.assign(document.createElement('p'), { className: 'ms-locks__note', textContent: 'Not available to you: only an owner or an administrator sets these. Your own alerts are in My alerts, and your tokens (command line and AI assistant) in Tokens (your menu).' });
      el.replaceChildren(p);
      return { destroy: () => el.replaceChildren() };
    }
    ctx.setTitle(`${PARTS[part]!.title} · Site settings`);
    const tabs = document.createElement('nav');
    tabs.className = 'ms-site-settings__parts';
    tabs.setAttribute('aria-label', 'Site settings');
    for (const key of allowed) {
      const { title, href } = PARTS[key]!;
      const a = Object.assign(document.createElement('a'), { href: href ?? `#/settings/${key}`, textContent: title });
      if (key === part) a.setAttribute('aria-current', 'page');
      tabs.append(a);
    }
    const body = document.createElement('div');
    el.replaceChildren(tabs, body);
    const shown = PARTS[part]!.mount(body, ctx);
    return { update: (c) => shown.update(c), destroy: () => el.replaceChildren() };
  },
});

registerScreen({ name: 'my-alerts', label: 'My alerts', icon: 'bell', nav: null, mount: mountMyAlerts });
