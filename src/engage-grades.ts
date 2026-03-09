/**
 * engage-grades.ts
 * Runs daily via GitHub Actions.
 * Fetches actual engagement for bot tweets posted 24h+ ago.
 * Updates tweets-db.json and state.json.
 */

import { getTweetsNeedingEngagementCheck, updateEngagement } from "./tweets-db";
import { updateTweetEngagement } from "./state";
import { getTweetEngagement } from "./twitter";

function calcActualGrade(
  likes: number,
  replies: number,
  retweets: number,
  impressions: number
): number {
  if (impressions === 0) {
    const score = Math.min(10, 1 + likes * 0.5 + replies * 1.5 + retweets * 1);
    return Math.round(score);
  }
  const rate  = (likes + replies * 3 + retweets * 2) / impressions * 1000;
  const score = Math.min(10, Math.max(1, 1 + Math.log1p(rate) * 2.5));
  return Math.round(score);
}

async function main() {
  console.log("\n📊 ENGAGEMENT GRADE JOB");
  console.log("─".repeat(40));

  const needsCheck = getTweetsNeedingEngagementCheck(24);
  console.log(`  ${needsCheck.length} tweets need engagement check`);

  let updated = 0;
  for (const tweet of needsCheck) {
    console.log(`\n  Checking ${tweet.id}: "${tweet.text.slice(0, 60)}…"`);

    const eng = await getTweetEngagement(tweet.id);
    const actualGrade = calcActualGrade(eng.likes, eng.replies, eng.retweets, eng.impressions);

    console.log(`    Likes: ${eng.likes}, Replies: ${eng.replies}, Retweets: ${eng.retweets}, Impressions: ${eng.impressions}`);
    console.log(`    Predicted: ${tweet.predicted_grade}/10 → Actual: ${actualGrade}/10`);

    const engData = {
      actual_likes:          eng.likes,
      actual_replies:        eng.replies,
      actual_retweets:       eng.retweets,
      actual_impressions:    eng.impressions,
      actual_grade:          actualGrade,
      engagement_checked_at: new Date().toISOString(),
    };

    // Update both DBs
    updateEngagement(tweet.id, engData);
    updateTweetEngagement(tweet.id, engData); // keep state.json in sync for similarity checks

    updated++;
  }

  console.log(`\n✓ Updated ${updated} tweets\n`);
}

main().catch(e => {
  console.error("Fatal error:", e.message);
  process.exit(1);
});
