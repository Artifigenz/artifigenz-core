import type { users, agentInstances, insights } from "@artifigenz/db";

export type UserRow = typeof users.$inferSelect;
export type AgentInstanceRow = typeof agentInstances.$inferSelect;
export type InsightRow = typeof insights.$inferSelect;

/**
 * Tool definition — shared by platform and agent-specific tools.
 */
export interface ChatToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute: (
    input: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ) => Promise<unknown>;
}

/**
 * Context provided to every tool call — always user-scoped.
 */
export interface ToolExecutionContext {
  user: UserRow;
  agentInstanceId: string | null;
}

/**
 * Context passed to PromptBuilder to assemble the system prompt.
 */
export interface ChatPromptContext {
  user: UserRow;
  activeAgents: AgentInstanceRow[];
  recentInsights: InsightRow[];
  financeSnapshot: {
    subscriptionCount: number;
    monthlyTotal: number;
    upcomingCharges: number;
  } | null;
  healthSnapshot: {
    avgSteps: number | null;
    avgSleepHours: number | null;
    avgRestingHR: number | null;
    daysWithData: number;
  } | null;
  anchoredInsight: InsightRow | null;
  memories: Array<{ type: string; text: string; source: string }>;
}

/**
 * SSE event types sent from server → client during a chat stream.
 */
export interface ChatCitation {
  url: string;
  title: string;
  citedText?: string;
}

export type SSEEvent =
  | { type: "conversation"; data: { conversationId: string; title?: string } }
  | { type: "title"; data: { conversationId: string; title: string } }
  | { type: "user_message"; data: { messageId: string } }
  | { type: "delta"; data: { content: string } }
  | { type: "tool_use"; data: { tool: string; input: Record<string, unknown> } }
  | { type: "tool_result"; data: { tool: string; result: unknown } }
  | { type: "citations"; data: { citations: ChatCitation[] } }
  | { type: "followups"; data: { followUps: string[] } }
  | {
      type: "done";
      data: {
        messageId: string;
        usage?: { input_tokens: number; output_tokens: number };
      };
    }
  | { type: "error"; data: { code: string; message: string } };

export interface ChatAttachmentRef {
  fileId: string;
  filename: string;
  mimeType: string;
  sizeBytes?: number;
  /** File extension as stored on disk (e.g. ".png"). */
  extension?: string;
}

export interface PasteSnippet {
  /** Client-generated id for chip dedup + React keys. */
  id: string;
  /** Full pasted text — appended into the model prompt at send time. */
  content: string;
  /** Optional first-line preview for the chip; computed client-side. */
  firstLine?: string;
}

export interface SendMessageParams {
  userId: string;
  agentInstanceId?: string | null;
  anchoredInsightId?: string | null;
  conversationId?: string | null;
  message: string;
  attachments?: ChatAttachmentRef[];
  pasteSnippets?: PasteSnippet[];
  /** Model id (e.g. "claude-sonnet-4-6", "gpt-4o"). Defaults to DEFAULT_MODEL_ID. */
  model?: string | null;
  /** Intelligence level the user picked (instant | medium | high). Resolved
   *  server-side against `model` to produce the actual call config. */
  intelligence?: string | null;
  /**
   * If set, delete this message and everything newer in the same
   * conversation before appending. Used for edit + regenerate.
   */
  truncateFromMessageId?: string | null;
  /**
   * When true, this is a "regenerate" — the user's prior message is reused
   * from history, so the server skips inserting a new one and just
   * regenerates the assistant turn.
   */
  regenerate?: boolean;
  onEvent: (event: SSEEvent) => void;
}
