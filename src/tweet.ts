import fs from "fs";
import path from "path";
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

const SIMILARITY_THRESHOLD = 0.4;
const LOG_DIR = path.join(process.cwd(), "logs");

// ── Logger ────────────────────────────────────────────────────────────────────

function createLogger() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = path.join(LOG_DIR, `tweet-${timestamp}.md`);
  const lines: string[] = [];

  const log = (line = "") => {
    console.log(line);
    lines.push(line);
  };

  const save = () => {
    fs.writeFileSync(logPath, lines.join("\n"), "utf-8");
    console.log(`\n📋 Log saved: logs/tweet-${timestamp}.md`);
  };

  return { log, save, logPath };
}

// ── Similarity ────────────────────────────────────────────────────────────────

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\u0590-\u05ff\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 3)
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

function isTooSimilarToRecent(candidate: string, log: (s?: string) => void): boolean {
  const recentTweets = getRecentTweets(48);
  for (const tweet of recentTweets) {
    const score = jaccardSimilarity(candidate, tweet.text);
    if (score >= SIMILARITY_THRESHOLD) {
      log(`  ⚠ Too similar (score: ${score.toFixed(2)}) to: "${tweet.text.slice(0, 80)}…"`);
      return true;
    }
  }
  return false;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { log, save } = createLogger();

  const runAt = new Date().toISOString();
  log(`# 🦅 Seahawks Bot — Tweet Log`);
  log(`**Run:** ${runAt}${DRY_RUN ? " [DRY RUN]" : ""}`);
  log();
  log("---");

  let tweetText: string;
  let language: string;
  let tweetId: string | undefined;

  // ── Quote tweet mode ────────────────────────────────────────────────────────
  if (QUOTE_TWEET_ID && QUOTE_TWEET_TEXT) {
    log();
    log("## Mode: Quote Tweet");
    log(`**Quoting:** "${QUOTE_TWEET_TEXT}"${QUOTE_TWEET_AUTHOR ? ` by @${QUOTE_TWEET_AUTHOR}` : ""}`);

    log();
    log("## Generating via Claude...");
    const source: QuoteTweetSource = {
      tweetId: QUOTE_TWEET_ID,
      tweetText: QUOTE_TWEET_TEXT,
      tweetAuthor: QUOTE_TWEET_AUTHOR,
    };
    const generated = await generateQuoteTweet(source);
    tweetText = generated.text;
    language = generated.language;

    log();
    log("## Result");
    log(`- **Language:** ${language}`);
    log(`- **Length:** ${tweetText.length} chars`);
    log(`- **Tweet:** "${tweetText}"`);

    if (DRY_RUN) {
      log();
      log("⏭ DRY RUN — not posted.");
      save();
      return;
    }

    tweetId = await quoteTweet(tweetText, QUOTE_TWEET_ID);
    log(`- **Posted:** https://twitter.com/i/web/status/${tweetId}`);

  // ── Regular tweet mode ──────────────────────────────────────────────────────
  } else {
    log();
    log("## Mode: Regular Tweet from News");

    log();
    log("## [1/3] News Sources");
    const articles = await fetchArticles();
    const freshArticles = articles.filter((a) => a.link && isArticleNew(a.link));
    log(`- Total articles fetched: **${articles.length}**`);
    log(`- New (unseen) articles: **${freshArticles.length}**`);

    if (freshArticles.length === 0) {
      log();
      log("⏭ No new stories — skipping.");
      save();
      return;
    }

    log();
    log("### Articles considered:");
    freshArticles.slice(0, 6).forEach((a, i) => {
      log(`${i + 1}. **[${a.source}]** ${a.title}`);
      log(`   ${a.content.slice(0, 120)}…`);
      log(`   ${a.link}`);
    });

    log();
    log("## [2/3] Claude Generation");
    const generated = await generateTweet(freshArticles);
    tweetText = generated.text;
    language = generated.language;

    log(`- **Language decided:** ${language}`);
    log(`- **Tone used:** ${generated.tone || "from sources.json"}`);
    log();
    log("### Reasoning:");
    log(generated.reasoning || "_No reasoning returned_");
    log();
    log("### Generated tweet:");
    log(`> ${tweetText}`);
    log(`- **Length:** ${tweetText.length}/280 chars`);

    if (tweetText.length > 280) {
      log();
      log("❌ Tweet too long — aborting.");
      save();
      process.exit(1);
    }

    log();
    log("## [3/3] Similarity Check");
    const recentTweets = getRecentTweets(48);
    log(`- Comparing against **${recentTweets.length}** tweets from the last 48h`);

    if (isTooSimilarToRecent(tweetText, log)) {
      log();
      log("⏭ Skipped — too similar to a recent tweet.");
      save();
      return;
    }
    log("- ✓ Unique enough to post");

    if (DRY_RUN) {
      log();
      log("⏭ DRY RUN — not posted.");
      save();
      return;
    }

    tweetId = await postTweet(tweetText);
    log();
    log("## Result");
    log(`- ✓ **Posted:** https://twitter.com/i/web/status/${tweetId}`);

    markArticlesSeen(freshArticles.slice(0, 8).map((a) => a.link));
  }

  if (tweetId) {
    addPostedTweet({
      id: tweetId,
      text: tweetText,
      posted_at: new Date().toISOString(),
      engaged_comment_ids: [],
    });
  }

  log();
  log("---");
  log("✓ Done.");
  save();
}

main().catch((e) => {
  console.error("Fatal error:", e.message);
  process.exit(1);
});
