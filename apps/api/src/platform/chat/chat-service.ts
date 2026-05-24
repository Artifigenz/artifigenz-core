import { eq, asc, and, gte } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, conversations, messages, users, contextStated } from "@artifigenz/db";
import { extractMemoriesFromTurn } from "../memories/extractor";
import { findModel, DEFAULT_MODEL_ID } from "@artifigenz/shared";
import { getClaudeClient } from "../../agents/finance/lib/claude-client";
import { getOpenAIClient } from "./openai-client";
import { toolExecutor } from "./tool-executor";
import { loadPromptContext, buildSystemPrompt } from "./prompt-builder";
import type { SendMessageParams, SSEEvent, ChatAttachmentRef, PasteSnippet } from "./types";

const ATTACHMENT_DIR = join(tmpdir(), "artifigenz-chat-attachments");

/** Compose a user's typed text + their pasted snippets into one text block.
 *  Empty inputs are skipped; snippets are framed so the model can tell they
 *  came from the user's clipboard rather than the prompt itself. */
function composeUserText(
  typed: string,
  snippets: PasteSnippet[] | undefined,
): string {
  const parts: string[] = [];
  if (typed && typed.trim().length > 0) parts.push(typed);
  for (const s of snippets ?? []) {
    if (!s.content) continue;
    parts.push(
      `[Pasted content — ${s.content.length} chars]\n\n${s.content}`,
    );
  }
  return parts.join("\n\n");
}

async function loadAttachmentAsContentBlock(
  userId: string,
  att: ChatAttachmentRef,
): Promise<Anthropic.ContentBlockParam | null> {
  const ext = att.extension ?? "";
  const path = join(ATTACHMENT_DIR, userId, `${att.fileId}${ext}`);
  try {
    const s = await stat(path);
    if (!s.isFile()) return null;
    const data = (await readFile(path)).toString("base64");
    if (att.mimeType === "application/pdf") {
      return {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data,
        },
      };
    }
    if (att.mimeType.startsWith("image/")) {
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: att.mimeType as
            | "image/jpeg"
            | "image/png"
            | "image/webp"
            | "image/gif",
          data,
        },
      };
    }
    return null;
  } catch {
    return null;
  }
}

const MAX_TOKENS = 2048;
const TEMPERATURE = 0.5;
const MAX_TOOL_ROUNDS = 5;

// Anthropic-hosted web search server tool. Anthropic executes the search
// on their side and streams the citations back as part of the response.
const WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 5,
} as const;

