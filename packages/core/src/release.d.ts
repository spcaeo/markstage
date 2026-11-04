export interface ReleaseInfo {
  version: string;
  commit: string | null;
  build: number | null;
  builtAt: string | null;
  timeZone: string;
  /** "v0.2.0 · build 256 · Nov 2, 2026 8:49 AM EST" */
  line: string;
}
export function releaseInfo(opts: { dir: string; env?: Record<string, string | undefined> }): ReleaseInfo;
export function releaseLine(parts: { version: string; build?: number | null; builtAt?: string | null; timeZone?: string }): string;
export function releaseTime(iso: string, timeZone?: string): string | null;
