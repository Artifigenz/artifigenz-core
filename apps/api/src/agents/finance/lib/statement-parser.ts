import { getClaudeClient } from "./claude-client";

export interface ExtractedTransaction {
  date: string; // YYYY-MM-DD
  description: string;
  merchantName: string | null;
  amount: number; // positive = charge/spending, negative = deposit/refund
  category: string | null;
  accountName: string | null;
}

export interface ParsedStatement {
  transactions: ExtractedTransaction[];
  accountName: string | null;
  institutionName: string | null;
  accountLast4: string | null;
  accountType: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  statementPeriod: { start: string; end: string } | null;
}

const SYSTEM_PROMPT = `You are a bank statement parser. Extract account details and all transactions from the provided document into structured JSON.

Rules:
- Return positive amounts for charges/debits/spending (money leaving the account)
- Return negative amounts for deposits/credits/refunds (money entering the account)
- Dates must be in YYYY-MM-DD format
- merchant_name should be a cleaned-up version of the description (e.g. "NETFLIX.COM 866-579" → "Netflix")
- account_last4 is the last 4 digits of the account number on the statement. If the account number is shown as XXXX-XXXX-1234 or ****1234, return "1234".
- institution_name is the bank name (e.g. "RBC Royal Bank", "TD Canada Trust", "Chase").
- account_type is one of: "depository" (chequing/savings), "credit" (credit card), "loan", "investment", or null if unclear.
- category should be one of: ENTERTAINMENT, FOOD_AND_DRINK, GENERAL_SERVICES, GENERAL_MERCHANDISE, TRAVEL, TRANSFER_IN, TRANSFER_OUT, LOAN_PAYMENTS, BANK_FEES, INCOME, MEDICAL, RENT_AND_UTILITIES, PERSONAL_CARE, or null if unclear
- Include pending transactions if present
- Skip running balances, totals, subtotals, and summary rows

Return ONLY a valid JSON object matching this schema:
{
  "institution_name": "string or null",
  "account_name": "string or null",
  "account_last4": "4-digit string or null",
  "account_type": "depository | credit | loan | investment | null",
  "opening_balance": number or null,
  "closing_balance": number or null,
  "statement_period": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" } or null,
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "raw description from statement",
      "merchant_name": "cleaned merchant name or null",
      "amount": number,
      "category": "category string or null",
      "account_name": "account name or null"
    }
  ]
}

Do not include any explanation, markdown formatting, or text outside the JSON.`;

type ChunkResult = {
  institution_name?: string | null;
  account_name?: string | null;
  account_last4?: string | null;
  account_type?: string | null;
  opening_balance?: number | null;
  closing_balance?: number | null;
  statement_period?: { start: string; end: string } | null;
  transactions: Array<{
    date: string;
    description: string;
    merchant_name?: string | null;
    amount: number;
    category?: string | null;
    account_name?: string | null;
  }>;
};

// Pages per Claude call. Picked empirically:
//  • 8 pages of dense bank-statement text ≈ ~80K tokens of PDF input.
//  • Leaves ~120K headroom in Sonnet 4's 200K window for the response
//    and the system prompt, so even verbose statements don't truncate.
//  • Parses ~50 txns/chunk on average, well within max_tokens=16384.
const PDF_CHUNK_PAGES = 8;
// Run at most this many chunks in parallel. Anthropic's free-tier rate
// limit is ~5 concurrent reqs; keeping conservative avoids 429s on long
// statements (a 60-page PDF = 8 chunks).
const CHUNK_CONCURRENCY = 4;

/**
 * Parses a bank statement file using Claude API.
 * Supports: PDF, CSV (text), plain text, images.
 *
 * Large PDFs are split by page so each Claude call stays well under the
 * model's context window. Chunks are parsed in parallel (bounded by
 * CHUNK_CONCURRENCY), then transactions are concatenated. Metadata
 * (institution, account, period) is taken from the first chunk that
 * produced any of those fields, since they're identical across a single
 * statement.
 */