export class ChatService {
  /**
   * Send a user message, stream the assistant response via onEvent callback.
   * Handles the full tool-use loop (stream → tool call → execute → feed back → continue).
   */
  async sendMessage(params: SendMessageParams): Promise<void> {
    const { userId, message, onEvent } = params;
    const model = findModel(params.model ?? DEFAULT_MODEL_ID);

    // ─── 1. Load user ────────────────────────────────────────────
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new Error(`User ${userId} not found`);

    // ─── 2. Create or load conversation ──────────────────────────
    let conversationId = params.conversationId ?? null;
    let isNewConversation = false;
    if (!conversationId) {
      const [newConv] = await db
        .insert(conversations)
        .values({
          userId,
          agentInstanceId: params.agentInstanceId ?? null,
          anchoredInsightId: params.anchoredInsightId ?? undefined,
          title: message.slice(0, 60),
          messageCount: 0,
        })
        .returning();
      conversationId = newConv.id;
      isNewConversation = true;
    }

    onEvent({
      type: "conversation",
      data: { conversationId, title: isNewConversation ? message.slice(0, 60) : undefined },
    });

    // ─── 2b. Edit/regenerate: truncate from the target message onward ──
    // The client passes truncateFromMessageId when the user edits a previous
    // message or hits "regenerate" — we delete that message and everything
    // newer, so the conversation effectively forks from this point.
    if (params.truncateFromMessageId && conversationId) {
      const [target] = await db
        .select({ createdAt: messages.createdAt })
        .from(messages)
        .where(
          and(
            eq(messages.id, params.truncateFromMessageId),
            eq(messages.conversationId, conversationId),
          ),
        )
        .limit(1);
      if (target?.createdAt) {
        await db
          .delete(messages)
          .where(
            and(
              eq(messages.conversationId, conversationId),
              gte(messages.createdAt, target.createdAt),
            ),
          );
      }
    }

    // ─── 3. Persist user message ─────────────────────────────────
    // In regenerate mode the user's prior turn is still in DB after the
    // truncate above — we just skip inserting a new one and reuse history.
    if (!params.regenerate) {
      const userAttachments = params.attachments ?? [];
      const pasteSnippets = (params.pasteSnippets ?? []).filter(
        (s) => typeof s.content === "string" && s.content.length > 0,
      );
      const userMetadata: Record<string, unknown> | null =
        userAttachments.length > 0 || pasteSnippets.length > 0
          ? {
              ...(userAttachments.length > 0
                ? { attachments: userAttachments }
                : {}),
              ...(pasteSnippets.length > 0 ? { pasteSnippets } : {}),
            }
          : null;
      const [userMsg] = await db
        .insert(messages)
        .values({
          conversationId,
          role: "user",
          content: message,
          metadata: userMetadata,
        })
        .returning();
      onEvent({ type: "user_message", data: { messageId: userMsg.id } });
    }

    // ─── 4. Load conversation history ────────────────────────────
    const history = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt));

    // ─── 5. Build system prompt from live context ────────────────
    const promptCtx = await loadPromptContext({
      userId,
      anchoredInsightId: params.anchoredInsightId,
    });
    const systemPrompt = buildSystemPrompt(promptCtx, {
      // Both providers expose web search now (Anthropic via web_search_20250305,
      // OpenAI via the Responses API web_search_preview built-in tool).
      hasWebSearch: true,
      // Platform data tools (finance/health getters) are Anthropic-only.
      hasDataTools: model.provider === "anthropic",
      modelLabel: model.label,
      modelFamily: model.family,
    });

    // ─── 6. Convert history to Claude message format ─────────────
    // User messages with attachments become multimodal content blocks (text
    // + image/document). Pasted snippets ride in the same text block as the
    // typed prompt, framed so the model can tell them apart.
    const claudeMessages: Anthropic.MessageParam[] = [];
    for (const m of history) {
      if (m.role === "assistant") {
        claudeMessages.push({ role: "assistant", content: m.content });
        continue;
      }
      const meta = m.metadata as {
        attachments?: ChatAttachmentRef[];
        pasteSnippets?: PasteSnippet[];
      } | null;
      const atts = meta?.attachments;
      const combinedText = composeUserText(m.content, meta?.pasteSnippets);
      if (!atts || atts.length === 0) {
        claudeMessages.push({ role: "user", content: combinedText });
        continue;
      }
      const blocks: Anthropic.ContentBlockParam[] = [];
      for (const att of atts) {
        const b = await loadAttachmentAsContentBlock(userId, att);
        if (b) blocks.push(b);
      }
      if (combinedText) blocks.push({ type: "text", text: combinedText });
      // Fallback to plain text if every file failed to load (e.g. tmp wiped).
      claudeMessages.push({
        role: "user",
        content: blocks.length > 0 ? blocks : combinedText,
      });
    }

    // ─── 7. Stream from provider ────────────────────────────────
    let assistantContent = "";
    const toolCallHistory: Array<{ tool: string; input: unknown; result: unknown }> = [];
    const citations: Array<{ url: string; title: string; citedText?: string }> = [];
    const citationUrls = new Set<string>();

    if (model.provider === "openai") {
      const result = await streamOpenAI({
        modelId: model.id,
        systemPrompt,
        history,
        userId,
        onEvent,
      });
      assistantContent = result.assistantContent;
      for (const c of result.citations) {
        if (!citationUrls.has(c.url)) {
          citationUrls.add(c.url);
          citations.push(c);
        }
      }
    } else {
    // Anthropic path — runs the full tool loop (incl. web_search)
    const client = getClaudeClient();
    const tools = [
      ...toolExecutor.getClaudeTools(),
      WEB_SEARCH_TOOL,
    ] as Anthropic.Messages.ToolUnion[];
    let round = 0;

    while (round < MAX_TOOL_ROUNDS) {
      round++;
      const stream = client.messages.stream({
        model: model.id,
        max_tokens: MAX_TOKENS,
        // Some models (e.g. Opus 4.7) reject `temperature` — opt in via flag.
        ...(model.supportsTemperature === false
          ? {}
          : { temperature: TEMPERATURE }),
        system: systemPrompt,
        tools,
        messages: claudeMessages,
      });

      // Buffer for current assistant turn
      type TurnBlock =
        | { type: "text"; text: string }
        | { type: "tool_use"; id: string; name: string; input: unknown; _partialJson?: string };
      const turnBlocks: TurnBlock[] = [];
      let turnText = "";

      for await (const event of stream) {
        if (event.type === "content_block_start") {
          const block = event.content_block;
          if (block.type === "text") {
            turnBlocks.push({ type: "text", text: "" });
          } else if (block.type === "tool_use") {
            turnBlocks.push({
              type: "tool_use",
              id: block.id,
              name: block.name,
              input: {},
            });
          } else if (block.type === "server_tool_use") {
            // Anthropic-hosted tool (e.g. web_search). Surface it to the UI
            // so the user sees "Searching the web..." while Anthropic runs it.
            onEvent({
              type: "tool_use",
              data: { tool: block.name, input: {} },
            });
          } else if (block.type === "web_search_tool_result") {
            onEvent({
              type: "tool_result",
              data: { tool: "web_search", result: { ok: true } },
            });
          }
        } else if (event.type === "content_block_delta") {
          const delta = event.delta;
          const lastBlock = turnBlocks[turnBlocks.length - 1];
          if (delta.type === "text_delta" && lastBlock?.type === "text") {
            lastBlock.text += delta.text;
            turnText += delta.text;
            onEvent({ type: "delta", data: { content: delta.text } });
          } else if (
            delta.type === "input_json_delta" &&
            lastBlock?.type === "tool_use"
          ) {
            // Accumulate partial JSON for tool input
            lastBlock._partialJson = (lastBlock._partialJson ?? "") + delta.partial_json;
          }
        } else if (event.type === "content_block_stop") {
          // Finalize block (parse tool input JSON if tool_use)
          const lastBlock = turnBlocks[turnBlocks.length - 1];
          if (lastBlock?.type === "tool_use") {
            try {
              lastBlock.input = JSON.parse(lastBlock._partialJson ?? "{}");
            } catch {
              lastBlock.input = {};
            }
          }
        }
      }

      const finalMessage = await stream.finalMessage();
      const stopReason = finalMessage.stop_reason;
      assistantContent += turnText;

      // ── Collect web_search citations from text blocks (deduped) ──
      for (const block of finalMessage.content) {
        if (block.type !== "text") continue;
        const blockCitations = (block as { citations?: unknown }).citations;
        if (!Array.isArray(blockCitations)) continue;
        for (const c of blockCitations) {
          const url = (c as { url?: string }).url;
          const title = (c as { title?: string }).title;
          if (!url || citationUrls.has(url)) continue;
          citationUrls.add(url);
          citations.push({
            url,
            title: title ?? url,
            citedText: (c as { cited_text?: string }).cited_text,
          });
        }
      }

      // Check if Claude called any tools
      const toolUseBlocks = finalMessage.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      if (stopReason !== "tool_use" || toolUseBlocks.length === 0) {
        // Stream ended without tool use → we're done
        break;
      }

      // Execute each tool call
      const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        onEvent({
          type: "tool_use",
          data: {
            tool: toolUse.name,
            input: toolUse.input as Record<string, unknown>,
          },
        });

        const result = await toolExecutor.execute(
          toolUse.name,
          toolUse.input as Record<string, unknown>,
          {
            user,
            agentInstanceId: params.agentInstanceId ?? null,
          },
        );

        onEvent({
          type: "tool_result",
          data: { tool: toolUse.name, result },
        });

        toolCallHistory.push({
          tool: toolUse.name,
          input: toolUse.input,
          result,
        });

        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
      }

      // Feed tool results back to Claude for the next round
      claudeMessages.push({
        role: "assistant",
        content: finalMessage.content,
      });
      claudeMessages.push({
        role: "user",
        content: toolResultBlocks,
      });
    }
    } // end Anthropic provider branch

    // ─── 8. Persist the assistant response ──────────────────────
    // Record which model generated this turn — the footer in the UI shows
    // it next to each response so the user can tell what answered what.
    const assistantMetadata: Record<string, unknown> = { modelId: model.id };
    if (citations.length > 0) {
      assistantMetadata.citations = citations;
    }

    const [assistantMsg] = await db
      .insert(messages)
      .values({
        conversationId,
        role: "assistant",
        content: assistantContent,
        toolCalls:
          toolCallHistory.length > 0
            ? (toolCallHistory as unknown as Record<string, unknown>)
            : null,
        metadata: assistantMetadata,
      })
      .returning();

    if (citations.length > 0) {
      onEvent({ type: "citations", data: { citations } });
    }

    // ── Generate follow-up suggestions (best-effort, Haiku) ──
    // Quick second call to suggest 3 questions the user might ask next.
    // Failure is silent so the main reply isn't blocked.
    const lastUserText = message; // user's prompt for THIS turn
    const followUps = await generateFollowUps(lastUserText, assistantContent);
    if (followUps.length > 0) {
      onEvent({ type: "followups", data: { followUps } });
      // Persist alongside the other metadata fields.
      await db
        .update(messages)
        .set({ metadata: { ...assistantMetadata, followUps } })
        .where(eq(messages.id, assistantMsg.id));
    }

    // Emit `done` after follow-ups so the client has everything when it
    // unlocks the input. The conversation-row bookkeeping below is just
    // for sidebar ordering and can lag without affecting UX.
    console.log("[chat] emitting done for message", assistantMsg.id);
    onEvent({
      type: "done",
      data: { messageId: assistantMsg.id },
    });

    // Update conversation message count + updated_at
    await db
      .update(conversations)
      .set({
        messageCount: history.length + 2,
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversationId));

    // ── Self-grow memory (best-effort, fire-and-forget) ───────────
    // Runs Haiku over the just-completed turn to extract durable facts
    // about the user. Failures are silent — they never affect the chat.
    void extractAndStoreMemories({
      userId,
      userText: message,
      assistantText: assistantContent,
    });
  }

  /**
   * List user's conversations.
   */
  async listConversations(userId: string) {
    return db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, userId))
      .orderBy(asc(conversations.updatedAt));
  }

  /**
   * Get a single conversation with its messages.
   */
  async getConversation(userId: string, conversationId: string) {
    const [conv] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.userId, userId),
        ),
      )
      .limit(1);

    if (!conv) return null;

    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt));

    return { conversation: conv, messages: msgs };
  }

  /**
   * Delete a conversation.
   */
  async deleteConversation(userId: string, conversationId: string) {
    await db
      .delete(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.userId, userId),
        ),
      );
  }
}

