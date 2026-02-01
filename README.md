# OpenClaw Zoho Cliq Channel

Real-time team chat integration for [OpenClaw](https://github.com/openclaw/openclaw) via Zoho Cliq bots.

## Features

- **@Mention Support** - Team members can @mention your AI assistant in any channel
- **Direct Messages** - Private conversations with the bot
- **Dynamic Routing** - Replies go back to the same channel/DM automatically
- **Thread Replies** - Contextual responses in threaded conversations
- **Token Refresh Tool** - Built-in tool to refresh OAuth tokens
- **Multi-Account** - Support for multiple Zoho organizations

## Quick Start

### 1. Install the Plugin

```bash
# From npm (when published)
openclaw plugins install @openclaw/cliq

# Or from source
git clone https://github.com/ibizdigital/openclaw-cliq-channel.git
cd openclaw-cliq-channel
npm install && npm run build
```

Then add to your OpenClaw config (`~/.openclaw/openclaw.json`):

```json
{
  "plugins": {
    "load": {
      "paths": ["/path/to/openclaw-cliq-channel"]
    }
  }
}
```

### 2. Create a Zoho Cliq Bot

1. Go to **Zoho Cliq Admin** → **Bots & Tools** → **Bots**
2. Click **Create Bot**
3. Name it (e.g., "Henry")
4. Add a description and avatar
5. Under **Handlers**, add a **Message Handler**:
   - Set the webhook URL to: `https://your-domain.com/webhooks/cliq`
   - This handles both DMs and @mentions
6. Copy the **Bot Unique Name** (you'll need this)

### 3. Set Up Zoho OAuth

1. Go to [Zoho API Console](https://api-console.zoho.com/)
2. Create a **Self Client**
3. Generate an authorization code with scopes:
   ```
   ZohoCliq.Channels.READ,ZohoCliq.Channels.CREATE,ZohoCliq.Messages.READ,ZohoCliq.Messages.CREATE
   ```
4. Exchange for tokens:
   ```bash
   curl -X POST "https://accounts.zoho.com/oauth/v2/token" \
     -d "grant_type=authorization_code" \
     -d "client_id=YOUR_CLIENT_ID" \
     -d "client_secret=YOUR_CLIENT_SECRET" \
     -d "code=YOUR_AUTH_CODE" \
     -d "redirect_uri=https://example.com"
   ```
5. Save the `access_token` and `refresh_token`

### 4. Configure OpenClaw

> ⚠️ **Important:** Configure Cliq under `plugins.entries.cliq.config`, NOT under `channels.cliq`. Using `channels.cliq` will cause the gateway to crash with "unknown channel id: cliq".

Add to `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "load": {
      "paths": ["/path/to/openclaw-cliq-channel"]
    },
    "entries": {
      "cliq": {
        "enabled": true,
        "config": {
          "enabled": true,
          "orgId": "YOUR_ORG_ID",
          "accessToken": "1000.xxx...",
          "refreshToken": "1000.xxx...",
          "clientId": "1000.YOUR_CLIENT_ID",
          "clientSecret": "YOUR_CLIENT_SECRET",
          "botId": "your_bot_unique_name",
          "botName": "Henry",
          "dm": {
            "policy": "open"
          }
        }
      }
    }
  }
}
```

### 5. Expose the Webhook

Your OpenClaw gateway needs to be accessible from the internet for Zoho to send webhooks.

**Option A: Cloudflare Tunnel (recommended)**
```bash
cloudflared tunnel create openclaw
cloudflared tunnel route dns openclaw webhook.yourdomain.com
# Configure to forward to localhost:34891
```

**Option B: ngrok (for testing)**
```bash
ngrok http 34891
# Use: https://abc123.ngrok.io/webhooks/cliq
```

**Option C: Reverse proxy (nginx/caddy)**
```nginx
location /webhooks/cliq {
    proxy_pass http://localhost:34891;
}
```

### 6. Set the Webhook in Cliq

In your Cliq bot's Message Handler settings, set the webhook URL:
```
https://webhook.yourdomain.com/webhooks/cliq
```

### 7. Restart OpenClaw

```bash
openclaw gateway stop && openclaw gateway start
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `orgId` | string | - | Zoho organization ID (from Cliq admin) |
| `accessToken` | string | - | OAuth access token |
| `refreshToken` | string | - | OAuth refresh token |
| `clientId` | string | - | Zoho API client ID |
| `clientSecret` | string | - | Zoho API client secret |
| `botId` | string | - | Bot unique name from Cliq |
| `botName` | string | "Henry" | Display name (for self-message filtering) |
| `webhookSecret` | string | - | Optional secret for webhook validation |
| `dm.policy` | string | "open" | DM policy: "open", "pairing", "allowlist", "disabled" |
| `dm.allowFrom` | array | [] | Allowed sender IDs (for allowlist policy) |
| `requireMention` | boolean | true | Require @mention in channels |

## Token Refresh

Zoho OAuth tokens expire after 1 hour. You can refresh them:

**Via OpenClaw tool:**
```bash
# The plugin registers a cliq_refresh_token tool
openclaw run "refresh the Cliq token"
```

**Via script (recommended for automation):**

Create `refresh-cliq-token.sh`:
```bash
#!/bin/bash
CLIQ_CONFIG="$HOME/.openclaw/cliq-tokens.json"

# Read current credentials
REFRESH_TOKEN=$(jq -r '.refreshToken' "$CLIQ_CONFIG")
CLIENT_ID=$(jq -r '.clientId' "$CLIQ_CONFIG")
CLIENT_SECRET=$(jq -r '.clientSecret' "$CLIQ_CONFIG")

# Get new access token
RESPONSE=$(curl -s -X POST "https://accounts.zoho.com/oauth/v2/token" \
  -d "refresh_token=$REFRESH_TOKEN" \
  -d "client_id=$CLIENT_ID" \
  -d "client_secret=$CLIENT_SECRET" \
  -d "grant_type=refresh_token")

NEW_TOKEN=$(echo "$RESPONSE" | jq -r '.access_token')

if [ "$NEW_TOKEN" != "null" ]; then
  # Update the config file
  jq --arg token "$NEW_TOKEN" \
    '.plugins.entries.cliq.config.accessToken = $token' \
    ~/.openclaw/openclaw.json > /tmp/oc.json && \
    mv /tmp/oc.json ~/.openclaw/openclaw.json
  echo "Token refreshed: ${NEW_TOKEN:0:20}..."
fi
```

**Automate with cron (every 55 minutes):**
```bash
crontab -e
# Add:
*/55 * * * * /path/to/refresh-cliq-token.sh >> /tmp/cliq-refresh.log 2>&1
```

## How It Works

1. **Webhook receives message** - Zoho Cliq sends a POST to `/webhooks/cliq`
2. **Chat ID extracted** - The plugin uses the `chat.id` from the payload
3. **Message dispatched** - OpenClaw processes via the agent
4. **Reply sent** - Response goes back to the same `chat.id` (works for any channel or DM)

The key insight: Zoho provides a universal `chat.id` that works for both channels and DMs, so replies always go back to the right place.

## Cliq Bot Message Handler (Deluge)

The simplest approach - just forward everything to OpenClaw:

```deluge
response = Map();

webhook_url = "https://your-domain.com/webhooks/cliq";

payload = Map();
payload.put("message", message);
payload.put("user", user);
payload.put("chat", chat);

invokeurl
[
  url: webhook_url
  type: POST
  parameters: payload.toString()
  headers: {"Content-Type": "application/json"}
];

// Return empty - OpenClaw responds asynchronously via the API
return response;
```

## Troubleshooting

### "unknown channel id: cliq" crash

You have `channels.cliq` in your config. Move it to `plugins.entries.cliq.config`:

```bash
# Check for the bad config
jq '.channels | keys' ~/.openclaw/openclaw.json
# Should NOT include "cliq"
```

### Bot not responding

1. Check webhook URL is correct in Cliq bot settings
2. Test the endpoint: `curl -X POST https://your-domain/webhooks/cliq -d '{}'`
3. Check logs: `tail -f ~/.openclaw/logs/gateway.log`

### "oauthtoken_invalid" errors

Token expired. Refresh it:
```bash
./refresh-cliq-token.sh
```

### Replies going to wrong place

The plugin needs a gateway restart to pick up code changes:
```bash
openclaw gateway stop && openclaw gateway start
```

### Telegram timeout errors

The Telegram plugin has a known 500-second polling timeout. It auto-recovers, but you may see errors in logs. This doesn't affect Cliq.

## Development

```bash
# Clone and install
git clone https://github.com/ibizdigital/openclaw-cliq-channel.git
cd openclaw-cliq-channel
npm install

# Build
npm run build

# Watch mode
npm run dev

# Test locally
curl -X POST http://localhost:34891/webhooks/cliq \
  -H "Content-Type: application/json" \
  -d '{"message":{"text":"hello"},"user":{"id":"123","name":"Test"},"chat":{"id":"CT_123","type":"channel"}}'
```

## License

MIT

## Credits

Built by [IBIZ Digital, Inc.](https://ibizdigital.com) for the OpenClaw community.

---

**Need help?** Open an issue on GitHub or join the [OpenClaw Discord](https://discord.com/invite/clawd).
