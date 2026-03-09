import fs from "fs";
import path from "path";
import { fetchArticles } from "./sources";
import {
  generateTweet,
  generateQuoteTweet,
  QuoteTweetSource,
  scoreMonitoredTweets,
  gradeTweet,
} from "./claude";
import { postTweet, quoteTweet, getRecentTweetsFromAccounts } from "./twitter";
import {
  Article,
  isArticleNew,
  markArticlesSeen,
  addPostedTweet,
  getRecentTweets,
  saveRawData,
  RawTweetData,
} from "./state";
import { addTweetRecord } from "./tweets-db";

const DRY_RUN   = process.env.DRY_RUN   === "true";
const FORCE_RUN = process.env.FORCE_RUN === "true";
const QUOTE_TWEET_ID    = process.env.QUOTE_TWEET_ID;
const QUOTE_TWEET_TEXT  = process.env.QUOTE_TWEET_TEXT;
const QUOTE_TWEET_AUTHOR = process.env.QUOTE_TWEET_AUTHOR;

const SIMILARITY_THRESHOLD = 0.4;
const LOG_DIR = path.join(process.cwd(), "logs");

// ── Logger ────────────────────────────────────────────────────────────────────

function createLogger() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = path.join(LOG_DIR, `tweet-${timestamp}.md`);
  const lines: string[] = [];
  const log = (line = "") => { console.log(line); lines.push(line); };
  const save = () => {
    fs.writeFileSync(logPath, lines.join("\n"), "utf-8");
    console.log(`\n📋 Log saved: logs/tweet-${timestamp}.md`);
  };
  return { log, save };
}

// ── Similarity ────────────────────────────────────────────────────────────────

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
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

// ── Config ────────────────────────────────────────────────────────────────────

function getMonitoredAccounts(): Array<{ handle: string; name: string }> {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), "sources.json"), "utf-8"));
    return config.monitored_accounts || [];
  } catch {
    return [];
  }
}

