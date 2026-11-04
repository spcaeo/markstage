// A crash the request pipeline cannot catch (a timer, a setImmediate, a promise nobody awaited) must not pass
// silently, and must not leave a half-working process: it is written to the log, then the process exits non-zero so
// the supervisor (systemd, Docker's restart policy) starts a fresh one. Running jobs are marked failed at the next
// start (jobs.mjs); nothing on the live site changes.

/** Install the handlers on `proc`; `log` and `exit` are seams for the test. */
export function watchCrashes(proc = process, { log = (...a) => console.error(...a), exit = (code) => proc.exit(code), name = 'markstage' } = {}) {
  let exiting = false;
  const die = (what, err) => {
    log(`[${name}] ${what}: ${err?.stack ?? err}`);
    if (exiting) return;
    exiting = true;
    log(`[${name}] exiting so the service manager can start a fresh process.`);
    exit(1);
  };
  proc.on('unhandledRejection', (err) => die('unhandled promise rejection', err));
  proc.on('uncaughtException', (err) => die('uncaught exception', err));
  return die;
}
