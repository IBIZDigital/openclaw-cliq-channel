/**
 * OpenClaw Zoho Cliq Channel Plugin
 *
 * Enables real-time team chat integration with Zoho Cliq.
 * Supports @mentions, DMs, and channel messages.
 *
 * Based on the Google Chat plugin pattern for reliable message routing.
 */

import type {
  PluginApi,
  ChannelPlugin,
  ChannelMeta,
} from "openclaw/plugin-sdk";
import { CliqConfigSchema, type CliqConfig, type CliqAccount } from "./config.js";
import { sendCliqChannelMessage, sendCliqUserMessage, sendCliqChatMessage } from "./outbound.js";
import { startCliqWebhookMonitor, setCliqRuntime, handleCliqWebhookRequest } from "./monitor.js";
import { refreshCliqToken } from "./auth.js";

const DEFAULT_ACCOUNT_ID = "default";

const meta: ChannelMeta = {
  id: "cliq",
  label: "Zoho Cliq",
  selectionLabel: "Zoho Cliq (Team Chat)",
  docsPath: "/channels/cliq",
  blurb: "Real-time team chat via Zoho Cliq bots with @mention support.",
  aliases: ["zoho-cliq", "zohocliq"],
};

/**
 * Get the Cliq config section from the main config
 * Checks channels.cliq first, then falls back to plugins.entries.cliq.config
 */
function getCliqConfig(cfg: any): Partial<CliqConfig> {
  if (cfg.channels?.cliq) {
    return cfg.channels.cliq;
  }
  if (cfg.plugins?.entries?.cliq?.config) {
    return cfg.plugins.entries.cliq.config;
  }
  return {};
}

/**
 * List all configured account IDs
 */
function listAccountIds(cfg: any): string[] {
  const cliqCfg = getCliqConfig(cfg);
  const accounts = cliqCfg.accounts ?? {};
  const accountIds = Object.keys(accounts);

  if (accountIds.length === 0 && (cliqCfg.accessToken || cliqCfg.botId)) {
    return [DEFAULT_ACCOUNT_ID];
  }

  return accountIds.length > 0 ? accountIds : [DEFAULT_ACCOUNT_ID];
}

/**
 * Resolve account config by ID, merging with top-level defaults
 */
function resolveAccount(cfg: any, accountId?: string): CliqAccount {
  const cliqCfg = getCliqConfig(cfg);
  const id = accountId ?? DEFAULT_ACCOUNT_ID;
  const accounts = cliqCfg.accounts ?? {};
  const account: Partial<CliqAccount> = accounts[id] ?? {};

  return {
    accountId: id,
    enabled: account.enabled ?? true,
    orgId: account.orgId ?? cliqCfg.orgId,
    accessToken: account.accessToken ?? cliqCfg.accessToken,
    refreshToken: account.refreshToken ?? cliqCfg.refreshToken,
    clientId: account.clientId ?? cliqCfg.clientId,
    clientSecret: account.clientSecret ?? cliqCfg.clientSecret,
    botId: account.botId ?? cliqCfg.botId,
    botName: account.botName ?? cliqCfg.botName ?? "Henry",
    webhookSecret: account.webhookSecret ?? cliqCfg.webhookSecret,
    dm: account.dm ?? cliqCfg.dm ?? { policy: "open", allowFrom: [] },
    channels: account.channels ?? cliqCfg.channels ?? {},
    groups: account.groups ?? cliqCfg.groups ?? {},
    requireMention: account.requireMention ?? cliqCfg.requireMention ?? true,
    textChunkLimit: account.textChunkLimit ?? cliqCfg.textChunkLimit ?? 4000,
  };
}

const formatAllowFromEntry = (entry: string) =>
  entry
    .trim()
    .replace(/^(cliq|zoho-cliq|zohocliq):/i, "")
    .replace(/^user:/i, "")
    .toLowerCase();

/**
 * Normalize a Cliq target (channel or user)
 */
function normalizeCliqTarget(target: string): string | null {
  const trimmed = target?.trim();
  if (!trimmed) return null;

  // Remove internal prefixes
  let normalized = trimmed
    .replace(/^cliq:/i, "")
    .replace(/^channel:/i, "")
    .replace(/^user:/i, "");

  if (!normalized) return null;

  // If it looks like a channel name (alphanumeric with underscores)
  if (/^[a-z0-9_-]+$/i.test(normalized)) {
    return `channel:${normalized.toLowerCase()}`;
  }

  return normalized;
}

function isCliqChannelTarget(value: string): boolean {
  return value.startsWith("channel:") || /^[a-z0-9_-]+$/i.test(value);
}

function isCliqUserTarget(value: string): boolean {
  return value.startsWith("user:");
}

