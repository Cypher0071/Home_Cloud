/**
 * In-process recursive file search.
 *
 * Replaces the old `fdfind | fzf` pipeline, which failed whenever either binary was missing
 * (the installer installs neither, and `fd` is called `fdfind` only on Debian/Ubuntu).
 *
 * The walk is breadth-first from the requested directory, so shallow matches are found first.
 * It never follows symlinks (no loops, no escaping the starting tree), skips hidden entries
 * and `node_modules` like `fd` does by default, never enters /proc, /sys or /dev, and stops at
 * a depth, entry, and time budget so a search from `/` cannot hang the agent.
 */

const fs = require("fs/promises");
const path = require("path");
const { isVirtualFs } = require("../paths");

const DEFAULTS = Object.freeze({
	maxResults: 50,
	maxDepth: 12,
	maxEntries: 200000,
	timeBudgetMs: 4000,
});

const SKIP_DIRS = new Set(["node_modules"]);

/**
 * Scores how well one query term matches an entry. Higher is better; 0 means no match.
 * Matches on the file name rank above matches that only hit a parent folder, and
 * contiguous matches rank above scattered (subsequence) ones.
 */
function scoreTerm(term, nameLower, relLower) {
	if (nameLower === term) return 1000;
	if (nameLower.startsWith(term)) return 800 - Math.min(nameLower.length, 200);
	const inName = nameLower.indexOf(term);
	if (inName !== -1) return 600 - Math.min(inName, 200);
	if (relLower.includes(term)) return 300;
	const gaps = subsequenceGaps(term, nameLower);
	if (gaps !== -1) return Math.max(1, 200 - gaps * 5);
	return 0;
}

/** Returns the number of skipped characters if `needle` is a subsequence of `hay`, else -1. */
function subsequenceGaps(needle, hay) {
	let i = 0;
	let gaps = 0;
	let started = false;
	for (let j = 0; j < hay.length && i < needle.length; j++) {
		if (hay[j] === needle[i]) {
			i++;
			started = true;
		} else if (started) {
			gaps++;
		}
	}
	return i === needle.length ? gaps : -1;
}

/** Scores an entry against every whitespace-separated term; all terms must match. */
function scoreEntry(terms, name, relPath) {
	const nameLower = name.toLowerCase();
	const relLower = relPath.toLowerCase();
	let total = 0;
	for (const term of terms) {
		const s = scoreTerm(term, nameLower, relLower);
		if (s === 0) return 0;
		total += s;
	}
	return total;
}

function parseTerms(query) {
	return String(query || "")
		.toLowerCase()
		.split(/\s+/)
		.map((t) => t.trim())
		.filter(Boolean);
}

/**
 * Walks `rootDir` and returns the best matches for `query`.
 *
 * @param {string} rootDir canonical, already scope-checked directory
 * @param {string} query
 * @param {object} [options]
 * @param {() => boolean} [options.isAborted] stop early when the client goes away
 * @returns {Promise<{ matches: Array<{ abs: string, name: string, isDirectory: boolean, score: number, depth: number }>, truncated: boolean }>}
 */
async function searchFiles(rootDir, query, options = {}) {
	const opts = { ...DEFAULTS, ...options };
	const terms = parseTerms(query);
	if (terms.length === 0) return { matches: [], truncated: false };

	const wantsHidden = terms.some((t) => t.startsWith("."));
	const deadline = Date.now() + opts.timeBudgetMs;
	const isAborted = typeof opts.isAborted === "function" ? opts.isAborted : () => false;

	const matches = [];
	let truncated = false;
	let scanned = 0;
	let queue = [{ dir: rootDir, depth: 0 }];

	while (queue.length > 0) {
		const next = [];
		for (const { dir, depth } of queue) {
			if (isAborted()) return { matches: [], truncated: true };
			if (Date.now() > deadline || scanned >= opts.maxEntries) {
				truncated = true;
				break;
			}

			let handle;
			try {
				handle = await fs.opendir(dir);
			} catch {
				continue; // unreadable (EACCES), vanished, or not a directory
			}

			try {
				for await (const entry of handle) {
					scanned++;
					if (scanned >= opts.maxEntries) {
						truncated = true;
						break;
					}
					const name = entry.name;
					if (!wantsHidden && name.startsWith(".")) continue;
					if (entry.isSymbolicLink()) continue;

					const abs = path.join(dir, name);
					if (isVirtualFs(abs)) continue;
					const isDirectory = entry.isDirectory();

					const rel = path.relative(rootDir, abs);
					const score = scoreEntry(terms, name, rel);
					if (score > 0) {
						matches.push({ abs, name, isDirectory, score, depth: depth + 1 });
					}

					if (isDirectory && !SKIP_DIRS.has(name) && depth + 1 < opts.maxDepth) {
						next.push({ dir: abs, depth: depth + 1 });
					}
				}
			} catch {
				// A directory can disappear mid-read; keep what we have.
			}
		}
		if (truncated) break;
		queue = next;
	}

	matches.sort((a, b) => b.score - a.score || a.depth - b.depth || a.abs.localeCompare(b.abs));
	if (matches.length > opts.maxResults) truncated = true;
	return { matches: matches.slice(0, opts.maxResults), truncated };
}

module.exports = { searchFiles, scoreEntry, parseTerms, subsequenceGaps, DEFAULTS };
