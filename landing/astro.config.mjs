// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';
import { CF_BEACON_SRC, CF_BEACON_DATA } from './src/data/analytics.mjs';

const REPO_URL = 'https://github.com/Cypher0071/Home_Cloud';

export default defineConfig({
  site: 'https://home-cloud.live',
  output: 'static',
  server: { port: 4321, host: true },
  devToolbar: {
    enabled: false,
  },
  integrations: [
    // Docs live in src/content/docs/docs/, so every page is served under /docs/.
    starlight({
      title: 'Home Cloud Docs',
      description: 'Install, use and run Home Cloud, a self-hosted dashboard for one Linux machine.',
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: REPO_URL }],
      editLink: { baseUrl: `${REPO_URL}/edit/main/landing/` },
      lastUpdated: true,
      // The landing site has its own 404 page.
      disable404Route: true,
      customCss: [
        '@fontsource-variable/geist',
        '@fontsource-variable/jetbrains-mono',
        './src/styles/docs.css',
      ],
      components: {
        // The site is dark-only, so the docs are too.
        ThemeProvider: './src/components/docs/ThemeProvider.astro',
        ThemeSelect: './src/components/docs/ThemeSelect.astro',
        SiteTitle: './src/components/docs/SiteTitle.astro',
      },
      head: [
        { tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' } },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' } },
        { tag: 'meta', attrs: { property: 'og:image', content: 'https://home-cloud.live/og.png' } },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
        { tag: 'meta', attrs: { name: 'twitter:image', content: 'https://home-cloud.live/og.png' } },
        { tag: 'script', attrs: { defer: true, src: CF_BEACON_SRC, 'data-cf-beacon': CF_BEACON_DATA } },
      ],
      expressiveCode: {
        themes: ['github-dark-default'],
        styleOverrides: {
          borderRadius: '8px',
          borderColor: 'var(--hc-border-default)',
          codeBackground: 'var(--hc-surface-1)',
          codeFontFamily: 'var(--hc-font-mono)',
          uiFontFamily: 'var(--hc-font-sans)',
          frames: {
            editorTabBarBackground: 'var(--hc-surface-2)',
            terminalTitlebarBackground: 'var(--hc-surface-2)',
            terminalBackground: 'var(--hc-surface-1)',
            frameBoxShadowCssValue: 'none',
          },
        },
      },
      sidebar: [
        { label: 'Overview', link: '/docs/' },
        { label: 'Getting started', items: [{ autogenerate: { directory: 'docs/getting-started' } }] },
        { label: 'Using Home Cloud', items: [{ autogenerate: { directory: 'docs/using' } }] },
        { label: 'Configuration', items: [{ autogenerate: { directory: 'docs/configuration' } }] },
        { label: 'Security', items: [{ autogenerate: { directory: 'docs/security' } }] },
        { label: 'Operations', items: [{ autogenerate: { directory: 'docs/operations' } }] },
        { label: 'Project', items: [{ autogenerate: { directory: 'docs/project' } }, { label: 'Changelog', link: '/docs/project/changelog/' }] },
      ],
    }),
    sitemap({
      filter: (page) => !page.includes('/404'),
    }),
  ],
});
