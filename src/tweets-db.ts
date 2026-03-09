/**
 * tweets-db.ts
 * 
 * Dedicated storage for bot-generated tweets.
 * Separated from state.json (which handles operational state: seen articles, engaged comments).
 * 
 * File: tweets-db.json (committed to repo, auto-updated by GitHub Actions)
 */

import fs from "fs";
import path from "path";

const DB_PATH = path.join(process.cwd(), "tweets-db.json");

export interface TweetRecord {
  id:                          string;
  text:                        string;
  posted_at:                   string;
  type:                        "single" | "thread" | "quote";
  thread_ids?:                 string[];    // ordered tweet IDs if thread
  quoted_tweet_id?:            string;
  quoted_author?:              string;
  // generation context
  tone:                        string;
  reasoning:                   string;
  articles_used:               Array<{ title: string; source: string; link: string }>;
  // predicted grade (at post time)
  predicted_grade:             number;
  predicted_grade_reason:      string;
  predicted_grade_strengths:   string[];
  predicted_grade_weaknesses:  string[];
  // actual engagement (filled 24h later by engage-grades job)
  actual_likes?:               number;
  actual_replies?:             number;
  actual_retweets?:            number;
  actual_impressions?:         number;
  actual_grade?:               number;
  engagement_checked_at?:      string;
  // manual feedback (from Sources Manager UI)
  manual_rating?:              number;
  manual_notes?:               string;
  feedback_at?:                string;
}

interface TweetsDB {
  version: number;
  tweets:  TweetRecord[];
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function load(): TweetsDB {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  } catch {
    return { version: 1, tweets: [] };
  }
}

function save(db: TweetsDB): void {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
}

// ── Write ─────────────────────────────────────────────────────────────────────

export function addTweetRecord(record: TweetRecord): void {
  const db = load();
  if (db.tweets.find(t => t.id === record.id)) return; // no duplicates
  db.tweets.unshift(record);
  save(db);
}

export function updateEngagement(
  tweetId: string,
  data: {
    actual_likes:          number;
    actual_replies:        number;
    actual_retweets:       number;
    actual_impressions:    number;
    actual_grade:          number;
    engagement_checked_at: string;
  }
): void {
  const db = load();
  const tweet = db.tweets.find(t => t.id === tweetId);
  if (tweet) { Object.assign(tweet, data); save(db); }
}

export function updateFeedback(tweetId: string, rating: number, notes: string): void {
  const db = load();
  const tweet = db.tweets.find(t => t.id === tweetId);
  if (tweet) {
    tweet.manual_rating = rating;
    tweet.manual_notes  = notes;
    tweet.feedback_at   = new Date().toISOString();
    save(db);
  }
}

// ── Read ──────────────────────────────────────────────────────────────────────

export function getAllTweets(): TweetRecord[] {
  return load().tweets;
}

export function getTweetsNeedingEngagementCheck(afterHours = 24): TweetRecord[] {
  const cutoff = new Date(Date.now() - afterHours * 60 * 60 * 1000);
  return load().tweets.filter(t =>
    !t.engagement_checked_at &&
    new Date(t.posted_at) < cutoff
  );
}

export function getTopAndLowPerformers(n = 5): { top: TweetRecord[]; low: TweetRecord[] } {
  const graded = load().tweets.filter(t =>
    t.actual_grade !== undefined || t.manual_rating !== undefined
  );
  const score = (t: TweetRecord): number => {
    if (t.actual_grade !== undefined && t.manual_rating !== undefined)
      return (t.actual_grade + t.manual_rating) / 2;
    return t.actual_grade ?? t.manual_rating ?? t.predicted_grade;
  };
  const sorted = [...graded].sort((a, b) => score(b) - score(a));
  return { top: sorted.slice(0, n), low: sorted.slice(-n) };
}
