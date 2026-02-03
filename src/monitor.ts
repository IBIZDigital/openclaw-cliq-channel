/**
 * Cliq Webhook Monitor
 *
 * Handles webhook registration and inbound message processing.
 * Based on the Google Chat monitor pattern for reliable message routing.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { CliqAccount, CliqMessage } from "./config.js";
import { sendCliqChannelMessage, sendCliqUserMessage, sendCliqChatMessage, postBotMessage, sendBotDmMessage } from "./outbound.js";
import { getConversationTracker, generateFollowUpHint } from "./conversation-tracker.js";
import { initTokenManager, getTokenManager } from "./token-manager.js";

// Runtime reference set by the plugin
let cliqRuntime: any = null;

export function setCliqRuntime(runtime: any) {
  cliqRuntime = runtime;
}

export function getCliqRuntime(): any {
  if (!cliqRuntime) {
    throw new Error("Cliq runtime not initialized");
  }
  return cliqRuntime;
}

export type CliqMonitorOptions = {
  account: CliqAccount;
  config: any;
  runtime: {
    log?: (message: string) => void;
    error?: (message: string) => void;
  };
  abortSignal: AbortSignal;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

interface CliqWebhookPayload {
  // Message content - can be string OR object depending on Zoho's mood
  message?: string | {
    text?: string;
    id?: string;
    time?: string;
  };
  text?: string;

  // Sender info
  user?: {
    id: string;
    name?: string;
    first_name?: string;
    last_name?: string;
    email_id?: string;
    email?: string;
    zuid?: string;
    zoho_user_id?: string;
  };

  // Chat context (for DMs and channels)
  chat?: {
    id: string;
    type?: string;
    chat_type?: string;
    title?: string;
    channel_unique_name?: string;
    channel_id?: string;
    owner?: string;
  };

  // Channel context (for mentions - sometimes separate)
  channel?: {
    id: string;
    name: string;
    unique_name?: string;
  };

  // Thread context
  thread?: {
    id: string;
  };

  // Mentions in the message
  mentions?: Array<{
    id: string;
    name: string;
    type?: string; // "user" | "bot" | "all"
    start?: number;
    end?: number;
  }>;

  // Handler type
  handler?: "message" | "mention" | "welcome" | "participationHandler" | "bot.message" | "bot.mention";

  // Additional fields
  params?: {
    message?: { text?: string; id?: string };
    user?: { id: string; name: string };
    channel?: { id: string; name: string; unique_name?: string };
    chat?: { id: string };
  };
}

type WebhookTarget = {
  account: CliqAccount;
  config: any;
  runtime: CliqMonitorOptions["runtime"];
  path: string;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

const webhookTargets = new Map<string, WebhookTarget[]>();

function normalizeWebhookPath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "/webhooks/cliq";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (withSlash.length > 1 && withSlash.endsWith("/")) {
    return withSlash.slice(0, -1);
  }
  return withSlash;
}

export function registerCliqWebhookTarget(target: WebhookTarget): () => void {
  const key = normalizeWebhookPath(target.path);
  const normalizedTarget = { ...target, path: key };
  const existing = webhookTargets.get(key) ?? [];
  const next = [...existing, normalizedTarget];
  webhookTargets.set(key, next);

  console.log(`[cliq] Registered webhook target at ${key}`);

  return () => {
    const updated = (webhookTargets.get(key) ?? []).filter((entry) => entry !== normalizedTarget);
    if (updated.length > 0) {
      webhookTargets.set(key, updated);
    } else {
      webhookTargets.delete(key);
    }
    console.log(`[cliq] Unregistered webhook target at ${key}`);
  };
}

async function readJsonBody(req: IncomingMessage, maxBytes: number) {
  const chunks: Buffer[] = [];
  let total = 0;

  return await new Promise<{ ok: boolean; value?: unknown; error?: string }>((resolve) => {
    let resolved = false;
    const doResolve = (value: { ok: boolean; value?: unknown; error?: string }) => {
      if (resolved) return;
      resolved = true;
      req.removeAllListeners();
      resolve(value);
    };

    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        doResolve({ ok: false, error: "payload too large" });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw.trim()) {
          doResolve({ ok: false, error: "empty payload" });
          return;
        }
        doResolve({ ok: true, value: JSON.parse(raw) as unknown });
      } catch (err) {
        doResolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });

    req.on("error", (err) => {
      doResolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
    });
  });
}

/**
 * Main webhook handler - called by OpenClaw HTTP server
 */
