/**
 * Singleton token manager for Cliq
 * Auto-refreshes on 401 and updates config
 */

import { refreshAccessToken } from "./auth.js";

let instance: CliqTokenManager | null = null;

export class CliqTokenManager {
  private accessToken: string;
  private refreshToken: string;
  private clientId: string;
  private clientSecret: string;
  private expiresAt: number = 0;
  private refreshPromise: Promise<string> | null = null;
  private configUpdater?: (newToken: string) => void;

  constructor(options: {
    accessToken: string;
    refreshToken: string;
    clientId: string;
    clientSecret: string;
    configUpdater?: (newToken: string) => void;
  }) {
    this.accessToken = options.accessToken;
    this.refreshToken = options.refreshToken;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.configUpdater = options.configUpdater;
  }

  /**
   * Get current token, refreshing proactively if about to expire
   */
  async getToken(): Promise<string> {
    // If token expires in less than 5 minutes, refresh proactively
    if (this.expiresAt && Date.now() > this.expiresAt - 5 * 60 * 1000) {
      console.log("[cliq-token] Token expiring soon, refreshing proactively...");
      await this.refresh();
    }
    return this.accessToken;
  }

  /**
   * Force refresh the token
   * Deduplicates concurrent refresh requests
   */
  async refresh(): Promise<string> {
    // If already refreshing, wait for that to complete
    if (this.refreshPromise) {
      console.log("[cliq-token] Refresh already in progress, waiting...");
      return this.refreshPromise;
    }

    this.refreshPromise = this._doRefresh();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async _doRefresh(): Promise<string> {
    console.log("[cliq-token] Refreshing access token...");

    const result = await refreshAccessToken({
      refreshToken: this.refreshToken,
      clientId: this.clientId,
      clientSecret: this.clientSecret,
    });

    if (result.error) {
      console.error("[cliq-token] Refresh failed:", result.error);
      throw new Error(`Token refresh failed: ${result.error}`);
    }

    this.accessToken = result.accessToken;
    this.expiresAt = Date.now() + result.expiresIn * 1000;

    console.log("[cliq-token] Token refreshed, expires at:", new Date(this.expiresAt).toISOString());

    // Update config if callback provided
    if (this.configUpdater) {
      try {
        this.configUpdater(result.accessToken);
      } catch (err) {
        console.error("[cliq-token] Config update failed:", err);
      }
    }

    return this.accessToken;
  }

  /**
   * Handle 401 by refreshing and returning new token
   */
  async handleUnauthorized(): Promise<string> {
    console.log("[cliq-token] Got 401, refreshing token...");
    return this.refresh();
  }

  /**
   * Update the token (e.g., from external refresh)
   */
  updateToken(newToken: string, expiresIn?: number): void {
    this.accessToken = newToken;
    if (expiresIn) {
      this.expiresAt = Date.now() + expiresIn * 1000;
    }
  }
}

/**
 * Initialize the singleton token manager
 */
export function initTokenManager(options: {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  configUpdater?: (newToken: string) => void;
}): CliqTokenManager {
  instance = new CliqTokenManager(options);
  return instance;
}

/**
 * Get the singleton token manager
 */
export function getTokenManager(): CliqTokenManager | null {
  return instance;
}

/**
 * Execute a function with auto-retry on 401
 */
export async function withAutoRefresh<T>(
  fn: (token: string) => Promise<T>,
  manager?: CliqTokenManager
): Promise<T> {
  const tokenManager = manager || instance;
  if (!tokenManager) {
    throw new Error("Token manager not initialized");
  }

  const token = await tokenManager.getToken();
  
  try {
    return await fn(token);
  } catch (err: any) {
    // Check if it's a 401 error
    if (err?.message?.includes("401") || err?.message?.includes("unauthorized") || err?.message?.includes("Unauthorized")) {
      console.log("[cliq-token] Request failed with 401, retrying with fresh token...");
      const newToken = await tokenManager.handleUnauthorized();
      return await fn(newToken);
    }
    throw err;
  }
}
