import { TwitterApi, TweetV2, TwitterApiReadWrite } from "twitter-api-v2";

let _client: TwitterApiReadWrite | null = null;

function getClient(): TwitterApiReadWrite {
  if (_client) return _client;
  _client = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY!,
    appSecret: process.env.TWITTER_API_SECRET!,
    accessToken: process.env.TWITTER_ACCESS_TOKEN!,
    accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET!,
  }).readWrite;
  return _client;
}

export async function postTweet(text: string): Promise<string> {
  const client = getClient();
  try {
    const result = await client.v2.tweet(text);
    return result.data.id;
  } catch (e: any) {
    console.error("Twitter error details:", JSON.stringify(e?.data || e?.message || e, null, 2));
    throw e;
  }
}

export async function quoteTweet(text: string, quotedTweetId: string): Promise<string> {
  const client = getClient();
  try {
    const result = await client.v2.tweet(text, { quote_tweet_id: quotedTweetId });
    return result.data.id;
  } catch (e: any) {
    console.error("Twitter error details:", JSON.stringify(e?.data || e?.message || e, null, 2));
    throw e;
  }
}

export async function likeTweet(tweetId: string): Promise<void> {
  const client = getClient();
  const me = await client.v2.me();
  await client.v2.like(me.data.id, tweetId);
}

export async function replyToTweet(tweetId: string, text: string): Promise<string> {
  const client = getClient();
  const result = await client.v2.tweet(text, {
    reply: { in_reply_to_tweet_id: tweetId },
  });
  return result.data.id;
}

export interface RawComment {
  id: string;
  text: string;
  author_id: string;
}

export async function getReplies(tweetId: string): Promise<RawComment[]> {
  const client = getClient();
  try {
    const query = `conversation_id:${tweetId} is:reply`;
    const results = await client.v2.search(query, {
      "tweet.fields": ["author_id", "text", "conversation_id"],
      max_results: 20,
    });
    if (!results.data?.data) return [];
    return results.data.data.map((t: TweetV2) => ({
      id: t.id,
      text: t.text,
      author_id: t.author_id || "",
    }));
  } catch (e) {
    console.warn(`Could not fetch replies for tweet ${tweetId}: ${(e as Error).message}`);
    return [];
  }
}

export async function getOwnUserId(): Promise<string> {
  const me = await getClient().v2.me();
  return me.data.id;
}

export interface MonitoredTweet {
  id: string;
  text: string;
  author: string;
  created_at: string;
}

export async function getRecentTweetsFromAccounts(
  handles: string[],
  lookbackHours = 3
): Promise<MonitoredTweet[]> {
  if (handles.length === 0) return [];
  const client = getClient();

  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const results: MonitoredTweet[] = [];

  for (const handle of handles) {
    try {
      // Search for recent tweets from this handle
      const query = `from:${handle} -is:retweet`;
      const res = await client.v2.search(query, {
        "tweet.fields": ["created_at", "author_id", "text"],
        "user.fields": ["username"],
        expansions: ["author_id"],
        max_results: 10,
        start_time: since,
      });

      if (!res.data?.data) continue;

      const users = res.includes?.users || [];
      for (const tweet of res.data.data) {
        const user = users.find((u) => u.id === tweet.author_id);
        results.push({
          id: tweet.id,
          text: tweet.text,
          author: user?.username || handle,
          created_at: tweet.created_at || new Date().toISOString(),
        });
      }
    } catch (e) {
      console.warn(`  Could not fetch tweets from @${handle}: ${(e as Error).message}`);
    }
  }

  return results;
}