export const chatService = new ChatService();

// ── Self-grow memories from a chat turn (best-effort) ─────────────
// Cheap dedupe: skip insert if the same text already exists for this user.
async function extractAndStoreMemories(opts: {
  userId: string;
  userText: string;
  assistantText: string;
}): Promise<void> {
  try {
    const items = await extractMemoriesFromTurn({
      userText: opts.userText,
      assistantText: opts.assistantText,
    });
    if (items.length === 0) return;

    const existing = await db
      .select({ text: contextStated.text })
      .from(contextStated)
      .where(eq(contextStated.userId, opts.userId));
    const seen = new Set(existing.map((r) => r.text.toLowerCase().trim()));

    const fresh = items.filter((it) => !seen.has(it.text.toLowerCase().trim()));
    if (fresh.length === 0) return;

    await db.insert(contextStated).values(
      fresh.map((it) => ({
        userId: opts.userId,
        type: it.type,
        text: it.text,
        source: "artifigenz_chat" as const,
        active: true,
      })),
    );
  } catch (err) {
    console.warn("[memories] self-grow failed:", (err as Error).message);
  }
}

// ── Follow-up suggestions (small, fast, best-effort) ──────────────

const FOLLOWUP_MODEL = "claude-haiku-4-5-20251001";

async function generateFollowUps(
  userPrompt: string,
  assistantReply: string,
): Promise<string[]> {
  if (!userPrompt && !assistantReply) return [];
  try {
    const client = getClaudeClient();
    const res = await client.messages.create({
      model: FOLLOWUP_MODEL,
      max_tokens: 240,
      system:
        "You generate exactly 3 short, distinct follow-up questions a user might ask next, based on a Q&A turn. Return ONLY a JSON array of 3 strings, no preamble, no trailing prose. Each question stands on its own (no 'and', no follow-on context required), max 80 characters.",
      messages: [
        {
          role: "user",
          content: `User asked: ${userPrompt}\n\nAssistant answered:\n${assistantReply.slice(0, 4000)}\n\nReturn 3 follow-up questions as a JSON array of strings.`,
        },
      ],
    });
    const text = (
      res.content.find((b) => b.type === "text") as { text?: string } | undefined
    )?.text;
    if (!text) return [];
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const arr = JSON.parse(match[0]);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((s): s is string => typeof s === "string" && s.length > 0)
      .slice(0, 3);
  } catch {
    return [];
  }
}

