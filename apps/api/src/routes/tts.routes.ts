import { Hono } from "hono";
import { clerkAuth } from "../platform/auth/clerk-middleware";
import { getOpenAIClient } from "../platform/chat/openai-client";

const app = new Hono();

app.use("/*", clerkAuth);

// Named voice presets — each maps to a base OpenAI voice plus a steering
// instruction. We expose preset names to the client so we can tune the
// underlying voice or style without touching the UI.
const PRESETS = {
  jon_hamm: {
    voice: "onyx",
    instructions:
      "Speak slowly and deliberately in a deep, warm baritone — think Jon Hamm as Don Draper. Measured cadence with thoughtful pauses between phrases. Confident, dry, and lightly weary, as if you've seen everything and are no longer easily impressed. Mid-century Madison Avenue executive: composed, understated, never hurried. Let each line land. Avoid bright or cheerful inflection.",
  },
  joan_holloway: {
    voice: "sage",
    instructions:
      "Speak in a low, smooth, confident register — think Joan Holloway from Mad Men. Warm but assured, slightly husky, never breathy or girlish. Measured pace with a knowing quality, as if you understand more than you're saying. Mid-century elegance: poised, unhurried, composed. Each phrase carries weight. Avoid bright, chirpy, or rushed delivery.",
  },
} as const;
type PresetId = keyof typeof PRESETS;

const DEFAULT_PRESET: PresetId = "jon_hamm";

function resolveVoice(input: string): {
  voice: string;
  instructions?: string;
} {
  if (input in PRESETS) {
    const p = PRESETS[input as PresetId];
    return { voice: p.voice, instructions: p.instructions };
  }
  return { voice: PRESETS[DEFAULT_PRESET].voice, instructions: PRESETS[DEFAULT_PRESET].instructions };
}

// gpt-4o-mini-tts caps input at 4096 chars. Chunk longer text on sentence
// boundaries and stream the resulting MP3 segments back-to-back — MP3 frames
// are independently decodable so the joined byte stream plays cleanly.
const MAX_CHARS_PER_REQUEST = 3800;
const MAX_TOTAL_CHARS = 24_000;

function chunkText(text: string, maxLen = MAX_CHARS_PER_REQUEST): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    const window = remaining.slice(0, maxLen);
    let cut = Math.max(
      window.lastIndexOf(". "),
      window.lastIndexOf("! "),
      window.lastIndexOf("? "),
      window.lastIndexOf("\n"),
    );
    if (cut < maxLen * 0.4) cut = window.lastIndexOf(" ");
    if (cut < 0) cut = maxLen - 1;
    chunks.push(remaining.slice(0, cut + 1).trim());
    remaining = remaining.slice(cut + 1);
  }
  const tail = remaining.trim();
  if (tail) chunks.push(tail);
  return chunks;
}

app.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const text = (body?.text ?? "").toString().trim();
  const voiceInput = (body?.voice ?? DEFAULT_PRESET).toString();
  const { voice, instructions } = resolveVoice(voiceInput);

  if (!text) return c.json({ error: "text is required" }, 400);
  if (text.length > MAX_TOTAL_CHARS) {
    return c.json(
      { error: `text too long (max ${MAX_TOTAL_CHARS} chars)` },
      400,
    );
  }

  const openai = getOpenAIClient();
  const chunks = chunkText(text);

  // Pipe each OpenAI response body straight through to the client. We never
  // buffer the full MP3 server-side — first audio bytes hit the browser as
  // soon as OpenAI emits them.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (const chunk of chunks) {
          const response = await openai.audio.speech.create({
            model: "gpt-4o-mini-tts",
            // OpenAI types limit `voice` to the original 6 enum literals, but
            // the API also accepts the newer voices (ash, ballad, coral, sage,
            // verse). Cast through unknown so we can pass them through.
            voice: voice as unknown as "alloy",
            input: chunk,
            response_format: "mp3",
            ...(instructions ? { instructions } : {}),
          });
          const responseBody = response.body;
          if (!responseBody) throw new Error("openai tts: empty body");
          const reader = responseBody.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) controller.enqueue(value);
          }
        }
        controller.close();
      } catch (err) {
        console.error("[tts] failed:", err);
        try {
          controller.error(err);
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, max-age=3600",
      "X-Accel-Buffering": "no",
    },
  });
});

export default app;
