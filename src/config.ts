/**
 * Cliq Configuration Types
 */

export interface CliqDmConfig {
  policy?: "open" | "pairing" | "allowlist" | "disabled";
  allowFrom?: string[];
  enabled?: boolean;
}

export interface CliqGroupConfig {
  enabled?: boolean;
  requireMention?: boolean;
  allowFrom?: string[];
  systemPrompt?: string;
}

export interface CliqConfig {
  enabled?: boolean;
  orgId?: string;
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  botId?: string;
  botName?: string;
  webhookSecret?: string;
  dm?: CliqDmConfig;
  channels?: Record<string, CliqGroupConfig>;
  groups?: Record<string, CliqGroupConfig>;
  accounts?: Record<string, Partial<CliqAccount>>;
  requireMention?: boolean;
  textChunkLimit?: number;
  allowBots?: boolean;
  groupPolicy?: "open" | "allowlist" | "disabled";
  groupAllowFrom?: string[];
}

export interface CliqAccount {
  accountId: string;
  enabled: boolean;
  orgId?: string;
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  botId?: string;
  botName?: string;
  webhookSecret?: string;
  dm?: CliqDmConfig;
  channels?: Record<string, CliqGroupConfig>;
  groups?: Record<string, CliqGroupConfig>;
  requireMention?: boolean;
  textChunkLimit?: number;
  allowBots?: boolean;
  groupPolicy?: "open" | "allowlist" | "disabled";
  groupAllowFrom?: string[];
  /** Conversation timeout in seconds. After @mention, Henry responds to follow-ups for this duration. Default: 300 (5 min) */
  conversationTimeout?: number;
}

export interface CliqMessage {
  chatId: string;
  senderId: string;
  senderName: string;
  senderEmail?: string;
  text: string;
  messageId: string;
  timestamp: string;
  channelId?: string;
  channelName?: string;
  channelUniqueName?: string;
  isChannel: boolean;
  isMention: boolean;
  threadId?: string;
}

export const CliqConfigSchema = {
  type: "object",
  properties: {
    enabled: { type: "boolean" },
    orgId: { type: "string", description: "Zoho organization ID" },
    accessToken: { type: "string", description: "OAuth access token" },
    refreshToken: { type: "string", description: "OAuth refresh token" },
    clientId: { type: "string", description: "Zoho API client ID" },
    clientSecret: { type: "string", description: "Zoho API client secret" },
    botId: { type: "string", description: "Bot unique name from Cliq" },
    botName: { type: "string", default: "Henry", description: "Bot display name" },
    webhookSecret: { type: "string", description: "Webhook validation secret" },
    requireMention: { type: "boolean", default: true, description: "Require @mention in channels" },
    textChunkLimit: { type: "number", default: 4000, description: "Max text chunk size" },
    dm: {
      type: "object",
      properties: {
        policy: {
          type: "string",
          enum: ["open", "pairing", "allowlist", "disabled"],
          default: "open",
        },
        allowFrom: { type: "array", items: { type: "string" } },
        enabled: { type: "boolean" },
      },
    },
    groups: {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          requireMention: { type: "boolean" },
          allowFrom: { type: "array", items: { type: "string" } },
          systemPrompt: { type: "string" },
        },
      },
    },
    accounts: {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: {
          enabled: { type: "boolean", default: true },
          orgId: { type: "string" },
          accessToken: { type: "string" },
          refreshToken: { type: "string" },
          clientId: { type: "string" },
          clientSecret: { type: "string" },
          botId: { type: "string" },
          botName: { type: "string" },
        },
      },
    },
  },
} as const;
