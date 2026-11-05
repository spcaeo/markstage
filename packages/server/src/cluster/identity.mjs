// Who a server process is, so another one can tell whether it still runs without trusting the wall clock
// (docs/SCALING.md, "Clock jumps and pauses"):
//
// - machine: the hostname, plus on Linux the pid namespace and the boot id. Two containers that share a hostname
//   (network_mode: host, or the same `hostname:`) have different pid namespaces, so one never reads the other's pid
//   as its own; a process from before a reboot has another boot id.
// - pid start: when the process with this pid started, as the system tells it (on Linux the start tick in
//   /proc/<pid>/stat, on macOS and the BSDs `ps -o lstart` in UTC). A pid that answers but started at another time is
//   a new process that got the old one's number.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

/** This process's machine: processes with the same one can see each other's pids. */
export function machineId() {
  const parts = [os.hostname()];
  try {
    parts.push(fs.readlinkSync('/proc/self/ns/pid'));
  } catch {
    // no /proc (macOS): the hostname alone
  }
  try {
    parts.push(`boot:${fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}`);
  } catch {
    // no boot id to read
  }
  return parts.join(' ');
}

/** Does a process with this pid run here? (EPERM: it runs, as another user.) */
export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/** When the process with this pid started, as a string to compare, or null when it is gone or cannot be told. */
export function pidStart(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === 'linux') {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      // the fields after the command name (which may hold spaces): field 22, the start time, is the 20th of them
      return `tick:${stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]}`;
    } catch {
      return null;
    }
  }
  if (process.platform === 'win32') return null;
  try {
    const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'], env: { PATH: '/bin:/usr/bin:/usr/sbin', TZ: 'UTC', LC_ALL: 'C' } });
    return out.trim().replace(/\s+/g, ' ') || null;
  } catch {
    return null;
  }
}
