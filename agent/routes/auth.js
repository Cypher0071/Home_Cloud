const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const express = require('express');
const router = express.Router();
const { COOKIE_SECURE } = require('../config');

function buildCookieOptions(req) {
    const forwarded = req.headers && req.headers['x-forwarded-proto'];
    const proto = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '';
    const isHttps = Boolean(req.secure || proto === 'https');
    return {
        httpOnly: true,
        secure: isHttps && COOKIE_SECURE,
        sameSite: 'lax',
        path: '/',
    };
}

function clearAuthCookie(res, req) {
    res.clearCookie('token', buildCookieOptions(req));
}
const preferences = require('../services/preferences');
const authMiddleware = require('../middleware/auth');

// Rate limiting configuration
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60 * 1000; // 1 minute
const LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes

// In-memory rate limiting store: IP -> { count, firstAttempt, lockedUntil }
const loginAttempts = new Map();

// Periodic cleanup of expired records every 5 minutes to prevent memory leaks
const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of loginAttempts.entries()) {
        const isLockExpired = !record.lockedUntil || record.lockedUntil <= now;
        const isWindowExpired = now - record.firstAttempt > WINDOW_MS;
        if (isLockExpired && isWindowExpired) {
            loginAttempts.delete(ip);
        }
    }
}, 5 * 60 * 1000);
if (cleanupTimer.unref) {
    cleanupTimer.unref();
}

/**
 * Extracts client IP from reverse proxy headers (Cloudflare, nginx) or direct socket.
 */
function normalizePeerAddress(address) {
    if (!address || typeof address !== 'string') return '';
    return address.replace(/^::ffff:/, '');
}

function isLoopbackAddress(address) {
    const normalized = normalizePeerAddress(address);
    return normalized === '127.0.0.1' || normalized === '::1';
}

function getClientIp(req) {
    const peer = req.socket?.remoteAddress || req.ip || '';
    if (isLoopbackAddress(peer)) {
        const cfIp = req.headers && req.headers['cf-connecting-ip'];
        if (typeof cfIp === 'string' && cfIp.trim()) {
            return cfIp.trim();
        }
    }
    return normalizePeerAddress(peer) || 'unknown';
}

const MAX_TRACKED_IPS = 10000;

function rememberAttempt(ip, record) {
    if (!loginAttempts.has(ip) && loginAttempts.size >= MAX_TRACKED_IPS) {
        const oldest = loginAttempts.keys().next().value;
        if (oldest !== undefined) loginAttempts.delete(oldest);
    }
    loginAttempts.set(ip, record);
}

/**
 * Compares two strings in constant time to prevent timing attacks.
 * Pre-hashes inputs using SHA-256 so buffers are always 32 bytes, preventing
 * buffer length mismatch exceptions and variable-length timing leaks.
 */
function constantTimeCompare(expected, actual) {
    if (typeof expected !== 'string' || typeof actual !== 'string') {
        return false;
    }
    const hashExpected = crypto.createHash('sha256').update(expected).digest();
    const hashActual = crypto.createHash('sha256').update(actual).digest();
    return crypto.timingSafeEqual(hashExpected, hashActual);
}

/**
 * Checks whether an IP is currently blocked by rate limiting.
 */
function checkLoginRateLimit(ip) {
    const now = Date.now();
    const record = loginAttempts.get(ip);
    if (!record) {
        return { allowed: true };
    }

    if (record.lockedUntil && record.lockedUntil > now) {
        const retryAfterSeconds = Math.ceil((record.lockedUntil - now) / 1000);
        return {
            allowed: false,
            retryAfterSeconds,
        };
    }

    if (now - record.firstAttempt > WINDOW_MS) {
        loginAttempts.delete(ip);
        return { allowed: true };
    }

    return { allowed: true };
}

/**
 * Records a failed login attempt and applies temporary lockout if threshold exceeded.
 */
