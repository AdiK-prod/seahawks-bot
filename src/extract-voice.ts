/**
 * extract-voice.ts
 * One-time (or occasional) script to build voice-profile.md from your Twitter archive.
 * 
 * Steps:
 *   1. Go to twitter.com → Settings → Your Account → Download an archive
 *   2. Wait for the email (can take up to 24h)
 *   3. Unzip → copy data/tweets.js into voice/my-tweets.js
 *      OR export as CSV and save as voice/my-tweets.csv
 *   4. Run: npx ts-node src/extract-voice.ts
 *   5. Review voice/voice-profile.md and commit
 *   6. Add voice/my-tweets.js and voice/my-tweets.csv to .gitignore
 */

import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";

const VOICE_DIR      = path.join(process.cwd(), "voice");
const PROFILE_PATH   = path.join(VOICE_DIR, "voice-profile.md");
const TWEETS_JS_PATH = path.join(VOICE_DIR, "my-tweets.js");
const TWEETS_CSV_PATH= path.join(VOICE_DIR, "my-tweets.csv");

// ── Parsers ───────────────────────────────────────────────────────────────────

function parseTweetsJs(filePath: string): string[] {
  let raw = fs.readFileSync(filePath, "utf-8");
  // Archive format: window.YTD.tweets.part0 = [...] or window.YTD.tweet.part0 = [...]
  raw = raw.replace(/^window\.YTD\.\w+\.part\d+\s*=\s*/, "");
  const data = JSON.parse(raw);
  return data
    .map((item: any) => item.tweet?.full_text || item.full_text || "")
    .filter((t: string) => t && !t.startsWith("RT @"))
    .map((t: string) => t.replace(/https?:\/\/\S+/g, "").trim())
    .filter((t: string) => t.length > 20);
}

function parseTweetsCsv(filePath: string): string[] {
  const raw   = fs.readFileSync(filePath, "utf-8");
  const lines = raw.split("\n").slice(1);
  return lines
    .map(line => {
      const match = line.match(/^[^,]*,[^,]*,[^,]*,"?(.*?)"?(?:,.*)?$/s);
      return match ? match[1].replace(/""/g, '"').trim() : "";
    })
    .filter(t => t && !t.startsWith("RT @") && t.length > 20)
    .map(t => t.replace(/https?:\/\/\S+/g, "").trim());
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🎙️  VOICE TRAINING — Extract Voice Profile");
  console.log("─".repeat(50));

  if (!fs.existsSync(VOICE_DIR)) fs.mkdirSync(VOICE_DIR, { recursive: true });

  let tweets: string[] = [];

  if (fs.existsSync(TWEETS_JS_PATH)) {
    console.log("  Reading voice/my-tweets.js...");
    tweets = parseTweetsJs(TWEETS_JS_PATH);
  } else if (fs.existsSync(TWEETS_CSV_PATH)) {
    console.log("  Reading voice/my-tweets.csv...");
    tweets = parseTweetsCsv(TWEETS_CSV_PATH);
  } else {
    console.error(`
  ✗ No tweet archive found. Expected one of:
      voice/my-tweets.js   (from Twitter archive — data/tweets.js)
      voice/my-tweets.csv  (exported CSV)
    `);
    process.exit(1);
  }

  console.log(`  Parsed ${tweets.length} original tweets (excluding retweets)`);

  // Prioritize longer tweets (more opinionated), cap at 200
  const sample = [...tweets].sort((a, b) => b.length - a.length).slice(0, 200);
  console.log(`  Using top ${sample.length} tweets for analysis`);

  const currentProfile = fs.existsSync(PROFILE_PATH)
    ? fs.readFileSync(PROFILE_PATH, "utf-8")
    : "No existing profile — build from scratch.";

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  console.log("\n  Calling Claude to analyze voice patterns...");

  const response = await client.messages.create({
    model:      "claude-sonnet-4-5",
    max_tokens: 2000,
    system: `You are analyzing a person's tweets to extract their authentic voice and writing style.
Your goal: update the existing voice-profile.md to reflect the person's real patterns.

Identify:
- Sentence structure, length, rhythm — what feels natural to them
- Specific words, phrases, expressions they actually use
- How they mix Hebrew and English (if applicable)
- Their opinion vs fact ratio — are they declarative or exploratory?
- Humor style — irony, sarcasm, callbacks, exaggeration?
- What topics get them most passionate (longer, more detailed tweets)
- What they avoid

Keep the existing structure. Enrich with real observed patterns and examples from their tweets.
Return ONLY the updated markdown file — no preamble or explanation.`,
    messages: [{
      role: "user",
      content: `Current voice-profile.md:\n${currentProfile}\n\n---\n\n${sample.length} sample tweets:\n${sample.map((t, i) => `${i + 1}. ${t}`).join("\n")}`
    }]
  });

  const updatedProfile = (response.content[0] as { type: string; text: string }).text;

  // Back up existing
  if (fs.existsSync(PROFILE_PATH)) {
    const backup = PROFILE_PATH.replace(".md", `-backup-${Date.now()}.md`);
    fs.copyFileSync(PROFILE_PATH, backup);
    console.log(`  Backed up existing profile → ${path.basename(backup)}`);
  }

  fs.writeFileSync(PROFILE_PATH, updatedProfile, "utf-8");
  console.log("  ✓ voice/voice-profile.md updated\n");

  console.log("  Next steps:");
  console.log("  1. Review voice/voice-profile.md");
  console.log("  2. git add voice/voice-profile.md");
  console.log("  3. git commit -m 'feat: update voice profile from tweet archive'");
  console.log("  4. Add voice/my-tweets.js to .gitignore (personal data)\n");
}

main().catch(e => {
  console.error("Fatal error:", e.message);
  process.exit(1);
});
