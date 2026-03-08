/**
 * Run once after placing your tweets in voice/my-tweets.txt
 * Usage: ts-node src/extract-voice.ts
 */

import fs from "fs";
import path from "path";

const TWEETS_PATH = path.join(process.cwd(), "voice/my-tweets.txt");
const PROFILE_PATH = path.join(process.cwd(), "voice/voice-profile.md");

async function main() {
  if (!fs.existsSync(TWEETS_PATH)) {
    console.error(`✗ Not found: ${TWEETS_PATH}`);
    console.error("  Create this file with your past tweets, one per line.");
    process.exit(1);
  }

  const tweets = fs.readFileSync(TWEETS_PATH, "utf-8").trim();
  const tweetCount = tweets.split("\n").filter((l) => l.trim()).length;
  console.log(`Found ${tweetCount} tweets. Analyzing voice...`);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1200,
      messages: [
        {
          role: "user",
          content: `Analyze these tweets and produce a detailed voice profile that another LLM can use to ghostwrite in this person's style.

TWEETS:
${tweets}

Analyze and describe:
1. Sentence structure patterns (length, complexity, use of fragments?)
2. Vocabulary and recurring words/phrases specific to this person
3. How they frame opinions (declarative? rhetorical? contrarian? hedged?)
4. Emotional tone range (analytical, passionate, sarcastic, dry, frustrated, celebratory)
5. What they tend to push back on vs. celebrate
6. Formatting habits (capitalization, punctuation, emoji usage, hashtag usage)
7. Topics they care most about and their typical angles on those topics
8. 8 example sentence starters or phrase patterns that are distinctly theirs

Format as a concise but detailed style guide a language model can follow precisely.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API error: ${err}`);
  }

  const data = await response.json();
  const profile = data.content[0].text.trim();

  fs.writeFileSync(
    PROFILE_PATH,
    `# Voice Profile\n\n> Auto-generated from ${tweetCount} tweets.\n\n${profile}`
  );

  console.log(`\n✓ Voice profile saved to voice/voice-profile.md`);
  console.log("  Review it and edit manually if anything looks off.");
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
