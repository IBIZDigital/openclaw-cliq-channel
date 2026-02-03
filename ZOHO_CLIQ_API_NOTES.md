# Zoho Cliq API Notes

Critical learnings from building the OpenClaw Cliq integration.

## Posting Messages AS a Bot (not as user)

The OAuth token authenticates as a USER, not the bot. To post AS the bot:

### Channel Messages
```
POST https://cliq.zoho.com/api/v2/channelsbyname/{CHANNEL_UNIQUE_NAME}/message?bot_unique_name={BOT_UNIQUE_NAME}
Headers:
  Authorization: Zoho-oauthtoken {ACCESS_TOKEN}
  orgId: {ORG_ID}
  Content-Type: application/json
Body: {"text": "Hello!"}
```

### DM Messages (Bot to User)
```
POST https://cliq.zoho.com/api/v2/bots/{BOT_UNIQUE_NAME}/message
Headers:
  Authorization: Zoho-oauthtoken {ACCESS_TOKEN}
  orgId: {ORG_ID}
  Content-Type: application/json
Body: {"text": "Hello!", "userids": "{USER_ID}"}
```

### What DOESN'T work for bot identity:
- `{"bot": {"name": "Henry"}}` in body — just adds display name, still sends as user
- `/chats/{CHAT_ID}/message` — always sends as authenticated user
- `/bots/{BOT}/incoming` with `channel` param — goes to DM, not channel

## Deluge Equivalents
```deluge
// Post to channel as bot
zoho.cliq.postToChannelAsBot("channel_unique_name", "bot_unique_name", "message");

// Post to user as bot  
zoho.cliq.postToBot("bot_unique_name", message);
```

## Bot Setup Requirements

1. **Bot must be added to each channel** where it needs to respond
   - Go to channel settings → Add bot
   - Or in bot settings → Add to channels

2. **Deluge Handlers needed:**
   - **Mention Handler** — triggers on @mentions
   - **Message Handler** — triggers on all messages (for follow-ups)
   - **Incoming Webhook Handler** — for async responses (optional)

## Deluge Handler Syntax

```javascript
// Correct syntax for invokeUrl in handlers
response = Map();

webhook_url = "https://your-webhook.com/endpoint";
payload = Map();
payload.put("message", message);
payload.put("user", user);
payload.put("chat", chat);
payload.put("handler", "mention");

invokeUrl
[
    url: webhook_url
    type: POST
    parameters: payload.toString()
    headers: {"Content-Type": "application/json"}
];

response.put("text", "🤔");  // Immediate response (shows as bot)
return response;
```

## Token Management

- Access tokens expire every ~1 hour
- Must refresh using refresh token
- Store new access token and update config
- Gateway must be restarted or config reloaded for new token

## Chat ID Patterns

- Channel chat: `CT_xxxxxxxxxxxx_xxxxxxxxx` (no suffix)
- Bot DM chat: `CT_xxxxxxxxxxxx_xxxxxxxxx-B2` (has `-B` suffix)

Use the `-B` suffix to detect DMs vs channels.

## Required OAuth Scopes

- `ZohoCliq.Webhooks.CREATE` — for posting messages
- `ZohoCliq.Channels.READ` — for reading channel info
- `ZohoCliq.Users.READ` — for user info
