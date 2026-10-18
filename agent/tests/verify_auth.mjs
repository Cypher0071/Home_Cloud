import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const authRouter = require('../routes/auth.js');

const {
    constantTimeCompare,
    checkLoginRateLimit,
    recordFailedLogin,
    recordSuccessfulLogin,
    _resetRateLimiter,
} = authRouter;

console.log('🧪 Testing Constant-Time Password Comparison...');

// Test 1: Exact matches
assert.equal(constantTimeCompare('secretPassword123!', 'secretPassword123!'), true, 'Exact match should succeed');
assert.equal(constantTimeCompare('a', 'a'), true, 'Single char match should succeed');
assert.equal(constantTimeCompare('', ''), true, 'Empty strings should match');

// Test 2: Mismatches of same and different lengths
assert.equal(constantTimeCompare('secretPassword123!', 'secretPassword123?'), false, '1-character difference should fail');
assert.equal(constantTimeCompare('secretPassword123!', 'short'), false, 'Different length should fail');
assert.equal(constantTimeCompare('short', 'longerStringWithPrefix'), false, 'Different length should fail');
assert.equal(constantTimeCompare('secret', ''), false, 'Non-empty vs empty should fail');

// Test 3: Type safety and non-string guards
assert.equal(constantTimeCompare('secret', null), false, 'null actual should fail safely');
assert.equal(constantTimeCompare(null, 'secret'), false, 'null expected should fail safely');
assert.equal(constantTimeCompare(undefined, 'secret'), false, 'undefined expected should fail safely');
assert.equal(constantTimeCompare('secret', 12345), false, 'number actual should fail safely');
assert.equal(constantTimeCompare({}, {}), false, 'object inputs should fail safely');

console.log('✅ Constant-time comparison tests passed!');

console.log('🧪 Testing Rate Limiter & Brute-Force Lockout...');

_resetRateLimiter();
const testIp = '203.0.113.42';

// Initial state: Allowed
assert.equal(checkLoginRateLimit(testIp).allowed, true, 'Initial state should allow login');

// 4 consecutive failed attempts: Still allowed, remaining attempts decrement
for (let i = 1; i <= 4; i++) {
    const res = recordFailedLogin(testIp);
    assert.equal(res.locked, false, `Attempt ${i} should not lock`);
    assert.equal(res.remainingAttempts, 5 - i, `Remaining attempts should be ${5 - i}`);
    assert.equal(checkLoginRateLimit(testIp).allowed, true, `Rate limit check should allow after ${i} failures`);
}

// 5th failed attempt: Lockout triggered
const lockRes = recordFailedLogin(testIp);
assert.equal(lockRes.locked, true, '5th attempt must trigger lockout');
assert.equal(lockRes.remainingAttempts, 0, 'Remaining attempts must be 0');
assert.ok(lockRes.retryAfterSeconds > 0, 'Retry-After seconds must be positive');

// Subsequent check: Blocked with 429 Retry-After
const blockedCheck = checkLoginRateLimit(testIp);
assert.equal(blockedCheck.allowed, false, 'IP must be blocked');
assert.ok(blockedCheck.retryAfterSeconds > 0, 'Blocked check must return retryAfterSeconds');

// Isolated IP test: Another IP is NOT affected
const otherIp = '198.51.100.1';
assert.equal(checkLoginRateLimit(otherIp).allowed, true, 'Different IP should remain allowed');

// Successful login resets attempts for that IP
recordSuccessfulLogin(testIp);
assert.equal(checkLoginRateLimit(testIp).allowed, true, 'Resetting / successful login should clear rate limit');

console.log('✅ Rate limiter & brute-force protection tests passed!');
console.log('🎉 All authentication security tests completed successfully.');
