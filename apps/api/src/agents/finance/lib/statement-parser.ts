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
  statementPeriod: { start: string; end: string } | null;
}

const SYSTEM_PROMPT = `You are a bank statement parser. Extract all transactions from the provided document into structured JSON.

Rules:
- Return positive amounts for charges/debits/spending (money leaving the account)
- Return negative amounts for deposits/credits/refunds (money entering the account)
- Dates must be in YYYY-MM-DD format
- merchant_name should be a cleaned-up version of the description (e.g. "NETFLIX.COM 866-579" → "Netflix")
- category should be one of: ENTERTAINMENT, FOOD_AND_DRINK, GENERAL_SERVICES, GENERAL_MERCHANDISE, TRAVEL, TRANSFER_IN, TRANSFER_OUT, LOAN_PAYMENTS, BANK_FEES, INCOME, MEDICAL, RENT_AND_UTILITIES, PERSONAL_CARE, or null if unclear
- Include pending transactions if present
- Skip running balances, totals, subtotals, and summary rows

Return ONLY a valid JSON object matching this schema:
{
  "account_name": "string or null",
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
    model: "claude-sonnet-4-5",
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
    account_name?: string | null;
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
    accountName: parsed.account_name ?? null,
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