export async function handleCliqWebhookRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  // Only handle /webhooks/cliq paths
  if (!path.startsWith("/webhooks/cliq")) {
    return false;
  }

  console.log(`[cliq] Webhook request received: ${req.method} ${path}`);

  // Get targets - try exact path first, then default
  const normalizedPath = normalizeWebhookPath(path);
  let targets = webhookTargets.get(normalizedPath);

  if (!targets || targets.length === 0) {
    targets = webhookTargets.get("/webhooks/cliq");
  }

  // If no targets registered yet, try to handle with runtime config
  if (!targets || targets.length === 0) {
    console.log(`[cliq] No webhook targets registered, using runtime config`);
    return handleCliqWebhookDirect(req, res);
  }

  return handleCliqWebhookWithTargets(req, res, targets);
}

/**
 * Handle webhook directly using runtime config (fallback when no targets registered)
 */
async function handleCliqWebhookDirect(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return true;
  }

  const core = getCliqRuntime();
  if (!core) {
    console.error("[cliq] Runtime not available");
    res.statusCode = 500;
    res.end("runtime not available");
    return true;
  }

  // Get config from runtime
  const cfg = core.config?.get?.() ?? core.cfg;
  if (!cfg) {
    console.error("[cliq] Config not available");
    res.statusCode = 500;
    res.end("config not available");
    return true;
  }

  // Resolve account config
  const cliqCfg = cfg.channels?.cliq ?? cfg.plugins?.entries?.cliq?.config ?? {};
  const account: CliqAccount = {
    accountId: "default",
    enabled: true,
    orgId: cliqCfg.orgId,
    accessToken: cliqCfg.accessToken,
    refreshToken: cliqCfg.refreshToken,
    clientId: cliqCfg.clientId,
    clientSecret: cliqCfg.clientSecret,
    botId: cliqCfg.botId,
    botName: cliqCfg.botName ?? "Henry",
    webhookSecret: cliqCfg.webhookSecret,
    dm: cliqCfg.dm ?? { policy: "open", allowFrom: [] },
    channels: cliqCfg.channels ?? {},
    groups: cliqCfg.groups ?? {},
    requireMention: cliqCfg.requireMention ?? true,
    textChunkLimit: cliqCfg.textChunkLimit ?? 4000,
  };

  const body = await readJsonBody(req, 1024 * 1024);
  if (!body.ok) {
    res.statusCode = body.error === "payload too large" ? 413 : 400;
    res.end(body.error ?? "invalid payload");
    return true;
  }

  let payload = body.value as CliqWebhookPayload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    res.statusCode = 400;
    res.end("invalid payload");
    return true;
  }

  // Handle wrapped params format
  if (payload.params) {
    payload = {
      ...payload,
      message: payload.params.message ?? payload.message,
      user: payload.params.user ?? payload.user,
      channel: payload.params.channel ?? payload.channel,
      chat: payload.params.chat ?? payload.chat,
    };
  }

  console.log("[cliq] Received webhook (direct):", JSON.stringify(payload, null, 2));

  // Create a synthetic target
  const target: WebhookTarget = {
    account,
    config: cfg,
    runtime: { log: console.log, error: console.error },
    path: "/webhooks/cliq",
  };

  // Process asynchronously
  processCliqWebhook(payload, target).catch((err) => {
    console.error(`[cliq] Webhook processing failed: ${String(err)}`);
  });

  // Return 200 immediately
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ status: "received" }));
  return true;
}

