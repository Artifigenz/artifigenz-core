import { eq } from "drizzle-orm";
import { db, merchantCategories, financeRecurringStreams } from "@artifigenz/db";
import { getClaudeClient } from "./claude-client";

/**
 * Valid categories for recurring transactions
 */
export type TransactionCategory =
  | "subscription"  // Netflix, Spotify, gym memberships, software
  | "loan"          // Ford Credit, Affirm, mortgages, BNPL
  | "fee"           // Credit card interest, bank fees, annual fees
  | "rent"          // Rent payments
  | "utility"       // Hydro, gas, internet, phone
  | "insurance"     // Car, home, life, health insurance
  | "transfer"      // Internal account transfers
  | "variable"      // Uber rides, frequent but not subscription
  | "income";       // Salary, wages, freelance income

interface MerchantToCategory {
  merchantName: string;
  description: string | null;
  amount: number;
  frequency: string;
  accountType: string | null;
  pfcPrimary: string | null;
}

interface CategorizedMerchant {
  merchantName: string;
  category: TransactionCategory;
  confidence: number;
  reasoning: string;
  source: "global_cache" | "llm" | "llm_search";
}

/**
 * Normalize merchant name for cache lookup
 * Handles variations like "NETFLIX.COM", "Netflix", "NETFLIX INC"
 */
function normalizeMerchantName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "") // Remove special characters
    .replace(/\s+/g, " ")        // Normalize spaces
    .replace(/\b(inc|llc|ltd|corp|co|com|www)\b/g, "") // Remove common suffixes
    .trim();
}

/**
 * Check global merchant cache for known categories
 */
async function checkGlobalCache(
  merchantNames: string[],
): Promise<Map<string, CategorizedMerchant>> {
  const results = new Map<string, CategorizedMerchant>();

  if (merchantNames.length === 0) return results;

  const normalized = merchantNames.map(normalizeMerchantName);

  // For now, do individual lookups (can optimize later with raw SQL IN clause)
  for (let i = 0; i < merchantNames.length; i++) {
    const original = merchantNames[i];
    const norm = normalized[i];

    const [cached] = await db
      .select()
      .from(merchantCategories)
      .where(eq(merchantCategories.merchantNameNormalized, norm))
      .limit(1);

    if (cached) {
      results.set(original, {
        merchantName: original,
        category: cached.category as TransactionCategory,
        confidence: Number(cached.confidence) || 0.9,
        reasoning: cached.reasoning || "From global cache",
        source: "global_cache",
      });

      // Increment usage count
      await db
        .update(merchantCategories)
        .set({ usageCount: (cached.usageCount || 0) + 1 })
        .where(eq(merchantCategories.id, cached.id));
    }
  }

  return results;
}

/**
 * Store categorization result in global cache
 */
async function storeInGlobalCache(
  merchantName: string,
  category: TransactionCategory,
  confidence: number,
  reasoning: string,
  source: "llm" | "llm_search",
): Promise<void> {
  const normalized = normalizeMerchantName(merchantName);

  await db
    .insert(merchantCategories)
    .values({
      merchantNameNormalized: normalized,
      category,
      confidence: confidence.toString(),
      reasoning,
      source,
    })
    .onConflictDoUpdate({
      target: merchantCategories.merchantNameNormalized,
      set: {
        category,
        confidence: confidence.toString(),
        reasoning,
        source,
        updatedAt: new Date(),
      },
    });
}

/**
 * Call Claude to categorize unknown merchants
 */
