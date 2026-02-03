/**
 * Outbound messaging to Zoho Cliq
 *
 * Handles sending messages to channels, users, and chats.
 */

const CLIQ_API_BASE = "https://cliq.zoho.com/api/v2";

export interface SendMessageOptions {
  chatId: string;
  text: string;
  accessToken: string;
  threadId?: string;
}

export interface SendChannelMessageOptions {
  channelId: string;
  text: string;
  accessToken: string;
  threadId?: string;
}

export interface SendUserMessageOptions {
  userId: string;
  text: string;
  accessToken: string;
}

export interface SendBotDmOptions {
  userId: string;
  text: string;
  accessToken: string;
  botId: string;
  orgId?: string;
}

/**
 * Send a message to a Cliq chat by chat ID (works for channels AND DMs)
 * This is the preferred method - use the chat ID from the incoming webhook
 */
export async function sendCliqChatMessage(options: SendMessageOptions): Promise<void> {
  const { chatId, text, accessToken, threadId } = options;
  const url = `${CLIQ_API_BASE}/chats/${encodeURIComponent(chatId)}/message`;

  console.log(`[cliq-outbound] Sending to chat ID: ${chatId}`);

  const body: Record<string, any> = { text };
  if (threadId) {
    body.thread = { id: threadId };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`[cliq-outbound] Chat message failed: ${response.status} - ${error}`);
    
    if (response.status === 401) {
      throw new Error(`Cliq API unauthorized (token may be expired): ${error}`);
    } else if (response.status === 404) {
      throw new Error(`Cliq chat not found: ${chatId}`);
    }
    
    throw new Error(`Cliq API error: ${response.status} - ${error}`);
  }

  console.log(`[cliq-outbound] Chat message sent successfully to ${chatId}`);
}

/**
 * Send a message to a Cliq chat (DM or group chat) - legacy alias
 */
export async function sendCliqMessage(options: SendMessageOptions): Promise<void> {
  return sendCliqChatMessage(options);
}

/**
 * Send a message to a Cliq channel by unique name
 */
export async function sendCliqChannelMessage(
  options: SendChannelMessageOptions
): Promise<void> {
  const { channelId, text, accessToken, threadId } = options;

  // channelId here is the channel's unique_name (e.g. "aicontentmachine")
  // Use channelsbyname endpoint, not channels/{id}
  const url = `${CLIQ_API_BASE}/channelsbyname/${encodeURIComponent(channelId)}/message`;

  console.log(`[cliq-outbound] Sending to channel: ${channelId}`);
  console.log(`[cliq-outbound] URL: ${url}`);

  const body: Record<string, any> = { text };
  if (threadId) {
    body.thread = { id: threadId };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`[cliq-outbound] Channel message failed: ${response.status} - ${error}`);
    
    // Check for common errors
    if (response.status === 401) {
      throw new Error(`Cliq API unauthorized (token may be expired): ${error}`);
    } else if (response.status === 404) {
      throw new Error(`Cliq channel not found: ${channelId}`);
    } else if (response.status === 403) {
      throw new Error(`Cliq API forbidden - bot may not have access to channel: ${channelId}`);
    }
    
    throw new Error(`Cliq API error: ${response.status} - ${error}`);
  }

  const result = await response.json().catch(() => null);
  console.log(`[cliq-outbound] Channel message sent successfully:`, result);
}

/**
 * Send a direct message to a user by user ID (ZUID)
 */
export async function sendCliqUserMessage(options: SendUserMessageOptions): Promise<void> {
  const { userId, text, accessToken } = options;
  const url = `${CLIQ_API_BASE}/buddies/${encodeURIComponent(userId)}/message`;

  console.log(`[cliq-outbound] Sending DM to user: ${userId}`);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`[cliq-outbound] User message failed: ${response.status} - ${error}`);
    
    if (response.status === 401) {
      throw new Error(`Cliq API unauthorized (token may be expired): ${error}`);
    } else if (response.status === 404) {
      throw new Error(`Cliq user not found: ${userId}`);
    }
    
    throw new Error(`Cliq API error: ${response.status} - ${error}`);
  }

  console.log(`[cliq-outbound] User message sent successfully`);
}

/**
 * Send a DM as the bot to a specific user
 * Uses the bot's message endpoint with userids parameter
 */
export async function sendBotDmMessage(options: SendBotDmOptions): Promise<void> {
  const { userId, text, accessToken, botId, orgId } = options;
  const url = `${CLIQ_API_BASE}/bots/${encodeURIComponent(botId)}/message`;

  console.log(`[cliq-outbound] Sending DM as bot ${botId} to user: ${userId}`);

  const headers: Record<string, string> = {
    Authorization: `Zoho-oauthtoken ${accessToken}`,
    "Content-Type": "application/json",
  };
  
  if (orgId) {
    headers["orgId"] = orgId;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ text, userids: userId }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`[cliq-outbound] Bot DM failed: ${response.status} - ${error}`);
    
    if (response.status === 401) {
      throw new Error(`Cliq API unauthorized (token may be expired): ${error}`);
    }
    
    throw new Error(`Cliq Bot DM error: ${response.status} - ${error}`);
  }

  console.log(`[cliq-outbound] Bot DM sent successfully to user ${userId}`);
}

/**
 * Post a message via bot to a channel
 * Supports reply_to for threading
 */
export async function postBotMessage(options: {
  channelId: string;
  text: string;
  accessToken: string;
  botId: string;
  botName?: string;
  orgId?: string;
  replyTo?: string;  // Message ID to reply to (creates thread)
}): Promise<void> {
  const { channelId, text, accessToken, botId, orgId, replyTo } = options;
  // Post to channel endpoint with bot_unique_name query param to post AS the bot
  const url = `${CLIQ_API_BASE}/channelsbyname/${encodeURIComponent(channelId)}/message?bot_unique_name=${encodeURIComponent(botId)}`;

  console.log(`[cliq-outbound] Posting as bot ${botId} to channel: ${channelId}${replyTo ? ` (replying to ${replyTo})` : ''}`);

  const headers: Record<string, string> = {
    Authorization: `Zoho-oauthtoken ${accessToken}`,
    "Content-Type": "application/json",
  };
  
  if (orgId) {
    headers["orgId"] = orgId;
  }

  // Build body with optional reply_to for threading
  const body: Record<string, string> = { text };
  if (replyTo) {
    body.reply_to = replyTo;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`[cliq-outbound] Bot message failed: ${response.status} - ${error}`);
    throw new Error(`Cliq Bot API error: ${response.status} - ${error}`);
  }

  console.log(`[cliq-outbound] Bot message sent successfully`);
}

/**
 * Get channel info by unique name
 */
export async function getCliqChannel(options: {
  channelName: string;
  accessToken: string;
}): Promise<{ id: string; name: string; unique_name: string } | null> {
  const { channelName, accessToken } = options;
  const url = `${CLIQ_API_BASE}/channelsbyname/${encodeURIComponent(channelName)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    const error = await response.text();
    throw new Error(`Cliq API error: ${response.status} - ${error}`);
  }

  return response.json() as Promise<{ id: string; name: string; unique_name: string }>;
}