async function handleCliqWebhookWithTargets(
  req: IncomingMessage,
  res: ServerResponse,
  targets: WebhookTarget[]
): Promise<boolean> {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return true;
  }

  const body = await readJsonBody(req, 1024 * 1024);
  if (!body.ok) {
    res.statusCode = body.error === "payload too large" ? 413 : 400;
    res.end(body.error ?? "invalid payload");
    return true;
  }

  let payload = body.value as CliqWebhookPayload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    res.statusCode = 400;
    res.end("invalid payload");
    return true;
  }

  // Handle wrapped params format (from some Cliq webhook configurations)
  if (payload.params) {
    payload = {
      ...payload,
      message: payload.params.message ?? payload.message,
      user: payload.params.user ?? payload.user,
      channel: payload.params.channel ?? payload.channel,
      chat: payload.params.chat ?? payload.chat,
    };
  }

  console.log("[cliq] Received webhook:", JSON.stringify(payload, null, 2));

  // Find matching target (use first one for now)
  const target = targets[0];
  if (!target) {
    res.statusCode = 500;
    res.end("no target configured");
    return true;
  }

  // Verify webhook secret if configured
  if (target.account.webhookSecret) {
    const providedSecret =
      req.headers["x-cliq-webhook-secret"] ||
      req.headers["x-webhook-secret"] ||
      req.headers["authorization"];
    if (providedSecret !== target.account.webhookSecret &&
        providedSecret !== `Bearer ${target.account.webhookSecret}`) {
      console.warn("[cliq] Invalid webhook secret");
      res.statusCode = 401;
      res.end("unauthorized");
      return true;
    }
  }

  target.statusSink?.({ lastInboundAt: Date.now() });

  // Process asynchronously
  processCliqWebhook(payload, target).catch((err) => {
    target.runtime.error?.(`[cliq] Webhook processing failed: ${String(err)}`);
  });

  // Return 200 immediately
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ status: "received" }));
  return true;
}

