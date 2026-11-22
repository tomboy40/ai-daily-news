import { tavily } from "@tavily/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TavilyArticle {
  title: string;
  url: string;
  content: string;
  score: number;
  publishedDate: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

function createTavilyClient() {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error(
      "❌ TAVILY_API_KEY is not set. Add it to your local .env file or the GitHub Actions environment secrets."
    );
  }
  return tavily({ apiKey });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Search for recent English-language news articles in a given category
 * using the Tavily API.
 *
 * Returns up to `maxResults` articles from the last day.
 */
export async function fetchCategoryNews(
  category: string,
  maxResults = 5
): Promise<TavilyArticle[]> {
  const client = createTavilyClient();

  const response = await client.search(
    `Latest English news about ${category}`,
    {
      searchDepth: "advanced",
      topic: "news",
      timeRange: "day",
      includeRawContent: false,
      maxResults,
    }
  );

  return response.results.map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content,
    score: r.score,
    publishedDate: r.publishedDate,
  }));
}
