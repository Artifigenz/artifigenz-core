import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { writeFile, mkdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { clerkAuth } from "../platform/auth/clerk-middleware";
import { chatService } from "../platform/chat/chat-service";

const app = new Hono();
app.use("/*", clerkAuth);

const ATTACHMENT_DIR = join(tmpdir(), "artifigenz-chat-attachments");
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

function userAttachmentDir(userId: string) {
  return join(ATTACHMENT_DIR, userId);
}

function attachmentPath(userId: string, fileId: string, ext: string) {
  return join(userAttachmentDir(userId), `${fileId}${ext}`);
}

// ── Attachments ─────────────────────────────────────────────────

// POST /api/me/chat/attachments — multipart upload, returns metadata
app.post("/attachments", async (c) => {
  const user = c.get("user");
  const formData = await c.req.formData();
  const file = formData.get("file");

  if (!file || typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== "function") {
    return c.json({ error: "No file provided. Send a 'file' field." }, 400);
  }

  const f = file as unknown as {
    name?: string;
    type: string;
    size: number;
    arrayBuffer: () => Promise<ArrayBuffer>;
  };
  const mimeType = f.type ?? "application/octet-stream";
  const filename = f.name ?? `upload-${Date.now()}`;
  const size = f.size ?? 0;

  if (!ALLOWED_MIME.has(mimeType)) {
    return c.json(
      { error: `Unsupported file type: ${mimeType}. Allowed: images and PDF.` },
      400,
    );
  }
  if (size > MAX_BYTES) {
    return c.json({ error: `File too large. Max ${MAX_BYTES / 1024 / 1024}MB.` }, 400);
  }

  const fileId = randomUUID();
  const ext = extname(filename) || (mimeType === "application/pdf" ? ".pdf" : "");
  await mkdir(userAttachmentDir(user.id), { recursive: true });
  const path = attachmentPath(user.id, fileId, ext);
  const buffer = Buffer.from(await f.arrayBuffer());
  await writeFile(path, buffer);

  return c.json({
    fileId,
    filename,
    mimeType,
    sizeBytes: size,
    extension: ext,
  });
});

// GET /api/me/chat/attachments/:fileId — serve file bytes (for thumbnails)
app.get("/attachments/:fileId", async (c) => {
  const user = c.get("user");
  const fileId = c.req.param("fileId");
  if (!/^[a-f0-9-]{36}$/i.test(fileId)) {
    return c.json({ error: "Invalid id" }, 400);
  }
  // Try common extensions; we don't track which was used here.
  const candidates = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".pdf", ""];
  for (const ext of candidates) {
    const path = attachmentPath(user.id, fileId, ext);
    try {
      const s = await stat(path);
      if (!s.isFile()) continue;
      const bytes = await readFile(path);
      const mime =
        ext === ".png"
          ? "image/png"
          : ext === ".webp"
            ? "image/webp"
            : ext === ".gif"
              ? "image/gif"
              : ext === ".pdf"
                ? "application/pdf"
                : "image/jpeg";
      return new Response(new Uint8Array(bytes), {
        headers: { "Content-Type": mime, "Cache-Control": "private, max-age=3600" },
      });
    } catch {
      // try next ext
    }
  }
  return c.json({ error: "Not found" }, 404);
});

// POST /api/me/chat — streaming chat
app.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();

  if (!body.message || typeof body.message !== "string") {
    return c.json({ error: "message is required" }, 400);
  }
  if (body.message.length > 10_000) {
    return c.json({ error: "message too long (max 10000 chars)" }, 400);
  }

  return streamSSE(c, async (stream) => {
    try {
      await chatService.sendMessage({
        userId: user.id,
        agentInstanceId: body.agentInstanceId ?? null,
        anchoredInsightId: body.anchoredInsightId ?? null,
        conversationId: body.conversationId ?? null,
        truncateFromMessageId: body.truncateFromMessageId ?? null,
        attachments: Array.isArray(body.attachments) ? body.attachments : [],
        model: typeof body.model === "string" ? body.model : null,
        message: body.message,
        onEvent: async (event) => {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event.data),
          });
        },
      });
    } catch (err) {
      console.error("[chat] sendMessage failed:", err);
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({
          code: "internal_error",
          message: err instanceof Error ? err.message : "Unknown error",
        }),
      });
    }
  });
});

// GET /api/me/conversations
app.get("/conversations", async (c) => {
  const user = c.get("user");
  const convs = await chatService.listConversations(user.id);
  return c.json({ conversations: convs });
});

// GET /api/me/conversations/:id
app.get("/conversations/:id", async (c) => {
  const user = c.get("user");
  const result = await chatService.getConversation(
    user.id,
    c.req.param("id"),
  );
  if (!result) return c.json({ error: "Not found" }, 404);
  return c.json(result);
});

// DELETE /api/me/conversations/:id
app.delete("/conversations/:id", async (c) => {
  const user = c.get("user");
  await chatService.deleteConversation(user.id, c.req.param("id"));
  return c.body(null, 204);
});

export default app;
