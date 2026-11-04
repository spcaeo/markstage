// The admin screens (the server's part of the editor): the shell imports this file when the folder is in the build,
// and mounts a screen for #/<name>/<args…>?<params> (host.ts). `group` and `menuLabel` place each in the drawer with
// the word list's name (docs/EDITOR-UX.md section 3); a screen with nav and no group sits under More tools. Every screen keeps all of its state in that URL, so
// any view can be linked to, reloaded, and gone back from. The server decides what each role may do; `roles` only
// keeps the navigation tidy.
import { registerScreen } from '../host';
import './admin.css';
import './lists.css';
import './review.css';
import './find.css';
import { mountAccount } from './account';
import { mountAcceptInvite, mountSetup, mountSignIn } from './auth';
import { mountAudit } from './audit';
import { mountAuthors } from './authors/index';
import { mountLinks } from './links/index';
import { mountTopics } from './topics/index';
import { mountBulk } from './bulk';
import { mountEntries } from './entries';
import { mountMedia } from './media';
import { mountHealth } from './health';
import { mountJobs } from './jobs';
import { mountPublish } from './publish';
import { mountRedirects } from './redirects';
import { mountReplace } from './replace';
import { mountTaxonomy } from './taxonomy';
import { mountRevisions } from './revisions';
import { mountTrash } from './trash';
import { mountUsers } from './users';

const MANAGERS = ['owner', 'administrator'];
const EDITORS = ['owner', 'administrator', 'editor'];

registerScreen({ name: 'sign-in', label: 'Sign in', icon: 'eye', nav: null, public: true, mount: mountSignIn });
registerScreen({ name: 'setup', label: 'Set up', icon: 'settings', nav: null, public: true, mount: mountSetup });
registerScreen({ name: 'accept-invite', label: 'Set your password', icon: 'settings', nav: null, public: true, mount: mountAcceptInvite });
registerScreen({ name: 'account', label: 'Your account', icon: 'settings', nav: null, mount: mountAccount });
// every entry of a collection: filters, sort and page in the URL (next to the editor's own Content)
registerScreen({ name: 'entries', label: 'Pages', icon: 'table', nav: 'main', group: 'content', menuLabel: 'Pages', mount: mountEntries });
registerScreen({ name: 'media', label: 'Images & files', icon: 'image', nav: 'main', group: 'content', menuLabel: 'Images & files', mount: mountMedia });
registerScreen({ name: 'jobs', label: 'Scheduled & history', icon: 'clock', nav: 'main', group: 'publishing', menuLabel: 'Scheduled & history', mount: mountJobs });
registerScreen({ name: 'trash', label: 'Trash', icon: 'trash', nav: 'main', group: 'site', menuLabel: 'Trash', mount: mountTrash });
registerScreen({ name: 'redirects', label: 'Moved addresses', icon: 'link', nav: 'main', roles: EDITORS, menuLabel: 'Moved addresses', mount: mountRedirects });
registerScreen({ name: 'replace', label: 'Change many at once', icon: 'search', nav: 'main', roles: EDITORS, menuLabel: 'Change many at once', mount: mountReplace });
// under More tools, not in the drawer's groups: few top-level items (owner)
// every signed-in person may look; editors and above change them, anyone their own profile (the server decides)
registerScreen({ name: 'authors', label: 'Authors', icon: 'user', nav: null, group: 'tools', mount: mountAuthors });
// the site's topics and its internal links (docs/API-LINKS.md): everyone may look; editors and above change topics
registerScreen({ name: 'topic-map', label: 'Topic map', icon: 'layers', nav: null, group: 'tools', menuLabel: 'Topic map', mount: mountTopics });
registerScreen({ name: 'links', label: 'Links between pages', icon: 'link', nav: null, group: 'tools', menuLabel: 'Links between pages', mount: mountLinks });
registerScreen({ name: 'taxonomy', label: 'Categories and tags', icon: 'list', nav: null, group: 'tools', roles: EDITORS, mount: mountTaxonomy });
registerScreen({ name: 'users', label: 'People & access', icon: 'users', nav: 'admin', group: 'site', menuLabel: 'People & access', roles: MANAGERS, mount: mountUsers });
registerScreen({ name: 'health', label: 'Site check-up', icon: 'shield', nav: 'admin', group: 'site', menuLabel: 'Site check-up', roles: MANAGERS, mount: mountHealth });
registerScreen({ name: 'audit', label: 'Activity', icon: 'log', nav: 'admin', menuLabel: 'Activity', roles: MANAGERS, mount: mountAudit });
// opened from an entry (its Publish button and its History), not listed
registerScreen({ name: 'publish', label: 'Publish', icon: 'upload', nav: null, mount: mountPublish });
registerScreen({ name: 'revisions', label: 'History', icon: 'clock', nav: null, mount: mountRevisions });
// opened from a list's selection, or from Find and replace
registerScreen({ name: 'bulk', label: 'Change many entries', icon: 'list', nav: null, roles: EDITORS, mount: mountBulk });
