# Several server processes on one data dir

Markstage may run as several `markstage-server serve` processes on one data dir, each on its own port, behind one
address. They behave as one server: a person may sign in on one, and their next request may land on another. This
page says what they share, how, and what is still limited. How to run them: [DEPLOY.md](DEPLOY.md), "Several server
processes". The proof: `packages/server/test/multi-process.test.mjs` (two real processes on one data dir),
`test/cluster.test.mjs` (the shared pieces) and `e2e/two-process.e2e.mjs` (signed in on one, editing on the other, in
a browser).

## How they share

- **The database.** Everything that must hold across processes is in the data dir's SQLite database
  (`markstage.db`, WAL mode, a 5 second busy wait). Every count that a limit checks is read and written in one write
  transaction (`BEGIN IMMEDIATE`), so two processes never both see "one left" and both take it.
- **Leases.** A lock with an owner, in the database (`leases`). Each process has a row in `server_processes` and a
  heartbeat (every sixth of `processes.leaseSeconds`: 5 seconds by default) that keeps it fresh. A lease is let go
  by its owner, or taken over by another process only once its owner has stopped (see "Clock jumps and pauses"): at
  once when the owner ran on the same machine and its pid is gone (a crash, `kill -9`), and for a process on another
  machine (another container) once its heartbeat stood still for a lease (30 seconds by default).
- **Fencing.** Work done under a lease checks the lease is still its process's before each step: each job step, each
  git write (the repo lock file still names it), each webhook send, and each AI ask of a site translation. When it is
  not (another process took over while this one was paused), the work stops there and says so: the job fails with
  "Another server process took this over while this one was paused, so the job stopped here.", the server log says
  which lease was lost.
- **The repo lock file.** Every write to the site repo (a save, a commit, a revert, a merge) holds
  `<data dir>/repo.lock`, made with an exclusive create (one process wins) and naming its owner: its process id, pid,
  when that pid started, and its machine. A lock left by a process that stopped is removed by the next process that
  wants it, judged by that pid and its start time (on another machine by its heartbeat), never by the file's age;
  the removal is decided inside the database's write transaction so two waiters never both remove it. Git's own
  optional locks are off for reads (`GIT_OPTIONAL_LOCKS=0`), so a `git status` on one process never trips a commit
  on another with `index.lock`.
- **The primary role.** One lease, `primary`, held by one `serve` process. Its holder runs what must run once for the
  whole server: the scheduler, scheduled releases, backups, alert digests, the webhook timer, integration refreshes,
  form alert retries, the hourly sweeps, the preview listener with its dev server, and the share-link listener (both
  on their fixed ports). When it stops, another process takes the role at its next heartbeat. The first process to
  start takes it; the rest serve the editor and the API.
- **Stopped work.** At a start with no other process running, the old restart rules apply as before (jobs failed,
  site translations paused). While others run, only the work of the process that stopped is marked: its jobs failed
  with "The server process running this job stopped.", its release builds and publishes, imports and branch previews
  failed, its site translation paused for anyone to resume, its in-flight AI asks and leases dropped.
- **Stepping down.** A process that is stopping lets its roles go and never takes one back, even when a heartbeat
  runs while a role is still stopping (its preview dev server exiting, a webhook send ending). Its heartbeat stops
  first when it closes, so nothing runs on its behalf against a closed database.
- **Floods.** A limit counts first and writes a try only when it lets it through, so a refused try costs no row. An
  IPv6 address counts as its /64 (one person usually holds a whole /64) for sign-in misses, wrong tokens and
  share-link tries. Tries whose window has passed are deleted at most a minute later, by the next process that
  writes one.

## Clock jumps and pauses

The wall clock is not trusted to say a process stopped. It jumps: an NTP step, a VM paused and resumed, a laptop
asleep, a process stopped with SIGSTOP for a while. Before, a jump of more than the lease made a live process look
stopped, and another one took its job, its primary role and its repo lock while it was still working. Now:

