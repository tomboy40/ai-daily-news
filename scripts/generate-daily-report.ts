import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import Parser from "rss-parser";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FeedConfig {
  name: string;
  feeds: string[];
}

interface InterestsConfig {
  maxArticlesPerFeed: number;
  categories: FeedConfig[];
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

// ---------------------------------------------------------------------------
// RSS Fetching
// ---------------------------------------------------------------------------

async function fetchCategory(
  parser: Parser,
  category: FeedConfig,
  maxPerFeed: number
): Promise<CategoryArticles> {
  const articles: Article[] = [];

  for (const feedUrl of category.feeds) {
    try {
      console.log(`  ↳ Fetching ${feedUrl}`);
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
      console.warn(`  ⚠ Failed to fetch ${feedUrl}: ${(err as Error).message}`);
    }
  }

  return { category: category.name, articles };
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
  openai: OpenAI,
  data: CategoryArticles[]
): Promise<string> {
  const userPrompt = buildPrompt(data);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    max_tokens: 4000,
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
  // Validate env
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("❌ OPENAI_API_KEY is not set. Exiting.");
    process.exit(1);
  }

  // Load config
  const configPath = path.join(ROOT, "interests.json");
  const config: InterestsConfig = JSON.parse(
    fs.readFileSync(configPath, "utf-8")
  );

  console.log(`📰 AI Daily News Generator — ${todayPretty()}`);
  console.log(`   Categories: ${config.categories.length}`);
  console.log(`   Max articles per feed: ${config.maxArticlesPerFeed}\n`);

  // Fetch RSS
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
    writeDailyPost("No articles were available today. Please check the RSS feed configuration.");
    return;
  }

  // Summarize with AI
  console.log("🤖 Summarizing with OpenAI…");
  const openai = new OpenAI({ apiKey });
  const summary = await summarize(openai, allData);

  // Write output
  writeDailyPost(summary);
  console.log("🎉 Done!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
