import { fetchArticles } from "./sources";
import { generateTweet } from "./claude";
import { postTweet } from "./twitter";
import {
  isArticleNew,
  markArticlesSeen,
  addPostedTweet,
} from "./state";

const DRY_RUN = process.env.DRY_RUN === "true";

async function main() {
  console.log(`\n🦅 SEAHAWKS BOT — TWEET JOB ${DRY_RUN ? "[DRY RUN]" : ""}`);
  console.log("─".repeat(50));

  // 1. Fetch articles
  console.log("\n[1/3] Fetching news sources...");
  const articles = await fetchArticles();
  const freshArticles = articles.filter((a) => a.link && isArticleNew(a.link));

  console.log(`  ${articles.length} total articles, ${freshArticles.length} new`);

  if (freshArticles.length === 0) {
    console.log("  No new stories since last run. Skipping.");
    return;
  }

  // 2. Generate tweet
  console.log("\n[2/3] Generating tweet via Claude...");
  const tweetText = await generateTweet(freshArticles);
  console.log(`\n  Generated tweet (${tweetText.length} chars):`);
  console.log(`  "${tweetText}"`);

  if (tweetText.length > 280) {
    console.error("  ✗ Tweet too long! Aborting.");
    process.exit(1);
  }

  // 3. Post or dry-run
  console.log("\n[3/3] Posting...");
  if (DRY_RUN) {
    console.log("  [DRY RUN] Would post tweet above. Not posting.");
    return;
  }

  const tweetId = await postTweet(tweetText);
  console.log(`  ✓ Posted! Tweet ID: ${tweetId}`);
  console.log(`  https://twitter.com/i/web/status/${tweetId}`);

  // 4. Save state
  addPostedTweet({
    id: tweetId,
    text: tweetText,
    posted_at: new Date().toISOString(),
    engaged_comment_ids: [],
  });

  markArticlesSeen(freshArticles.slice(0, 8).map((a) => a.link));
  console.log("\n✓ State saved.\n");
}

main().catch((e) => {
  console.error("Fatal error:", e.message);
  process.exit(1);
});
