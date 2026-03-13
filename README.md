# AI Daily News

An automated, AI-powered daily news aggregator that fetches articles from RSS feeds **and websites**, summarizes them with any OpenAI-compatible LLM, and publishes a static site to GitHub Pages — entirely unattended.

## Architecture

```
Cron (GitHub Actions, daily 07:00 UTC)
  │
  ▼
scripts/generate-daily-report.ts
  ├── Read interests.json (categories + RSS feeds + websites)
  ├── Fetch RSS feeds via rss-parser
  ├── Scrape websites via fetch + cheerio
  ├── Summarize articles via any OpenAI-compatible LLM
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
- **AI Summarization**: Any OpenAI-compatible API (OpenAI, Ollama, Groq, Together AI, vLLM, etc.)
- **RSS Parsing**: [rss-parser](https://www.npmjs.com/package/rss-parser)
- **Web Scraping**: [cheerio](https://www.npmjs.com/package/cheerio)
- **CI/CD**: GitHub Actions (cron + manual dispatch)
- **Hosting**: GitHub Pages

## Setup

### Prerequisites

- Node.js ≥ 22
- An API key for any OpenAI-compatible LLM provider

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

Edit `interests.json` to add/change categories, RSS feeds, and websites:

```json
{
  "llm": {
    "model": "gpt-4o-mini",
    "temperature": 0.4,
    "maxTokens": 4000
  },
  "maxArticlesPerFeed": 5,
  "categories": [
    {
      "name": "Your Category",
      "feeds": [
        "https://example.com/rss"
      ],
      "websites": [
        { "url": "https://example.com/blog", "title": "Example Blog" }
      ]
    }
  ]
}
```

Each category can have `feeds` (RSS/Atom), `websites` (arbitrary URLs), or both.

### Configuring the LLM Provider

The script uses the OpenAI SDK, which works with **any provider** that exposes a compatible `/v1/chat/completions` endpoint. Configure via environment variables:

| Variable | Required | Description |
|---|---|---|
| `LLM_API_KEY` or `OPENAI_API_KEY` | Yes | API key (`LLM_API_KEY` takes precedence) |
| `LLM_BASE_URL` | No | Base URL for non-OpenAI providers |
| `LLM_MODEL` | No | Override the model from `interests.json` |

**Provider examples:**

```bash
# OpenAI (default — no base URL needed)
OPENAI_API_KEY=sk-...

# Ollama (local)
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=llama3

# Groq
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_API_KEY=gsk_...
LLM_MODEL=llama-3.3-70b-versatile

# Together AI
LLM_BASE_URL=https://api.together.xyz/v1
LLM_API_KEY=...
LLM_MODEL=meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo
```

### GitHub Pages Deployment

1. Push this repo to GitHub.
2. Go to **Settings → Pages** and set the source to **GitHub Actions**.
3. Go to **Settings → Secrets and variables → Actions**:
   - Add secret `OPENAI_API_KEY` (or `LLM_API_KEY` for non-OpenAI providers)
   - Optionally add variables `LLM_BASE_URL` and `LLM_MODEL`
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
