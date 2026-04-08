import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function getClaudeClient(): Anthropic {
  if (client) return client;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY must be set");
  }

  client = new Anthropic({ apiKey });
  return client;
}