export const cliqPlugin: ChannelPlugin = {
  id: "cliq",
  meta,

  capabilities: {
    chatTypes: ["direct", "group"],
    reactions: false,
    threads: true,
    media: false, // TODO: Add media support
    nativeCommands: false,
    blockStreaming: true,
  },

  streaming: {
    blockStreamingCoalesceDefaults: { minChars: 1500, idleMs: 1000 },
  },

  reload: { configPrefixes: ["channels.cliq", "plugins.entries.cliq"] },

  config: {
    listAccountIds,
    resolveAccount: (cfg: any, accountId?: string) => resolveAccount(cfg, accountId),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    isConfigured: (account: CliqAccount) =>
      Boolean(account.accessToken && account.orgId && account.botId),
    describeAccount: (account: CliqAccount) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: Boolean(account.accessToken && account.orgId && account.botId),
      botName: account.botName,
    }),
    resolveAllowFrom: ({ cfg, accountId }: { cfg: any; accountId?: string }) =>
      (resolveAccount(cfg, accountId).dm?.allowFrom ?? []).map((entry: any) => String(entry)),
    formatAllowFrom: ({ allowFrom }: { allowFrom: string[] }) =>
      allowFrom
        .map((entry) => String(entry))
        .filter(Boolean)
        .map(formatAllowFromEntry),
  },

  security: {
    resolveDmPolicy: ({ cfg, accountId, account }: { cfg: any; accountId?: string; account: CliqAccount }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const cliqCfg = getCliqConfig(cfg);
      const useAccountPath = Boolean((cliqCfg as any).accounts?.[resolvedAccountId]);
      const allowFromPath = useAccountPath
        ? `channels.cliq.accounts.${resolvedAccountId}.dm.`
        : "channels.cliq.dm.";
      return {
        policy: account.dm?.policy ?? "open",
        allowFrom: account.dm?.allowFrom ?? [],
        allowFromPath,
        normalizeEntry: (raw: string) => formatAllowFromEntry(raw),
      };
    },
    collectWarnings: ({ account }: { account: CliqAccount }) => {
      const warnings: string[] = [];
      if (account.dm?.policy === "open") {
        const hasWildcard = account.dm?.allowFrom?.includes("*");
        if (!hasWildcard) {
          warnings.push(
            `- Zoho Cliq DMs: policy="open" but allowFrom doesn't include "*". Add channels.cliq.dm.allowFrom=["*"] or change policy.`
          );
        }
      }
      return warnings;
    },
  },

  groups: {
    resolveRequireMention: ({ cfg, accountId }: { cfg: any; accountId?: string }) => {
      const account = resolveAccount(cfg, accountId);
      return account.requireMention ?? true;
    },
  },

  messaging: {
    normalizeTarget: normalizeCliqTarget,
    targetResolver: {
      looksLikeId: (raw: string, normalized?: string | null) => {
        const value = normalized ?? raw.trim();
        return isCliqChannelTarget(value) || isCliqUserTarget(value);
      },
      hint: "<channelName> or channel:<name> or user:<id>",
    },
  },

  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 4000,

    resolveTarget: ({ to, allowFrom, mode }: { to?: string; allowFrom?: string[]; mode?: string }) => {
      const trimmed = to?.trim() ?? "";
      const allowListRaw = (allowFrom ?? []).map((entry) => String(entry).trim()).filter(Boolean);
      const allowList = allowListRaw
        .filter((entry) => entry !== "*")
        .map((entry) => normalizeCliqTarget(entry))
        .filter((entry): entry is string => Boolean(entry));

      if (trimmed) {
        const normalized = normalizeCliqTarget(trimmed);
        if (!normalized) {
          if ((mode === "implicit" || mode === "heartbeat") && allowList.length > 0) {
            return { ok: true, to: allowList[0] };
          }
          return {
            ok: false,
            error: "Cliq target is required. Use channel:<name> or user:<id>.",
          };
        }
        return { ok: true, to: normalized };
      }

      if (allowList.length > 0) {
        return { ok: true, to: allowList[0] };
      }
      return {
        ok: false,
        error: "Cliq target is required. Use channel:<name> or user:<id>.",
      };
    },

    sendText: async ({ cfg, to, text, accountId, replyToId, threadId }: any) => {
      const account = resolveAccount(cfg, accountId);

      if (!account.accessToken) {
        throw new Error("Cliq access token is not configured");
      }

      // Don't normalize chat: targets - they need to stay as-is
      const normalized = to?.startsWith("chat:") ? to : (normalizeCliqTarget(to) ?? to);
      console.log(`[cliq] sendText to=${normalized}, text length=${text?.length}`);

      try {
        if (normalized.startsWith("chat:")) {
          // Universal chat ID - works for both channels and DMs
          const chatId = normalized.slice("chat:".length);
          await sendCliqChatMessage({
            chatId,
            text,
            accessToken: account.accessToken,
            threadId: threadId ?? replyToId,
          });
          return {
            channel: "cliq",
            messageId: `cliq-${Date.now()}`,
            chatId,
          };
        } else if (normalized.startsWith("channel:")) {
          const channelName = normalized.slice("channel:".length);
          await sendCliqChannelMessage({
            channelId: channelName,
            text,
            accessToken: account.accessToken,
            threadId: threadId ?? replyToId,
          });
          return {
            channel: "cliq",
            messageId: `cliq-${Date.now()}`,
            chatId: channelName,
          };
        } else if (normalized.startsWith("user:")) {
          const userId = normalized.slice("user:".length);
          await sendCliqUserMessage({
            userId,
            text,
            accessToken: account.accessToken,
          });
          return {
            channel: "cliq",
            messageId: `cliq-${Date.now()}`,
            chatId: userId,
          };
        } else {
          // Default to channel
          await sendCliqChannelMessage({
            channelId: normalized,
            text,
            accessToken: account.accessToken,
            threadId: threadId ?? replyToId,
          });
          return {
            channel: "cliq",
            messageId: `cliq-${Date.now()}`,
            chatId: normalized,
          };
        }
      } catch (error) {
        console.error("[cliq] sendText failed:", error);
        throw error;
      }
    },

    sendMedia: async ({ cfg, to, text, mediaUrl, accountId }: any) => {
      const account = resolveAccount(cfg, accountId);

      if (!account.accessToken) {
        throw new Error("Cliq access token is not configured");
      }

      // For now, send media as a text link
      const messageText = mediaUrl ? `${text ?? ""}\n\n${mediaUrl}` : text ?? "";
      const normalized = normalizeCliqTarget(to) ?? to;

      if (normalized.startsWith("channel:")) {
        const channelName = normalized.slice("channel:".length);
        await sendCliqChannelMessage({
          channelId: channelName,
          text: messageText,
          accessToken: account.accessToken,
        });
        return {
          channel: "cliq",
          messageId: `cliq-${Date.now()}`,
          chatId: channelName,
        };
      } else {
        await sendCliqChannelMessage({
          channelId: normalized,
          text: messageText,
          accessToken: account.accessToken,
        });
        return {
          channel: "cliq",
          messageId: `cliq-${Date.now()}`,
          chatId: normalized,
        };
      }
    },
  },

  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildAccountSnapshot: ({ account, runtime }: { account: CliqAccount; runtime: any }) => ({
      accountId: account.accountId,
      name: account.botName,
      enabled: account.enabled,
      configured: Boolean(account.accessToken && account.orgId && account.botId),
      botName: account.botName,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      lastInboundAt: runtime?.lastInboundAt ?? null,
      lastOutboundAt: runtime?.lastOutboundAt ?? null,
      dmPolicy: account.dm?.policy ?? "open",
    }),
  },

  gateway: {
    startAccount: async (ctx: any) => {
      const account = ctx.account;
      ctx.log?.info(`[${account.accountId}] starting Cliq webhook monitor`);

      ctx.setStatus({
        accountId: account.accountId,
        running: true,
        lastStartAt: Date.now(),
      });

      const unregister = await startCliqWebhookMonitor({
        account,
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        statusSink: (patch: any) => ctx.setStatus({ accountId: account.accountId, ...patch }),
      });

      return () => {
        unregister?.();
        ctx.setStatus({
          accountId: account.accountId,
          running: false,
          lastStopAt: Date.now(),
        });
      };
    },
  },
} as any;

