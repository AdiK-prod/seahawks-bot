// Triggered manually or after feedback: rewrites voice-profile.md based on top/low performers

import fs from "fs";
import path from "path";
import { getAllTweets } from "./state";
import { rewriteVoiceProfile } from "./claude";

const VOICE_PATH = path.join(process.cwd(), "voice/voice-profile.md");
const MIN_TWEETS = 5; // need at least this many graded tweets

function combinedScore(t: { actual_grade?: number; manual_rating?: number; predicted_grade?: number }): number {
  if (t.actual_grade !== undefined && t.manual_rating !== undefined)
    return (t.actual_grade + t.manual_rating) / 2;
  return t.actual_grade ?? t.manual_rating ?? t.predicted_grade ?? 5;
}

async function main() {
  console.log("\n🧠 VOICE PROFILE REWRITE JOB");
  console.log("─".repeat(40));

  const tweets = getAllTweets().filter((t) =>
    t.actual_grade !== undefined || t.manual_rating !== undefined
  );

  console.log(`  ${tweets.length} graded tweets available`);

  if (tweets.length < MIN_TWEETS) {
    console.log(`  Need at least ${MIN_TWEETS} graded tweets — skipping.`);
    return;
  }

  const sorted = [...tweets].sort((a, b) => combinedScore(b) - combinedScore(a));
  const topTweets = sorted.slice(0, 5).map((t) => ({
    text: t.text,
    score: combinedScore(t),
    notes: t.manual_notes,
  }));
  const lowTweets = sorted.slice(-5).map((t) => ({
    text: t.text,
    score: combinedScore(t),
    notes: t.manual_notes,
  }));

  console.log("\n  Top performers:");
  topTweets.forEach((t) => console.log(`    [${t.score.toFixed(1)}] "${t.text.slice(0, 80)}…"`));
  console.log("\n  Low performers:");
  lowTweets.forEach((t) => console.log(`    [${t.score.toFixed(1)}] "${t.text.slice(0, 80)}…"`));

  const currentProfile = fs.existsSync(VOICE_PATH)
    ? fs.readFileSync(VOICE_PATH, "utf-8")
    : "No existing profile.";

  console.log("\n  Rewriting voice profile via Claude...");
  const newProfile = await rewriteVoiceProfile(currentProfile, topTweets, lowTweets);

  // Back up old profile
  const backupPath = VOICE_PATH.replace(".md", `-backup-${Date.now()}.md`);
  if (fs.existsSync(VOICE_PATH)) fs.copyFileSync(VOICE_PATH, backupPath);

  fs.writeFileSync(VOICE_PATH, newProfile, "utf-8");
  console.log("  ✓ voice-profile.md rewritten");
  console.log(`  Backup: ${path.basename(backupPath)}`);
  console.log("\n✓ Done.\n");
}

main().catch((e) => {
  console.error("Fatal error:", e.message);
  process.exit(1);
});
