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
}

/**
 * SSE event types sent from server → client during a chat stream.
 */
export type SSEEvent =
  | { type: "conversation"; data: { conversationId: string; title?: string } }
  | { type: "delta"; data: { content: string } }
  | { type: "tool_use"; data: { tool: string; input: Record<string, unknown> } }
  | { type: "tool_result"; data: { tool: string; result: unknown } }
  | {
      type: "done";
      data: {
        messageId: string;
        usage?: { input_tokens: number; output_tokens: number };
      };
    }
  | { type: "error"; data: { code: string; message: string } };

export interface SendMessageParams {
  userId: string;
  agentInstanceId?: string | null;
  anchoredInsightId?: string | null;
  conversationId?: string | null;
  message: string;
  onEvent: (event: SSEEvent) => void;
}
