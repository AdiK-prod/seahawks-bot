/**
 * migrate-tweets.ts
 * One-time migration: copies tweets from state.json → tweets-db.json
 * Safe to run multiple times — skips duplicates.
 * 
 * Run: npx ts-node src/migrate-tweets.ts
 */

import fs from "fs";
import path from "path";

const STATE_PATH = path.join(process.cwd(), "state.json");
const DB_PATH    = path.join(process.cwd(), "tweets-db.json");

function load(p: string) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch { return null; }
}

const state = load(STATE_PATH);
if (!state) { console.error("state.json not found"); process.exit(1); }

const db = load(DB_PATH) || { version: 1, tweets: [] };
const existingIds = new Set(db.tweets.map((t: any) => t.id));

const stateTweets: any[] = state.posted_tweets || [];
let added = 0;

for (const t of stateTweets) {
  if (existingIds.has(t.id)) continue;

  db.tweets.push({
    id:                         t.id,
    text:                       t.text,
    posted_at:                  t.posted_at,
    type:                       "single",
    tone:                       "unknown",
    reasoning:                  "",
    articles_used:              [],
    predicted_grade:            t.predicted_grade            || 0,
    predicted_grade_reason:     t.predicted_grade_reason     || "",
    predicted_grade_strengths:  [],
    predicted_grade_weaknesses: [],
    actual_likes:               t.actual_likes,
    actual_replies:             t.actual_replies,
    actual_retweets:            t.actual_retweets,
    actual_impressions:         t.actual_impressions,
    actual_grade:               t.actual_grade,
    engagement_checked_at:      t.engagement_checked_at,
    manual_rating:              t.manual_rating,
    manual_notes:               t.manual_notes,
  });
  added++;
}

// Sort by posted_at descending
db.tweets.sort((a: any, b: any) =>
  new Date(b.posted_at).getTime() - new Date(a.posted_at).getTime()
);

fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
console.log(`✓ Migrated ${added} tweets from state.json → tweets-db.json`);
console.log(`  Total in tweets-db.json: ${db.tweets.length}`);
