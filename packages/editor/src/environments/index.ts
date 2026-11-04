// Environments (docs/ENVIRONMENTS.md): #/environments, this environment with its plans, branches and previews
// (overview.ts), and #/environments/plans/<id>, one plan's review (plan.ts). Every signed-in person may look; the
// promotion rules decide what each may do. The rules editor and the personal tokens are parts of Site settings
// (rules.ts, tokens.ts); the environment's badge in the header is badge.ts, which the shell mounts.
import { registerScreen } from '../host';
import '../styles/environments.css';
import { mountOverview } from './overview';
import { mountPlan } from './plan';

registerScreen({
  name: 'environments',
  label: 'Staging & live',
  icon: 'branch',
  nav: 'admin',
  menuLabel: 'Staging & live',
  mount(el, ctx) {
    if (ctx.args[0] === 'plans' && ctx.args[1]) return mountPlan(el, ctx, ctx.args[1]);
    return mountOverview(el, ctx);
  },
});
