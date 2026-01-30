/**
 * Webhook handler for incoming Cliq messages
 *
 * Handles:
 * - Bot mentions in channels (@Henry)
 * - Direct messages to the bot
 * - Message handler events
 */

import type { PluginApi } from "openclaw/plugin-sdk";
import type { CliqMessage, CliqAccount } from "./config.js";

interface CliqWebhookPayload {
  // Message handler payload
  message?: string;
  text?: string;

  // Sender info
  user?: {
    id: string;
    name: string;
    email?: string;
  };

  // Chat context
  chat?: {
    id: string;
    type: string; // "chat" | "channel" | "bot"
  };

  // Channel context (for mentions)
  channel?: {
    id: string;
    name: string;
  };

  // Thread context
  thread?: {
    id: string;
    root_message_id?: string;
  };

  // Mention info
  mentions?: Array<{
    id: string;
    name: string;
    type: string; // "user" | "bot" | "all"
  }>;

  // Message metadata
  message_id?: string;
  time?: string;

  // Handler type indicator
  handler?: "message" | "mention" | "welcome" | "context" | "participationHandler";
}

function resolveAccount(cfg: any, accountId?: string): CliqAccount {
  const accounts = cfg.channels?.cliq?.accounts ?? {};
  const id = accountId ?? "default";
  const account = accounts[id] ?? {};

  return {
    accountId: id,
    enabled: account.enabled ?? true,
    orgId: account.orgId ?? cfg.channels?.cliq?.orgId,
    accessToken: account.accessToken ?? cfg.channels?.cliq?.accessToken,
    refreshToken: account.refreshToken ?? cfg.channels?.cliq?.refreshToken,
    clientId: account.clientId ?? cfg.channels?.cliq?.clientId,
    clientSecret: account.clientSecret ?? cfg.channels?.cliq?.clientSecret,
    botId: account.botId ?? cfg.channels?.cliq?.botId,
    botName: account.botName ?? cfg.channels?.cliq?.botName ?? "Henry",
    webhookSecret: account.webhookSecret ?? cfg.channels?.cliq?.webhookSecret,
    dm: account.dm ?? cfg.channels?.cliq?.dm ?? { policy: "open" },
    channels: account.channels ?? cfg.channels?.cliq?.channels ?? {},
  };
}

function parseCliqPayload(payload: CliqWebhookPayload): CliqMessage | null {
  const text = payload.message || payload.text;
  if (!text || !payload.user?.id) {
    return null;
  }

  const isChannel = Boolean(payload.channel?.id);
  const isMention = Boolean(
    payload.mentions?.some((m) => m.type === "bot") ||
      payload.handler === "mention"
  );

  return {
    chatId: payload.chat?.id || payload.channel?.id || "",
    senderId: payload.user.id,
    senderName: payload.user.name || "Unknown",
    text,
    messageId: payload.message_id || `cliq-${Date.now()}`,
    timestamp: payload.time || new Date().toISOString(),
    channelId: payload.channel?.id,
    channelName: payload.channel?.name,
    isChannel,
    isMention,
    threadId: payload.thread?.id,
  };
}

export function createCliqWebhookHandler(api: PluginApi, cfg: any) {
  return async (req: any, res: any) => {
    try {
      // Parse account ID from URL if present
      const accountId = req.params?.accountId ?? "default";
      const account = resolveAccount(cfg, accountId);

      // Verify webhook secret if configured
      if (account.webhookSecret) {
        const providedSecret =
          req.headers["x-cliq-webhook-secret"] ||
          req.headers["x-webhook-secret"];
        if (providedSecret !== account.webhookSecret) {
          api.logger.warn("[cliq] Invalid webhook secret");
          res.status(401).json({ error: "Invalid webhook secret" });
          return;
        }
      }

      // Parse the incoming payload
      const payload: CliqWebhookPayload =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body;

      api.logger.debug("[cliq] Received webhook:", JSON.stringify(payload, null, 2));

      const message = parseCliqPayload(payload);
      if (!message) {
        api.logger.debug("[cliq] Could not parse message from payload");
        res.status(200).json({ status: "ignored" });
        return;
      }

      // Skip messages from the bot itself
      if (message.senderName === account.botName) {
        res.status(200).json({ status: "ignored", reason: "self" });
        return;
      }

      // For channel messages, only respond to mentions
      if (message.isChannel && !message.isMention) {
        api.logger.debug("[cliq] Channel message without mention, ignoring");
        res.status(200).json({ status: "ignored", reason: "no-mention" });
        return;
      }

      // Build the target for responses
      const target = message.isChannel
        ? `channel:${message.channelId}`
        : `user:${message.senderId}`;

      // Route to OpenClaw agent
      const inboundMessage = {
        channel: "cliq",
        accountId,
        senderId: message.senderId,
        senderName: message.senderName,
        text: message.text,
        target,
        messageId: message.messageId,
        threadId: message.threadId,
        metadata: {
          channelId: message.channelId,
          channelName: message.channelName,
          isChannel: message.isChannel,
          isMention: message.isMention,
        },
      };

      // Dispatch to agent
      api.dispatchInbound?.(inboundMessage);

      res.status(200).json({ status: "received" });
    } catch (error) {
      api.logger.error("[cliq] Webhook error:", error);
      res.status(500).json({ error: "Internal error" });
    }
  };
}