function parseCliqPayload(payload: CliqWebhookPayload): CliqMessage | null {
  // Handle message as string OR object
  let text = "";
  let messageId = "";
  let messageTime = "";
  
  if (typeof payload.message === "string") {
    text = payload.message.trim();
  } else if (payload.message && typeof payload.message === "object") {
    text = payload.message.text?.trim() || "";
    messageId = payload.message.id || "";
    messageTime = payload.message.time || "";
  }
  
  // Fallback to payload.text
  if (!text && payload.text) {
    text = payload.text.trim();
  }

  const user = payload.user;

  if (!text || !user?.id) {
    console.log("[cliq] Missing text or user id", { 
      hasText: Boolean(text), 
      textType: typeof payload.message,
      hasUserId: Boolean(user?.id),
      payloadKeys: Object.keys(payload),
    });
    return null;
  }

  // Build user name from available fields
  const userName = user.name 
    || [user.first_name, user.last_name].filter(Boolean).join(" ")
    || user.id;

  // Zoho sends channel info in different ways:
  // 1. payload.channel (for some webhook types)
  // 2. payload.chat with type="channel" or chat_type="channel" (for message handlers)
  // 3. payload.chat.channel_unique_name (direct field)
  const hasChannelObject = Boolean(payload.channel?.id || payload.channel?.unique_name);
  const isChatChannel = payload.chat?.type === "channel" || payload.chat?.chat_type === "channel";
  const isChannel = hasChannelObject || isChatChannel || Boolean(payload.chat?.channel_unique_name);

  const handler = payload.handler || "";
  const isMention = handler.includes("mention") ||
    Boolean(payload.mentions?.some((m) => m.type === "bot")) ||
    isChannel; // Assume channel messages are mentions (bot was @mentioned to receive)

  // Determine channel info - try multiple sources (Zoho is inconsistent)
  let channelUniqueName = payload.chat?.channel_unique_name 
    || payload.channel?.unique_name 
    || payload.channel?.name;
  let channelId = payload.chat?.channel_id || payload.channel?.id;
  let channelName = payload.channel?.name;
  const chatId = payload.chat?.id || channelId || "";

  // If chat.type is "channel", extract channel name from chat.title
  // Format is typically "#Channel Name" or "Channel Name"
  if (isChatChannel && !channelName && payload.chat?.title) {
    channelName = payload.chat.title.replace(/^#\s*/, "").trim();
  }
  
  // Use channel_unique_name from chat if available
  if (!channelUniqueName && payload.chat?.channel_unique_name) {
    channelUniqueName = payload.chat.channel_unique_name;
  }

  console.log("[cliq] Parsed payload:", {
    text: text.substring(0, 50),
    userName,
    isChannel,
    isMention,
    channelUniqueName,
    chatId,
    handler,
  });

  return {
    chatId,
    senderId: user.id,
    senderName: userName,
    senderEmail: user.email_id || user.email,
    text,
    messageId: messageId || `cliq-${Date.now()}`,
    timestamp: messageTime || new Date().toISOString(),
    channelId,
    channelName,
    channelUniqueName,
    isChannel,
    isMention,
    threadId: payload.thread?.id,
  };
}

function isSenderAllowed(senderId: string, senderEmail: string | undefined, allowFrom: string[]): boolean {
  if (allowFrom.includes("*")) return true;
  const normalizedSenderId = senderId.toLowerCase();
  const normalizedEmail = senderEmail?.trim().toLowerCase() ?? "";

  return allowFrom.some((entry) => {
    const normalized = String(entry).trim().toLowerCase();
    if (!normalized) return false;
    if (normalized === normalizedSenderId) return true;
    if (normalizedEmail && normalized === normalizedEmail) return true;
    if (normalized.replace(/^(cliq|zoho-cliq):/i, "") === normalizedSenderId) return true;
    if (normalized.replace(/^user:/i, "") === normalizedSenderId) return true;
    return false;
  });
}

async function processCliqWebhook(payload: CliqWebhookPayload, target: WebhookTarget): Promise<void> {
  const { account, config, runtime, statusSink } = target;
  const core = getCliqRuntime();

  const message = parseCliqPayload(payload);
  if (!message) {
    console.log("[cliq] Could not parse message from payload");
    return;
  }

  console.log("[cliq] Parsed message:", {
    isChannel: message.isChannel,
    isMention: message.isMention,
    channelUniqueName: message.channelUniqueName,
    senderId: message.senderId,
    text: message.text.substring(0, 100),
  });

  // Skip messages from the bot itself
  if (message.senderName === account.botName ||
      message.senderId === account.botId) {
    console.log("[cliq] Skipping self-message");
    return;
  }

  const isGroup = message.isChannel;
  const rawBody = message.text;

  // Get conversation tracker with configured timeout
  const conversationTimeoutMs = (account as any).conversationTimeout 
    ? (account as any).conversationTimeout * 1000 
    : 5 * 60 * 1000; // Default 5 minutes
  const tracker = getConversationTracker({ timeoutMs: conversationTimeoutMs });

  // Check for per-channel settings
  const channelConfig = isGroup && message.channelUniqueName
    ? (account.channels?.[message.channelUniqueName] || account.channels?.[message.chatId])
    : null;
  const channelRequireMention = channelConfig?.requireMention;

  // Determine if mention is required for this context
  const requireMention = channelRequireMention ?? account.requireMention ?? true;

  // Track if this is a follow-up to an active conversation
  let isFollowUp = false;
  let followUpHint = "";
  let existingSessionKey: string | undefined;

  // Handle group messages - check mention requirement OR active conversation
  if (isGroup) {
    if (message.isMention) {
      // Explicit @mention - always respond
      console.log("[cliq] Message has @mention, will respond");
    } else if (!requireMention) {
      // Channel doesn't require mentions (e.g., dedicated bot channel)
      console.log("[cliq] Channel doesn't require @mention, will respond");
    } else {
      // Check for active conversation (intelligent follow-up)
      const activeConversation = tracker.getActiveConversation({
        channelId: message.chatId || message.channelUniqueName || "",
        userId: message.senderId,
      });

      if (activeConversation) {
        isFollowUp = true;
        existingSessionKey = activeConversation.sessionKey;
        followUpHint = generateFollowUpHint(activeConversation);
        console.log("[cliq] Active conversation found, treating as potential follow-up");
      } else {
        console.log("[cliq] Group message without mention and no active conversation, skipping");
        return;
      }
    }
  }

  // Handle DM policy
  if (!isGroup) {
    const dmPolicy = account.dm?.policy ?? "open";
    const allowFrom = (account.dm?.allowFrom ?? []).map((v) => String(v));

    if (dmPolicy === "disabled") {
      console.log(`[cliq] DMs disabled, dropping message from ${message.senderId}`);
      return;
    }

    if (dmPolicy !== "open") {
      const allowed = isSenderAllowed(message.senderId, message.senderEmail, allowFrom);
      if (!allowed) {
        console.log(`[cliq] Sender ${message.senderId} not allowed (dmPolicy=${dmPolicy})`);
        // TODO: Handle pairing requests
        return;
      }
    }
  }

  // Resolve agent routing
  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: "cliq",
    accountId: account.accountId,
    peer: {
      kind: isGroup ? "group" : "dm",
      id: message.channelUniqueName || message.chatId,
    },
  });

  // Build response target - prefer chat ID for universal routing
  const responseTarget = message.chatId
    ? `chat:${message.chatId}`
    : isGroup
      ? `channel:${message.channelUniqueName}`
      : `user:${message.senderId}`;

  // Build display label for envelope
  const fromLabel = isGroup
    ? message.channelName || `channel:${message.channelUniqueName}`
    : message.senderName || `user:${message.senderId}`;

  // Resolve session store path
  const storePath = core.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });

  // Format envelope
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config);
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });

  // Add follow-up hint if this is a potential follow-up message
  const messageBody = isFollowUp && followUpHint
    ? `${rawBody}\n\n${followUpHint}`
    : rawBody;

  const body = core.channel.reply.formatAgentEnvelope({
    channel: "Cliq",
    from: fromLabel,
    timestamp: message.timestamp ? Date.parse(message.timestamp) : undefined,
    previousTimestamp,
    envelope: envelopeOptions,
    body: messageBody,
  });

  // Use existing session if this is a follow-up, otherwise use the routed session
  const effectiveSessionKey = existingSessionKey || route.sessionKey;

  // Record mention if this is an @mention (starts/continues active conversation)
  if (message.isMention && isGroup) {
    tracker.recordMention({
      channelId: message.chatId || message.channelUniqueName || "",
      userId: message.senderId,
      sessionKey: effectiveSessionKey,
    });
  }

  // Build the context payload for the agent
  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: messageBody,
    CommandBody: rawBody,
    From: `cliq:${message.senderId}`,
    To: `cliq:${responseTarget}`,
    SessionKey: effectiveSessionKey,
    AccountId: route.accountId,
    ChatType: isGroup ? "channel" : "direct",
    ConversationLabel: fromLabel,
    SenderName: message.senderName || undefined,
    SenderId: message.senderId,
    SenderUsername: message.senderEmail,
    WasMentioned: isGroup ? message.isMention : undefined,
    Provider: "cliq",
    Surface: "cliq",
    MessageSid: message.messageId,
    MessageSidFull: message.messageId,
    ReplyToId: message.threadId,
    ReplyToIdFull: message.threadId,
    GroupSpace: isGroup ? fromLabel : undefined,
    OriginatingChannel: "cliq",
    OriginatingTo: `cliq:${responseTarget}`,
  });

  // Record session metadata
  void core.channel.session
    .recordSessionMetaFromInbound({
      storePath,
      sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
      ctx: ctxPayload,
    })
    .catch((err: Error) => {
      runtime.error?.(`[cliq] Failed updating session meta: ${String(err)}`);
    });

  console.log("[cliq] Dispatching to agent:", {
    sessionKey: effectiveSessionKey,
    agentId: route.agentId,
    target: responseTarget,
    isFollowUp,
  });

  // Dispatch using the buffered block dispatcher (same as Google Chat)
  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config,
    dispatcherOptions: {
      deliver: async (payload: { text?: string; mediaUrl?: string; replyToId?: string }) => {
        await deliverCliqReply({
          payload,
          account,
          target: responseTarget,
          runtime,
          statusSink,
          threadId: message.threadId,
          // Pass context for conversation tracking
          channelId: message.chatId || message.channelUniqueName || "",
          channelUniqueName: message.channelUniqueName || "",
          userId: message.senderId,
          // Pass message ID for reply_to threading
          replyToMessageId: message.messageId,
        });
      },
      onError: (err: Error, info: { kind: string }) => {
        runtime.error?.(`[cliq] ${info.kind} reply failed: ${String(err)}`);
      },
    },
  });
}

