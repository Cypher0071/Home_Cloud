import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

// Isolate test environment
const testTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'home-cloud-auth-test-'));
process.env.HOME = testTmpDir;
process.env.XDG_CONFIG_HOME = path.join(testTmpDir, '.config');
process.env.HOME_CLOUD_CONFIG_DIR = path.join(testTmpDir, '.config', 'home-cloud');
process.env.AGENT_ENV_FILE = path.join(testTmpDir, '.env');
process.env.CF_CONFIG = path.join(testTmpDir, '.cloudflared', 'config.yml');
process.env.BASE_DIR = testTmpDir;

const require = createRequire(import.meta.url);
const authRouter = require('../routes/auth.js');

const {
    constantTimeCompare,
    checkLoginRateLimit,
    recordFailedLogin,
    recordSuccessfulLogin,
    getClientIp,
    _resetRateLimiter,
    _getAttemptsMap,
} = authRouter;

try {
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

    // Header spoofing tests:
    const spoofedReq = {
        socket: { remoteAddress: '203.0.113.10' },
        headers: { 'cf-connecting-ip': '198.51.100.9', 'x-forwarded-for': '203.0.113.99' },
    };
    assert.equal(getClientIp(spoofedReq), '203.0.113.10', 'Direct peers must not trust forwarding headers');

    const loopbackReq = {
        socket: { remoteAddress: '127.0.0.1' },
        headers: { 'cf-connecting-ip': '203.0.113.77' },
    };
    assert.equal(getClientIp(loopbackReq), '203.0.113.77', 'Loopback peers may use CF-Connecting-IP');

    // Two requests from the same direct TCP peer share one counter even if forwarding headers differ
    _resetRateLimiter();
    const peerReq1 = {
        socket: { remoteAddress: '198.51.100.50' },
        headers: { 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '9.9.9.9' },
    };
    const peerReq2 = {
        socket: { remoteAddress: '198.51.100.50' },
        headers: { 'cf-connecting-ip': '2.2.2.2', 'x-forwarded-for': '8.8.8.8' },
    };
    const ip1 = getClientIp(peerReq1);
    const ip2 = getClientIp(peerReq2);
    assert.equal(ip1, ip2, 'IPs must match socket address');
    recordFailedLogin(ip1);
    const fail2 = recordFailedLogin(ip2);
    assert.equal(fail2.remainingAttempts, 3, 'Both requests share one counter on the TCP peer address');

    // Limiter state cap test
    _resetRateLimiter();
    const map = _getAttemptsMap();
    for (let i = 0; i < 10050; i++) {
        recordFailedLogin(`10.0.${Math.floor(i / 256)}.${i % 256}`);
    }
    assert.ok(map.size <= 10000, `Limiter map size must be capped at 10000, got ${map.size}`);

    console.log('✅ Rate limiter & brute-force protection tests passed!');
    console.log('🎉 All authentication security tests completed successfully.');
} finally {
    try {
        fs.rmSync(testTmpDir, { recursive: true, force: true });
    } catch (_) {}
}
