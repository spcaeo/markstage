// The Inbox (#/inbox): the site's form messages and Markstage's alerts in one list (list.ts, item.ts). It talks to
// the Markstage server only, and uses the admin screens' parts (../admin/ui), so it is part of the build with them.
import { registerScreen } from '../host';
import '../styles/inbox.css';
import { mountInbox } from './list';

registerScreen({ name: 'inbox', label: 'Messages', icon: 'mail', nav: 'main', group: 'visitors', menuLabel: 'Messages', roles: ['owner', 'administrator', 'editor'], mount: mountInbox });