async function categorizeMerchantsWithLLM(
  merchants: MerchantToCategory[],
): Promise<CategorizedMerchant[]> {
  if (merchants.length === 0) return [];

  const claude = getClaudeClient();

  const merchantList = merchants
    .map((m, i) => {
      const parts = [
        `${i + 1}. "${m.merchantName}"`,
        m.description ? `   Description: "${m.description}"` : null,
        `   Amount: $${m.amount.toFixed(2)}/${m.frequency.toLowerCase()}`,
        m.accountType ? `   Account: ${m.accountType}` : null,
        m.pfcPrimary ? `   Plaid category: ${m.pfcPrimary}` : null,
      ];
      return parts.filter(Boolean).join("\n");
    })
    .join("\n\n");

  const prompt = `You are a financial transaction categorizer. Analyze each recurring transaction and determine its category.

CATEGORIES:
- subscription: Streaming services, software subscriptions, gym memberships, digital services, news/media subscriptions
- loan: Car loans, mortgages, personal loans, BNPL (Affirm, Klarna), financing payments
- fee: Credit card interest, bank fees, account maintenance fees, overdraft fees, annual card fees
- rent: Rent payments, lease payments for housing
- utility: Electricity, gas, water, internet, phone, cable
- insurance: Car insurance, home insurance, life insurance, health insurance
- transfer: Internal transfers between own accounts (savings to checking, etc.)
- variable: Frequent purchases that aren't subscriptions (Uber rides, frequent shopping)
- income: Salary, wages, freelance payments, refunds

IMPORTANT RULES:
1. "Interest Charge" on credit cards = fee (NOT subscription)
2. Uber, Lyft without subscription = variable (frequent rides, not subscription)
3. Amazon could be subscription (Prime) OR variable (frequent shopping) - look at amount
4. Bank fees, monthly fees, service charges = fee
5. PayPal/Venmo person-to-person transfers = transfer, BUT PayPal MSP/merchant services = subscription (business payment processing)
6. FordPass/car app subscriptions = subscription, Ford Credit = loan
7. Transfers are ONLY internal account-to-account movements or person-to-person payments, NOT merchant charges

TRANSACTIONS TO CATEGORIZE:
${merchantList}

Respond with a JSON array. Each object must have:
- index: number (1-based, matching the list)
- category: one of the categories above
- confidence: number 0.0-1.0
- reasoning: brief explanation (1 sentence)

Example response:
[
  {"index": 1, "category": "subscription", "confidence": 0.95, "reasoning": "Netflix is a streaming subscription service"},
  {"index": 2, "category": "fee", "confidence": 0.90, "reasoning": "Interest charge is a credit card fee, not a subscription"}
]

Respond ONLY with the JSON array, no other text.`;

  try {
    const response = await claude.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type from Claude");
    }

    // Parse JSON response
    const jsonMatch = content.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error("[Categorizer] Could not parse LLM response:", content.text);
      throw new Error("Invalid JSON response from LLM");
    }

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      index: number;
      category: TransactionCategory;
      confidence: number;
      reasoning: string;
    }>;

    // Map back to merchants
    return parsed.map((p) => ({
      merchantName: merchants[p.index - 1].merchantName,
      category: p.category,
      confidence: p.confidence,
      reasoning: p.reasoning,
      source: "llm" as const,
    }));
  } catch (err) {
    console.error("[Categorizer] LLM categorization failed:", err);
    // Return default categorization on error
    return merchants.map((m) => ({
      merchantName: m.merchantName,
      category: "variable" as TransactionCategory,
      confidence: 0.3,
      reasoning: "Categorization failed, defaulting to variable",
      source: "llm" as const,
    }));
  }
}

/**
 * Main function: Categorize a batch of recurring streams
 * 1. Check global cache
 * 2. Call LLM for unknowns
 * 3. Store results in cache and on stream records
 */
