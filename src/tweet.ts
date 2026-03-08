import { fetchArticles } from "./sources";
import { generateTweet, generateQuoteTweet, QuoteTweetSource } from "./claude";
import { postTweet, quoteTweet } from "./twitter";
import {
  isArticleNew,
  markArticlesSeen,
  addPostedTweet,
  getRecentTweets,
} from "./state";

const DRY_RUN = process.env.DRY_RUN === "true";
const QUOTE_TWEET_ID = process.env.QUOTE_TWEET_ID;
const QUOTE_TWEET_TEXT = process.env.QUOTE_TWEET_TEXT;
const QUOTE_TWEET_AUTHOR = process.env.QUOTE_TWEET_AUTHOR;

const SIMILARITY_THRESHOLD = 0.4; // 40% word overlap = too similar

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\u0590-\u05ff\s]/g, "") // keep Hebrew + English
      .split(/\s+/)
      .filter((w) => w.length > 3) // ignore short words
  );
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = new Set([...setA].filter((w) => setB.has(w)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

function isTooSimilarToRecent(candidate: string): boolean {
  const recentTweets = getRecentTweets(48); // last 48 hours
  for (const tweet of recentTweets) {
    const score = jaccardSimilarity(candidate, tweet.text);
    if (score >= SIMILARITY_THRESHOLD) {
      console.log(
        `  ⚠ Too similar to recent tweet (score: ${score.toFixed(2)}): "${tweet.text.slice(0, 60)}…"`
      );
      return true;
    }
  }
  return false;
}

async function main() {
  console.log(`\n🦅 SEAHAWKS BOT — TWEET JOB ${DRY_RUN ? "[DRY RUN]" : ""}`);
  console.log("─".repeat(50));

  let tweetText: string;
  let language: string;
  let tweetId: string | undefined;

  // ── Quote tweet mode ────────────────────────────────────────────────────────
  if (QUOTE_TWEET_ID && QUOTE_TWEET_TEXT) {
    console.log("\n[MODE] Quote tweet");
    const source: QuoteTweetSource = {
      tweetId: QUOTE_TWEET_ID,
      tweetText: QUOTE_TWEET_TEXT,
      tweetAuthor: QUOTE_TWEET_AUTHOR,
    };

    console.log("\n[1/2] Generating quote tweet via Claude...");
    const generated = await generateQuoteTweet(source);
    tweetText = generated.text;
    language = generated.language;

    console.log(`\n  Language: ${language}`);
    console.log(`  Generated (${tweetText.length} chars):\n  "${tweetText}"`);

    if (DRY_RUN) {
      console.log("\n[DRY RUN] Would quote-tweet above. Not posting.");
      return;
    }

    console.log("\n[2/2] Posting quote tweet...");
    tweetId = await quoteTweet(tweetText, QUOTE_TWEET_ID);
    console.log(`  ✓ Posted! https://twitter.com/i/web/status/${tweetId}`);

  // ── Regular tweet mode ──────────────────────────────────────────────────────
  } else {
    console.log("\n[MODE] Regular tweet from news");

    console.log("\n[1/3] Fetching news sources...");
    const articles = await fetchArticles();
    const freshArticles = articles.filter((a) => a.link && isArticleNew(a.link));
    console.log(`  ${articles.length} total articles, ${freshArticles.length} new`);

    if (freshArticles.length === 0) {
      console.log("  No new stories since last run. Skipping.");
      return;
    }

    console.log("\n[2/3] Generating tweet via Claude...");
    const generated = await generateTweet(freshArticles);
    tweetText = generated.text;
    language = generated.language;

    console.log(`\n  Language: ${language}`);
    console.log(`  Generated (${tweetText.length} chars):\n  "${tweetText}"`);

    if (tweetText.length > 280) {
      console.error("  ✗ Tweet too long! Aborting.");
      process.exit(1);
    }

    // ── Similarity check ──────────────────────────────────────────────────────
    console.log("\n  Checking similarity against recent tweets...");
    if (isTooSimilarToRecent(tweetText)) {
      console.log("  Skipping — too similar to a recent tweet.");
      return;
    }
    console.log("  ✓ Unique enough to post.");

    if (DRY_RUN) {
      console.log("\n[3/3] [DRY RUN] Would post tweet above. Not posting.");
      return;
    }

    console.log("\n[3/3] Posting...");
    tweetId = await postTweet(tweetText);
    console.log(`  ✓ Posted! https://twitter.com/i/web/status/${tweetId}`);

    markArticlesSeen(freshArticles.slice(0, 8).map((a) => a.link));
  }

  // Save to state
  if (tweetId) {
    addPostedTweet({
      id: tweetId,
      text: tweetText,
      posted_at: new Date().toISOString(),
      engaged_comment_ids: [],
    });
  }

  console.log("\n✓ Done.\n");
}

main().catch((e) => {
  console.error("Fatal error:", e.message);
  process.exit(1);
});