// ── OpenAI streaming path (Responses API) ───────────────────────────
// Uses the Responses API rather than chat.completions so we can attach
// the built-in `web_search_preview` tool — giving OpenAI models the same
// live-data capability Claude already has via web_search_20250305.

interface StreamOpenAIParams {
  modelId: string;
  systemPrompt: string;
  history: Array<{
    role: string;
    content: string;
    metadata: unknown;
  }>;
  userId: string;
  onEvent: (event: SSEEvent) => void;
}

interface StreamOpenAIResult {
  assistantContent: string;
  citations: Array<{ url: string; title: string; citedText?: string }>;
}

type ResponsesInputItem = {
  role: "user" | "assistant";
  content: Array<
    | { type: "input_text"; text: string }
    | { type: "output_text"; text: string }
    | { type: "input_image"; image_url: string }
    | { type: "input_file"; filename: string; file_data: string }
  >;
};

async function rowToResponsesInput(
  m: { role: string; content: string; metadata: unknown },
  userId: string,
): Promise<ResponsesInputItem | null> {
  if (m.role === "assistant") {
    if (!m.content) return null;
    return {
      role: "assistant",
      content: [{ type: "output_text", text: m.content }],
    };
  }
  if (m.role !== "user") return null;

  const meta = m.metadata as {
    attachments?: ChatAttachmentRef[];
    pasteSnippets?: PasteSnippet[];
  } | null;
  const atts = meta?.attachments ?? [];
  const parts: ResponsesInputItem["content"] = [];

  for (const att of atts) {
    const ext = att.extension ?? "";
    const path = join(ATTACHMENT_DIR, userId, `${att.fileId}${ext}`);
    try {
      const s = await stat(path);
      if (!s.isFile()) continue;
      const data = (await readFile(path)).toString("base64");
      if (att.mimeType.startsWith("image/")) {
        parts.push({
          type: "input_image",
          image_url: `data:${att.mimeType};base64,${data}`,
        });
      } else if (att.mimeType === "application/pdf") {
        parts.push({
          type: "input_file",
          filename: att.filename,
          file_data: `data:application/pdf;base64,${data}`,
        });
      }
    } catch {
      // skip missing
    }
  }

  const combinedText = composeUserText(m.content, meta?.pasteSnippets);
  if (combinedText) {
    parts.push({ type: "input_text", text: combinedText });
  }

  return parts.length > 0 ? { role: "user", content: parts } : null;
}

