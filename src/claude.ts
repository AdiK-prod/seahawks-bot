import fs from "fs";
import path from "path";
import { Article } from "./state";

const VOICE_PROFILE_PATH = path.join(process.cwd(), "voice/voice-profile.md");
const SOURCES_CONFIG_PATH = path.join(process.cwd(), "sources.json");

function getVoiceProfile(): string {
  try {
    return fs.readFileSync(VOICE_PROFILE_PATH, "utf-8");
  } catch {
    return "Passionate, analytical Seahawks fan. Short declarative opinions. No hedging.";
  }
}

function getTweetTone(): string {
  try {
    const config = JSON.parse(fs.readFileSync(SOURCES_CONFIG_PATH, "utf-8"));
    return config.tweet_tone || "hot_take";
  } catch {
    return "hot_take";
  }
}

const TONE_INSTRUCTIONS: Record<string, string> = {
  hot_take:   "Strong, provocative opinion. Confident. Willing to be controversial.",
  analytical: "Data-driven and reasoned. Break down WHY something is happening. Cite specifics.",
  frustrated: "Venting frustration. Direct criticism. No sugarcoating.",
  optimistic: "Positive spin. Find the silver lining. Rally the fans.",
};

async function callClaude(system: string, user: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 400,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }

  const data = await response.json() as { content: { text: string }[] };
  return data.content[0].text.trim();
}

// ── Language decision ─────────────────────────────────────────────────────────

async function decideLanguage(content: string): Promise<"hebrew" | "english"> {
  const system = `You decide whether a Seahawks/NFL tweet should be written in Hebrew or English.

RULES:
- DEFAULT IS HEBREW. Always. This is a Hebrew-language account.
- Use ENGLISH only in rare cases: a direct quote that must stay verbatim in English, or a technical stat line (e.g., "3rd & 1 from the 22") where the numbers and yard-line notation would be confusing in Hebrew.
- Opinions, takes, reactions, analysis → ALWAYS HEBREW.
- If you are not 100% sure English is necessary → HEBREW.

Output ONLY one word: "hebrew" or "english"`;

  const result = await callClaude(system, `Topic/content:\n${content}`);
  return result.toLowerCase().includes("english") ? "english" : "hebrew";
}

// ── Tweet generation ──────────────────────────────────────────────────────────

export interface GeneratedTweet {
  text: string;
  language: "hebrew" | "english";
  tone: string;
  reasoning: string;
}

export async function generateTweet(articles: Article[]): Promise<GeneratedTweet> {
  const voiceProfile = getVoiceProfile();
  const tone = getTweetTone();
  const toneInstruction = TONE_INSTRUCTIONS[tone] || TONE_INSTRUCTIONS.hot_take;

  const digest = articles
    .slice(0, 6)
    .map((a) => `• [${a.source}] ${a.title}: ${a.content.slice(0, 150)}`)
    .join("\n");

  const topStory = articles[0] ? `${articles[0].title}: ${articles[0].content}` : digest;
  const language = await decideLanguage(topStory);

  const languageInstruction = language === "hebrew"
    ? `- Write in HEBREW (עברית). RTL text, natural Israeli football fan tone.
- Hebrew slang and football terms are fine (e.g., "קוורטרבק", "דראפט", "פליאאוף")
- Max 260 characters (Hebrew chars count the same)`
    : `- Write in ENGLISH
- Max 260 characters`;

  const system = `You are ghostwriting a tweet for a specific person.

THEIR VOICE PROFILE:
${voiceProfile}

TONE FOR THIS TWEET: ${toneInstruction}

RULES:
- Write EXACTLY ONE tweet
- Apply the tone above — it should be obvious in the writing style
- Sound like a strong opinion, not a news recap
- Match their vocabulary, sentence rhythm, and tone precisely
- No hashtags
- No emojis unless they use them in their profile
- Do NOT start with "אני חושב" / "I think" or "In my opinion"
- Pick ONE angle — don't try to cover everything
${languageInstruction}
- Output your response in this exact format:
REASONING: (1-2 sentences: which story you picked and why, what angle you chose)
TWEET: (the tweet text only)`;

  const user = `Today's NFL/Seahawks news:\n${digest}\n\nWrite a tweet with a sharp opinion on the most interesting story.`;

  const raw = await callClaude(system, user);
  const reasoningMatch = raw.match(/REASONING:\s*(.+?)\n?TWEET:/s);
  const tweetMatch = raw.match(/TWEET:\s*([\s\S]+)$/);
  const reasoning = reasoningMatch ? reasoningMatch[1].trim() : "";
  const text = tweetMatch ? tweetMatch[1].trim() : raw.trim();
  return { text, language, tone: getTweetTone(), reasoning };
}

// ── Quote tweet generation ────────────────────────────────────────────────────

export interface QuoteTweetSource {
  tweetId: string;
  tweetText: string;
  tweetAuthor?: string;
}

