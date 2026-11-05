// landing/src/data/site.ts
// Single source of truth for project links and release facts.
// Release data is fetched from GitHub at build time, so publishing a new
// tag and rebuilding the site (see .github/workflows/landing-release.yml)
// updates every version, command and requirement on the page.

export const REPO = 'Cypher0071/Home_Cloud';
export const REPO_URL = `https://github.com/${REPO}`;

export const links = {
  repo: REPO_URL,
  // Docs live in the README until a dedicated docs site exists.
  // Point these at the docs site later; everything on the page follows.
  docs: `${REPO_URL}#readme`,
  docsQuickstart: `${REPO_URL}#quickstart`,
  docsArchitecture: `${REPO_URL}#architecture-overview`,
  docsSecurity: `${REPO_URL}#security-model--threat-boundaries`,
  docsRequirements: `${REPO_URL}#requirements--compatibility`,
  docsConfig: `${REPO_URL}#configuration-reference`,
  changelog: `${REPO_URL}/blob/main/CHANGELOG.md`,
  releases: `${REPO_URL}/releases`,
  issues: `${REPO_URL}/issues`,
  discussions: `${REPO_URL}/discussions`,
  contributing: `${REPO_URL}/blob/main/CONTRIBUTING.md`,
  securityPolicy: `${REPO_URL}/blob/main/SECURITY.md`,
  codeOfConduct: `${REPO_URL}/blob/main/CODE_OF_CONDUCT.md`,
  license: `${REPO_URL}/blob/main/LICENSE`,
};

export interface ReleaseInfo {
  tag: string;
  publishedAt: string | null;
  nodeMin: string;
  stars: number | null;
}

// Used only when GitHub cannot be reached at build time.
const FALLBACK: ReleaseInfo = {
  tag: 'v1.0.1',
  publishedAt: '2026-10-23T20:37:14Z',
  nodeMin: '22.13',
  stars: null,
};

const headers: Record<string, string> = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'home-cloud-landing-build',
};
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

let cached: Promise<ReleaseInfo> | null = null;

export function getRelease(): Promise<ReleaseInfo> {
  cached ??= (async () => {
    const [release, repo] = await Promise.all([
      getJson(`https://api.github.com/repos/${REPO}/releases/latest`),
      getJson(`https://api.github.com/repos/${REPO}`),
    ]);
    const tag: string = release?.tag_name ?? FALLBACK.tag;

    // Node minimum comes from the released package.json, not from a copy here.
    let nodeMin = FALLBACK.nodeMin;
    const pkg = await getJson(`https://raw.githubusercontent.com/${REPO}/${tag}/package.json`);
    const range: string | undefined = pkg?.engines?.node;
    const match = range?.match(/(\d+(?:\.\d+){0,2})/);
    if (match) nodeMin = match[1].replace(/\.0$/, '');

    return {
      tag,
      publishedAt: release?.published_at ?? (release ? null : FALLBACK.publishedAt),
      nodeMin,
      stars: typeof repo?.stargazers_count === 'number' ? repo.stargazers_count : FALLBACK.stars,
    };
  })();
  return cached;
}

export const installCommand = (tag: string) =>
  `curl -fsSL https://raw.githubusercontent.com/${REPO}/${tag}/setup.sh -o setup.sh && \\
less setup.sh && \\
bash setup.sh`;

export const installerSource = (tag: string) => `${REPO_URL}/blob/${tag}/setup.sh`;
