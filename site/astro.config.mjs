import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://camaleaun.github.io',
  base: '/forge',
  output: 'static',
  trailingSlash: 'always',
  build: { inlineStylesheets: 'always' },
  markdown: {
    shikiConfig: {
      // High-contrast themes keep comments readable (WCAG AA) in both color schemes.
      themes: { light: 'github-light-high-contrast', dark: 'github-dark-high-contrast' },
      defaultColor: false,
    },
  },
});
