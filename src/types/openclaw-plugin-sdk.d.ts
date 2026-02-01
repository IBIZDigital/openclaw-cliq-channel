// Type stubs for OpenClaw Plugin SDK
declare module "openclaw/plugin-sdk" {
  export interface Logger {
    info(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
    debug(...args: any[]): void;
  }

  export interface PluginApi {
    logger: Logger;
    dispatchInbound?(message: any): void;
    registerHttpHandler(
      method: string,
      path: string,
      handler: (req: any, res: any) => Promise<void>
    ): void;
    registerChannel(opts: { plugin: ChannelPlugin }): void;
    registerTool(tool: {
      name: string;
      description: string;
      parameters: Record<string, any>;
      handler: (ctx: any) => Promise<any>;
    }): void;
  }

  export interface ChannelMeta {
    id: string;
    label: string;
    selectionLabel: string;
    docsPath: string;
    blurb: string;
    aliases: string[];
  }

  export interface ChannelPlugin {
    id: string;
    meta: ChannelMeta;
    capabilities: {
      chatTypes: string[];
      reactions: boolean;
      threads: boolean;
      media: boolean;
      nativeCommands: boolean;
    };
    configSchema: any;
    config: {
      listAccountIds: (cfg: any) => string[];
      resolveAccount: (cfg: any, accountId?: string) => any;
      defaultAccountId: () => string;
      isConfigured: (account: any) => boolean;
      describeAccount: (account: any) => any;
    };
    security: {
      resolveDmPolicy: (opts: { account: any }) => {
        policy: string;
        allowFrom: string[];
        allowFromPath: string;
      };
    };
    outbound: {
      deliveryMode: string;
      sendText: (opts: {
        text: string;
        target: string;
        account?: any;
        cfg: any;
        api?: PluginApi;
      }) => Promise<{ ok: boolean; error?: string }>;
    };
    gateway: {
      start: (opts: { api: PluginApi; cfg: any }) => Promise<void>;
      stop: (opts: { api: PluginApi }) => Promise<void>;
    };
  }
}
