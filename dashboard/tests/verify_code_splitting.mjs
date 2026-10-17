import assert from 'node:assert/strict';
import { isChunkLoadError, retryDynamicImport } from '../src/utils/dynamicImport.ts';
import { getLazyWindowApp, preloadWindowApp } from '../src/utils/windowAppRegistry.ts';

console.log('--- Running Code-Splitting Verification Tests ---');

// ─── 1. Test isChunkLoadError across all browsers & error formats ───
console.log('[Test 1] isChunkLoadError: Cross-Browser & Format Coverage');

const positiveCases = [
  // Chrome / Chromium
  new Error('Failed to fetch dynamically imported module: https://homecloud.app/assets/desktop-Do1ca_GI.js'),
  new Error('net::ERR_INTERNET_DISCONNECTED'),
  new Error('net::ERR_CONNECTION_REFUSED'),
  new Error('net::ERR_NAME_NOT_RESOLVED'),
  // Safari / WebKit
  new TypeError('Load failed'),
  new TypeError('Module specifier was not loaded: Load failed'),
  new Error('Importing a module script failed.'),
  // Firefox
  new TypeError('NetworkError when attempting to fetch resource.'),
  new Error('error loading dynamically imported module'),
  new Error('failed to load module script'),
  // Standard Fetch / CSS / Webpack Chunk errors
  new TypeError('Failed to fetch'),
  new Error('Unable to preload CSS for /assets/desktop.css'),
  new Error('Loading chunk 12 failed'),
  new Error('ChunkLoadError: Loading chunk 4 (timeout) failed.'),
  // Plain objects & strings
  'Failed to fetch dynamically imported module',
  'TypeError: Load failed',
  { message: 'failed to fetch dynamically imported module' },
  { message: 'Load failed', name: 'TypeError' },
  { message: 'NetworkError when attempting to fetch resource.', name: 'TypeError' },
];

for (const err of positiveCases) {
  assert.equal(isChunkLoadError(err), true, `Expected isChunkLoadError to be true for: ${err?.message ?? err}`);
}

const negativeCases = [
  new TypeError("Cannot read properties of undefined (reading 'map')"),
  new ReferenceError('foo is not defined'),
  new SyntaxError("Unexpected token '<'"),
  new Error('500 Internal Server Error'),
  new Error('Unauthorized access: Invalid token'),
  'Normal string error message',
  '',
  null,
  undefined,
  0,
  {},
  { message: 'Generic application error' },
];

for (const err of negativeCases) {
  assert.equal(isChunkLoadError(err), false, `Expected isChunkLoadError to be false for: ${err?.message ?? err}`);
}
console.log('  ✔ All 19 positive cases & 12 negative cases passed.');

// ─── 2. Test retryDynamicImport ───
console.log('[Test 2] retryDynamicImport: Exponential Backoff & Retry Exhaustion');

// Case A: Immediate success
{
  let attempts = 0;
  const result = await retryDynamicImport(async () => {
    attempts++;
    return 'success-immediate';
  });
  assert.equal(result, 'success-immediate');
  assert.equal(attempts, 1);
}

// Case B: Success on 1st retry (2 attempts total)
{
  let attempts = 0;
  const start = Date.now();
  const result = await retryDynamicImport(async () => {
    attempts++;
    if (attempts < 2) throw new Error('Transient network timeout');
    return 'success-retry-1';
  }, 2, 50); // fast interval for test
  const elapsed = Date.now() - start;
  assert.equal(result, 'success-retry-1');
  assert.equal(attempts, 2);
  assert.ok(elapsed >= 40, `Expected backoff delay of at least 40ms, got ${elapsed}ms`);
}

// Case C: Success on 2nd retry (3 attempts total)
{
  let attempts = 0;
  const start = Date.now();
  const result = await retryDynamicImport(async () => {
    attempts++;
    if (attempts < 3) throw new Error('Transient network timeout');
    return 'success-retry-2';
  }, 2, 30);
  const elapsed = Date.now() - start;
  assert.equal(result, 'success-retry-2');
  assert.equal(attempts, 3);
  // 30ms + 60ms = 90ms total minimum delay
  assert.ok(elapsed >= 75, `Expected backoff delay of at least 75ms, got ${elapsed}ms`);
}

// Case D: Retries exhausted throws final error
{
  let attempts = 0;
  let caughtError = null;
  try {
    await retryDynamicImport(async () => {
      attempts++;
      throw new Error(`Persistent failure ${attempts}`);
    }, 2, 20);
  } catch (err) {
    caughtError = err;
  }
  assert.ok(caughtError instanceof Error);
  assert.equal(caughtError.message, 'Persistent failure 3');
  assert.equal(attempts, 3); // 1 initial + 2 retries
}

// Case E: retriesLeft = 0 throws immediately
{
  let attempts = 0;
  try {
    await retryDynamicImport(async () => {
      attempts++;
      throw new Error('Immediate failure');
    }, 0, 100);
  } catch (err) {
    assert.equal(err.message, 'Immediate failure');
  }
  assert.equal(attempts, 1);
}
console.log('  ✔ Immediate success, retry success with backoff, and exhaustion verified.');

// ─── 3. Test windowAppRegistry ───
console.log('[Test 3] windowAppRegistry: App Caching & Cache-Busting');

const registeredApps = ['metrics', 'files', 'terminal', 'docker', 'docker-console', 'settings'];

for (const appId of registeredApps) {
  // Test cache identity for same version
  const comp1 = getLazyWindowApp(appId, 0);
  const comp2 = getLazyWindowApp(appId, 0);
  assert.equal(comp1, comp2, `Expected identical cached lazy component instance for ${appId}@0`);

  // Test cache busting on incremented retry version
  const compVersion1 = getLazyWindowApp(appId, 1);
  assert.notEqual(comp1, compVersion1, `Expected new lazy component instance for ${appId}@1`);

  const compVersion2 = getLazyWindowApp(appId, 2);
  assert.notEqual(compVersion1, compVersion2, `Expected new lazy component instance for ${appId}@2`);
}

// Test unknown app ID throws
assert.throws(
  () => getLazyWindowApp('invalid-app-id'),
  /Unknown window app ID: "invalid-app-id"/
);

// Test preloadWindowApp
{
  const p1 = preloadWindowApp('metrics');
  assert.ok(p1 instanceof Promise);

  const p2 = preloadWindowApp('nonexistent-app');
  assert.ok(p2 instanceof Promise);
  const res = await p2;
  assert.equal(res, undefined);
}
console.log('  ✔ App caching, cache-busting per retryVersion, and preloading verified.');

console.log('--- ALL AUTOMATED VERIFICATION TESTS PASSED SUCCESSFULLY ---');