async function deliverCliqReply(params: {
  payload: { text?: string; mediaUrl?: string; replyToId?: string };
  account: CliqAccount;
  target: string;
  runtime: CliqMonitorOptions["runtime"];
  statusSink?: (patch: { lastOutboundAt?: number }) => void;
  threadId?: string;
  channelId?: string;
  channelUniqueName?: string;
  userId?: string;
  replyToMessageId?: string;  // Original message ID for threading
}): Promise<void> {
  const { payload, account, target, runtime, statusSink, threadId, channelId, channelUniqueName, userId, replyToMessageId } = params;

  // Get fresh token - prefer token manager (auto-refresh) over config
  const core = getCliqRuntime();
  const freshCfg = core?.config?.get?.() ?? core?.cfg;
  const cliqCfg = freshCfg?.channels?.cliq ?? freshCfg?.plugins?.entries?.cliq?.config ?? {};
  
  const tokenManager = getTokenManager();
  let accessToken: string;
  
  if (tokenManager) {
    accessToken = await tokenManager.getToken();
  } else {
    accessToken = cliqCfg.accessToken || account.accessToken;
  }

  if (!accessToken) {
    runtime.error?.("[cliq] No access token for reply");
    return;
  }

  console.log(`[cliq] Using token: ${accessToken.substring(0, 25)}...`);

  const text = payload.text;
  if (!text) {
    console.log("[cliq] Empty reply, skipping");
    return;
  }

  console.log(`[cliq] Delivering reply to ${target}, length=${text.length}`);

  // Get botId and orgId for posting as bot
  const botId = cliqCfg.botId || account.botId;
  const botName = cliqCfg.botName || account.botName;
  const orgId = cliqCfg.orgId || account.orgId;

  try {
    if (target.startsWith("chat:")) {
      // Universal chat ID - for channels, try to post as bot
      // For DMs, use chat endpoint
      const chatId = target.slice("chat:".length);
      
      // Check if this looks like a channel chat ID (starts with CT_ and contains channel marker)
      // Channel chat IDs typically look like: CT_xxxx_xxxx
      // DM chat IDs look like: CT_xxxx_xxxx-B1 or similar with user suffix
      const isLikelyChannel = channelId && !chatId.includes("-B");
      
      if (isLikelyChannel && botId && channelUniqueName) {
        // Post as bot to channel using unique_name, with reply_to for threading
        console.log(`[cliq] Posting as bot ${botName || botId} to channel ${channelUniqueName} (org: ${orgId})${replyToMessageId ? ` replying to ${replyToMessageId}` : ''}`);
        await postBotMessage({
          channelId: channelUniqueName,
          text,
          accessToken,
          botId,
          botName,
          orgId,
          replyTo: replyToMessageId,
        });
      } else {
        // DM - send as bot to user
        if (botId && userId) {
          console.log(`[cliq] Sending DM as bot ${botId} to user ${userId}`);
          await sendBotDmMessage({
            userId,
            text,
            accessToken,
            botId,
            orgId,
          });
        } else {
          // Fallback to chat endpoint (sends as authenticated user)
          console.log(`[cliq] Fallback: Sending to chat ${chatId} (no botId or userId)`);
          await sendCliqChatMessage({
            chatId,
            text,
            accessToken,
            threadId: threadId ?? payload.replyToId,
          });
        }
      }
    } else if (target.startsWith("channel:")) {
      const channelName = target.slice("channel:".length);
      if (botId) {
        // Post as bot with reply_to for threading
        await postBotMessage({
          channelId: channelName,
          text,
          accessToken,
          botId,
          botName,
          orgId,
          replyTo: replyToMessageId,
        });
      } else {
        await sendCliqChannelMessage({
          channelId: channelName,
          text,
          accessToken,
          threadId: threadId ?? payload.replyToId,
        });
      }
    } else if (target.startsWith("user:")) {
      const usrId = target.slice("user:".length);
      await sendCliqUserMessage({
        userId: usrId,
        text,
        accessToken,
      });
    } else {
      // Default to channel via bot
      if (botId) {
        await postBotMessage({
          channelId: target,
          text,
          accessToken,
          botId,
          botName,
          orgId,
          replyTo: replyToMessageId,
        });
      } else {
        await sendCliqChannelMessage({
          channelId: target,
          text,
          accessToken,
          threadId: threadId ?? payload.replyToId,
        });
      }
    }

    statusSink?.({ lastOutboundAt: Date.now() });
    console.log("[cliq] Reply delivered successfully");

    // Record that we responded (keeps conversation active)
    if (channelId && userId) {
      const tracker = getConversationTracker();
      tracker.recordResponse({ channelId, userId });
    }
  } catch (err) {
    runtime.error?.(`[cliq] Reply delivery failed: ${String(err)}`);
    throw err;
  }
}

