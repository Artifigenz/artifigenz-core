import { createHash } from "node:crypto";

const STORE_NUM_PATTERNS = [
  /#\s*\d+/g,
  /\bstore\s+\d+/gi,
  /\b\d{4,}\b/g,
];

const TRAILING_CITY_STATE = /\s+[A-Z]{2}\s*$/;
const PHONE_FRAGMENT = /\b\d{3}[-\s]?\d{3,4}[-\s]?\d{0,4}\b/g;
const WEBSITE = /\b(?:www\.|https?:\/\/)\S+/gi;
const MULTI_SPACE = /\s{2,}/g;
const NON_ALNUM_TRAILING = /[^a-z0-9]+$/;
const NON_ALNUM_LEADING = /^[^a-z0-9]+/;

// Transfer/deposit descriptions vary by counterparty name (e.g. "E-TRANSFER
// RECEIVED <person>"), which causes every single transfer to become its own
// cluster. Collapse them to the transfer type so the LLM sees the full
// pattern and we don't drown the brief in 1-txn clusters.
const TRANSFER_COLLAPSE_PATTERNS: Array<[RegExp, string]> = [
  [/^(e[-\s]?transfer\s+received).*$/i, "$1"],
  [/^(e[-\s]?transfer\s+sent).*$/i, "$1"],
  [/^(interac\s+(?:e[-\s]?)?transfer\s+from).*$/i, "$1"],
  [/^(interac\s+(?:e[-\s]?)?transfer\s+to).*$/i, "$1"],
  [/^(send\s+e[-\s]?tfr).*$/i, "$1"],
  [/^(transfer\s+from).*$/i, "$1"],
  [/^(transfer\s+to).*$/i, "$1"],
  [/^(internal\s+transfer).*$/i, "$1"],
  [/^(payment\s+from).*$/i, "$1"],
  [/^(direct\s+deposit\s+from).*$/i, "$1"],
];

/**
 * Reduce a raw merchant or description string to a canonical merchant key.
 * Strips store numbers, phone fragments, URLs, trailing state codes, punctuation.
 * Used for grouping transactions into merchant_clusters.
 *
 * Examples:
 *   "STARBUCKS #1234 TORONTO ON"            → "starbucks"
 *   "AMZN Mktp CA*P32CD1AA1"                 → "amzn mktp ca"
 *   "NETFLIX.COM 866-579-7172 CA"            → "netflix.com"
 *   "E-TRANSFER RECEIVED FROM JOHN DOE ABC"  → "e-transfer received"
 *   "INTERAC TRANSFER FROM JANE SMITH"       → "interac transfer from"
 */
export function normalizeMerchant(raw: string | null | undefined): string {
  if (!raw) return "unknown";

  let s = raw.toLowerCase().replace(MULTI_SPACE, " ").trim();

  // Collapse transfer descriptions before generic stripping so the
  // person-name suffix doesn't survive.
  for (const [pattern, replacement] of TRANSFER_COLLAPSE_PATTERNS) {
    const collapsed = s.replace(pattern, replacement);
    if (collapsed !== s) {
      s = collapsed;
      break;
    }
  }

  s = s.replace(WEBSITE, "");
  s = s.replace(PHONE_FRAGMENT, "");
  for (const p of STORE_NUM_PATTERNS) s = s.replace(p, "");
  s = s.replace(TRAILING_CITY_STATE, "");
  s = s.replace(/[*]/g, " ");
  s = s.replace(MULTI_SPACE, " ").trim();
  s = s.replace(NON_ALNUM_TRAILING, "").replace(NON_ALNUM_LEADING, "");

  return s || "unknown";
}

/**
 * Deterministic hash of a cleaned description, used as the last leg of the
 * transaction dedup key (account_id, date, amount, description_hash).
 * Two genuinely different transactions with identical (account, date, amount)
 * will have different descriptions, so this disambiguates them.
 */
export function descriptionHash(description: string): string {
  const cleaned = description
    .toLowerCase()
    .replace(MULTI_SPACE, " ")
    .trim();
  return createHash("sha256").update(cleaned).digest("hex").slice(0, 16);
}
