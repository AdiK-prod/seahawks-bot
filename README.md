# 🦅 Seahawks Opinion Bot

Auto-tweets NFL/Seahawks opinions twice daily and engages with replies — powered by Claude.

## How It Works

```
NFL RSS Feeds → Claude (voice-trained) → Auto-Tweet → GitHub Actions
                                              ↓
                                    Comment Engagement (3x/day)
                                    • Like supportive comments
                                    • Reply to questions & debates
                                    • Ignore trolls
```

---

## Setup (15 minutes)

### 1. Twitter Developer Access

1. Go to [developer.twitter.com](https://developer.twitter.com) → Create Project + App
2. Apply for **Elevated access** (required for search/reply)
3. Set App permissions to **Read and Write**
4. Generate all four tokens

### 2. GitHub Secrets

In your repo → **Settings → Secrets and variables → Actions**:

| Secret | Where to get it |
|--------|----------------|
| `TWITTER_API_KEY` | Twitter Developer Portal |
| `TWITTER_API_SECRET` | Twitter Developer Portal |
| `TWITTER_ACCESS_TOKEN` | Twitter Developer Portal |
| `TWITTER_ACCESS_TOKEN_SECRET` | Twitter Developer Portal |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |

### 3. Install & Test Locally

```bash
npm install
cp .env.example .env   # fill in your keys

# Test without posting
npm run dry-tweet
npm run dry-engage
```

### 4. Voice Training (when ready)

```bash
# 1. Put your past tweets in this file (one per line)
voice/my-tweets.txt

# 2. Run the extractor
ANTHROPIC_API_KEY=your-key npx ts-node src/extract-voice.ts

# 3. Review and edit voice/voice-profile.md if needed
# 4. Commit voice/voice-profile.md to the repo
```

---

## Schedule

| Job | Times (UTC) | What it does |
|-----|-------------|--------------|
| Tweet | 12:00, 22:00 | Fetch news → generate opinion → post |
| Engage | 14:00, 18:00, 00:00 | Check replies → like/reply/ignore |

To change times, edit `.github/workflows/tweet.yml` and `engage.yml`.

---

## Manual Triggers

In GitHub → **Actions** tab → select a workflow → **Run workflow**

Use `dry_run: true` to test without posting.

---

## File Structure

```
├── src/
│   ├── tweet.ts          # Tweet job entry point
│   ├── engage.ts         # Engagement job entry point
│   ├── sources.ts        # RSS feed fetcher
│   ├── claude.ts         # Claude API (tweet gen, comment classification, reply gen)
│   ├── twitter.ts        # Twitter API wrapper
│   ├── state.ts          # State management (no DB needed)
│   └── extract-voice.ts  # One-time voice profile generator
├── voice/
│   ├── my-tweets.txt     # Your tweets (gitignored)
│   └── voice-profile.md  # Extracted style guide (committed)
├── state.json            # Tracks seen articles + posted tweets
├── sources.json          # RSS feed list + config
└── .github/workflows/
    ├── tweet.yml
    └── engage.yml
```

---

## Guardrails

- **Rate limits:** Max 5 replies + 15 likes per engagement run
- **Deduplication:** Won't tweet the same news twice (state.json tracks seen articles)
- **Troll protection:** Claude classifies and ignores bad-faith comments
- **Dry run:** Set `DRY_RUN=true` to test everything without posting

---

## Cost Estimate

| Resource | Usage | Cost |
|----------|-------|------|
| GitHub Actions | ~3 min/run × 5 runs/day | Free (2,000 min/month) |
| Claude API | ~800 tokens/tweet × 60/month | ~$0.15/month |
| Twitter API | Free tier (17 tweets/day cap) | Free |

**Total: ~$0.15/month**
