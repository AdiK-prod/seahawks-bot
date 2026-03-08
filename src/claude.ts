import fs from "fs";
import path from "path";
import { Article } from "./state";

const VOICE_PROFILE_PATH = path.join(process.cwd(), "voice/voice-profile.md");

function getVoiceProfile(): string {
  try {
    return fs.readFileSync(VOICE_PROFILE_PATH, "utf-8");
  } catch {
    return "Passionate, analytical Seahawks fan. Short declarative opinions. No hedging.";
  }
}

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
      max_tokens: 300,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.content[0].text.trim();
}

// ── Tweet generation ──────────────────────────────────────────────────────────

export async function generateTweet(articles: Article[]): Promise<string> {
  const voiceProfile = getVoiceProfile();
  const digest = articles
    .slice(0, 6)
    .map((a) => `• [${a.source}] ${a.title}: ${a.content.slice(0, 150)}`)
    .join("\n");

  const system = `You are ghostwriting a tweet for a specific person.

THEIR VOICE PROFILE:
${voiceProfile}

RULES:
- Write EXACTLY ONE tweet, max 260 characters
- Sound like a strong opinion, not a news recap
- Match their vocabulary, sentence rhythm, and tone precisely
- No hashtags
- No emojis unless they use them in their profile
- Do NOT start with "I think" or "In my opinion"
- Pick ONE angle — don't try to cover everything
- Output ONLY the tweet text, nothing else`;

  const user = `Today's NFL/Seahawks news:\n${digest}\n\nWrite a tweet with a sharp opinion on the most interesting story.`;

  return callClaude(system, user);
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

  const toneGuide =
    category === "question"
      ? "Answer their question directly and confidently. Add your opinion."
      : "Engage with their point. Agree, push back, or add nuance — but commit to a stance.";

  const system = `You are ghostwriting a reply tweet for a specific person.

THEIR VOICE PROFILE:
${voiceProfile}

RULES:
- Max 240 characters
- Sound like them, not a PR account
- ${toneGuide}
- No hashtags
- Output ONLY the reply text, nothing else`;

  const user = `Their original tweet: "${originalTweet}"
Comment they're replying to: "${comment}"

Write a reply.`;

  return callClaude(system, user);
}
