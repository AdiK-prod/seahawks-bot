// Runs daily: fetches actual engagement for tweets posted 24h ago, updates state.json

import { getAllTweets, updateTweetEngagement } from "./state";
import { getTweetEngagement } from "./twitter";

const GRADE_AFTER_HOURS = 24;

function calcActualGrade(likes: number, replies: number, retweets: number, impressions: number): number {
  // Weighted engagement rate score 1–10
  if (impressions === 0) {
    // No impression data — use raw counts
    const score = Math.min(10, 1 + likes * 0.5 + replies * 1.5 + retweets * 1);
    return Math.round(score);
  }
  const rate = (likes + replies * 3 + retweets * 2) / impressions * 1000;
  // rate of ~5 = score 7, ~10 = score 10, ~1 = score 4
  const score = Math.min(10, Math.max(1, 1 + Math.log1p(rate) * 2.5));
  return Math.round(score);
}

async function main() {
  console.log("\n📊 ENGAGEMENT GRADE JOB");
  console.log("─".repeat(40));

  const tweets = getAllTweets();
  const cutoff = new Date(Date.now() - GRADE_AFTER_HOURS * 60 * 60 * 1000);
  const needsCheck = tweets.filter((t) => {
    if (t.engagement_checked_at) return false;          // already graded
    if (!t.predicted_grade) return false;               // not a bot tweet
    return new Date(t.posted_at) < cutoff;              // older than 24h
  });

  console.log(`  ${needsCheck.length} tweets need engagement check`);

  for (const tweet of needsCheck) {
    console.log(`\n  Checking @${tweet.id}: "${tweet.text.slice(0, 60)}…"`);
    const eng = await getTweetEngagement(tweet.id);
    const actualGrade = calcActualGrade(eng.likes, eng.replies, eng.retweets, eng.impressions);

    console.log(`    Likes: ${eng.likes}, Replies: ${eng.replies}, Retweets: ${eng.retweets}, Impressions: ${eng.impressions}`);
    console.log(`    Predicted: ${tweet.predicted_grade}/10 → Actual: ${actualGrade}/10`);

    updateTweetEngagement(tweet.id, {
      actual_likes:        eng.likes,
      actual_replies:      eng.replies,
      actual_retweets:     eng.retweets,
      actual_impressions:  eng.impressions,
      actual_grade:        actualGrade,
      engagement_checked_at: new Date().toISOString(),
    });
  }

  console.log("\n✓ Done.\n");
}

main().catch((e) => {
  console.error("Fatal error:", e.message);
  process.exit(1);
});
