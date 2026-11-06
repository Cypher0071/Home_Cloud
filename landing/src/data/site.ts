// landing/src/data/site.ts
// Single source of truth for project links and release facts.
// Release data is fetched from GitHub at build time, so publishing a new
// tag and rebuilding the site (see .github/workflows/landing-release.yml)
// updates the version and changelog on the page.

export const REPO = 'Cypher0071/Home_Cloud';
export const REPO_URL = `https://github.com/${REPO}`;

export const links = {
  repo: REPO_URL,
  // Docs are served by Starlight from this site (src/content/docs/docs/).
  docs: '/docs/',
  docsQuickstart: '/docs/getting-started/install/',
  docsArchitecture: '/docs/project/architecture/',
  docsSecurity: '/docs/security/threat-model/',
  docsRequirements: '/docs/getting-started/requirements/',
  docsConfig: '/docs/configuration/environment/',
  changelog: '/docs/project/changelog/',
  changelogFile: `${REPO_URL}/blob/main/CHANGELOG.md`,
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
  stars: number | null;
}

// Used only when GitHub cannot be reached at build time.
const FALLBACK: ReleaseInfo = {
  tag: 'v1.2.0',
  publishedAt: '2026-11-06T00:00:00Z',
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

    return {
      tag,
      publishedAt: release?.published_at ?? (release ? null : FALLBACK.publishedAt),
      stars: typeof repo?.stargazers_count === 'number' ? repo.stargazers_count : FALLBACK.stars,
    };
  })();
  return cached;
}

// setup.sh on main always installs the latest published release, never
// unreleased commits, so the command downloads it from main. It resolves the
// release itself; `--branch <tag>` pins a version.
export const installCommand = `curl -fsSL https://raw.githubusercontent.com/${REPO}/main/setup.sh -o setup.sh && \\
less setup.sh && \\
bash setup.sh`;

export const installerSource = `${REPO_URL}/blob/main/setup.sh`;
