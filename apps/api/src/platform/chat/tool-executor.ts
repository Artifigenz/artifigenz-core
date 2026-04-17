import type {
  ChatToolDefinition,
  ToolExecutionContext,
} from "./types";
import { platformTools } from "./platform-tools";
import { financeTools } from "../../agents/finance/chat/finance-tools";
import { healthTools } from "../../agents/health/chat/health-tools";

export class ToolExecutor {
  private tools: Map<string, ChatToolDefinition>;

  constructor() {
    this.tools = new Map();
    // Register platform tools
    for (const tool of platformTools) {
      this.tools.set(tool.name, tool);
    }
    // Register agent-specific tools
    for (const tool of financeTools) {
      this.tools.set(tool.name, tool);
    }
    for (const tool of healthTools) {
      this.tools.set(tool.name, tool);
    }
  }

  /**
   * Get all tool definitions (for passing to Claude API).
   */
  getClaudeTools(): Array<{
    name: string;
    description: string;
    input_schema: ChatToolDefinition["input_schema"];
  }> {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));
  }

  /**
   * Execute a tool call with user-scoped context.
   */
  async execute(
    toolName: string,
    input: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<unknown> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return { error: `Unknown tool: ${toolName}` };
    }

    try {
      const result = await tool.execute(input, ctx);
      return result;
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : "Tool execution failed",
      };
    }
  }

  /**
   * Returns the list of tool names registered.
   */
  listTools(): string[] {
    return Array.from(this.tools.keys());
  }
}

export const toolExecutor = new ToolExecutor();
