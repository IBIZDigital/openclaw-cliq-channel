/**
 * Cliq Webhook Monitor
 *
 * Handles webhook registration and inbound message processing.
 * Based on the Google Chat monitor pattern for reliable message routing.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { CliqAccount, CliqMessage } from "./config.js";
import { sendCliqChannelMessage, sendCliqUserMessage, sendCliqChatMessage } from "./outbound.js";

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
  // Message content
  message?: {
    text?: string;
    id?: string;
    time?: string;
  };
  text?: string;

  // Sender info
  user?: {
    id: string;
    name: string;
    email_id?: string;
    email?: string;
    zuid?: string;
  };

  // Chat context (for DMs and channels)
  chat?: {
    id: string;
    type?: string;
    title?: string;
  };

  // Channel context (for mentions)
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
  const text = payload.message?.text || payload.text || "";
  const user = payload.user;

  if (!text || !user?.id) {
    console.log("[cliq] Missing text or user id");
    return null;
  }

  // Zoho sends channel info in different ways:
  // 1. payload.channel (for some webhook types)
  // 2. payload.chat with type="channel" (for message handlers)
  const hasChannelObject = Boolean(payload.channel?.id || payload.channel?.unique_name);
  const isChatChannel = payload.chat?.type === "channel";
  const isChannel = hasChannelObject || isChatChannel;

  const handler = payload.handler || "";
  const isMention = handler.includes("mention") ||
    Boolean(payload.mentions?.some((m) => m.type === "bot")) ||
    isChannel; // Assume channel messages are mentions (bot was @mentioned to receive)

  // Determine channel info - try multiple sources
  let channelUniqueName = payload.channel?.unique_name || payload.channel?.name;
  let channelId = payload.channel?.id;
  let channelName = payload.channel?.name;
  const chatId = payload.chat?.id || channelId || "";

  // If chat.type is "channel", extract channel name from chat.title
  // Format is typically "#Channel Name" or "Channel Name"
  if (isChatChannel && !channelUniqueName && payload.chat?.title) {
    channelName = payload.chat.title.replace(/^#\s*/, "").trim();
    // Convert to unique_name format (lowercase, replace spaces with underscores)
    // But we need the actual unique_name from config or API
    // For now, use a normalized version
    channelUniqueName = channelName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  }

  console.log("[cliq] Channel detection:", {
    hasChannelObject,
    isChatChannel,
    isChannel,
    channelUniqueName,
    chatTitle: payload.chat?.title,
  });

  return {
    chatId,
    senderId: user.id,
    senderName: user.name || "Unknown",
    senderEmail: user.email_id || user.email,
    text,
    messageId: payload.message?.id || `cliq-${Date.now()}`,
    timestamp: payload.message?.time || new Date().toISOString(),
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

  // Handle group messages - check mention requirement
  if (isGroup) {
    const requireMention = account.requireMention ?? true;
    if (requireMention && !message.isMention) {
      console.log("[cliq] Group message without mention, skipping");
      return;
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

  const body = core.channel.reply.formatAgentEnvelope({
    channel: "Cliq",
    from: fromLabel,
    timestamp: message.timestamp ? Date.parse(message.timestamp) : undefined,
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });

  // Build the context payload for the agent
  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: `cliq:${message.senderId}`,
    To: `cliq:${responseTarget}`,
    SessionKey: route.sessionKey,
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
    sessionKey: route.sessionKey,
    agentId: route.agentId,
    target: responseTarget,
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
}): Promise<void> {
  const { payload, account, target, runtime, statusSink, threadId } = params;

  // Get fresh token from config (in case it was refreshed)
  const core = getCliqRuntime();
  const freshCfg = core?.config?.get?.() ?? core?.cfg;
  const cliqCfg = freshCfg?.channels?.cliq ?? freshCfg?.plugins?.entries?.cliq?.config ?? {};
  const accessToken = cliqCfg.accessToken || account.accessToken;

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

  try {
    if (target.startsWith("chat:")) {
      // Universal chat ID - works for both channels and DMs
      const chatId = target.slice("chat:".length);
      await sendCliqChatMessage({
        chatId,
        text,
        accessToken,
        threadId: threadId ?? payload.replyToId,
      });
    } else if (target.startsWith("channel:")) {
      const channelName = target.slice("channel:".length);
      await sendCliqChannelMessage({
        channelId: channelName,
        text,
        accessToken,
        threadId: threadId ?? payload.replyToId,
      });
    } else if (target.startsWith("user:")) {
      const userId = target.slice("user:".length);
      await sendCliqUserMessage({
        userId,
        text,
        accessToken,
      });
    } else {
      // Default to channel
      await sendCliqChannelMessage({
        channelId: target,
        text,
        accessToken,
        threadId: threadId ?? payload.replyToId,
      });
    }

    statusSink?.({ lastOutboundAt: Date.now() });
    console.log("[cliq] Reply delivered successfully");
  } catch (err) {
    runtime.error?.(`[cliq] Reply delivery failed: ${String(err)}`);
    throw err;
  }
}

export async function startCliqWebhookMonitor(options: CliqMonitorOptions): Promise<() => void> {
  const { account, config, runtime, statusSink } = options;
  const webhookPath = "/webhooks/cliq";

  console.log(`[cliq] Starting webhook monitor for account ${account.accountId}`);

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
