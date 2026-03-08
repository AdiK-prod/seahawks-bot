import Parser from "rss-parser";
import { Article } from "./state";
import sourcesConfig from "../sources.json";

const parser = new Parser({ timeout: 10000 });

export async function fetchArticles(): Promise<Article[]> {
  const all: Article[] = [];

  for (const source of sourcesConfig.rss) {
    try {
      console.log(`  Fetching ${source.name}...`);
      const feed = await parser.parseURL(source.url);
      const items = feed.items.slice(0, 8).map((item) => ({
        title: item.title || "",
        content: (item.contentSnippet || item.summary || "")
          .replace(/<[^>]+>/g, "")
          .slice(0, 250),
        link: item.link || "",
        published: item.pubDate || new Date().toISOString(),
        source: source.name,
      }));
      all.push(...items);
      console.log(`  ✓ ${items.length} articles from ${source.name}`);
    } catch (e) {
      console.warn(`  ✗ Failed to fetch ${source.name}: ${(e as Error).message}`);
    }
  }

  // Dedupe by link, sort newest first
  return [...new Map(all.map((a) => [a.link, a])).values()].sort(
    (a, b) => new Date(b.published).getTime() - new Date(a.published).getTime()
  );
}
