import { fetchArticles } from "./sources";
import { generateTweet, generateQuoteTweet, QuoteTweetSource } from "./claude";
import { postTweet, quoteTweet } from "./twitter";
import {
  isArticleNew,
  markArticlesSeen,
  addPostedTweet,
} from "./state";

const DRY_RUN = process.env.DRY_RUN === "true";

// Optional: set QUOTE_TWEET_ID and QUOTE_TWEET_TEXT env vars to do a quote tweet instead
const QUOTE_TWEET_ID = process.env.QUOTE_TWEET_ID;
const QUOTE_TWEET_TEXT = process.env.QUOTE_TWEET_TEXT;
const QUOTE_TWEET_AUTHOR = process.env.QUOTE_TWEET_AUTHOR;

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
