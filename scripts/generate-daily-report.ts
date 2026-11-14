import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { runDailyNewsPipeline } from "../src/pipelines/daily-news.js";
import { translateToChineseMarkdown } from "../src/services/translation.service.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LlmConfig {
  /** Model identifier, e.g. "gpt-4o-mini", "llama3", "mistral". */
  model: string;
  temperature?: number;
  maxTokens?: number;
}

interface InterestsConfig {
  llm?: LlmConfig;
  maxResultsPerCategory: number;
  /** Simple list of topic / interest strings to search for via Tavily. */
  categories: string[];
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
// Markdown File Writer
// ---------------------------------------------------------------------------

function writeDailyPost(markdownBody: string, tags: string[] = []): string {
  const slug = todaySlug();
  const filename = `${slug}-daily-report.md`;
  const filepath = path.join(CONTENT_DIR, filename);

  const tagLine = tags.length > 0
    ? `tags:\n${tags.map((t) => `  - "${t}"`).join("\n")}`
    : "tags: []";

  const frontmatter = [
    "---",
    `title: "AI Daily News — ${todayPretty()}"`,
    `description: "Your AI-curated daily briefing for ${todayPretty()}."`,
    `pubDate: "${new Date().toISOString()}"`,
    tagLine,
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
  console.log(`   Max results per category: ${config.maxResultsPerCategory}`);
  console.log(`   LLM model: ${process.env.LLM_MODEL ?? llmConfig.model}\n`);

  // Build LLM client (validates API key)
  const client = createLlmClient();

  // ── Tavily-powered search & hierarchical summarization ──────────────────
  console.log("🔎 Running Tavily search pipeline…");

  const { dailySummary, categorizedNews } = await runDailyNewsPipeline(
    client,
    llmConfig,
    config.categories,
    config.maxResultsPerCategory
  );

  const totalArticles = Object.values(categorizedNews).reduce(
    (s, arr) => s + arr.length,
    0
  );
  console.log(`📊 ${totalArticles} articles enriched with TL;DRs.`);

  if (totalArticles === 0) {
    console.warn("⚠ No articles fetched. Writing an empty report.");
    writeDailyPost(
      "No articles were available today. Please check your categories and Tavily API key."
    );
    return;
  }

  // Build the report with Daily Glance + per-category TL;DRs
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

  const fullReport = parts.join("\n");

  // ── Translate to Chinese ─────────────────────────────────────────────────
  console.log("\n🌐 Translating report to Chinese…");
  let chineseReport = "";
  try {
    chineseReport = await translateToChineseMarkdown(client, llmConfig, fullReport);
  } catch (err) {
    console.warn(
      `⚠ Translation failed: ${(err as Error).message}. Writing English-only report.`
    );
  }

  const finalReport = chineseReport
    ? `${fullReport}\n\n---\n\n## 🇨🇳 中文版 / Chinese Translation\n\n${chineseReport}`
    : fullReport;

  // Collect category tags from the config
  const tags = config.categories;

  // Write output
  writeDailyPost(finalReport, tags);
  console.log("🎉 Done!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
