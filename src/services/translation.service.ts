import type OpenAI from "openai";
import type { SummaryLlmConfig } from "./summary.service.js";

// ---------------------------------------------------------------------------
// Translate Markdown Content to Chinese
// ---------------------------------------------------------------------------

/**
 * Translate a Markdown-formatted news report from English to Chinese.
 *
 * The LLM is instructed to preserve all Markdown formatting, links, and
 * structural elements while translating the prose into Simplified Chinese.
 */
export async function translateToChineseMarkdown(
  client: OpenAI,
  llmConfig: SummaryLlmConfig,
  markdownContent: string
): Promise<string> {
  const model = process.env.LLM_MODEL ?? llmConfig.model;

  console.log(`🌐 Translating report to Chinese with model: ${model}`);

  const response = await client.chat.completions.create({
    model,
    temperature: llmConfig.temperature ?? 0.3,
    max_tokens: llmConfig.maxTokens ?? 8000,
    messages: [
      {
        role: "system",
        content:
          "You are a professional translator specializing in technology and science news. " +
          "Translate the provided Markdown content from English to Simplified Chinese (简体中文). " +
          "Rules:\n" +
          "- Preserve ALL Markdown formatting (headings, bold, links, blockquotes, etc.).\n" +
          "- Keep URLs unchanged.\n" +
          '- Keep "[Read more →]" link text as "[阅读更多 →]".\n' +
          "- Do NOT add or remove any information.\n" +
          "- Maintain a professional and accessible tone suitable for a tech news briefing.\n" +
          "- Return ONLY the translated Markdown, no explanations.",
      },
      {
        role: "user",
        content: `Translate the following Markdown news report to Simplified Chinese:\n\n${markdownContent}`,
      },
    ],
  });

  return response.choices[0]?.message?.content?.trim() ?? "";
}
