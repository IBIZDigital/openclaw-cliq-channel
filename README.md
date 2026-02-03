# @openclaw/cliq - Zoho Cliq Channel Plugin

OpenClaw channel plugin for Zoho Cliq integration.

## Features

- ✅ Receive messages via webhook (mentions & DMs)
- ✅ Respond as the bot (not as user) in channels and DMs
- ✅ Conversation tracking for follow-up messages
- ✅ Automatic token refresh support

## Setup

### 1. Create a Zoho Cliq Bot

1. Go to Zoho Cliq → Settings → Bots & Tools → Create Bot
2. Note the bot's **unique name** (e.g., `henry`)

### 2. Create OAuth Client

1. Go to [Zoho API Console](https://api-console.zoho.com/)
2. Create a Self Client
3. Generate tokens with scopes:
   - `ZohoCliq.Webhooks.CREATE`
   - `ZohoCliq.Channels.READ`
   - `ZohoCliq.Users.READ`

### 3. Configure Bot Handlers

#### Mention Handler
```javascript
response = Map();

webhook_url = "https://your-domain.com/webhooks/cliq";
payload = Map();
payload.put("handler", "mention");
payload.put("message", message);
payload.put("user", user);
payload.put("chat", chat);
payload.put("mentions", mentions);

invokeUrl
[
    url: webhook_url
    type: POST
    parameters: payload.toString()
    headers: {"Content-Type": "application/json"}
];

response.put("text", "🤔");
return response;
```

#### Message Handler (for follow-ups)
```javascript
response = Map();

webhook_url = "https://your-domain.com/webhooks/cliq";
payload = Map();
payload.put("handler", "message");
payload.put("message", message);
payload.put("user", user);
payload.put("chat", chat);

invokeUrl
[
    url: webhook_url
    type: POST
    parameters: payload.toString()
    headers: {"Content-Type": "application/json"}
];

return response;
```

### 4. Add Bot to Channels

The bot must be added to each channel where you want it to respond:
- Go to channel settings → Integrations → Add bot
- Or: Bot settings → Channels → Add to channel

### 5. Configure OpenClaw

Add to `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "cliq": {
        "enabled": true,
        "config": {
          "orgId": "your-org-id",
          "accessToken": "your-access-token",
          "refreshToken": "your-refresh-token",
          "clientId": "your-client-id",
          "clientSecret": "your-client-secret",
          "botId": "henry",
          "botName": "Henry"
        }
      }
    }
  }
}
```

## API Notes

See [ZOHO_CLIQ_API_NOTES.md](./ZOHO_CLIQ_API_NOTES.md) for critical API details.

Key points:
- Use `?bot_unique_name=` query param for channel messages
- Use `/bots/{bot}/message` with `userids` for DMs
- Bot must be added to channels to post there

## Development

```bash
npm install
npm run build
npm run dev  # watch mode
```

## License

MIT
