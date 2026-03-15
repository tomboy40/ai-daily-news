// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

// GitHub Pages URL — update <USERNAME> to your GitHub username.
// For a repo named "ai-daily-news" deployed to GitHub Pages, the site URL
// is https://<USERNAME>.github.io and the base path is /ai-daily-news/.
export default defineConfig({
	site: 'https://tomboy40.github.io',
	base: '/ai-daily-news',
	output: 'static',
	trailingSlash: 'always',
	integrations: [mdx(), sitemap()],
});
