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
  const result = await client.v2.tweet(text);
  return result.data.id;
}

export async function likeTweet(tweetId: string): Promise<void> {
  const client = getClient();
  // Get our own user ID first
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
    // Search for replies to our tweet
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
