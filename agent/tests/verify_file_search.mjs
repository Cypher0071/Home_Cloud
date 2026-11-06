import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fileSearch from "../services/fileSearch.js";

const { searchFiles, scoreEntry, parseTerms, subsequenceGaps } = fileSearch;

console.log("--- Running In-Process File Search Verification Tests ---");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hc-search-"));
const mk = (rel, content = "x") => {
	const abs = path.join(root, rel);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, content);
	return abs;
};

try {
	mk("docker-compose.yml");
	mk("projects/web/docker-compose.yml");
	mk("projects/web/README.md");
	mk("notes/compose-ideas.txt");
	mk("photos/2026/holiday.jpg");
	mk(".secret/compose.env");
	mk("node_modules/pkg/compose.js");
	fs.mkdirSync(path.join(root, "deep/a/b/c/d/e/f/g/h/i/j/k/l/m"), { recursive: true });
	mk("deep/a/b/c/d/e/f/g/h/i/j/k/l/m/compose-deep.yml");
	fs.symlinkSync(root, path.join(root, "loop"));

	console.log("[Test 1] Scoring helpers");
	assert.deepEqual(parseTerms("  Docker   Compose "), ["docker", "compose"]);
	assert.equal(subsequenceGaps("dcy", "docker-compose.yml"), 13);
	assert.equal(subsequenceGaps("zz", "docker"), -1);
	assert.ok(scoreEntry(["readme.md"], "README.md", "README.md") > scoreEntry(["readme"], "README.md", "README.md"));
	assert.equal(scoreEntry(["nothing"], "README.md", "x/README.md"), 0);
	console.log("  ✔ Exact > prefix, non-matches score 0, subsequence counts gaps.");

	console.log("[Test 2] Finds nested matches, shallow and exact first");
	const r = await searchFiles(root, "docker-compose");
	const rels = r.matches.map((m) => path.relative(root, m.abs));
	assert.equal(rels[0], "docker-compose.yml", "shallow exact-prefix match should rank first");
	assert.ok(rels.includes(path.join("projects", "web", "docker-compose.yml")));
	assert.equal(r.truncated, false);
	console.log("  ✔", rels.join(", "));

	console.log("[Test 3] Skips hidden entries, node_modules and symlinks; respects depth");
	const c = await searchFiles(root, "compose");
	const crels = c.matches.map((m) => path.relative(root, m.abs));
	assert.ok(!crels.some((p) => p.startsWith(".secret")), "hidden dirs skipped");
	assert.ok(!crels.some((p) => p.startsWith("node_modules")), "node_modules skipped");
	assert.ok(!crels.some((p) => p.startsWith("loop")), "symlinks not followed");
	assert.ok(!crels.some((p) => p.includes("compose-deep")), "depth limit applied");
	assert.ok(crels.includes(path.join("notes", "compose-ideas.txt")));
	const hidden = await searchFiles(root, ".secret");
	assert.ok(hidden.matches.some((m) => m.name === ".secret"), "dot query opts into hidden entries");
	console.log("  ✔ Hidden, node_modules, symlink loop and over-deep files excluded.");

	console.log("[Test 4] Multi-term queries must match every term");
	const m = await searchFiles(root, "web readme");
	assert.deepEqual(
		m.matches.map((x) => path.relative(root, x.abs)),
		[path.join("projects", "web", "README.md")],
	);
	console.log("  ✔ 'web readme' matches only projects/web/README.md.");

	console.log("[Test 5] Result and budget limits report truncation");
	const limited = await searchFiles(root, "o", { maxResults: 2 });
	assert.equal(limited.matches.length, 2);
	assert.equal(limited.truncated, true);
	const budget = await searchFiles(root, "compose", { maxEntries: 3 });
	assert.equal(budget.truncated, true);
	const aborted = await searchFiles(root, "compose", { isAborted: () => true });
	assert.deepEqual(aborted.matches, []);
	console.log("  ✔ maxResults, maxEntries and abort are honored.");

	console.log("[Test 6] Empty query returns nothing without walking");
	assert.deepEqual(await searchFiles(root, "   "), { matches: [], truncated: false });
	console.log("  ✔ Empty query short-circuits.");
} finally {
	fs.rmSync(root, { recursive: true, force: true });
}

console.log("\n=== ALL FILE SEARCH TESTS PASSED ===");
