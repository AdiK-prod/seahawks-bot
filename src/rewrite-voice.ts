/**
 * rewrite-voice.ts
 * Triggered manually from Sources Manager → "Rewrite Voice Profile" button,
 * or can be automated once enough graded tweets exist.
 * 
 * Reads tweets-db.json → finds top/low performers → Claude rewrites voice-profile.md
 */

import fs from "fs";
import path from "path";
import { getTopAndLowPerformers, getAllTweets } from "./tweets-db";
import { rewriteVoiceProfile } from "./claude";

const VOICE_PATH = path.join(process.cwd(), "voice/voice-profile.md");
const MIN_GRADED = 5; // minimum graded tweets before rewrite makes sense

async function main() {
  console.log("\n🧠 VOICE PROFILE REWRITE JOB");
  console.log("─".repeat(40));

  const allTweets = getAllTweets();
  const gradedTweets = allTweets.filter(t =>
    t.actual_grade !== undefined || t.manual_rating !== undefined
  );

  console.log(`  Total bot tweets: ${allTweets.length}`);
  console.log(`  Graded tweets:    ${gradedTweets.length}`);

  if (gradedTweets.length < MIN_GRADED) {
    console.log(`\n  Need at least ${MIN_GRADED} graded tweets to rewrite — skipping.`);
    console.log(`  Currently have ${gradedTweets.length}. Keep posting and grading!\n`);
    return;
  }

  const { top, low } = getTopAndLowPerformers(5);

  console.log("\n  Top performers:");
  top.forEach(t => {
    const score = t.actual_grade ?? t.manual_rating ?? t.predicted_grade;
    console.log(`    [${score}/10] "${t.text.slice(0, 80)}…"`);
    if (t.manual_notes) console.log(`           Note: "${t.manual_notes}"`);
  });

  console.log("\n  Low performers:");
  low.forEach(t => {
    const score = t.actual_grade ?? t.manual_rating ?? t.predicted_grade;
    console.log(`    [${score}/10] "${t.text.slice(0, 80)}…"`);
    if (t.manual_notes) console.log(`           Note: "${t.manual_notes}"`);
  });

  const currentProfile = fs.existsSync(VOICE_PATH)
    ? fs.readFileSync(VOICE_PATH, "utf-8")
    : "No existing profile — create from scratch.";

  console.log("\n  Calling Claude to rewrite voice profile...");

  const topForClaude = top.map(t => ({
    text:  t.text,
    score: t.actual_grade ?? t.manual_rating ?? t.predicted_grade,
    notes: t.manual_notes,
  }));
  const lowForClaude = low.map(t => ({
    text:  t.text,
    score: t.actual_grade ?? t.manual_rating ?? t.predicted_grade,
    notes: t.manual_notes,
  }));

  const newProfile = await rewriteVoiceProfile(currentProfile, topForClaude, lowForClaude);

  // Back up existing profile
  if (fs.existsSync(VOICE_PATH)) {
    const backup = VOICE_PATH.replace(".md", `-backup-${Date.now()}.md`);
    fs.copyFileSync(VOICE_PATH, backup);
    console.log(`  Backed up → ${path.basename(backup)}`);
  }

  fs.writeFileSync(VOICE_PATH, newProfile, "utf-8");
  console.log("  ✓ voice/voice-profile.md rewritten\n");
}

main().catch(e => {
  console.error("Fatal error:", e.message);
  process.exit(1);
});
