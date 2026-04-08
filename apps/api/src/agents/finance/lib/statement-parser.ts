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
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });

  // Extract text from response
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text content");
  }

  // Parse JSON from response
  const jsonText = extractJson(textBlock.text);
  let parsed: {
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
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    console.error("Claude returned invalid JSON:", textBlock.text.slice(0, 500));
    throw new Error(`Failed to parse Claude response as JSON: ${err}`);
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
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();

  // Find the first { and last }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return text.trim();
}
