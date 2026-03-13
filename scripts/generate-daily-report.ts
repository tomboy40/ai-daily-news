import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import OpenAI from "openai";
import Parser from "rss-parser";
import { runDailyNewsPipeline } from "../src/pipelines/daily-news.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WebsiteSource {
  url: string;
  /** Human-readable name shown in the report. Falls back to the URL. */
  title?: string;
}

interface CategoryConfig {
  name: string;
  /** RSS / Atom feed URLs. */
  feeds?: string[];
  /** Arbitrary website URLs to scrape. */
  websites?: WebsiteSource[];
}

interface LlmConfig {
  /** Model identifier, e.g. "gpt-4o-mini", "llama3", "mistral". */
  model: string;
  temperature?: number;
  maxTokens?: number;
}

interface InterestsConfig {
  llm?: LlmConfig;
  maxArticlesPerFeed: number;
  categories: CategoryConfig[];
}

interface Article {
  title: string;
  link: string;
  snippet: string;
  pubDate: string;
  source: string;
}

interface CategoryArticles {
  category: string;
  articles: Article[];
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const CONTENT_DIR = path.join(ROOT, "src", "content", "blog");
const DATA_DIR = path.join(ROOT, "public", "data");
const NEWS_DIR = path.join(DATA_DIR, "news");
const MANIFEST_PATH = path.join(DATA_DIR, "manifest.json");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todaySlug(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function todayPretty(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "…";
}

/** Collapse whitespace runs and trim. */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// RSS Fetching
// ---------------------------------------------------------------------------

async function fetchRssFeeds(
  parser: Parser,
  feeds: string[],
  maxPerFeed: number
): Promise<Article[]> {
  const articles: Article[] = [];

  for (const feedUrl of feeds) {
    try {
      console.log(`  ↳ [rss]  ${feedUrl}`);
      const feed = await parser.parseURL(feedUrl);
      const feedTitle = feed.title ?? feedUrl;

      const items = (feed.items ?? []).slice(0, maxPerFeed);
      for (const item of items) {
        articles.push({
          title: item.title ?? "Untitled",
          link: item.link ?? "",
          snippet: truncate(
            stripHtml(item.contentSnippet ?? item.content ?? ""),
            500
          ),
          pubDate: item.pubDate ?? item.isoDate ?? "",
          source: feedTitle,
        });
      }
    } catch (err) {
      console.warn(`  ⚠ Failed to fetch feed ${feedUrl}: ${(err as Error).message}`);
    }
  }

  return articles;
}

// ---------------------------------------------------------------------------
// Website Scraping
// ---------------------------------------------------------------------------

const WEB_FETCH_TIMEOUT_MS = 20_000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; AIDailyNewsBot/1.0; +https://github.com)";

async function fetchWebsite(site: WebsiteSource): Promise<Article[]> {
  const articles: Article[] = [];
  const label = site.title ?? site.url;

  try {
    console.log(`  ↳ [web]  ${site.url}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS);

    const res = await fetch(site.url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`  ⚠ HTTP ${res.status} for ${site.url}`);
      return articles;
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    // Remove noise
    $("script, style, nav, footer, header, aside, iframe, noscript").remove();

    // Strategy 1: look for <article> elements (common in blogs / news sites)
    const articleEls = $("article");
    if (articleEls.length > 0) {
      articleEls.each((_i, el) => {
        const $el = $(el);
        // Try to find a heading inside the article
        const heading =
          $el.find("h1, h2, h3").first().text().trim() || "Untitled";
        // Try to find a link
        const link = $el.find("a[href]").first().attr("href") ?? site.url;
        const resolvedLink = link.startsWith("http")
          ? link
          : new URL(link, site.url).href;
        // Extract text content
        const text = normalizeWhitespace($el.text());

        if (text.length > 30) {
          articles.push({
            title: heading,
            link: resolvedLink,
            snippet: truncate(text, 500),
            pubDate: new Date().toISOString(),
            source: label,
          });
        }
      });
    }

    // Strategy 2: if no <article>s found, fall back to the page's main content
    if (articles.length === 0) {
      const main = $("main").length ? $("main") : $("body");
      const pageTitle =
        $("title").text().trim() ||
        $("h1").first().text().trim() ||
        label;
      const text = normalizeWhitespace(main.text());

      if (text.length > 30) {
        articles.push({
          title: pageTitle,
          link: site.url,
          snippet: truncate(text, 1500),
          pubDate: new Date().toISOString(),
          source: label,
        });
      }
    }
  } catch (err) {
    console.warn(`  ⚠ Failed to scrape ${site.url}: ${(err as Error).message}`);
  }

  return articles;
}

async function fetchWebsites(
  websites: WebsiteSource[]
): Promise<Article[]> {
  const all: Article[] = [];
  for (const site of websites) {
    const articles = await fetchWebsite(site);
    all.push(...articles);
  }
  return all;
}

// ---------------------------------------------------------------------------
// Category Orchestrator
// ---------------------------------------------------------------------------

async function fetchCategory(
  parser: Parser,
  category: CategoryConfig,
  maxPerFeed: number
): Promise<CategoryArticles> {
  const rssArticles = category.feeds?.length
    ? await fetchRssFeeds(parser, category.feeds, maxPerFeed)
    : [];

  const webArticles = category.websites?.length
    ? await fetchWebsites(category.websites)
    : [];

  return {
    category: category.name,
    articles: [...rssArticles, ...webArticles],
  };
}

// ---------------------------------------------------------------------------
// LLM Client
// ---------------------------------------------------------------------------

/**
 * Build an OpenAI-compatible client.
 *
 * Env-var precedence (highest → lowest):
 *   LLM_API_KEY  →  OPENAI_API_KEY
 *   LLM_BASE_URL →  (default: https://api.openai.com/v1)
 *
 * This means you can point at *any* provider that exposes the
 * OpenAI-compatible `/v1/chat/completions` endpoint:
 *   - OpenAI          (default)
 *   - Ollama          LLM_BASE_URL=http://localhost:11434/v1
 *   - Together AI     LLM_BASE_URL=https://api.together.xyz/v1
 *   - Groq            LLM_BASE_URL=https://api.groq.com/openai/v1
 *   - Anyscale / vLLM / LiteLLM / etc.
 */
function createLlmClient(): OpenAI {
  const apiKey = process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error(
      "❌ Neither LLM_API_KEY nor OPENAI_API_KEY is set. Exiting."
    );
    process.exit(1);
  }

  const baseURL = process.env.LLM_BASE_URL; // undefined → SDK default

  if (baseURL) {
    console.log(`🔗 LLM base URL: ${baseURL}`);
  }

  return new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
}

// ---------------------------------------------------------------------------
// AI Summarization
// ---------------------------------------------------------------------------

function buildPrompt(data: CategoryArticles[]): string {
  let prompt = `You are a professional news editor. Given the following raw articles organized by category, produce an engaging daily briefing in **Markdown** format.\n\nRules:\n- For each category, write a short section header (## Category Name).\n- Under each category, summarize the top stories in 2-3 sentences each.\n- At the end of each summary, include a link to the original article as "[Read more →](url)".\n- Do NOT invent information. Only summarize what is provided.\n- Keep the tone professional yet accessible.\n- If a category has no articles, write "No articles available today."\n\n---\n\n`;

  for (const cat of data) {
    prompt += `### Category: ${cat.category}\n\n`;
    if (cat.articles.length === 0) {
      prompt += "(no articles)\n\n";
      continue;
    }
    for (const a of cat.articles) {
      prompt += `**${a.title}**\nSource: ${a.source}\nURL: ${a.link}\nSnippet: ${a.snippet}\n\n`;
    }
  }

  return prompt;
}

async function summarize(
  client: OpenAI,
  llmConfig: LlmConfig,
  data: CategoryArticles[]
): Promise<string> {
  const userPrompt = buildPrompt(data);
  const model = process.env.LLM_MODEL ?? llmConfig.model;

  console.log(`🤖 Summarizing with model: ${model}`);

  const response = await client.chat.completions.create({
    model,
    temperature: llmConfig.temperature ?? 0.4,
    max_tokens: llmConfig.maxTokens ?? 4000,
    messages: [
      {
        role: "system",
        content:
          "You are an expert news summarizer. You ONLY use the provided source material. Never add information that is not present in the input.",
      },
      { role: "user", content: userPrompt },
    ],
  });

  return response.choices[0]?.message?.content ?? "";
}

// ---------------------------------------------------------------------------
// JSON Data Writer
// ---------------------------------------------------------------------------

interface JsonNewsArticle {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedDate: string;
}

/**
 * Write the daily news as a JSON file to public/data/news/YYYY-MM-DD.json
 * and update public/data/manifest.json so the frontend can discover it.
 */
function writeDailyJson(articles: JsonNewsArticle[]): void {
  const slug = todaySlug();

  // Ensure directories exist
  fs.mkdirSync(NEWS_DIR, { recursive: true });

  // Write daily JSON
  const newsPath = path.join(NEWS_DIR, `${slug}.json`);
  fs.writeFileSync(newsPath, JSON.stringify(articles, null, 2), "utf-8");
  console.log(`✅ JSON written to ${newsPath}`);

  // Update manifest
  let manifest: { latest: string; dates: string[] } = { latest: slug, dates: [] };
  if (fs.existsSync(MANIFEST_PATH)) {
    try {
      manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
    } catch {
      // If the file is malformed, start fresh
    }
  }

  manifest.latest = slug;
  if (!manifest.dates.includes(slug)) {
    manifest.dates.unshift(slug);
  }
  // Keep the manifest sorted (newest first)
  manifest.dates.sort((a, b) => b.localeCompare(a));

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf-8");
  console.log(`✅ Manifest updated at ${MANIFEST_PATH}`);
}

/**
 * Convert fetched CategoryArticles into the flat JsonNewsArticle[] format
 * used by the static JSON data layer.
 */
function toJsonArticles(allData: CategoryArticles[]): JsonNewsArticle[] {
  let counter = 0;
  const slug = todaySlug();
  const articles: JsonNewsArticle[] = [];

  for (const cat of allData) {
    for (const a of cat.articles) {
      articles.push({
        id: `${slug}-${counter++}`,
        title: a.title,
        summary: a.snippet,
        url: a.link,
        source: a.source,
        publishedDate: a.pubDate || new Date().toISOString(),
      });
    }
  }

  return articles;
}

// ---------------------------------------------------------------------------
// Markdown File Writer
// ---------------------------------------------------------------------------

function writeDailyPost(markdownBody: string): string {
  const slug = todaySlug();
  const filename = `${slug}-daily-report.md`;
  const filepath = path.join(CONTENT_DIR, filename);

  const frontmatter = [
    "---",
    `title: "AI Daily News — ${todayPretty()}"`,
    `description: "Your AI-curated daily briefing for ${todayPretty()}."`,
    `pubDate: "${new Date().toISOString()}"`,
    "---",
  ].join("\n");

  const content = `${frontmatter}\n\n${markdownBody}\n`;

  fs.mkdirSync(CONTENT_DIR, { recursive: true });
  fs.writeFileSync(filepath, content, "utf-8");
  console.log(`✅ Written to ${filepath}`);

  return filepath;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Load config
  const configPath = path.join(ROOT, "interests.json");
  const config: InterestsConfig = JSON.parse(
    fs.readFileSync(configPath, "utf-8")
  );

  const llmConfig: LlmConfig = config.llm ?? { model: "gpt-4o-mini" };

  console.log(`📰 AI Daily News Generator — ${todayPretty()}`);
  console.log(`   Categories: ${config.categories.length}`);
  console.log(`   Max articles per feed: ${config.maxArticlesPerFeed}`);
  console.log(`   LLM model: ${process.env.LLM_MODEL ?? llmConfig.model}\n`);

  // Build LLM client (validates API key)
  const client = createLlmClient();

  // Fetch all sources
  const parser = new Parser({ timeout: 15_000 });
  const allData: CategoryArticles[] = [];

  for (const cat of config.categories) {
    console.log(`📂 ${cat.name}`);
    const result = await fetchCategory(parser, cat, config.maxArticlesPerFeed);
    allData.push(result);
  }

  const totalArticles = allData.reduce((s, c) => s + c.articles.length, 0);
  console.log(`\n📊 Fetched ${totalArticles} articles total.\n`);

  if (totalArticles === 0) {
    console.warn("⚠ No articles fetched. Writing an empty report.");
    writeDailyPost(
      "No articles were available today. Please check the feed and website configuration."
    );
    writeDailyJson([]);
    return;
  }

  // Summarize (existing RSS/web pipeline)
  const summary = await summarize(client, llmConfig, allData);

  // ── Tavily-powered search & hierarchical summarization ──────────────────
  let tavilySection = "";
  if (process.env.TAVILY_API_KEY) {
    console.log("\n🔎 Running Tavily search pipeline…");
    const categoryNames = config.categories.map((c) => c.name);
    try {
      const { dailySummary, categorizedNews } = await runDailyNewsPipeline(
        client,
        llmConfig,
        categoryNames,
        config.maxArticlesPerFeed
      );

      const tavilyArticleCount = Object.values(categorizedNews).reduce(
        (s, arr) => s + arr.length,
        0
      );
      console.log(
        `📊 Tavily pipeline: ${tavilyArticleCount} articles enriched with TL;DRs.`
      );

      // Build the Tavily section with Daily Glance + per-category TL;DRs
      const parts: string[] = [];
      parts.push("## 🗞️ Daily Glance\n");
      parts.push(dailySummary);
      parts.push("");

      for (const [cat, articles] of Object.entries(categorizedNews)) {
        if (articles.length === 0) continue;
        parts.push(`### ${cat}\n`);
        for (const a of articles) {
          parts.push(`**${a.title}**`);
          parts.push(`> ${a.tldr}`);
          parts.push(`[Read more →](${a.url})\n`);
        }
      }

      tavilySection = parts.join("\n");
    } catch (err) {
      console.warn(
        `⚠ Tavily pipeline failed: ${(err as Error).message}. Continuing with RSS/web results only.`
      );
    }
  } else {
    console.log(
      "\nℹ TAVILY_API_KEY not set — skipping Tavily search pipeline."
    );
  }

  // Combine both pipelines into the final report
  const fullReport = tavilySection
    ? `${tavilySection}\n\n---\n\n${summary}`
    : summary;

  // Write output
  writeDailyPost(fullReport);
  writeDailyJson(toJsonArticles(allData));
  console.log("🎉 Done!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
