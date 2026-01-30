# OpenClaw Zoho Cliq Channel

Real-time team chat integration for [OpenClaw](https://github.com/openclaw/openclaw) via Zoho Cliq bots.

## Features

- **@Mention Support** - Team members can @mention your AI assistant in any channel
- **Direct Messages** - Private conversations with the bot
- **Thread Replies** - Contextual responses in threaded conversations
- **Auto Token Refresh** - OAuth tokens refresh automatically
- **Multi-Account** - Support for multiple Zoho organizations

## Quick Start

### 1. Install the Plugin

```bash
openclaw plugins install @openclaw/cliq
```

Or for development:

```bash
git clone https://github.com/ibizdigital/openclaw-cliq-channel.git
cd openclaw-cliq-channel
npm install && npm run build
openclaw plugins install -l .
```

### 2. Create a Zoho Cliq Bot

1. Go to **Zoho Cliq Admin** → **Bots & Tools** → **Bots**
2. Click **Create Bot**
3. Name it (e.g., "Henry")
4. Add a description and avatar
5. Under **Handlers**, enable:
   - **Message Handler** - For DMs
   - **Mention Handler** - For @mentions in channels
6. Copy the **Bot Unique Name** (you'll need this)

### 3. Set Up Zoho OAuth

1. Go to [Zoho API Console](https://api-console.zoho.com/)
2. Create a **Self Client**
3. Generate a code with scopes:
   ```
   ZohoCliq.Channels.READ,ZohoCliq.Channels.CREATE,ZohoCliq.Messages.READ,ZohoCliq.Messages.CREATE
   ```
4. Exchange for tokens:
   ```bash
   curl -s -X POST "https://accounts.zoho.com/oauth/v2/token" \
     -d "grant_type=authorization_code" \
     -d "client_id=YOUR_CLIENT_ID" \
     -d "client_secret=YOUR_CLIENT_SECRET" \
     -d "code=YOUR_AUTH_CODE"
   ```
5. Save the `access_token` and `refresh_token`

### 4. Configure OpenClaw

Add to your OpenClaw config (`~/.openclaw/config.json`):

```json
{
  "channels": {
    "cliq": {
      "enabled": true,
      "orgId": "YOUR_ORG_ID",
      "accessToken": "1000.xxx...",
      "refreshToken": "1000.xxx...",
      "clientId": "1000.xxx",
      "clientSecret": "xxx",
      "botId": "YOUR_BOT_UNIQUE_NAME",
      "botName": "Henry",
      "dm": {
        "policy": "open"
      }
    }
  }
}
```

### 5. Configure Cliq Bot Webhook

In your Cliq bot settings, set the webhook URL to:

```
https://your-openclaw-gateway.com/webhooks/cliq
```

For local development with ngrok:

```bash
ngrok http 3000
# Use the ngrok URL: https://abc123.ngrok.io/webhooks/cliq
```

### 6. Restart OpenClaw

```bash
openclaw gateway restart
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `orgId` | string | - | Zoho organization ID |
| `accessToken` | string | - | OAuth access token |
| `refreshToken` | string | - | OAuth refresh token |
| `clientId` | string | - | Zoho API client ID |
| `clientSecret` | string | - | Zoho API client secret |
| `botId` | string | - | Bot unique name from Cliq |
| `botName` | string | "Henry" | Display name (for self-message filtering) |
| `webhookSecret` | string | - | Optional secret for webhook validation |
| `dm.policy` | string | "open" | DM policy: "open", "pairing", "allowlist" |
| `dm.allowFrom` | array | [] | Allowed sender IDs (for allowlist policy) |

## Multi-Account Setup

```json
{
  "channels": {
    "cliq": {
      "accounts": {
        "default": {
          "enabled": true,
          "orgId": "ORG_1",
          "accessToken": "...",
          "botId": "henry-main"
        },
        "secondary": {
          "enabled": true,
          "orgId": "ORG_2",
          "accessToken": "...",
          "botId": "henry-secondary"
        }
      }
    }
  }
}
```

## Bot Handler Setup (Deluge)

In your Cliq bot's **Message Handler**, use this Deluge code:

```deluge
response = Map();

// Forward to OpenClaw
webhook_url = "https://your-openclaw-gateway.com/webhooks/cliq";

payload = Map();
payload.put("message", message);
payload.put("user", user);
payload.put("chat", chat);
payload.put("handler", "message");

post_response = invokeurl
[
  url: webhook_url
  type: POST
  parameters: payload.toString()
  headers: {"Content-Type": "application/json"}
];

// Return empty to let OpenClaw respond asynchronously
return response;
```

For the **Mention Handler**:

```deluge
response = Map();

webhook_url = "https://your-openclaw-gateway.com/webhooks/cliq";

payload = Map();
payload.put("message", message);
payload.put("user", user);
payload.put("chat", chat);
payload.put("channel", channel);
payload.put("mentions", mentions);
payload.put("handler", "mention");

post_response = invokeurl
[
  url: webhook_url
  type: POST
  parameters: payload.toString()
  headers: {"Content-Type": "application/json"}
];

return response;
```

## Token Refresh

Tokens are automatically refreshed every 50 minutes. You can also manually refresh:

```bash
# Via OpenClaw tool
openclaw run "refresh the Cliq token"

# Or via the existing script (if using zoho-desk-mcp)
cd ~/clawd/zoho-desk-mcp-server && ./refresh-token.sh
```

## Troubleshooting

### Bot not responding to mentions

1. Check that the Mention Handler is enabled in Cliq bot settings
2. Verify the webhook URL is correct and accessible
3. Check OpenClaw logs: `openclaw gateway logs`

### Token expired errors

1. Ensure `refreshToken` is set in config
2. Check that `clientId` and `clientSecret` are correct
3. Manually refresh: `openclaw run "refresh Cliq token"`

### Webhook not receiving messages

1. Test the webhook URL directly with curl
2. Check ngrok logs if using ngrok
3. Verify the bot is added to the channels you're testing

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

# Link for local testing
openclaw plugins install -l .
```

## License

MIT

## Credits

Built by [IBIZ Digital, Inc.](https://ibizdigital.com) for the OpenClaw community.
