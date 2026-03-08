import { getReplies, likeTweet, replyToTweet, getOwnUserId } from "./twitter";
import { classifyComments, generateReply } from "./claude";
import {
  getRecentTweets,
  markCommentEngaged,
  isCommentEngaged,
} from "./state";

const DRY_RUN = process.env.DRY_RUN === "true";

// Max replies per engagement run — stay under Twitter rate limits
const MAX_REPLIES_PER_RUN = 5;
const MAX_LIKES_PER_RUN = 15;

async function main() {
  console.log(`\n🦅 SEAHAWKS BOT — ENGAGE JOB ${DRY_RUN ? "[DRY RUN]" : ""}`);
  console.log("─".repeat(50));

  // Get tweets from last 48h that have been posted
  const recentTweets = getRecentTweets(48);
  if (recentTweets.length === 0) {
    console.log("No recent tweets to check. Exiting.");
    return;
  }
  console.log(`\nChecking ${recentTweets.length} recent tweet(s) for replies...`);

  const ownUserId = DRY_RUN ? "dry_run_user" : await getOwnUserId();

  let totalRepliesSent = 0;
  let totalLikesSent = 0;

  for (const tweet of recentTweets) {
    console.log(`\n── Tweet: "${tweet.text.slice(0, 60)}..."`);
    console.log(`   ID: ${tweet.id}`);

    // Fetch replies
    const rawComments = DRY_RUN
      ? [] // can't fetch real replies in dry run
      : await getReplies(tweet.id);

    // Filter out own replies and already-engaged
    const unengaged = rawComments.filter(
      (c) => c.author_id !== ownUserId && !isCommentEngaged(tweet.id, c.id)
    );

    if (unengaged.length === 0) {
      console.log("   No new comments to engage with.");
      continue;
    }

    console.log(`   ${unengaged.length} new comment(s) found`);

    // Classify with Claude
    console.log("   Classifying comments...");
    const classified = await classifyComments(unengaged);

    for (const comment of classified) {
      console.log(`\n   Comment [${comment.category}]: "${comment.text.slice(0, 80)}"`);

      // ── LIKE supportive comments ──────────────────────────────────────────
      if (comment.category === "supportive" && totalLikesSent < MAX_LIKES_PER_RUN) {
        console.log("   → Liking...");
        if (!DRY_RUN) {
          try {
            await likeTweet(comment.id);
            console.log("   ✓ Liked");
          } catch (e) {
            console.warn(`   ✗ Like failed: ${(e as Error).message}`);
          }
        } else {
          console.log("   [DRY RUN] Would like this comment");
        }
        markCommentEngaged(tweet.id, comment.id);
        totalLikesSent++;
        continue;
      }

      // ── REPLY to questions and reply-worthy comments ──────────────────────
      if (
        (comment.category === "question" || comment.category === "reply_worthy") &&
        totalRepliesSent < MAX_REPLIES_PER_RUN
      ) {
        console.log("   → Generating reply...");
        try {
          const replyText = await generateReply(tweet.text, comment.text, comment.category);
          console.log(`   Reply (${replyText.length} chars): "${replyText}"`);

          if (!DRY_RUN) {
            const replyId = await replyToTweet(comment.id, replyText);
            console.log(`   ✓ Replied (ID: ${replyId})`);
          } else {
            console.log("   [DRY RUN] Would post reply above");
          }

          markCommentEngaged(tweet.id, comment.id);
          totalRepliesSent++;

          // Small delay between replies to avoid rate limits
          if (!DRY_RUN) await sleep(3000);
        } catch (e) {
          console.warn(`   ✗ Reply failed: ${(e as Error).message}`);
        }
        continue;
      }

      // ── IGNORE trolls and neutral ─────────────────────────────────────────
      if (comment.category === "troll" || comment.category === "neutral") {
        console.log("   → Ignoring (troll/neutral)");
        markCommentEngaged(tweet.id, comment.id); // mark so we don't re-evaluate
      }
    }
  }

  console.log(`\n✓ Engagement run complete.`);
  console.log(`  Replies sent: ${totalRepliesSent}`);
  console.log(`  Likes sent: ${totalLikesSent}\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((e) => {
  console.error("Fatal error:", e.message);
  process.exit(1);
});
