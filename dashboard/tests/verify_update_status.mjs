import assert from 'node:assert/strict';
import { compareVersions, normalizeUpdateStatus } from '../src/utils/updateStatus.ts';

console.log('--- Running Update Status Normalization Tests ---');

assert.equal(compareVersions('1.3.0', '1.3.0'), 0);
assert.equal(compareVersions('v1.3.1', '1.3.0'), 1);
assert.equal(compareVersions('1.2.9', '1.10.0'), -1);
console.log('  ✔ compareVersions orders versions numerically');

// What a pre-1.3.0 agent that never restarted returns after the files moved to 1.3.0:
// a cached updateAvailable from before the update, and no restartRequired field.
{
  const s = normalizeUpdateStatus({ currentVersion: '1.3.0', latestVersion: '1.3.0', updateAvailable: true });
  assert.equal(s.updateAvailable, false, 'equal versions are never an available update');
  assert.equal(s.restartRequired, true, 'an agent without restartRequired is older than this dashboard');
  console.log('  ✔ stale old-agent status shows Restart Required, not Update Available');
}

// A current agent is taken at its word for restartRequired, and a newer release still shows.
{
  const s = normalizeUpdateStatus({ currentVersion: '1.3.0', latestVersion: '1.4.0', updateAvailable: true, restartRequired: false });
  assert.equal(s.updateAvailable, true);
  assert.equal(s.restartRequired, false);
  const n = normalizeUpdateStatus({ currentVersion: '1.3.0', latestVersion: null, updateAvailable: false, restartRequired: false });
  assert.equal(n.updateAvailable, false, 'no latest version known yet');
  assert.equal(normalizeUpdateStatus(null), null);
  console.log('  ✔ current agent status passes through');
}

console.log('All update status tests passed.');