export async function generateQuoteTweet(source: QuoteTweetSource): Promise<GeneratedTweet> {
  const voiceProfile = getVoiceProfile();
  const tone = getTweetTone();
  const toneInstruction = TONE_INSTRUCTIONS[tone] || TONE_INSTRUCTIONS.hot_take;

  const language = await decideLanguage(source.tweetText);

  const languageInstruction = language === "hebrew"
    ? `- Write in HEBREW (עברית). Natural Israeli football fan tone.
- Max 240 characters`
    : `- Write in ENGLISH
- Max 240 characters`;

  const system = `You are ghostwriting a quote-tweet for a specific person.

THEIR VOICE PROFILE:
${voiceProfile}

TONE FOR THIS TWEET: ${toneInstruction}

RULES:
- Write a sharp reaction or counter-opinion to the tweet being quoted
- Apply the tone above
- Sound like them — opinionated, direct, no hedging
- No hashtags
- The quoted tweet is already attached, so don't repeat its content — react to it
${languageInstruction}
- Output ONLY the quote-tweet text, nothing else`;

  const author = source.tweetAuthor ? ` by @${source.tweetAuthor}` : "";
  const user = `Tweet${author} being quoted:\n"${source.tweetText}"\n\nWrite a quote-tweet reaction.`;

  const text = await callClaude(system, user);
  return { text, language, tone: getTweetTone(), reasoning: "" };
}

// ── Comment classification ────────────────────────────────────────────────────

export type CommentCategory = "supportive" | "question" | "troll" | "neutral" | "reply_worthy";

export interface ClassifiedComment {
  id: string;
  text: string;
  author_id: string;
  category: CommentCategory;
}

export async function classifyComments(
  comments: Array<{ id: string; text: string; author_id: string }>
): Promise<ClassifiedComment[]> {
  if (comments.length === 0) return [];

  const formatted = comments
    .map((c, i) => `${i + 1}. [id:${c.id}] "${c.text}"`)
    .join("\n");

  const system = `You classify tweets/replies for a Seahawks fan account.
Return ONLY valid JSON — an array of objects, one per comment.
Each object: { "id": "...", "category": "..." }
Categories:
- "supportive": agrees, cheers, positive vibes → we should LIKE this
- "question": asks something genuine → we should REPLY
- "reply_worthy": interesting debate, pushback worth engaging → we should REPLY
- "troll": insults, bad faith, spam → IGNORE
- "neutral": generic reaction, not worth engaging → IGNORE
Output ONLY the JSON array, no markdown, no explanation.`;

  const result = await callClaude(system, `Classify these comments:\n${formatted}`);

  try {
    const parsed = JSON.parse(result);
    return parsed.map((item: { id: string; category: CommentCategory }) => {
      const original = comments.find((c) => c.id === item.id);
      return { ...original, category: item.category };
    });
  } catch {
    console.warn("Failed to parse comment classification, treating all as neutral");
    return comments.map((c) => ({ ...c, category: "neutral" as CommentCategory }));
  }
}

// ── Reply generation ──────────────────────────────────────────────────────────

export async function generateReply(
  originalTweet: string,
  comment: string,
  category: CommentCategory
): Promise<string> {
  const voiceProfile = getVoiceProfile();

  const language = await decideLanguage(comment);

  const toneGuide =
    category === "question"
      ? "Answer their question directly and confidently. Add your opinion."
      : "Engage with their point. Agree, push back, or add nuance — but commit to a stance.";

  const languageInstruction = language === "hebrew"
    ? "- Write in HEBREW (עברית) — the commenter wrote in Hebrew, reply in Hebrew"
    : "- Write in ENGLISH — the commenter wrote in English, reply in English";

  const system = `You are ghostwriting a reply tweet for a specific person.

THEIR VOICE PROFILE:
${voiceProfile}

RULES:
- Max 240 characters
- Sound like them, not a PR account
- ${toneGuide}
- No hashtags
${languageInstruction}
- Output ONLY the reply text, nothing else`;

  const user = `Their original tweet: "${originalTweet}"
Comment they're replying to: "${comment}"

Write a reply.`;

  return callClaude(system, user);
}

// ── Monitor scoring ───────────────────────────────────────────────────────────

export interface ScoredTweet {
  id: string;
  text: string;
  author: string;
  score: number;       // 0-10
  worthy: boolean;     // score >= 7
  reason: string;
}

export async function scoreMonitoredTweets(
  tweets: Array<{ id: string; text: string; author: string }>
): Promise<ScoredTweet[]> {
  if (tweets.length === 0) return [];

  const formatted = tweets
    .map((t, i) => `${i + 1}. [id:${t.id}] @${t.author}: "${t.text}"`)
    .join("\n");

  const system = `You score tweets from NFL insiders for quote-tweet worthiness by a Seahawks fan account.

Score each tweet 0-10:
- 9-10: Breaking Seahawks news (trade, signing, injury, draft pick)
- 7-8: Interesting Seahawks analysis, roster move, or strong take worth reacting to
- 5-6: General NFL news tangentially relevant to Seahawks
- 0-4: Unrelated to Seahawks, generic NFL filler, or not post-worthy

Return ONLY valid JSON array:
[{ "id": "...", "score": 8, "reason": "one sentence why" }]
No markdown, no explanation.`;

  const result = await callClaude(system, `Score these tweets:\n${formatted}`);

  try {
    const parsed = JSON.parse(result);
    return parsed.map((item: { id: string; score: number; reason: string }) => {
      const original = tweets.find((t) => t.id === item.id);
      return {
        ...original,
        score: item.score,
        worthy: item.score >= 7,
        reason: item.reason,
      };
    });
  } catch {
    console.warn("Failed to parse tweet scores, skipping monitored accounts");
    return tweets.map((t) => ({ ...t, score: 0, worthy: false, reason: "parse error" }));
  }
}
