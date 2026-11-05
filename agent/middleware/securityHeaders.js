/**
 * Anti-framing and MIME security headers middleware.
 * Defends the root-equivalent dashboard from same-site sibling subdomain framing
 * and clickjacking attacks. 'self' (exact origin) still lets the dashboard frame its own
 * file previews (PDF iframe) while refusing every other origin, including siblings.
 */

module.exports = function securityHeaders(req, res, next) {
	res.setHeader("X-Frame-Options", "SAMEORIGIN");
	res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
	res.setHeader("X-Content-Type-Options", "nosniff");
	next();
};
