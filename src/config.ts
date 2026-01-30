/**
 * Zoho Cliq Channel Configuration
 */

import { z } from "zod";

export const CliqAccountSchema = z.object({
  enabled: z.boolean().default(true),
  orgId: z.string().optional(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  botId: z.string().optional(),
  botName: z.string().default("Henry"),
  webhookSecret: z.string().optional(),
  dm: z
    .object({
      policy: z.enum(["open", "pairing", "allowlist"]).default("open"),
      allowFrom: z.array(z.string()).default([]),
    })
    .optional(),
  channels: z.record(z.string(), z.any()).optional(),
});

export const CliqConfigSchema = z.object({
  // Top-level config (used as defaults)
  orgId: z.string().optional(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  botId: z.string().optional(),
  botName: z.string().default("Henry"),
  webhookSecret: z.string().optional(),
  dm: z
    .object({
      policy: z.enum(["open", "pairing", "allowlist"]).default("open"),
      allowFrom: z.array(z.string()).default([]),
    })
    .optional(),
  channels: z.record(z.string(), z.any()).optional(),
  // Multi-account support
  accounts: z.record(z.string(), CliqAccountSchema).optional(),
});

export type CliqConfig = z.infer<typeof CliqConfigSchema>;

export interface CliqAccount {
  accountId: string;
  enabled: boolean;
  orgId?: string;
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  botId?: string;
  botName: string;
  webhookSecret?: string;
  dm?: {
    policy: "open" | "pairing" | "allowlist";
    allowFrom: string[];
  };
  channels?: Record<string, any>;
}

export interface CliqMessage {
  chatId: string;
  senderId: string;
  senderName: string;
  text: string;
  messageId: string;
  timestamp: string;
  channelId?: string;
  channelName?: string;
  isChannel: boolean;
  isMention: boolean;
  threadId?: string;
}