// Plugin object (matches Google Chat pattern)
const plugin = {
  id: "cliq",
  name: "Zoho Cliq",
  description: "OpenClaw Zoho Cliq channel plugin",
  configSchema: CliqConfigSchema,
  register(api: PluginApi) {
    // Store runtime for use in monitor
    setCliqRuntime((api as any).runtime);

    // Register channel plugin
    api.registerChannel({ plugin: cliqPlugin });

    // Register HTTP handler for webhooks
    console.log("[cliq] Registering HTTP handler...");
    const hasRegisterHttpHandler = typeof (api as any).registerHttpHandler === "function";
    console.log("[cliq] api.registerHttpHandler available:", hasRegisterHttpHandler);
    
    if (hasRegisterHttpHandler) {
      (api as any).registerHttpHandler(handleCliqWebhookRequest);
      console.log("[cliq] HTTP handler registered");
    } else {
      console.error("[cliq] registerHttpHandler not available on api");
    }

    // Register token refresh tool
    api.registerTool({
      name: "cliq_refresh_token",
      description: "Refresh the Zoho Cliq access token",
      parameters: {},
      handler: async ({ cfg }: any) => {
        try {
          await refreshCliqToken(cfg, api);
          return { success: true, message: "Cliq token refreshed" };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Refresh failed",
          };
        }
      },
    });

    api.logger.info("[cliq] Plugin registered");
  },
};

export default plugin;
