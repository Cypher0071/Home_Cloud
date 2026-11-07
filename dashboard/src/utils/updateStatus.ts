/**
 * The dashboard is served from disk, so right after an update it is the NEW build while the
 * agent process may still be the OLD code (an updater older than 1.3.0 could not restart
 * itself). Old agents return a cached `updateAvailable: true` next to the new on-disk version,
 * and they don't send `restartRequired` at all. Don't trust those fields blindly.
 */

export interface UpdateFlags {
  currentVersion?: string | null;
  latestVersion?: string | null;
  updateAvailable?: boolean;
  restartRequired?: boolean;
}

/** Compares "1.2.3" style versions (a leading "v" is ignored). Returns -1, 0 or 1. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.trim().replace(/^v/i, '').split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function normalizeUpdateStatus<T extends UpdateFlags>(status: T): T;
export function normalizeUpdateStatus<T extends UpdateFlags>(status: T | null | undefined): T | null;
export function normalizeUpdateStatus<T extends UpdateFlags>(status: T | null | undefined): T | null {
  if (!status) return null;
  const { currentVersion, latestVersion } = status;
  const updateAvailable =
    currentVersion && latestVersion
      ? compareVersions(latestVersion, currentVersion) > 0
      : Boolean(status.updateAvailable);
  // Agents from 1.3.0 on always send restartRequired. If it is missing, the process answering
  // is older than this dashboard build, which means it has not been restarted since the update.
  const restartRequired = typeof status.restartRequired === 'boolean' ? status.restartRequired : true;
  return { ...status, updateAvailable, restartRequired };
}
