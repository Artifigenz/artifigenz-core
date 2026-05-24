import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, contextStated } from "@artifigenz/db";
import { clerkAuth } from "../platform/auth/clerk-middleware";
import { extractMemoriesFromText } from "../platform/memories/extractor";

const app = new Hono();

app.use("/*", clerkAuth);

const ALLOWED_SOURCES = [
  "artifigenz_chat",
  "chatgpt_import",
  "claude_import",
  "manual",
] as const;
type MemorySource = (typeof ALLOWED_SOURCES)[number];

function isSource(v: unknown): v is MemorySource {
  return typeof v === "string" && (ALLOWED_SOURCES as readonly string[]).includes(v);
}

// ─── GET /api/me/memories — list ──────────────────────────────────
app.get("/", async (c) => {
  const user = c.get("user");
  const source = c.req.query("source");
  const includeInactive = c.req.query("includeInactive") === "true";

  const where = [eq(contextStated.userId, user.id)];
  if (!includeInactive) where.push(eq(contextStated.active, true));
  if (source && isSource(source)) where.push(eq(contextStated.source, source));

  const rows = await db
    .select()
    .from(contextStated)
    .where(and(...where))
    .orderBy(desc(contextStated.createdAt));

  return c.json({ memories: rows });
});

// ─── POST /api/me/memories — manual create ────────────────────────
app.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  const text = (body?.text ?? "").toString().trim();
  if (!text) return c.json({ error: "text is required" }, 400);
  if (text.length > 2000) return c.json({ error: "text too long (max 2000)" }, 400);

  const type = (body?.type ?? "fact").toString().slice(0, 50);
  const source: MemorySource = isSource(body?.source) ? body.source : "manual";

  const [row] = await db
    .insert(contextStated)
    .values({ userId: user.id, type, text, source, active: true })
    .returning();
  return c.json({ memory: row });
});

// ─── PATCH /api/me/memories/:id ───────────────────────────────────
app.patch("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};
  if (typeof body?.text === "string") updates.text = body.text.trim().slice(0, 2000);
  if (typeof body?.active === "boolean") updates.active = body.active;
  if (typeof body?.type === "string") updates.type = body.type.slice(0, 50);

  if (Object.keys(updates).length === 0) {
    return c.json({ error: "no updatable fields" }, 400);
  }

  const [row] = await db
    .update(contextStated)
    .set(updates)
    .where(and(eq(contextStated.id, id), eq(contextStated.userId, user.id)))
    .returning();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ memory: row });
});

// ─── DELETE /api/me/memories/:id ──────────────────────────────────
app.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  await db
    .delete(contextStated)
    .where(and(eq(contextStated.id, id), eq(contextStated.userId, user.id)));
  return c.body(null, 204);
});

// ─── POST /api/me/memories/import — paste bulk text ───────────────
// Body: { source: 'chatgpt_import' | 'claude_import', text: string }
// We split into individual memory rows two ways:
//   1. Try to extract a fenced ```memory ... ``` block first (the prompt
//      asks the source AI to wrap output that way).
//   2. Fall back to splitting on newline bullets / numbered lines.
// Optionally runs Haiku in the background to refine, but the synchronous
// path always returns something so the import never hangs on the model.
app.post("/import", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  const rawText = (body?.text ?? "").toString();
  const source: MemorySource = isSource(body?.source) ? body.source : "chatgpt_import";

  if (!rawText.trim()) return c.json({ error: "text is required" }, 400);
  if (rawText.length > 60000) return c.json({ error: "text too long (max 60000)" }, 400);

  const items = await extractMemoriesFromText(rawText);
  if (items.length === 0) return c.json({ imported: 0, memories: [] });

  const values = items.map((it) => ({
    userId: user.id,
    type: it.type,
    text: it.text,
    source,
    active: true,
  }));

  const inserted = await db.insert(contextStated).values(values).returning();
  return c.json({ imported: inserted.length, memories: inserted });
});

// ─── DELETE /api/me/memories/source/:source — bulk wipe by source ──
app.delete("/source/:source", async (c) => {
  const user = c.get("user");
  const source = c.req.param("source");
  if (!isSource(source)) return c.json({ error: "invalid source" }, 400);
  await db
    .delete(contextStated)
    .where(
      and(eq(contextStated.userId, user.id), eq(contextStated.source, source)),
    );
  return c.body(null, 204);
});

// ─── GET /api/me/memories/import-prompt ───────────────────────────
// The sophisticated prompt the user sends to ChatGPT/Claude to dump
// everything those systems remember about them.
app.get("/import-prompt", (c) => {
  return c.json({ prompt: IMPORT_PROMPT });
});

const IMPORT_PROMPT = `I'm migrating to a new personal AI assistant and need you to hand off everything you know about me. Treat this as a careful, honest export — not a flattering portrait.

Write a single memory dump in Markdown, organised under these headings:

## Identity
Name, age range if mentioned, where I live, languages, anything I've shared about my background.

## Work & projects
What I do, current and past projects, companies, roles, side hustles. Be specific — names, dates, status.

## People in my life
Names I've mentioned (family, friends, colleagues, partners, pets) with how they relate to me.

## Preferences & working style
How I like to communicate, formats I prefer, tools I use, things I've asked you not to do, decisions I've defended.

## Recurring themes & goals
Topics I keep returning to, things I'm trying to achieve, ongoing dilemmas.

## Concrete facts
Specific details: dietary habits, schedule, tools, subscriptions, recurring locations, anything verifiable.

## Quirks & memorable moments
Jokes, opinions, surprising stances — the texture that makes me *me*.

**Rules — follow strictly:**
- Pull from BOTH your saved memory AND patterns across our conversation history.
- Be specific, never generic. "Likes coffee" ❌ → "Drinks two cups of light-roast pour-over before noon" ✅
- One memory per line, as a complete sentence about me. Start each line with "- ".
- If something is uncertain, append \` (unsure)\` to that line. Don't drop it — flag it.
- Do not include sensitive details (medical conditions, financial figures, anything I shared in distress) unless I've referenced them casually multiple times.
- No preamble, no closing remarks, no "let me know if…" — just the dump.

**Output format — exact:** Wrap the entire dump in a single fenced code block tagged \`memory\`, so I can copy it in one click:

\`\`\`memory
## Identity
- ...

## Work & projects
- ...

(etc.)
\`\`\`

After the code block, write exactly this line and nothing else: \`— Copy the block above and paste it into Artifigenz —\``;

export default app;