- **On the same machine** (the same hostname, and on Linux the same pid namespace and boot id), a process runs while
  its pid answers. Its row also keeps when that pid started (from `/proc/<pid>/stat` on Linux, `ps -o lstart` on
  macOS), so a new process that got the old pid is not taken for it. The heartbeat's age is only used to decide when
  to ask. A paused process keeps its leases and its lock however long it was silent; a hung one keeps them until it
  is stopped (systemd's `TimeoutStopSec` or a `kill`).
- **On another machine** (another container), a process runs while its heartbeat moves. Once a process has seen it,
  it times it with its own monotonic clock, which does not jump: it counts as stopped only when its heartbeat stood
  still for a lease by that clock and by the wall clock. At the first sight (just after a start) the heartbeat's age
  decides, as before.
- **Fencing** (above) covers what is left: a process on another machine that was paused for longer than the lease
  finds, when it wakes, that its lease or lock is someone else's, and stops before its next step.

The proof: `test/cluster.test.mjs` (clock jumps of 40 seconds and an hour, forward and back; a reused pid; another
pid namespace with the same hostname; fencing; stepping down) and `test/multi-process.test.mjs` (a real process
frozen with SIGSTOP for twice its lease keeps its primary role and its job, then finishes it).

## The audit: every piece of process memory in packages/server/src

Each item is one of three kinds: **(a)** must be shared, so it moved to the database or a lock; **(b)** a cache
each process keeps, safe when another process writes (the "why" says how); **(c)** harmless per process.

### (a) Moved: shared through the database or a lock (33)

| Where | What it held in memory | Now |
| --- | --- | --- |
| `jobs.mjs` | The one running job, and the queue's turn | Lease `jobs`: one job at a time across processes; a queued job waits for it. Each job row names its process (`owner`). |
| `jobs.mjs` | A running job's steps and log | Written to its row as it goes, at most a second behind, so `GET /jobs/:id` on any process shows it live. |
| `jobs.mjs` | The restart sweep (every queued or running job failed) | By owner: only the jobs of a process that stopped. |
| `app.mjs` (`repoLock`) | The repo's one-at-a-time queue | The same queue in each process, plus the repo lock file across processes. |
| `content/git.mjs` | Git writes outside the repo lock (`index.lock` races) | Every write subcommand holds the repo lock file; `fetch` holds lease `git.fetch`. |
| `util.mjs` (`createBusyLock`), `import/` | "An import is running" | Lease `import`; starting a planned run is one `UPDATE … WHERE status = 'planned'` (two starts: one runs, one gets 409). |
| `import/index.mjs` | (no restart rule before) | A running import whose process stopped is failed. |
| `releases/builds.mjs` | The restart sweep of release builds | By owner (the build's job). |
| `releases/publish.mjs` | The restart sweep of release publishes | By owner (the publish's job). |
| `env/site.mjs` | (no restart rule before) | A branch preview being built whose process stopped is failed. |
| `translate/` | The running site translation, its busy check, Pause and Cancel, its progress | Claimed in one write transaction (one run at a time); its row names its process; Pause or Cancel asked on another process is written on the row (`stop_asked`) and read between two asks and during a wait; where it is (`live`: drafts not committed, a wait) is on the row for the others to show. |
| `translate/index.mjs` | The restart pause | By owner: a run whose process stopped is paused, to resume on any process. |
| `auth/limiter.mjs` | Sign-in misses per address | `limit_hits` bucket `login.ip`, same window and limit. |
| `releases/share.mjs` | Share-link tries per address (30 a minute) | Bucket `share.try`, counted first: the 31st is 429 (not stored) and audited once, as before; an IPv6 address counts as its /64. |
| `env/tokens.mjs` | Wrong tokens per address (20 in 10 minutes) | Bucket `token.miss`. |
| `redirects/routes.mjs` | Live redirect tests per person a minute | Bucket `redirects.test`. |
| `mcp/index.mjs` | MCP calls and writes a minute, publishes an hour, "audited once a minute" | Buckets `mcp.call`, `mcp.write`, `mcp.publish`; a write counts as a call in the same transaction; "once" is a shared once. |
| `ai/index.mjs` | AI asks in flight; "audited once a minute" | The count (audit rows plus asks in flight) and the claim of one more are one transaction; in-flight asks are the process's and go with it. |
| `presence.mjs` | Who has an entry open, the edit lock, takeover notes | Tables `presence_tabs`, `presence_locks`, `presence_taken`; each heartbeat is one write transaction. |
| `preview/routes.mjs` | Unsaved states pushed by the editor | Table `preview_states` (bounded as before); the listener's process looks every second for a new state of the entry it shows, pushed or autosaved on any process. |
| `preview/gallery.mjs` | The section gallery's throwaway pages | Kept in the database (`kv`), read by the preview listener. |
| `media/stock.mjs` | Stock photo thumbnail tokens | Table `stock_thumbs` (the last 600, as before). |
| `forms/crm.mjs` | "Being sent to the CRM" per message | Lease `crm:<message>`. |
| `forms/leads.mjs` | "Being sent as a lead" per message | Lease `lead:<message>`. |
| `forms/submit.mjs` | "Held messages told once an hour" | A shared once per form. |
| `forms/submit.mjs` | (check, then store) per address, network, email and form | The day's and the hour's counts and the store are one write transaction. |
| `webhooks/deliver.mjs` | One send loop (an event may start it on any process) | Lease `webhooks.send`: one process sends at a time. |
| `app.mjs` and the timers | Every timer and both extra listeners | Run by the primary role only. |
| `protect.mjs` | Making the page cookie secret on first start | Made once (`INSERT … ON CONFLICT DO NOTHING`), then read: two first starts use one secret. |
| `library/items.mjs` | "The Library moved into the repo" (once) | Checked again under the repo lock. |
| `env/index.mjs` | The promotion rules file, parsed | Re-read when the file changes (inode, size, time); its version check and write hold the database's write lock. |
| `links/index.mjs` | The link inbox's skip-list version | In the database (`kv` `links.skipsRev`). |
| `db.mjs` | Migrations at start | Each step re-reads the version inside its write transaction (two first starts: each step once); switching to WAL is tried again for a few seconds. |

Also made atomic, though they held nothing in memory (a check, then a write, which two processes could interleave):
saving a custom role, the site's alert rules and a form's thank-you mail (the version check and the write in one
write transaction), running an environment plan (claimed only while it is still ready, at the version loaded), and
the manual refresh of an integration (compare and set on its last refresh time).

### (b) Kept per process: caches that stay right when another process writes (14)

| Where | The cache | Why it stays right |
| --- | --- | --- |
| `content/index.mjs` | The entries' list and summaries | Swept by file stat (size, time, inode); a save on another process changes them. |
| `content/store.mjs` | Parsed files | Keyed by the file's version (its content hash). |
| `links/map.mjs` | The link map and related pages | Keyed by the files' versions and the skip-list version (now shared). |
| `links/map.mjs` | The site's redirects, from its hook | A minute at most, as with one process. |
| `content/translations.mjs` | The git log per HEAD and each file's status | Keyed by the repo's HEAD and the files' versions. |
| `custom-roles/index.mjs` | Compiled roles | Keyed by the role's `rev` read from the database each time. |
| `integrations/index.mjs` | Parsed option lists | Keyed by the row's `fetched_at`. |
| `env/index.mjs` | Git facts of the status | 30 seconds, keyed by HEAD and branch. |
| `env/index.mjs` | Promotion rules | Keyed by the file's inode, size and time (made safe here). |
| `links/index.mjs` | The link inbox | Keyed by the shared skip-list version (made safe here). |
| `mcp/`, `ai/` | The secret scrubber's list | A short time to live; secrets come from the environment, the same in every process. |
| `auth/oidc.mjs` | The provider's discovery and keys | A time to live, as with one process. |
| `geo/` | The city database | Re-read when the file's stamp changes. |
| `preview/` | Dev paths, the shown state, the refresh timer | Only the primary's preview listener uses them. |

### (c) Harmless per process (13)

The version and commit read at start; the crash handler's "exiting" flag; the dummy password hash (for even sign-in
timing); the AI's spelling helper; the authors' pending writes (inside the repo lock only); the site config
description; the store's "held" view; the address checker's "running" guard; the release publisher's tick guard
(primary only); the integrations' "fetching now" dedupe (a second fetch on another process is the same fetch);
the preview's shown entry, refresh timer and written files (primary only); the mail and Library fetch timeouts;
and every per-request map.

## What is still limited

- **One machine.** All processes must run on one machine with the data dir on a local disk. SQLite's WAL mode does
  not work over a network file system, and the quick "its pid is gone" check only works for processes on the same
  machine. Several machines would need a database server; that is not built.
- **Docker.** Two containers on one volume are not tested. Run several processes with systemd on one host (the
  supported way, DEPLOY.md), or one container per data dir. Containers that share a hostname are told apart by their
  pid namespace (Linux), so one never reads the other's pids; they judge each other by the heartbeat.
- **Taking over takes a moment.** When the primary process stops cleanly, another takes the role at its next
  heartbeat (5 seconds by default, `processes.leaseSeconds` / 6); when it crashes on the same machine, the same. A
  process on the same machine that hangs, or is paused, without dying keeps its role until it is stopped (the role
  is never taken from a live process, so nothing runs twice); one in another container, after its heartbeat stood
  still for a lease (30 seconds by default). Meanwhile the preview and share hosts answer 502 from nginx, and the
  timers wait. The editor and the API go on, on the other processes.
- **A process on another machine that wakes from a long pause** stops its work at its next step (fencing), but a
  step already running when it froze (a build command, a webhook request in flight) ends as it would have.
- **A process that stops mid-job.** Its job is failed and must be run again; a job still queued in it is failed too
  (it is not handed to another process). A site command it had started (a build) is not stopped by its crash and
  runs to its end, so the next build may start while that one finishes; a clean stop (SIGTERM) waits for the job
  first, as before.
- **Turns, not order.** Jobs run one at a time across processes, each process's in the order it got them; between
  processes, whichever asks first when the lease frees goes next.
- **Small delays.** A running job's log on another process is at most a second behind; an unsaved change pushed to
  another process reaches the preview within a second; Pause or Cancel of a site translation asked on another process
  takes effect between two asks (the answer waits up to 30 seconds for it).