export async function startCliqWebhookMonitor(options: CliqMonitorOptions): Promise<() => void> {
  const { account, config, runtime, statusSink } = options;
  const webhookPath = "/webhooks/cliq";

  console.log(`[cliq] Starting webhook monitor for account ${account.accountId}`);

  // Initialize token manager for auto-refresh on 401
  const cliqCfg = config as any;
  if (cliqCfg.refreshToken && cliqCfg.clientId && cliqCfg.clientSecret) {
    initTokenManager({
      accessToken: cliqCfg.accessToken || account.accessToken,
      refreshToken: cliqCfg.refreshToken,
      clientId: cliqCfg.clientId,
      clientSecret: cliqCfg.clientSecret,
      configUpdater: (newToken) => {
        // Update in-memory config
        cliqCfg.accessToken = newToken;
        console.log("[cliq] Token updated in memory via auto-refresh");
      },
    });
    console.log("[cliq] Token manager initialized with auto-refresh");
  } else {
    console.warn("[cliq] Missing refresh credentials - auto-refresh disabled");
  }

  // Register webhook target
  const unregisterTarget = registerCliqWebhookTarget({
    account,
    config,
    runtime,
    path: webhookPath,
    statusSink,
  });

  // Register HTTP handler with OpenClaw
  try {
    const core = getCliqRuntime();
    if (core.http?.registerHandler) {
      core.http.registerHandler("POST", webhookPath, handleCliqWebhookRequest);
      core.http.registerHandler("POST", `${webhookPath}/:accountId`, handleCliqWebhookRequest);
      console.log(`[cliq] Registered HTTP handlers at ${webhookPath}`);
    }
  } catch (err) {
    console.error("[cliq] Failed to register HTTP handlers:", err);
  }

  return () => {
    unregisterTarget();
    console.log(`[cliq] Stopped webhook monitor for account ${account.accountId}`);
  };
}