export async function parseStatement(params: {
  fileType: "pdf" | "csv" | "text" | "image";
  fileContent: Buffer | string;
  filename?: string;
}): Promise<ParsedStatement> {
  // Non-PDF paths can't be page-split; fall through to single-call parse.
  if (params.fileType !== "pdf" || typeof params.fileContent === "string") {
    const result = await parseOneChunk(params);
    return finaliseParsed(result);
  }

  // PDF — check page count and chunk if large.
  const { PDFDocument } = await import("pdf-lib");
  let chunks: Buffer[];
  try {
    const doc = await PDFDocument.load(params.fileContent, {
      ignoreEncryption: false,
    });
    const pageCount = doc.getPageCount();

    if (pageCount <= PDF_CHUNK_PAGES) {
      chunks = [params.fileContent];
    } else {
      chunks = await splitPdf(doc, PDF_CHUNK_PAGES);
      console.log(
        `[statement-parser] split ${pageCount}-page PDF into ${chunks.length} chunks`,
      );
    }
  } catch (err) {
    // pdf-lib fails on a small minority of PDFs (esoteric encryption,
    // exotic structure). Fall back to a single call — Claude is usually
    // fine, and if not we surface the original error.
    console.warn(
      `[statement-parser] pdf-lib couldn't load, parsing as single chunk: ${(err as Error).message}`,
    );
    chunks = [params.fileContent];
  }

  // Parse chunks in bounded-parallel batches.
  const results: ChunkResult[] = await runWithConcurrency(
    chunks.map((chunk, i) => () =>
      parseOneChunk({
        fileType: "pdf",
        fileContent: chunk,
        filename: chunks.length > 1
          ? `${params.filename ?? "statement"} (part ${i + 1}/${chunks.length})`
          : params.filename,
      }),
    ),
    CHUNK_CONCURRENCY,
  );

  // Merge: stitch all transactions together. Take the first non-null
  // value seen for each metadata field across chunks — they should all
  // agree on a single statement.
  const merged: ChunkResult = {
    institution_name: firstNonNull(results, "institution_name"),
    account_name: firstNonNull(results, "account_name"),
    account_last4: firstNonNull(results, "account_last4"),
    account_type: firstNonNull(results, "account_type"),
    opening_balance: results[0]?.opening_balance ?? null,
    closing_balance: results[results.length - 1]?.closing_balance ?? null,
    statement_period: firstNonNull(results, "statement_period"),
    transactions: results.flatMap((r) => r.transactions ?? []),
  };
  return finaliseParsed(merged);
}

function finaliseParsed(parsed: ChunkResult): ParsedStatement {
  return {
    institutionName: parsed.institution_name ?? null,
    accountName: parsed.account_name ?? null,
    accountLast4: parsed.account_last4
      ? String(parsed.account_last4).slice(-4)
      : null,
    accountType: parsed.account_type ?? null,
    openingBalance: parsed.opening_balance ?? null,
    closingBalance: parsed.closing_balance ?? null,
    statementPeriod: parsed.statement_period ?? null,
    transactions: (parsed.transactions ?? []).map((t) => ({
      date: t.date,
      description: t.description,
      merchantName: t.merchant_name ?? null,
      amount: t.amount,
      category: t.category ?? null,
      accountName: t.account_name ?? parsed.account_name ?? null,
    })),
  };
}

/**
 * Single Claude call against one piece of PDF/CSV/text/image. Used by
 * parseStatement directly (small inputs) and as the per-chunk worker for
 * large PDFs.
 */
async function parseOneChunk(params: {
  fileType: "pdf" | "csv" | "text" | "image";
  fileContent: Buffer | string;
  filename?: string;
}): Promise<ChunkResult> {
  const client = getClaudeClient();
  const content = buildMessageContent(params);

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 16384,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text content");
  }

  let jsonText = extractJson(textBlock.text);
  if (response.stop_reason === "max_tokens") {
    console.warn(
      `[statement-parser] chunk truncated (${params.filename ?? "?"}) — salvaging`,
    );
    jsonText = salvageTruncatedJson(jsonText);
  }

  try {
    return JSON.parse(jsonText) as ChunkResult;
  } catch (err) {
    // Last resort — close the transactions array at the last complete
    // object so we keep whatever rows did parse.
    console.error(
      `[statement-parser] invalid JSON in ${params.filename ?? "chunk"}, attempting recovery:`,
      textBlock.text.slice(0, 200),
    );
    const txStart = jsonText.indexOf('"transactions"');
    const arrStart = txStart !== -1 ? jsonText.indexOf("[", txStart) : -1;
    const lastBrace = jsonText.lastIndexOf("}");
    if (arrStart !== -1 && lastBrace > arrStart) {
      try {
        return JSON.parse(jsonText.slice(0, lastBrace + 1) + "]}") as ChunkResult;
      } catch {
        /* fall through */
      }
    }
    throw new Error(`Failed to parse Claude response as JSON: ${(err as Error).message}`);
  }
}

/**
 * Split a loaded PDFDocument into N-page sub-documents and return the
 * serialised bytes for each.
 */
