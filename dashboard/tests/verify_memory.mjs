import assert from 'node:assert/strict';
import { memCache, memInUse } from '../src/utils/memory.ts';

console.log('--- Running Memory Usage Tests ---');
const MB = 1024 ** 2;
// The bug report (user's server): 7.2 GB box, 6.4 GB "used" (incl. cache), 6.4 GB available, 762 MB free.
const mem = { total: 7373 * MB, used: 6611 * MB, free: 762 * MB, available: 6554 * MB, active: 819 * MB };
assert.equal(memInUse(mem), 819 * MB, 'in use excludes the disk cache');
assert.equal(memCache(mem), (7373 - 762 - 819) * MB, 'cache is what is neither in use nor free');
assert.equal(memInUse({ ...mem, active: undefined }), 819 * MB, 'falls back to total - available');
assert.equal(memInUse({ total: 8, used: 5, free: 3 }), 5, 'last resort is used');
console.log('  ✔ in-use memory leaves out reclaimable cache');
console.log('All memory usage tests passed.');
