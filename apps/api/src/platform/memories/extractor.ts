import { getClaudeClient } from "../../agents/finance/lib/claude-client";

export interface ExtractedMemory {
  type: string;
  text: string;
}

const VALID_TYPES = new Set([
  "identity",
  "work",
  "person",
  "preference",
  "goal",
  "fact",
  "quirk",
]);

/**
 * Parse a pasted memory dump from ChatGPT/Claude into individual rows.
 *
 * The import prompt asks the source AI to:
 *   - wrap output in ```memory ... ```
 *   - prefix each item with "- "
 *   - group items under "## Identity", "## Work & projects", etc.
 *
 * We honor that structure when present and fall back to "any bullet line"
 * parsing when the output didn't follow the format exactly.
 */
export async function extractMemoriesFromText(
  raw: string,
): Promise<ExtractedMemory[]> {
  const stripped = stripFenced(raw);
  const heuristic = parseHeuristically(stripped);
  if (heuristic.length > 0) return heuristic;
  // Fall back to LLM if heuristics produced nothing — handles freeform paragraphs.
  return llmExtract(stripped);
}

function stripFenced(s: string): string {
  // Prefer the ```memory ... ``` block if present, else any ``` block.
  const memoryBlock = s.match(/```memory\s*([\s\S]*?)```/i);
  if (memoryBlock) return memoryBlock[1].trim();
  const anyBlock = s.match(/```[a-z]*\s*([\s\S]*?)```/i);
  if (anyBlock) return anyBlock[1].trim();
  return s.trim();
}

function parseHeuristically(s: string): ExtractedMemory[] {
  const lines = s.split(/\r?\n/);
  let currentType = "fact";
  const out: ExtractedMemory[] = [];

  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line) continue;

    const heading = line.match(/^#+\s*(.+)$/);
    if (heading) {
      currentType = headingToType(heading[1]);
      continue;
    }

    const bullet = line.match(/^[-*•]\s+(.+)$/) ?? line.match(/^\d+[.)]\s+(.+)$/);
    if (!bullet) continue;
    const text = bullet[1].trim();
    if (text.length < 3) continue;
    if (text.length > 1000) continue;
    out.push({ type: currentType, text });
  }
  return out;
}

function headingToType(heading: string): string {
  const h = heading.toLowerCase();
  if (h.includes("identity") || h.includes("about")) return "identity";
  if (h.includes("work") || h.includes("project") || h.includes("career")) return "work";
  if (h.includes("people") || h.includes("relationship")) return "person";
  if (h.includes("preference") || h.includes("style") || h.includes("communication")) return "preference";
  if (h.includes("goal") || h.includes("theme") || h.includes("aspir")) return "goal";
  if (h.includes("fact")) return "fact";
  if (h.includes("quirk") || h.includes("memorable") || h.includes("personal")) return "quirk";
  return "fact";
}

const EXTRACT_MODEL = "claude-haiku-4-5-20251001";

async function llmExtract(text: string): Promise<ExtractedMemory[]> {
  if (text.length < 20) return [];
  try {
    const client = getClaudeClient();
    const res = await client.messages.create({
      model: EXTRACT_MODEL,
      max_tokens: 2000,
      system:
        "You convert a freeform description of a person into a clean JSON array of discrete memory items. " +
        "Each item: { type: one of [identity, work, person, preference, goal, fact, quirk], text: a single self-contained sentence about the user, ≤200 chars }. " +
        "Return ONLY the JSON array, no preamble. Skip generic filler. Aim for high-signal, specific facts only.",
      messages: [
        {
          role: "user",
          content: `Extract memory items from this text about the user:\n\n${text.slice(0, 20000)}`,
        },
      ],
    });
    const out = (
      res.content.find((b) => b.type === "text") as { text?: string } | undefined
    )?.text;
    if (!out) return [];
    const match = out.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const arr = JSON.parse(match[0]);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((it: unknown) => {
        if (!it || typeof it !== "object") return null;
        const o = it as Record<string, unknown>;
        const type = typeof o.type === "string" && VALID_TYPES.has(o.type) ? o.type : "fact";
        const txt = typeof o.text === "string" ? o.text.trim() : "";
        if (!txt || txt.length < 3 || txt.length > 1000) return null;
        return { type, text: txt };
      })
      .filter((v): v is ExtractedMemory => v !== null);
  } catch {
    return [];
  }
}

/**
 * Pull memories from a conversation turn. Used by chat-service for self-grow.
 * Best-effort and non-blocking — returns [] on any failure.
 */
export async function extractMemoriesFromTurn(opts: {
  userText: string;
  assistantText: string;
}): Promise<ExtractedMemory[]> {
  const blob = `User said: ${opts.userText}\n\nAssistant replied: ${opts.assistantText.slice(0, 2000)}`;
  if (opts.userText.length < 20) return [];
  try {
    const client = getClaudeClient();
    const res = await client.messages.create({
      model: EXTRACT_MODEL,
      max_tokens: 600,
      system:
        "You read one chat turn and extract any NEW, durable memories about the user that are worth remembering across future conversations. " +
        "Return a JSON array (possibly empty). Each item: { type: one of [identity, work, person, preference, goal, fact, quirk], text: a single sentence about the user, ≤200 chars }. " +
        "Only extract facts about the USER, not the assistant. Skip questions, transient tasks, casual remarks, anything obvious. " +
        "Return ONLY the JSON array.",
      messages: [{ role: "user", content: blob }],
    });
    const out = (
      res.content.find((b) => b.type === "text") as { text?: string } | undefined
    )?.text;
    if (!out) return [];
    const match = out.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const arr = JSON.parse(match[0]);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((it: unknown) => {
        if (!it || typeof it !== "object") return null;
        const o = it as Record<string, unknown>;
        const type = typeof o.type === "string" && VALID_TYPES.has(o.type) ? o.type : "fact";
        const txt = typeof o.text === "string" ? o.text.trim() : "";
        if (!txt || txt.length < 3 || txt.length > 500) return null;
        return { type, text: txt };
      })
      .filter((v): v is ExtractedMemory => v !== null);
  } catch {
    return [];
  }
}
