// Every kind of alert (docs/API-INBOX.md "Alerts"): its words for Settings → Alerts and My alerts, its group, whether it is a
// safety alert (it can never be turned off: no site rule stops it and nobody opts out of its mail), and who it reaches
// by default. Besides the roles here, an alert reaches the people it is about (who started the job, whose role
// changed, who signed in, who was given a message): `about` is the lowest role that can be such a person, so My
// alerts lists the kind for them. A personal one goes to no shared address (notify.email.to) unless the site adds one.
const ALL_STAFF = ['owner', 'administrator', 'editor'];
const ADMINS = ['owner', 'administrator'];

export const KINDS = [
  { kind: 'publish.failed', group: 'Publishing', label: 'A publish failed', roles: ADMINS, about: 'author' },
  { kind: 'deploy.failed', group: 'Publishing', label: 'A deploy to the host failed', roles: ADMINS, about: 'author' },
  { kind: 'backup.failed', group: 'Publishing', label: 'A backup failed', roles: ADMINS, safety: true },
  { kind: 'site.rollback', group: 'Publishing', label: 'The site was rolled back', roles: ALL_STAFF },
  { kind: 'schedule.held', group: 'Publishing', label: 'A scheduled entry is held back', roles: ALL_STAFF },
  { kind: 'schedule.released', group: 'Publishing', label: 'A held entry is going live', roles: ALL_STAFF },
  { kind: 'schedule.late', group: 'Publishing', label: 'A scheduled entry went live late', roles: ALL_STAFF },
  { kind: 'release.published', group: 'Publishing', label: 'A release went live or was rolled back', roles: ALL_STAFF, about: 'editor' },
  { kind: 'release.blocked', group: 'Publishing', label: 'A scheduled release is blocked at its time', roles: ALL_STAFF, about: 'editor' },
  { kind: 'webhook.failed', group: 'Publishing', label: 'A webhook could not deliver an event', roles: ADMINS },
  { kind: 'form.message', group: 'Forms', label: 'A new message from a site form', roles: ALL_STAFF },
  { kind: 'form.assigned', group: 'Forms', label: 'A message was given to you', roles: [], about: 'editor', personal: true },
  { kind: 'form.held', group: 'Forms', label: 'A form got more messages in an hour than its limit: new ones are held', roles: ADMINS },
  { kind: 'health.broken', group: 'Site health', label: 'Site health found a broken page or link', roles: ADMINS },
  { kind: 'integration.failed', group: 'Site health', label: 'An integration’s list of options could not be fetched', roles: ADMINS },
  { kind: 'lock.changed', group: 'Content', label: 'A lock changed', roles: ADMINS },
  { kind: 'user.invited', group: 'People', label: 'A user was invited', roles: ADMINS, safety: true },
  { kind: 'user.role', group: 'People', label: "A user's role changed, or their account was turned off", roles: ADMINS, safety: true, about: 'contributor' },
  { kind: 'roles.changed', group: 'People', label: 'A custom role was made, changed or removed', roles: ADMINS, safety: true },
  { kind: 'env.promoted', group: 'Environments', label: 'A promotion or sync went live', roles: ADMINS, about: 'contributor' },
  { kind: 'env.promote-failed', group: 'Environments', label: 'A promotion, sync or rollback failed', roles: ADMINS, about: 'contributor' },
  { kind: 'env.approval-needed', group: 'Environments', label: 'A promotion waits for an approval', roles: ADMINS },
  { kind: 'env.rules-changed', group: 'Environments', label: 'The promotion rules changed', roles: ADMINS, safety: true },
  { kind: 'signin.new-device', group: 'Security', label: 'A sign-in from a new device', roles: [], safety: true, personal: true, about: 'contributor' },
].map((k) => Object.freeze({ safety: false, personal: false, about: null, ...k }));

export const KIND = new Map(KINDS.map((k) => [k.kind, k]));
export const DELIVERIES = ['now', 'digest', 'editor'];
// the editor always shows what reaches a person; these are the ways out of it
export const CHANNELS = ['email', 'slack', 'webhook'];
