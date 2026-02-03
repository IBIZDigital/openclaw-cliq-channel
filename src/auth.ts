/**
 * Zoho OAuth token management
 * 
 * Handles token refresh for Zoho Cliq API.
 * Tokens expire every ~1 hour and must be refreshed.
 */

import type { CliqConfig } from "./config.js";

const ZOHO_TOKEN_URL = "https://accounts.zoho.com/oauth/v2/token";

export interface TokenRefreshOptions {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}

export interface TokenRefreshResult {
  accessToken: string;
  expiresIn: number;
  error?: string;
}

/**
 * Refresh the Zoho OAuth access token
 */
export async function refreshAccessToken(options: TokenRefreshOptions): Promise<TokenRefreshResult> {
  const { refreshToken, clientId, clientSecret } = options;

  console.log("[cliq-auth] Refreshing access token...");

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

  const data = await response.json() as { 
    access_token?: string; 
    expires_in?: number; 
    error?: string 
  };

  if (!response.ok || data.error) {
    console.error("[cliq-auth] Token refresh failed:", data);
    return {
      accessToken: "",
      expiresIn: 0,
      error: data.error || `HTTP ${response.status}`,
    };
  }

  console.log("[cliq-auth] Token refreshed successfully, expires in:", data.expires_in);

  return {
    accessToken: data.access_token || "",
    expiresIn: data.expires_in || 3600,
  };
}

/**
 * Token manager with auto-refresh on 401
 */
export class TokenManager {
  private accessToken: string;
  private refreshToken: string;
  private clientId: string;
  private clientSecret: string;
  private expiresAt: number = 0;
  private onTokenRefresh?: (newToken: string) => void;

  constructor(options: {
    accessToken: string;
    refreshToken: string;
    clientId: string;
    clientSecret: string;
    onTokenRefresh?: (newToken: string) => void;
  }) {
    this.accessToken = options.accessToken;
    this.refreshToken = options.refreshToken;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.onTokenRefresh = options.onTokenRefresh;
  }

  async getToken(): Promise<string> {
    // If token is about to expire (within 5 minutes), refresh proactively
    if (this.expiresAt && Date.now() > this.expiresAt - 5 * 60 * 1000) {
      await this.refresh();
    }
    return this.accessToken;
  }

  async refresh(): Promise<string> {
    const result = await refreshAccessToken({
      refreshToken: this.refreshToken,
      clientId: this.clientId,
      clientSecret: this.clientSecret,
    });

    if (result.error) {
      throw new Error(`Token refresh failed: ${result.error}`);
    }

    this.accessToken = result.accessToken;
    this.expiresAt = Date.now() + result.expiresIn * 1000;

    // Notify callback (for persisting to config)
    if (this.onTokenRefresh) {
      this.onTokenRefresh(result.accessToken);
    }

    return this.accessToken;
  }

  /**
   * Handle a 401 error by refreshing and returning new token
   */
  async handleUnauthorized(): Promise<string> {
    console.log("[cliq-auth] Got 401, attempting token refresh...");
    return this.refresh();
  }
}

/**
 * Refresh the Cliq token and update the config
 * Called by the cliq_refresh_token tool
 */
export async function refreshCliqToken(cfg: CliqConfig, _api?: unknown): Promise<void> {
  const account = cfg.accounts?.default || cfg;
  
  const refreshToken = (account as any).refreshToken || cfg.refreshToken;
  const clientId = (account as any).clientId || cfg.clientId;
  const clientSecret = (account as any).clientSecret || cfg.clientSecret;

  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error("Missing refresh credentials (refreshToken, clientId, clientSecret)");
  }

  const result = await refreshAccessToken({
    refreshToken,
    clientId,
    clientSecret,
  });

  if (result.error) {
    throw new Error(`Token refresh failed: ${result.error}`);
  }

  // Note: The new token needs to be persisted to config manually or via gateway restart
  // For now, we return the new token and let the caller handle persistence
  console.log("[cliq-auth] New access token obtained:", result.accessToken.substring(0, 20) + "...");
  console.log("[cliq-auth] Token refresh complete - update openclaw.json with new token");
}
