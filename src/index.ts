/**
 * OpenClaw Zoho Cliq Channel Plugin
 *
 * Enables real-time team chat integration with Zoho Cliq.
 * Supports @mentions, DMs, and channel messages.
 */

import type { PluginApi, ChannelPlugin, ChannelMeta } from "openclaw/plugin-sdk";
import { CliqConfigSchema, type CliqConfig, type CliqAccount } from "./config.js";
import { sendCliqMessage, sendCliqChannelMessage } from "./outbound.js";
import { createCliqWebhookHandler } from "./webhook.js";
import { refreshCliqToken } from "./auth.js";

const meta: ChannelMeta = {
  id: "cliq",
  label: "Zoho Cliq",
  selectionLabel: "Zoho Cliq (Team Chat)",
  docsPath: "/channels/cliq",
  blurb: "Real-time team chat via Zoho Cliq bots with @mention support.",
  aliases: ["zoho-cliq", "zohocliq"],
};

function listAccountIds(cfg: any): string[] {
  return Object.keys(cfg.channels?.cliq?.accounts ?? {});
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

export const cliqPlugin: ChannelPlugin = {
  id: "cliq",
  meta,

  capabilities: {
    chatTypes: ["direct", "channel"],
    reactions: false, // Cliq reactions are limited
    threads: true,
    media: true,
    nativeCommands: false,
  },

  configSchema: CliqConfigSchema,

  config: {
    listAccountIds,
    resolveAccount,
    defaultAccountId: () => "default",
    isConfigured: (account: CliqAccount) =>
      Boolean(account.accessToken && account.orgId && account.botId),
    describeAccount: (account: CliqAccount) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: Boolean(account.accessToken && account.orgId && account.botId),
      botName: account.botName,
    }),
  },

  security: {
    resolveDmPolicy: ({ account }) => ({
      policy: account.dm?.policy ?? "open",
      allowFrom: account.dm?.allowFrom ?? [],
      allowFromPath: `channels.cliq.dm.`,
    }),
  },

  outbound: {
    deliveryMode: "direct",

    sendText: async ({ text, target, account, cfg }) => {
      const resolvedAccount = resolveAccount(cfg, account?.accountId);

      if (!resolvedAccount.accessToken) {
        return { ok: false, error: "Missing Cliq access token" };
      }

      try {
        // Determine if target is a channel or user
        if (target.startsWith("channel:")) {
          const channelId = target.slice("channel:".length);
          await sendCliqChannelMessage({
            channelId,
            text,
            accessToken: resolvedAccount.accessToken,
          });
        } else {
          // DM or chat
          const chatId = target.startsWith("user:")
            ? target.slice("user:".length)
            : target;
          await sendCliqMessage({
            chatId,
            text,
            accessToken: resolvedAccount.accessToken,
          });
        }

        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Send failed",
        };
      }
    },
  },

  gateway: {
    start: async ({ api, cfg }) => {
      const account = resolveAccount(cfg);

      if (!account.accessToken) {
        api.logger.warn("[cliq] No access token configured");
        return;
      }

      // Register webhook endpoint
      api.registerHttpHandler("POST", "/webhooks/cliq", createCliqWebhookHandler(api, cfg));
      api.registerHttpHandler("POST", "/webhooks/cliq/:accountId", createCliqWebhookHandler(api, cfg));

      api.logger.info(`[cliq] Channel started for bot: ${account.botName}`);

      // Set up token refresh interval (every 50 minutes)
      const refreshInterval = setInterval(async () => {
        try {
          await refreshCliqToken(cfg, api);
          api.logger.debug("[cliq] Token refreshed successfully");
        } catch (error) {
          api.logger.error("[cliq] Token refresh failed:", error);
        }
      }, 50 * 60 * 1000);

      // Store interval for cleanup
      (api as any)._cliqRefreshInterval = refreshInterval;
    },

    stop: async ({ api }) => {
      const interval = (api as any)._cliqRefreshInterval;
      if (interval) {
        clearInterval(interval);
      }
      api.logger.info("[cliq] Channel stopped");
    },
  },
};

export default function register(api: PluginApi) {
  api.registerChannel({ plugin: cliqPlugin });

  // Register token refresh tool
  api.registerTool({
    name: "cliq_refresh_token",
    description: "Refresh the Zoho Cliq access token",
    parameters: {},
    handler: async ({ cfg }) => {
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
}
