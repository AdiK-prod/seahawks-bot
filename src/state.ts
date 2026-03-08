import fs from "fs";
import path from "path";

const STATE_PATH = path.join(process.cwd(), "state.json");

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
}

interface State {
  seen_articles: string[];   // URLs
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
  state.seen_articles = updated.slice(-300); // keep last 300
  saveState(state);
}

export function addPostedTweet(tweet: PostedTweet): void {
  const state = loadState();
  state.posted_tweets = [tweet, ...state.posted_tweets].slice(0, 50); // keep last 50
  saveState(state);
}

export function getRecentTweets(hours = 48): PostedTweet[] {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  return loadState().posted_tweets.filter(
    (t) => new Date(t.posted_at) > cutoff
  );
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
