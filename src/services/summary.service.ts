import type OpenAI from "openai";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SummaryLlmConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
}

// ---------------------------------------------------------------------------
// Per-Article TL;DR
// ---------------------------------------------------------------------------

/**
 * Generate a concise 2-sentence TL;DR for a single news article.
 */
export async function generateArticleTLDR(
  client: OpenAI,
  llmConfig: SummaryLlmConfig,
  articleContent: string
): Promise<string> {
  const model = process.env.LLM_MODEL ?? llmConfig.model;

  const response = await client.chat.completions.create({
    model,
    temperature: llmConfig.temperature ?? 0.3,
    max_tokens: llmConfig.maxTokens ?? 200,
    messages: [
      {
        role: "system",
        content:
          "You are a concise news summarizer. Produce a 2-sentence TL;DR in English. Only use the provided content. Never add information that is not present.",
      },
      {
        role: "user",
        content: `Summarize the following news article into a concise 2-sentence TL;DR in English:\n\n${articleContent}`,
      },
    ],
  });

  return response.choices[0]?.message?.content?.trim() ?? "";
}

// ---------------------------------------------------------------------------
// Daily Aggregated Summary ("Daily Glance")
// ---------------------------------------------------------------------------

/**
 * Synthesize all per-category TL;DRs into a single cohesive "Daily Glance"
 * overview. The input is a map from category name → array of TL;DR strings.
 */
export async function generateDailyGlance(
  client: OpenAI,
  llmConfig: SummaryLlmConfig,
  categorizedTLDRs: Record<string, string[]>
): Promise<string> {
  const model = process.env.LLM_MODEL ?? llmConfig.model;
  const payload = JSON.stringify(categorizedTLDRs, null, 2);

  const response = await client.chat.completions.create({
    model,
    temperature: llmConfig.temperature ?? 0.4,
    max_tokens: llmConfig.maxTokens ?? 4000,
    messages: [
      {
        role: "system",
        content:
          "You are a senior news editor. You ONLY use the provided source material. Never add information that is not present in the input.",
      },
      {
        role: "user",
        content: `Review the following categorized news TL;DRs for today and write a cohesive "Daily Glance" summary in **Markdown** format. Highlight the most critical events across all categories in a brief, highly readable format:\n\n${payload}`,
      },
    ],
  });

  return response.choices[0]?.message?.content?.trim() ?? "";
}