function recordFailedLogin(ip) {
    const now = Date.now();
    let record = loginAttempts.get(ip);

    if (!record || (now - record.firstAttempt > WINDOW_MS && !record.lockedUntil)) {
        record = { count: 1, firstAttempt: now, lockedUntil: 0 };
        rememberAttempt(ip, record);
    } else {
        record.count += 1;
    }

    if (record.count >= MAX_ATTEMPTS) {
        record.lockedUntil = now + LOCKOUT_MS;
    }

    const retryAfterSeconds = record.lockedUntil ? Math.ceil((record.lockedUntil - now) / 1000) : 0;
    return {
        locked: record.count >= MAX_ATTEMPTS,
        remainingAttempts: Math.max(0, MAX_ATTEMPTS - record.count),
        retryAfterSeconds,
    };
}

/**
 * Clears failed attempts for an IP upon successful authentication.
 */
function recordSuccessfulLogin(ip) {
    loginAttempts.delete(ip);
}

router.post('/login', (req, res) => {
    const clientIp = getClientIp(req);
    const rateCheck = checkLoginRateLimit(clientIp);

    if (!rateCheck.allowed) {
        res.set('Retry-After', String(rateCheck.retryAfterSeconds));
        return res.status(429).json({
            error: `Too many failed login attempts. Please try again in ${rateCheck.retryAfterSeconds} seconds.`,
            retryAfter: rateCheck.retryAfterSeconds,
        });
    }

    const suppliedPassword = req.body && typeof req.body.password === 'string' ? req.body.password : '';
    const configuredPassword = process.env.PASSWORD || '';

    const isMatch = configuredPassword.length > 0 && constantTimeCompare(configuredPassword, suppliedPassword);

    if (isMatch) {
        recordSuccessfulLogin(clientIp);
        const token = jwt.sign(
            { authorized: true, epoch: preferences.getSessionEpoch() },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        res.cookie('token', token, buildCookieOptions(req));
        return res.json({ success: true });
    } else {
        const failStatus = recordFailedLogin(clientIp);
        if (failStatus.locked) {
            res.set('Retry-After', String(failStatus.retryAfterSeconds));
            return res.status(429).json({
                error: `Too many failed login attempts. Account temporarily locked for ${Math.ceil(LOCKOUT_MS / 60000)} minutes.`,
                retryAfter: failStatus.retryAfterSeconds,
            });
        }
        return res.status(401).json({ error: 'Invalid password' });
    }
});

router.post('/logout', authMiddleware, (req, res) => {
    const newEpoch = preferences.incrementSessionEpoch();
    clearAuthCookie(res, req);
    res.json({
        success: true,
        message: 'All active sessions revoked',
        sessionEpoch: newEpoch,
    });
});

router.post('/logout-all', authMiddleware, (req, res) => {
    const newEpoch = preferences.incrementSessionEpoch();
    clearAuthCookie(res, req);
    res.json({
        success: true,
        message: 'All active sessions revoked',
        sessionEpoch: newEpoch,
    });
});

router.get('/me', (req, res) => {
    const token = req.cookies && req.cookies.token;
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    jwt.verify(token, process.env.JWT_SECRET, (err, decodedtoken) => {
        if (err) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        if (!decodedtoken || decodedtoken.epoch !== preferences.getSessionEpoch()) {
            return res.status(401).json({ error: 'Session has been revoked' });
        }
        res.json({ authorized: true, user: decodedtoken });
    });
});

router.constantTimeCompare = constantTimeCompare;
router.checkLoginRateLimit = checkLoginRateLimit;
router.recordFailedLogin = recordFailedLogin;
router.recordSuccessfulLogin = recordSuccessfulLogin;
router.getClientIp = getClientIp;
router.isLoopbackAddress = isLoopbackAddress;
router.buildCookieOptions = buildCookieOptions;
router.clearAuthCookie = clearAuthCookie;
router._resetRateLimiter = () => loginAttempts.clear();
router._getAttemptsMap = () => loginAttempts;

module.exports = router;
