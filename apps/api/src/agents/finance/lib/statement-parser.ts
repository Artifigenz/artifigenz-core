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

/**
 * Parses a bank statement file using Claude API.
 * Supports: PDF, CSV (text), plain text, images
 */
export async function parseStatement(params: {
  fileType: "pdf" | "csv" | "text" | "image";
  fileContent: Buffer | string;
  filename?: string;
}): Promise<ParsedStatement> {
  const client = getClaudeClient();

  // Build the user message content based on file type
  const content: Anthropic.MessageCreateParams["messages"][0]["content"] =
    buildMessageContent(params);

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 16384,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });

  // Extract text from response
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text content");
  }

  // Parse JSON from response — handle truncation from max_tokens
  let jsonText = extractJson(textBlock.text);

  // If the response was truncated (stop_reason === 'max_tokens'), try to
  // salvage partial JSON by closing open arrays/objects
  if (response.stop_reason === "max_tokens") {
    console.warn("[statement-parser] Response truncated — attempting to salvage partial JSON");
    jsonText = salvageTruncatedJson(jsonText);
  }

  type ParsedResult = {
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

  let parsed: ParsedResult;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    // Last resort: try to extract whatever transactions we can find
    console.error("Claude returned invalid JSON, attempting line-by-line extraction:", textBlock.text.slice(0, 200));
    try {
      // Find the transactions array and close it
      const txStart = jsonText.indexOf('"transactions"');
      if (txStart !== -1) {
        const arrStart = jsonText.indexOf("[", txStart);
        if (arrStart !== -1) {
          // Find the last complete object (ends with })
          const lastBrace = jsonText.lastIndexOf("}");
          if (lastBrace > arrStart) {
            const salvaged = jsonText.slice(0, lastBrace + 1) + "]}";
            parsed = JSON.parse(salvaged);
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    } catch {
      throw new Error(`Failed to parse Claude response as JSON: ${err}`);
    }
  }

  return {
    institutionName: parsed.institution_name ?? null,
    accountName: parsed.account_name ?? null,
    accountLast4: parsed.account_last4 ? String(parsed.account_last4).slice(-4) : null,
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
    max_tokens: 400,
    system: VALIDATE_SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Validator returned no text content");
  }

  const jsonText = extractJson(textBlock.text);
  let parsed: {
    is_statement?: boolean;
    rejection_reason?: string;
    institution_name?: string | null;
    account_name?: string | null;
    account_last4?: string | null;
    account_type?: string | null;
    statement_period?: { start: string; end: string } | null;
  };
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`Validator returned invalid JSON: ${err}`);
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
