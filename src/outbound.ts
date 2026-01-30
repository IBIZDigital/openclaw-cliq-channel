/**
 * Outbound messaging to Zoho Cliq
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

/**
 * Send a message to a Cliq chat (DM or group chat)
 */
export async function sendCliqMessage(options: SendMessageOptions): Promise<void> {
  const { chatId, text, accessToken, threadId } = options;

  const url = `${CLIQ_API_BASE}/chats/${chatId}/message`;

  const body: Record<string, any> = {
    text,
  };

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
    throw new Error(`Cliq API error: ${response.status} - ${error}`);
  }
}

/**
 * Send a message to a Cliq channel
 */
export async function sendCliqChannelMessage(
  options: SendChannelMessageOptions
): Promise<void> {
  const { channelId, text, accessToken, threadId } = options;

  const url = `${CLIQ_API_BASE}/channels/${channelId}/message`;

  const body: Record<string, any> = {
    text,
  };

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
    throw new Error(`Cliq API error: ${response.status} - ${error}`);
  }
}

/**
 * Send a message to a user by user ID
 */
export async function sendCliqUserMessage(options: {
  userId: string;
  text: string;
  accessToken: string;
}): Promise<void> {
  const { userId, text, accessToken } = options;

  const url = `${CLIQ_API_BASE}/buddies/${userId}/message`;

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
    throw new Error(`Cliq API error: ${response.status} - ${error}`);
  }
}

/**
 * Post a message via bot to a channel
 */
export async function postBotMessage(options: {
  channelId: string;
  text: string;
  accessToken: string;
  botId: string;
}): Promise<void> {
  const { channelId, text, accessToken, botId } = options;

  const url = `${CLIQ_API_BASE}/bots/${botId}/message`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      channel: { id: channelId },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Cliq Bot API error: ${response.status} - ${error}`);
  }
}
