# AI Daily News

An automated, AI-powered daily news aggregator that fetches articles from RSS feeds, summarizes them with OpenAI, and publishes a static site to GitHub Pages — entirely unattended.

## Architecture

```
Cron (GitHub Actions, daily 07:00 UTC)
  │
  ▼
scripts/generate-daily-report.ts
  ├── Read interests.json (categories + RSS feeds)
  ├── Fetch RSS feeds via rss-parser
  ├── Summarize articles via OpenAI gpt-4o-mini
  └── Write Markdown → src/content/blog/YYYY-MM-DD-daily-report.md
  │
  ▼
astro build → Static HTML in dist/
  │
  ▼
GitHub Pages deployment
```

## Tech Stack

- **Static Site Generator**: [Astro](https://astro.build) (blog template)
- **AI Summarization**: [OpenAI API](https://platform.openai.com) (`gpt-4o-mini`)
- **RSS Parsing**: [rss-parser](https://www.npmjs.com/package/rss-parser)
- **CI/CD**: GitHub Actions (cron + manual dispatch)
- **Hosting**: GitHub Pages

## Setup

### Prerequisites

- Node.js ≥ 22
- An [OpenAI API key](https://platform.openai.com/api-keys)

### Local Development

```bash
# Install dependencies
npm install

# Create .env with your API key
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

# Generate a daily report locally
npm run generate

# Build and preview
npm run build
npm run preview
```

### Configuring Interests

Edit `interests.json` to add or change categories and RSS feed URLs:

```json
{
  "maxArticlesPerFeed": 5,
  "categories": [
    {
      "name": "Your Category",
      "feeds": [
        "https://example.com/rss"
      ]
    }
  ]
}
```

### GitHub Pages Deployment

1. Push this repo to GitHub.
2. Go to **Settings → Pages** and set the source to **GitHub Actions**.
3. Go to **Settings → Secrets and variables → Actions** and add a repository secret:
   - Name: `OPENAI_API_KEY`
   - Value: your OpenAI API key
4. Update `astro.config.mjs`:
   - Set `site` to `https://<YOUR_USERNAME>.github.io`
   - Set `base` to `/<REPO_NAME>` (e.g., `/ai-daily-news`)
5. The workflow runs daily at 07:00 UTC, or trigger it manually from the **Actions** tab.

## Verification

```bash
# Type-check the generation script
npx tsc --noEmit -p tsconfig.json

# Dry-run locally
OPENAI_API_KEY="sk-..." npm run generate

# Build and preview
npm run build
npm run preview
```

## License

MIT