function isWithinILHours(): boolean {
  const now = new Date();
  const ilHour = parseInt(
    now.toLocaleString("en-US", { timeZone: "Asia/Jerusalem", hour: "numeric", hour12: false })
  );
  return ilHour >= 8 && ilHour < 23;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!DRY_RUN && !FORCE_RUN && !isWithinILHours()) {
    console.log("Outside IL active hours (08:00–22:00) — skipping.");
    return;
  }
  if (FORCE_RUN) console.log("⚡ FORCE_RUN — bypassing IL hours check");

  const { log, save } = createLogger();
  const runAt = new Date().toISOString();

  log(`# 🦅 Seahawks Bot — Tweet Log`);
  log(`**Run:** ${runAt}${DRY_RUN ? " [DRY RUN]" : ""}`);
  log();
  log("---");

  let tweetText: string = "";
  let tweetId: string | undefined;

  // ── Manual quote tweet mode ──────────────────────────────────────────────────
  if (QUOTE_TWEET_ID && QUOTE_TWEET_TEXT) {
    log();
    log("## Mode: Manual Quote Tweet");
    log(`**Quoting:** "${QUOTE_TWEET_TEXT}"${QUOTE_TWEET_AUTHOR ? ` by @${QUOTE_TWEET_AUTHOR}` : ""}`);

    const source: QuoteTweetSource = {
      tweetId: QUOTE_TWEET_ID,
      tweetText: QUOTE_TWEET_TEXT,
      tweetAuthor: QUOTE_TWEET_AUTHOR,
    };
    const generated = await generateQuoteTweet(source);
    tweetText = generated.text;

    log(`- **Language:** ${generated.language}`);
    log(`- **Tweet:** "${tweetText}"`);

    if (DRY_RUN) { log("\n⏭ DRY RUN — not posted."); save(); return; }

    tweetId = await quoteTweet(tweetText, QUOTE_TWEET_ID);
    log(`- ✓ **Posted:** https://twitter.com/i/web/status/${tweetId}`);

    addPostedTweet({ id: tweetId, text: tweetText, posted_at: runAt, engaged_comment_ids: [] });

  } else {

    // ── Step 1: Check monitored accounts ──────────────────────────────────────
    const accounts = getMonitoredAccounts();
    log();
    log("## [1/5] Monitored Accounts");
    log(`Checking **${accounts.length}** accounts: ${accounts.map(a => `@${a.handle}`).join(", ")}`);

    let quotedFromMonitor = false;

    if (accounts.length > 0) {
      const handles = accounts.map((a) => a.handle);
      const recentTweets = await getRecentTweetsFromAccounts(handles, 3);
      log(`- Found **${recentTweets.length}** tweets in the last 3 hours`);

      if (recentTweets.length > 0) {
        log();
        log("### Scoring tweets:");
        const scored = await scoreMonitoredTweets(recentTweets);
        const worthy = scored.filter((t) => t.worthy).sort((a, b) => b.score - a.score);

        scored.forEach((t) => {
          log(`- @${t.author} [${t.score}/10]: "${t.text.slice(0, 80)}…" — ${t.reason}`);
        });

        if (worthy.length > 0) {
          const best = worthy[0];
          log();
          log(`### Best quote target: @${best.author} (score: ${best.score}/10)`);
          log(`> "${best.text}"`);

          const alreadyQuoted = getRecentTweets(48).some((t) =>
            t.text.includes(best.id) || jaccardSimilarity(t.text, best.text) > 0.5
          );

          if (alreadyQuoted) {
            log("- ⏭ Already quoted this tweet recently, skipping.");
          } else {
            const source: QuoteTweetSource = { tweetId: best.id, tweetText: best.text, tweetAuthor: best.author };
            const generated = await generateQuoteTweet(source);
            tweetText = generated.text;

            log(`- **Language:** ${generated.language}`);
            log(`- **Tweet:** "${tweetText}"`);

            const grade = await gradeTweet(tweetText, `Quote of @${best.author}: ${best.text}`);
            log();
            log("### Self-grade:");
            log(`- **Score:** ${grade.score}/10 — ${grade.reason}`);
            if (grade.strengths.length) log(`- **Strengths:** ${grade.strengths.join(", ")}`);
            if (grade.weaknesses.length) log(`- **Weaknesses:** ${grade.weaknesses.join(", ")}`);

            if (!isTooSimilarToRecent(tweetText, log)) {
              if (!DRY_RUN) {
                tweetId = await quoteTweet(tweetText, best.id);
                log(`- ✓ **Quote-tweeted:** https://twitter.com/i/web/status/${tweetId}`);
                quotedFromMonitor = true;
                addPostedTweet({
                  id: tweetId, text: tweetText, posted_at: runAt,
                  engaged_comment_ids: [],
                  predicted_grade: grade.score,
                  predicted_grade_reason: grade.reason,
                });

                addTweetRecord({
                  id: tweetId,
                  text: tweetText,
                  posted_at: runAt,
                  type: "quote",
                  quoted_tweet_id: best.id,
                  quoted_author: best.author,
                  tone: "quote",
                  reasoning: `Quote of @${best.author} (score: ${best.score}/10): ${best.reason}`,
                  articles_used: [],
                  predicted_grade: grade.score,
                  predicted_grade_reason: grade.reason,
                  predicted_grade_strengths: grade.strengths,
                  predicted_grade_weaknesses: grade.weaknesses,
                });
              } else {
                log("\n⏭ DRY RUN — would quote-tweet above.");
              }
            }
          }
        } else {
          log("- No tweets scored ≥7 — nothing worth quoting.");
        }
      }
    }

    if (quotedFromMonitor) {
      log();
      log("## Quote tweet posted — skipping news tweet this run.");
      log("\n---\n✓ Done.");
      save();
      return;
    }

    // ── Step 2: Fetch news ─────────────────────────────────────────────────────
    log();
    log("## [2/5] News Sources");
    const articles = await fetchArticles();
    const freshArticles = articles.filter((a) => a.link && isArticleNew(a.link));
    log(`- Total: **${articles.length}**, New: **${freshArticles.length}**`);

    if (freshArticles.length === 0) {
      log("\n⏭ No new stories — skipping.");
      save();
      return;
    }

    log();
    log("### Articles considered:");
    freshArticles.slice(0, 6).forEach((a, i) => {
      log(`${i + 1}. **[${a.source}]** ${a.title}`);
      log(`   ${a.content.slice(0, 120)}…`);
    });

    // ── Step 3: Generate ───────────────────────────────────────────────────────
    log();
    log("## [3/5] Claude Generation");
    const generated = await generateTweet(freshArticles);
    tweetText = generated.text;

    log(`- **Language:** ${generated.language}`);
    log(`- **Tone:** ${generated.tone}`);
    log();
    log("### Reasoning:");
    log(generated.reasoning || "_none_");
    log();
    log("### Generated tweet:");
    log(`> ${tweetText}`);
    log(`- **Length:** ${tweetText.length}/280`);

    if (tweetText.length > 280) {
      log("\n❌ Too long — aborting.");
      save();
      process.exit(1);
    }

    // ── Step 4: Similarity check ───────────────────────────────────────────────
    log();
    log("## [4/5] Similarity Check");
    const similarityPassed = !isTooSimilarToRecent(tweetText, log);
    if (!similarityPassed) {
      log("\n⏭ Skipped — too similar to recent tweet.");
      save();
      return;
    }
    log("- ✓ Unique enough to post");

    // ── Step 5: Self-grade ─────────────────────────────────────────────────────
    log();
    log("## [5/5] Self-Grade");
    const grade = await gradeTweet(tweetText, generated.reasoning);
    log(`- **Predicted engagement score:** ${grade.score}/10`);
    log(`- **Reason:** ${grade.reason}`);
    if (grade.strengths.length)  log(`- **Strengths:** ${grade.strengths.join(", ")}`);
    if (grade.weaknesses.length) log(`- **Weaknesses:** ${grade.weaknesses.join(", ")}`);

    if (DRY_RUN) {
      log("\n⏭ DRY RUN — not posted.");
      save();
      return;
    }

    // ── Post ───────────────────────────────────────────────────────────────────
    tweetId = await postTweet(tweetText);
    log();
    log("## Result");
    log(`- ✓ **Posted:** https://twitter.com/i/web/status/${tweetId}`);

    markArticlesSeen(freshArticles.slice(0, 8).map((a) => a.link));

    // Save raw data snapshot
    const rawData: RawTweetData = {
      run_at: runAt,
      articles_fetched: articles.slice(0, 20) as Article[],
      articles_used: freshArticles.slice(0, 8) as Article[],
      tone: generated.tone,
      reasoning: generated.reasoning,
      generated_text: tweetText,
      predicted_grade: grade.score,
      predicted_grade_reason: grade.reason,
      predicted_grade_strengths: grade.strengths,
      predicted_grade_weaknesses: grade.weaknesses,
      similarity_check_passed: similarityPassed,
      posted_tweet_id: tweetId,
    };
    const rawFile = saveRawData(tweetId, rawData);

    addPostedTweet({
      id: tweetId,
      text: tweetText,
      posted_at: runAt,
      engaged_comment_ids: [],
      predicted_grade: grade.score,
      predicted_grade_reason: grade.reason,
      raw_data_file: rawFile || undefined,
    });

    // Save to dedicated tweets DB
    addTweetRecord({
      id: tweetId,
      text: tweetText,
      posted_at: runAt,
      type: "single",
      tone: generated.tone,
      reasoning: generated.reasoning,
      articles_used: freshArticles.slice(0, 8).map(a => ({
        title: a.title,
        source: a.source,
        link: a.link,
      })),
      predicted_grade: grade.score,
      predicted_grade_reason: grade.reason,
      predicted_grade_strengths: grade.strengths,
      predicted_grade_weaknesses: grade.weaknesses,
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