async function streamOpenAI(
  params: StreamOpenAIParams,
): Promise<StreamOpenAIResult> {
  const { modelId, systemPrompt, history, userId, onEvent } = params;

  const openai = getOpenAIClient();
  const input: ResponsesInputItem[] = [];
  for (const m of history) {
    const converted = await rowToResponsesInput(m, userId);
    if (converted) input.push(converted);
  }

  // SDK types differ across versions; the wire format we send is stable.
  const stream = (await openai.responses.create({
    model: modelId,
    instructions: systemPrompt,
    input: input as unknown as Parameters<typeof openai.responses.create>[0]["input"],
    tools: [{ type: "web_search_preview" }],
    stream: true,
  })) as AsyncIterable<Record<string, unknown>>;

  let assistantContent = "";
  const citations: Array<{ url: string; title: string; citedText?: string }> = [];
  const seenUrls = new Set<string>();
  let searchAnnounced = false;

  for await (const ev of stream) {
    const type = ev.type as string;
    if (type === "response.output_text.delta") {
      const delta = ev.delta as string | undefined;
      if (typeof delta === "string" && delta.length > 0) {
        assistantContent += delta;
        onEvent({ type: "delta", data: { content: delta } });
      }
    } else if (
      type === "response.web_search_call.in_progress" ||
      type === "response.web_search_call.searching"
    ) {
      if (!searchAnnounced) {
        searchAnnounced = true;
        onEvent({
          type: "tool_use",
          data: { tool: "web_search", input: {} },
        });
      }
    } else if (type === "response.web_search_call.completed") {
      searchAnnounced = false;
      onEvent({
        type: "tool_result",
        data: { tool: "web_search", result: { ok: true } },
      });
    } else if (
      type === "response.output_text.annotation.added" ||
      type === "response.output_text.annotation_added"
    ) {
      const annotation = (ev.annotation ?? {}) as {
        type?: string;
        url?: string;
        title?: string;
      };
      if (
        annotation.type === "url_citation" &&
        annotation.url &&
        !seenUrls.has(annotation.url)
      ) {
        seenUrls.add(annotation.url);
        citations.push({
          url: annotation.url,
          title: annotation.title ?? annotation.url,
        });
      }
    }
  }

  return { assistantContent, citations };
}
