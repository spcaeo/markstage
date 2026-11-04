// The Groups screen (#/groups/<collection>): the entries a site sorts into groups (topic clusters), each group in
// its page's order (screen.ts). In the navigation only when the site's config has `groups`, named as the site calls them.
import { registerScreen } from '../host';
import '../styles/groups.css';
import { grouped, mountGroups } from './screen';

registerScreen({
  name: 'groups',
  get label() {
    return grouped()[0]?.groups.label ?? 'Groups';
  },
  icon: 'sections',
  get nav() {
    return grouped().length ? ('main' as const) : null;
  },
  roles: ['owner', 'administrator', 'editor'],
  mount: mountGroups,
});
