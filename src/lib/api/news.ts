import { z } from 'astro/zod';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const NewsArticleSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  url: z.string().url(),
  source: z.string(),
  publishedDate: z.string().optional(),
});

export const NewsManifestSchema = z.object({
  latest: z.string(),
  dates: z.array(z.string()),
});

export type NewsArticle = z.infer<typeof NewsArticleSchema>;
export type NewsManifest = z.infer<typeof NewsManifestSchema>;

// ---------------------------------------------------------------------------
// Fetching helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a data path relative to the Astro base URL.
 *
 * `import.meta.env.BASE_URL` includes a trailing slash when a `base` is set
 * in `astro.config.mjs` (e.g. `/ai-daily-news/`), so we normalise it here.
 */
function dataUrl(path: string): string {
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/+$/, '');
  return `${base}/data/${path}`;
}

/**
 * Fetch and validate the master manifest that lists all available dates.
 */
export async function getNewsManifest(): Promise<NewsManifest> {
  const res = await fetch(dataUrl('manifest.json'), { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch news manifest');
  const json = await res.json();
  return NewsManifestSchema.parse(json);
}

/**
 * Fetch and validate the news articles for a specific date (YYYY-MM-DD).
 */
export async function getDailyNews(date: string): Promise<NewsArticle[]> {
  const res = await fetch(dataUrl(`news/${date}.json`), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch news for ${date}`);
  const json = await res.json();
  return z.array(NewsArticleSchema).parse(json);
}
