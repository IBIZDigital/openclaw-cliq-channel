/**
 * Conversation State Tracker
 * 
 * Tracks active conversations so Henry can intelligently decide
 * whether to respond to follow-up messages without @mentions.
 */

export interface ConversationState {
  /** When Henry was last @mentioned by this user in this context */
  lastMentionAt: number;
  /** When Henry last responded */
  lastResponseAt: number;
  /** The session key for this conversation */
  sessionKey: string;
  /** Brief topic/context hint (optional) */
  topic?: string;
}

export interface ConversationTrackerConfig {
  /** How long a conversation stays active (ms). Default: 5 minutes */
  timeoutMs?: number;
  /** Max conversations to track (LRU eviction). Default: 1000 */
  maxConversations?: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_CONVERSATIONS = 1000;

/**
 * In-memory conversation tracker with LRU eviction
 */
class ConversationTracker {
  private conversations = new Map<string, ConversationState>();
  private config: Required<ConversationTrackerConfig>;

  constructor(config: ConversationTrackerConfig = {}) {
    this.config = {
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxConversations: config.maxConversations ?? DEFAULT_MAX_CONVERSATIONS,
    };
  }

  /**
   * Generate a unique key for a user+channel combination
   */
  private makeKey(params: { channelId: string; userId: string }): string {
    return `cliq:${params.channelId}:${params.userId}`;
  }

  /**
   * Record that Henry was @mentioned (starts/continues a conversation)
   */
  recordMention(params: {
    channelId: string;
    userId: string;
    sessionKey: string;
    topic?: string;
  }): void {
    const key = this.makeKey(params);
    const now = Date.now();

    const existing = this.conversations.get(key);
    
    this.conversations.set(key, {
      lastMentionAt: now,
      lastResponseAt: existing?.lastResponseAt ?? now,
      sessionKey: params.sessionKey,
      topic: params.topic ?? existing?.topic,
    });

    // LRU eviction
    if (this.conversations.size > this.config.maxConversations) {
      const oldest = this.findOldest();
      if (oldest) {
        this.conversations.delete(oldest);
      }
    }

    console.log(`[cliq-tracker] Recorded mention: ${key}, timeout=${this.config.timeoutMs}ms`);
  }

  /**
   * Record that Henry responded
   */
  recordResponse(params: { channelId: string; userId: string }): void {
    const key = this.makeKey(params);
    const existing = this.conversations.get(key);
    
    if (existing) {
      existing.lastResponseAt = Date.now();
      this.conversations.set(key, existing);
    }
  }

  /**
   * Check if there's an active conversation with this user
   * Returns the conversation state if active, null otherwise
   */
  getActiveConversation(params: {
    channelId: string;
    userId: string;
  }): ConversationState | null {
    const key = this.makeKey(params);
    const state = this.conversations.get(key);

    if (!state) {
      return null;
    }

    const now = Date.now();
    const lastActivity = Math.max(state.lastMentionAt, state.lastResponseAt);
    const elapsed = now - lastActivity;

    if (elapsed > this.config.timeoutMs) {
      // Conversation expired
      console.log(`[cliq-tracker] Conversation expired: ${key}, elapsed=${elapsed}ms`);
      this.conversations.delete(key);
      return null;
    }

    console.log(`[cliq-tracker] Active conversation found: ${key}, elapsed=${elapsed}ms`);
    return state;
  }

  /**
   * Check if a conversation is active (boolean helper)
   */
  hasActiveConversation(params: { channelId: string; userId: string }): boolean {
    return this.getActiveConversation(params) !== null;
  }

  /**
   * Update the timeout setting
   */
  setTimeoutMs(ms: number): void {
    this.config.timeoutMs = ms;
    console.log(`[cliq-tracker] Timeout updated to ${ms}ms`);
  }

  /**
   * Clear all conversations (for testing)
   */
  clear(): void {
    this.conversations.clear();
  }

  /**
   * Get stats for debugging
   */
  getStats(): { active: number; timeout: number } {
    // Clean up expired conversations
    const now = Date.now();
    for (const [key, state] of this.conversations.entries()) {
      const lastActivity = Math.max(state.lastMentionAt, state.lastResponseAt);
      if (now - lastActivity > this.config.timeoutMs) {
        this.conversations.delete(key);
      }
    }

    return {
      active: this.conversations.size,
      timeout: this.config.timeoutMs,
    };
  }

  private findOldest(): string | null {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, state] of this.conversations.entries()) {
      const lastActivity = Math.max(state.lastMentionAt, state.lastResponseAt);
      if (lastActivity < oldestTime) {
        oldestTime = lastActivity;
        oldestKey = key;
      }
    }

    return oldestKey;
  }
}

// Singleton instance
let trackerInstance: ConversationTracker | null = null;

export function getConversationTracker(config?: ConversationTrackerConfig): ConversationTracker {
  if (!trackerInstance) {
    trackerInstance = new ConversationTracker(config);
  } else if (config?.timeoutMs) {
    trackerInstance.setTimeoutMs(config.timeoutMs);
  }
  return trackerInstance;
}

/**
 * Generate the system hint for the agent when processing a follow-up message
 */
export function generateFollowUpHint(state: ConversationState): string {
  const elapsedSec = Math.round((Date.now() - state.lastResponseAt) / 1000);
  const elapsedMin = Math.round(elapsedSec / 60);
  
  const timeAgo = elapsedMin > 0 
    ? `${elapsedMin} minute${elapsedMin > 1 ? 's' : ''} ago`
    : `${elapsedSec} seconds ago`;

  return `[Conversation Context] You were recently helping this user (${timeAgo}). ` +
    `This message doesn't have an @mention, but may be a follow-up to your conversation. ` +
    `If it seems relevant to what you were discussing, respond naturally. ` +
    `If it's clearly meant for someone else or off-topic, respond with just: NO_REPLY`;
}
