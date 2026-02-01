/**
 * Zoho OAuth token refresh
 */

import type { PluginApi } from "openclaw/plugin-sdk";

const ZOHO_TOKEN_URL = "https://accounts.zoho.com/oauth/v2/token";

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  error?: string;
}

function getCliqConfig(cfg: any): any {
  // Check both channels.cliq and plugins.entries.cliq.config
  return cfg.channels?.cliq ?? cfg.plugins?.entries?.cliq?.config ?? {};
}

export async function refreshCliqToken(cfg: any, api: PluginApi): Promise<string> {
  const cliqConfig = getCliqConfig(cfg);

  const refreshToken = cliqConfig.refreshToken;
  const clientId = cliqConfig.clientId;
  const clientSecret = cliqConfig.clientSecret;

  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error("Missing Cliq OAuth credentials (refreshToken, clientId, clientSecret)");
  }

  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });

  const response = await fetch(ZOHO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as TokenResponse;

  if (data.error) {
    throw new Error(`Token refresh error: ${data.error}`);
  }

  if (!data.access_token) {
    throw new Error("No access token in response");
  }

  // Update the config with new token
  // Note: This updates the in-memory config; for persistence,
  // the gateway config patch mechanism should be used
  if (cfg.channels?.cliq) {
    cfg.channels.cliq.accessToken = data.access_token;
  }

  api.logger.info("[cliq] Access token refreshed, expires in:", data.expires_in);

  return data.access_token;
}

/**
 * Generate the initial OAuth URL for authorization
 */
export function getAuthorizationUrl(options: {
  clientId: string;
  redirectUri: string;
  scopes?: string[];
}): string {
  const { clientId, redirectUri, scopes = [] } = options;

  const defaultScopes = [
    "ZohoCliq.Channels.READ",
    "ZohoCliq.Channels.CREATE",
    "ZohoCliq.Messages.READ",
    "ZohoCliq.Messages.CREATE",
  ];

  const allScopes = [...new Set([...defaultScopes, ...scopes])];

  const params = new URLSearchParams({
    scope: allScopes.join(","),
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    access_type: "offline",
    prompt: "consent",
  });

  return `https://accounts.zoho.com/oauth/v2/auth?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(options: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const { code, clientId, clientSecret, redirectUri } = options;

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  });

  const response = await fetch(ZOHO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as TokenResponse & { refresh_token?: string };

  if (data.error) {
    throw new Error(`Token exchange error: ${data.error}`);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || "",
    expiresIn: data.expires_in,
  };
}