export async function categorizeRecurringStreams(
  streams: Array<{
    id: string;
    merchantName: string | null;
    description: string | null;
    averageAmount: string;
    frequency: string;
    pfcPrimary: string | null;
    direction: string;
    category: string | null;
    accountType?: string | null;
  }>,
): Promise<Map<string, CategorizedMerchant>> {
  const results = new Map<string, CategorizedMerchant>();

  // Filter streams that need categorization
  const needsCategorization = streams.filter(
    (s) => !s.category && s.direction === "outflow"
  );

  // Also handle inflows - income detection
  const inflowStreams = streams.filter(
    (s) => !s.category && s.direction === "inflow"
  );

  // For inflows, if PFC is INCOME, categorize as income
  for (const stream of inflowStreams) {
    if (stream.pfcPrimary === "INCOME") {
      const result: CategorizedMerchant = {
        merchantName: stream.merchantName || stream.description || "Unknown",
        category: "income",
        confidence: 0.95,
        reasoning: "Plaid categorized as income",
        source: "global_cache",
      };
      results.set(stream.id, result);

      // Update stream record
      await db
        .update(financeRecurringStreams)
        .set({
          category: "income",
          categorySource: "pfc",
          categoryConfidence: "0.95",
        })
        .where(eq(financeRecurringStreams.id, stream.id));
    } else {
      // Non-income inflows (transfers, refunds) - categorize as transfer
      const result: CategorizedMerchant = {
        merchantName: stream.merchantName || stream.description || "Unknown",
        category: "transfer",
        confidence: 0.8,
        reasoning: "Inflow that is not income",
        source: "global_cache",
      };
      results.set(stream.id, result);

      await db
        .update(financeRecurringStreams)
        .set({
          category: "transfer",
          categorySource: "pfc",
          categoryConfidence: "0.80",
        })
        .where(eq(financeRecurringStreams.id, stream.id));
    }
  }

  if (needsCategorization.length === 0) {
    return results;
  }

  // Get merchant names for cache lookup
  const merchantNames = needsCategorization.map(
    (s) => s.merchantName || s.description || "Unknown"
  );

  // Step 1: Check global cache
  const cached = await checkGlobalCache(merchantNames);

  // Apply cached results
  for (const stream of needsCategorization) {
    const name = stream.merchantName || stream.description || "Unknown";
    const cachedResult = cached.get(name);
    if (cachedResult) {
      results.set(stream.id, cachedResult);

      // Update stream record
      await db
        .update(financeRecurringStreams)
        .set({
          category: cachedResult.category,
          categorySource: "global_cache",
          categoryConfidence: cachedResult.confidence.toString(),
        })
        .where(eq(financeRecurringStreams.id, stream.id));
    }
  }

  // Step 2: Find merchants not in cache
  const uncategorized = needsCategorization.filter((s) => {
    const name = s.merchantName || s.description || "Unknown";
    return !cached.has(name);
  });

  if (uncategorized.length > 0) {
    console.log(
      `[Categorizer] ${uncategorized.length} merchants need LLM categorization`
    );

    // Prepare for LLM
    const merchantsForLLM: MerchantToCategory[] = uncategorized.map((s) => ({
      merchantName: s.merchantName || s.description || "Unknown",
      description: s.description,
      amount: Math.abs(Number(s.averageAmount)),
      frequency: s.frequency,
      accountType: s.accountType || null,
      pfcPrimary: s.pfcPrimary,
    }));

    // Step 3: Call LLM
    const llmResults = await categorizeMerchantsWithLLM(merchantsForLLM);

    // Step 4: Store results
    for (let i = 0; i < uncategorized.length; i++) {
      const stream = uncategorized[i];
      const llmResult = llmResults[i];

      if (llmResult) {
        results.set(stream.id, llmResult);

        // Store in global cache
        await storeInGlobalCache(
          llmResult.merchantName,
          llmResult.category,
          llmResult.confidence,
          llmResult.reasoning,
          llmResult.source as "llm" | "llm_search"
        );

        // Update stream record
        await db
          .update(financeRecurringStreams)
          .set({
            category: llmResult.category,
            categorySource: llmResult.source,
            categoryConfidence: llmResult.confidence.toString(),
          })
          .where(eq(financeRecurringStreams.id, stream.id));
      }
    }
  }

  // Also return results for streams that already had categories
  for (const stream of streams.filter((s) => s.category)) {
    results.set(stream.id, {
      merchantName: stream.merchantName || stream.description || "Unknown",
      category: stream.category as TransactionCategory,
      confidence: 1.0,
      reasoning: "Previously categorized",
      source: "global_cache",
    });
  }

  return results;
}

/**
 * Get category for a single merchant (for real-time use)
 */
export async function getMerchantCategory(
  merchantName: string,
  description?: string,
  amount?: number,
  pfcPrimary?: string,
): Promise<CategorizedMerchant> {
  // Check cache first
  const cached = await checkGlobalCache([merchantName]);
  if (cached.has(merchantName)) {
    return cached.get(merchantName)!;
  }

  // Call LLM for single merchant
  const results = await categorizeMerchantsWithLLM([
    {
      merchantName,
      description: description || null,
      amount: amount || 0,
      frequency: "MONTHLY",
      accountType: null,
      pfcPrimary: pfcPrimary || null,
    },
  ]);

  if (results.length > 0) {
    // Store in cache
    await storeInGlobalCache(
      merchantName,
      results[0].category,
      results[0].confidence,
      results[0].reasoning,
      "llm"
    );
    return results[0];
  }

  // Fallback
  return {
    merchantName,
    category: "variable",
    confidence: 0.3,
    reasoning: "Could not categorize",
    source: "llm",
  };
}
