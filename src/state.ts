import fs from "fs";
import path from "path";

const STATE_PATH  = path.join(process.cwd(), "state.json");
const RAWDATA_DIR = path.join(process.cwd(), "raw-data");

// ── Feature flags ─────────────────────────────────────────────────────────────
function isRawDataEnabled(): boolean {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "sources.json"), "utf-8"));
    return cfg.preserve_raw_data !== false; // enabled by default
  } catch {
    return true;
  }
}

export interface Article {
  title: string;
  content: string;
  link: string;
  published: string;
  source: string;
}

export interface PostedTweet {
  id: string;
  text: string;
  posted_at: string;
  engaged_comment_ids: string[];
  // grading
  predicted_grade?: number;
  predicted_grade_reason?: string;
  actual_likes?: number;
  actual_replies?: number;
  actual_retweets?: number;
  actual_impressions?: number;
  actual_grade?: number;
  engagement_checked_at?: string;
  // manual feedback
  manual_rating?: number;
  manual_notes?: string;
  // raw data snapshot reference
  raw_data_file?: string;
}

export interface RawTweetData {
  run_at: string;
  articles_fetched: Article[];
  articles_used: Article[];
  tone: string;
  reasoning: string;
  generated_text: string;
  predicted_grade: number;
  predicted_grade_reason: string;
  predicted_grade_strengths: string[];
  predicted_grade_weaknesses: string[];
  similarity_check_passed: boolean;
  posted_tweet_id?: string;
}

interface State {
  seen_articles: string[];
  posted_tweets: PostedTweet[];
}

function loadState(): State {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
  } catch {
    return { seen_articles: [], posted_tweets: [] };
  }
}

function saveState(state: State): void {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

export function isArticleNew(url: string): boolean {
  return !loadState().seen_articles.includes(url);
}

export function markArticlesSeen(urls: string[]): void {
  const state = loadState();
  const updated = [...new Set([...state.seen_articles, ...urls])];
  state.seen_articles = updated.slice(-300);
  saveState(state);
}

export function addPostedTweet(tweet: PostedTweet): void {
  const state = loadState();
  state.posted_tweets = [tweet, ...state.posted_tweets].slice(0, 100);
  saveState(state);
}

export function getRecentTweets(hours = 48): PostedTweet[] {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  return loadState().posted_tweets.filter(
    (t) => new Date(t.posted_at) > cutoff
  );
}

export function getAllTweets(): PostedTweet[] {
  return loadState().posted_tweets;
}

export function updateTweetEngagement(
  tweetId: string,
  data: Partial<Pick<PostedTweet,
    "actual_likes" | "actual_replies" | "actual_retweets" |
    "actual_impressions" | "actual_grade" | "engagement_checked_at"
  >>
): void {
  const state = loadState();
  const tweet = state.posted_tweets.find((t) => t.id === tweetId);
  if (tweet) {
    Object.assign(tweet, data);
    saveState(state);
  }
}

export function updateTweetFeedback(
  tweetId: string,
  rating: number,
  notes: string
): void {
  const state = loadState();
  const tweet = state.posted_tweets.find((t) => t.id === tweetId);
  if (tweet) {
    tweet.manual_rating = rating;
    tweet.manual_notes  = notes;
    saveState(state);
  }
}

export function markCommentEngaged(tweetId: string, commentId: string): void {
  const state = loadState();
  const tweet = state.posted_tweets.find((t) => t.id === tweetId);
  if (tweet && !tweet.engaged_comment_ids.includes(commentId)) {
    tweet.engaged_comment_ids.push(commentId);
    saveState(state);
  }
}

export function isCommentEngaged(tweetId: string, commentId: string): boolean {
  const tweet = loadState().posted_tweets.find((t) => t.id === tweetId);
  return tweet?.engaged_comment_ids.includes(commentId) ?? false;
}

// ── Raw data preservation ─────────────────────────────────────────────────────

export function saveRawData(tweetId: string, data: RawTweetData): string | null {
  if (!isRawDataEnabled()) return null;
  try {
    if (!fs.existsSync(RAWDATA_DIR)) fs.mkdirSync(RAWDATA_DIR, { recursive: true });
    const filename = `tweet-${tweetId}-${Date.now()}.json`;
    const filepath = path.join(RAWDATA_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
    return filename;
  } catch (e) {
    console.warn("Could not save raw data:", (e as Error).message);
    return null;
  }
}

export function getRawData(filename: string): RawTweetData | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(RAWDATA_DIR, filename), "utf-8"));
  } catch {
    return null;
  }
}