async function splitPdf(
  doc: Awaited<ReturnType<typeof import("pdf-lib").PDFDocument.load>>,
  pagesPerChunk: number,
): Promise<Buffer[]> {
  const { PDFDocument } = await import("pdf-lib");
  const total = doc.getPageCount();
  const chunks: Buffer[] = [];
  for (let start = 0; start < total; start += pagesPerChunk) {
    const end = Math.min(start + pagesPerChunk, total);
    const sub = await PDFDocument.create();
    const indices = Array.from({ length: end - start }, (_, i) => start + i);
    const pages = await sub.copyPages(doc, indices);
    pages.forEach((p) => sub.addPage(p));
    const bytes = await sub.save();
    chunks.push(Buffer.from(bytes));
  }
  return chunks;
}

/** Run `tasks` with at most `n` running at once. Returns results in order. */
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  n: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let idx = 0;
  const workers = Array.from(
    { length: Math.min(n, tasks.length) },
    async () => {
      while (true) {
        const myIdx = idx++;
        if (myIdx >= tasks.length) return;
        results[myIdx] = await tasks[myIdx]();
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function firstNonNull<K extends keyof ChunkResult>(
  results: ChunkResult[],
  key: K,
): ChunkResult[K] | null {
  for (const r of results) {
    const v = r[key];
    if (v !== null && v !== undefined && v !== "") return v;
  }
  return null;
}

// ─── Fast validation pass ──────────────────────────────────────────
// Used on upload to confirm the file is a bank statement and pull
// just the identifying metadata. No transaction extraction → much
// smaller Claude response, returns in ~3-5s.

export interface ValidationResult {
  isStatement: boolean;
  institutionName: string | null;
  accountName: string | null;
  accountLast4: string | null;
  accountType: string | null;
  statementPeriod: { start: string; end: string } | null;
  rejectionReason?: string;
}

const VALIDATE_SYSTEM_PROMPT = `You inspect a document and decide whether it is a bank statement, then extract identifying metadata. Do NOT extract any transactions in this pass.

Rules:
- A bank statement is a periodic account summary from a financial institution that lists transactions. It has a bank name, an account number (often masked), a statement period, and at least a few transaction lines.
- If the document is NOT a bank statement (receipt, invoice, tax form, random PDF, blank page, etc.), return is_statement=false with a one-line reason.
- account_last4 is the last 4 digits of the account number on the statement. If shown as ****1234 or XXXX-1234, return "1234". If you can't find an account number at all, return null.
- institution_name is the bank name (e.g. "RBC Royal Bank", "TD Canada Trust", "Chase", "Bank of America").
- account_type: one of "depository" (chequing/savings), "credit" (credit card), "loan", "investment", null if unclear.
- statement_period: dates in YYYY-MM-DD. If only a single date is visible, return null.

DERIVING THE BANK NAME WHEN IT IS NOT EXPLICITLY PRINTED:
First, look hard for the bank name in any form — logos, watermarks, footer addresses, customer service phone numbers, URLs (e.g. "td.com" in the footer), branding language ("MyTD App", "RBC Mobile"). The bank usually identifies itself somewhere.

ONLY if no bank name is anywhere visible, you may derive it from a fully-visible bank identifier — but ONLY when the full identifier is actually printed on the page, not just inferred:

- Canada: ONLY if you can read the 5-digit transit number AND the 3-digit institution number (typically printed as "TRANSIT XXXXX-XXX" or "ROUTING NUMBER" or shown on a cheque image). Institution codes:
  001 BMO · 002 Scotia · 003 RBC · 004 TD · 006 National Bank ·
  010 CIBC · 016 HSBC · 614 Tangerine · 829 Desjardins.
- US: ONLY if the full 9-digit ABA routing number is printed.
- India: ONLY if the full IFSC code (e.g. "HDFC0001234") is printed.
- UK: ONLY if the 6-digit sort code is printed.
- Australia: ONLY if the 6-digit BSB is printed.

**DO NOT derive the bank from a masked last-4 account number alone.** A 4-digit number like "8794" tells you nothing about which institution it belongs to — many banks use overlapping account-number patterns. If the only number you see is a 4-digit mask, return institution_name = null.

**DO NOT lean on context** (the user's other connected banks, the language of the page, the file name). Each statement must be classified on its own evidence.

**Be conservative.** If you're not certain — return null. We surface "Unknown bank" to the user and they can correct it. Confidently labelling the wrong bank is worse than admitting uncertainty.

Return ONLY valid JSON in this exact shape, no markdown:
{
  "is_statement": boolean,
  "rejection_reason": "string (only if is_statement=false)",
  "institution_name": "string or null",
  "account_name": "string or null",
  "account_last4": "4-digit string or null",
  "account_type": "depository | credit | loan | investment | null",
  "statement_period": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" } or null
}`;

export async function validateStatement(params: {
  fileType: "pdf" | "csv" | "text" | "image";
  fileContent: Buffer | string;
  filename?: string;
}): Promise<ValidationResult> {
  const client = getClaudeClient();

  const content: Anthropic.MessageCreateParams["messages"][0]["content"] =
    buildMessageContent(params);

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    // 400 used to be enough for the small fixed JSON we ask for, but Haiku
    // 4.5 occasionally emits a longer rejection_reason or wraps the JSON
    // in extra preamble, truncating the response mid-string and breaking
    // JSON.parse. 1200 gives plenty of headroom while still keeping the
    // validator cheap (~$0.0005/call).
    max_tokens: 1200,
    system: VALIDATE_SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Validator returned no text content");
  }

  // Even with the bigger budget, salvage truncated JSON the same way
  // parseStatement does — small files can still hit edge cases.
  let jsonText = extractJson(textBlock.text);
  if (response.stop_reason === "max_tokens") {
    console.warn(
      "[statement-parser/validate] Response truncated — attempting to salvage",
    );
    jsonText = salvageTruncatedJson(jsonText);
  }

  type ValidatorParsed = {
    is_statement?: boolean;
    rejection_reason?: string;
    institution_name?: string | null;
    account_name?: string | null;
    account_last4?: string | null;
    account_type?: string | null;
    statement_period?: { start: string; end: string } | null;
  };
  let parsed: ValidatorParsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    // Last-ditch salvage — try closing brackets, parse again.
    try {
      parsed = JSON.parse(salvageTruncatedJson(jsonText));
    } catch (err2) {
      throw new Error(
        `Validator returned invalid JSON: ${(err2 as Error).message}. ` +
          `Raw response head: ${textBlock.text.slice(0, 200).replace(/\s+/g, " ")}…`,
      );
    }
  }

  return {
    isStatement: parsed.is_statement === true,
    rejectionReason: parsed.rejection_reason,
    institutionName: parsed.institution_name ?? null,
    accountName: parsed.account_name ?? null,
    accountLast4: parsed.account_last4 ? String(parsed.account_last4).slice(-4) : null,
    accountType: parsed.account_type ?? null,
    statementPeriod: parsed.statement_period ?? null,
  };
}

// Need the Anthropic type for content blocks
import type Anthropic from "@anthropic-ai/sdk";

function buildMessageContent(params: {
  fileType: "pdf" | "csv" | "text" | "image";
  fileContent: Buffer | string;
  filename?: string;
}): Anthropic.MessageCreateParams["messages"][0]["content"] {
  const { fileType, fileContent, filename } = params;

  if (fileType === "pdf") {
    const base64 =
      typeof fileContent === "string"
        ? fileContent
        : fileContent.toString("base64");
    return [
      {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: base64,
        },
      },
      {
        type: "text",
        text: `Parse this bank statement${filename ? ` (${filename})` : ""} and extract all transactions.`,
      },
    ];
  }

  if (fileType === "image") {
    const base64 =
      typeof fileContent === "string"
        ? fileContent
        : fileContent.toString("base64");
    return [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: base64,
        },
      },
      {
        type: "text",
        text: `Parse this bank statement image${filename ? ` (${filename})` : ""} and extract all transactions.`,
      },
    ];
  }

  // Text or CSV → send as plain text
  const text =
    typeof fileContent === "string" ? fileContent : fileContent.toString("utf-8");
  return [
    {
      type: "text",
      text: `Parse this bank statement${filename ? ` (${filename})` : ""} and extract all transactions.\n\n---\n\n${text}`,
    },
  ];
}

function extractJson(text: string): string {
  // Handle cases where Claude wraps in markdown code blocks
  // Use a greedy match for truncated responses (no closing ```)
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();

  // Find the first { and last }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  // If truncated, just take everything from the first {
  if (firstBrace !== -1) {
    return text.slice(firstBrace);
  }

  return text.trim();
}

/**
 * Attempts to fix truncated JSON by closing open arrays and objects.
 * Best-effort — may lose the last partial transaction.
 */
function salvageTruncatedJson(json: string): string {
  // Find the last complete transaction object (ends with })
  const lastCompleteBrace = json.lastIndexOf("}");
  if (lastCompleteBrace === -1) return json;

  let salvaged = json.slice(0, lastCompleteBrace + 1);

  // Count open brackets to close them
  let openBrackets = 0;
  let openBraces = 0;
  for (const ch of salvaged) {
    if (ch === "[") openBrackets++;
    if (ch === "]") openBrackets--;
    if (ch === "{") openBraces++;
    if (ch === "}") openBraces--;
  }

  // Close any remaining open brackets/braces
  for (let i = 0; i < openBrackets; i++) salvaged += "]";
  for (let i = 0; i < openBraces; i++) salvaged += "}";

  return salvaged;
}
