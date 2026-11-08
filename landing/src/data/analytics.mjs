// Cloudflare Web Analytics: cookieless, no personal data, so no consent banner is needed.
// The token is public (it ships in every page). Automatic injection doesn't apply to sites
// served by a Worker, so the beacon is added by hand to the landing layout and the docs head.
export const CF_BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js';
export const CF_BEACON_DATA = JSON.stringify({ token: '0ff5beedb8df439b844be07a21fb1735' });
