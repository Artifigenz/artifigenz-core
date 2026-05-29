import { getClaudeClient } from "../lib/claude-client";

/**
 * Resolve an opaque merchant string into a canonical brand entity using
 * Claude Sonnet 4.6 + web search.
 *
 * Why an LLM:
 *   - Regex normalization gets "AMZN MKTP #1234" → "amzn mktp" but can't
 *     tell that "amzn mktp" and "amazon.com" and "amazon prime video" all
 *     belong to the same Amazon brand.
 *   - Plaid covers ~80% of US/CA merchants but misses regional players
 *     (BC Ferries, Indian fintechs, neighbourhood shops). The LLM with
 *     web search fills in the long tail.
 *
 * Why a brand_slug:
 *   - The output is a canonical, stable, kebab-cased identifier (e.g.,
 *     "amazon", "bc-ferries", "td-canada-trust"). Every variant of the
 *     merchant_normalized string for that brand maps to the same slug,
 *     which is what the clusters page groups by. So 7 BC Ferries rows
 *     collapse into 1 in the UI.
 *
 * Plaid's raw_data is passed in as context (when available) so the model
 * has a head start — for known Plaid merchants this often skips the need
 * for a web search entirely, cutting latency by ~3-4s per merchant.
 */

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1024;
const WEB_SEARCH_MAX_USES = 2;

export interface PlaidHint {
  merchant_name?: string | null;
  logo_url?: string | null;
  website?: string | null;
  merchant_entity_id?: string | null;
  pfc_primary?: string | null;
  pfc_detailed?: string | null;
}

export interface BrandResolution {
  brandSlug: string;
  displayName: string;
  website: string | null;
  industry: string | null;
  confidence: number;
  reasoning: string;
  /** True if the resolver leaned on Plaid's hint without needing a web
   *  search. Lets the caller measure how much value Plaid is adding. */
  usedPlaidHint: boolean;
}

const SYSTEM_PROMPT = `You are a merchant resolver. Given an opaque merchant string from a bank statement (and optionally a hint from Plaid's merchant catalog), identify the canonical brand entity.

Your output is a single JSON object with these fields:

{
  "brand_slug": "kebab-cased canonical brand id (e.g., \\"amazon\\", \\"bc-ferries\\", \\"td-canada-trust\\")",
  "display_name": "the brand's properly-cased display name (e.g., \\"Amazon\\", \\"BC Ferries\\")",
  "website": "primary brand website (host only, no protocol — e.g., \\"amazon.com\\", \\"bcferries.com\\"), or null if you genuinely don't know",
  "industry": "one of: retail | food_drink | transport | entertainment | utility | finance | telecom | software | health | travel | government | personal_care | other",
  "confidence": "number 0.0 to 1.0 — your confidence the brand identification is correct",
  "reasoning": "one short sentence explaining the match"
}

Rules:
- The brand_slug is THE canonical identifier. Two different normalized strings (e.g., "amzn mktp" and "amazon.com") that belong to the same brand must return the same brand_slug.
- Slug format: lowercase, kebab-case, no special chars (e.g., "bc-ferries" not "bc_ferries" or "BCFerries").
- For obvious brands (Amazon, Netflix, Spotify, large banks): you don't need to search. Just answer directly.
- For unknown/opaque strings: use the web_search tool with the merchant string itself. ONLY send the merchant string, never any other transaction context.
- For regional or smaller merchants (e.g., "BCF" → BC Ferries, "STARBUCKS BUR" → Starbucks burrard branch): identify by context, search if needed.
- For payment-processor passthroughs ("SQ *RANDOM", "FBPAY*XYZ", "WL*ZTKXGB"): try to resolve the actual merchant via search; if unresolvable, set brand_slug to the cleaned passthrough name (e.g., "square-passthrough") with low confidence.
- For pure interest/fee descriptors ("purchase interest", "overdraft fee", "service charge"): brand_slug should be the descriptor itself (e.g., "purchase-interest") and industry "finance" — these aren't true merchants.
- For e-transfers / internal transfers ("e-transfer received", "interac transfer to"): brand_slug "transfer" + industry "finance" — these aren't merchants either.

If a Plaid hint is provided and the merchant_entity_id is present, treat that brand as authoritative for display_name/website but always produce your own brand_slug (Plaid's IDs aren't human-readable).

Output ONLY the JSON, no markdown, no preamble.`;

export async function resolveBrand(
  merchantNormalized: string,
  plaidHint: PlaidHint | null = null,
): Promise<BrandResolution> {
  const client = getClaudeClient();

  const userMessage = buildUserMessage(merchantNormalized, plaidHint);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: WEB_SEARCH_MAX_USES,
      },
    ] as never, // server-tool type not in the public SDK yet
    messages: [{ role: "user", content: userMessage }],
  });

  // Concat all text blocks (web search produces multiple)
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");

  const jsonText = extractJson(text);
  let parsed: {
    brand_slug?: string;
    display_name?: string;
    website?: string | null;
    industry?: string | null;
    confidence?: number;
    reasoning?: string;
  };
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `LLM brand resolver returned invalid JSON for "${merchantNormalized}": ${
        (err as Error).message
      }. Raw: ${text.slice(0, 200)}`,
    );
  }

  if (!parsed.brand_slug || !parsed.display_name) {
    throw new Error(
      `LLM brand resolver missing required fields for "${merchantNormalized}". Got: ${JSON.stringify(parsed)}`,
    );
  }

  const usedSearch = response.content.some((b) =>
    ["web_search_tool_use", "web_search_tool_result"].includes(b.type),
  );

  return {
    brandSlug: sanitiseSlug(parsed.brand_slug),
    displayName: parsed.display_name,
    website: cleanWebsite(parsed.website),
    industry: parsed.industry ?? null,
    confidence:
      typeof parsed.confidence === "number" && parsed.confidence >= 0 && parsed.confidence <= 1
        ? parsed.confidence
        : 0.6,
    reasoning: parsed.reasoning ?? "",
    usedPlaidHint: plaidHint !== null && !usedSearch,
  };
}

function buildUserMessage(
  merchantNormalized: string,
  hint: PlaidHint | null,
): string {
  let body = `Merchant string from bank statement: "${merchantNormalized}"`;
  if (hint) {
    const hintParts: string[] = [];
    if (hint.merchant_name) hintParts.push(`name: "${hint.merchant_name}"`);
    if (hint.website) hintParts.push(`website: "${hint.website}"`);
    if (hint.merchant_entity_id)
      hintParts.push(`plaid_entity_id: "${hint.merchant_entity_id}"`);
    if (hint.pfc_primary) hintParts.push(`category: ${hint.pfc_primary}`);
    if (hintParts.length > 0) {
      body += `\n\nPlaid hint (US/CA merchant catalog — usually correct when present): ${hintParts.join(", ")}`;
    }
  }
  body += `\n\nResolve to the canonical brand entity and respond with JSON only.`;
  return body;
}

function extractJson(text: string): string {
  // Strip markdown fences if present.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }
  return text.trim();
}

function sanitiseSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function cleanWebsite(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "")
    .trim()
    .toLowerCase() || null;
}
