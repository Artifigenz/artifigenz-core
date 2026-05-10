import { and, desc, eq } from "drizzle-orm";
import {
  db,
  financeTransactions,
  financeAccounts,
  merchantClusters,
} from "@artifigenz/db";
import { CATEGORIES, type Category } from "../categorize/llm-classify";

export interface CategoryTotal {
  monthly: number;
  total: number;
  txnCount: number;
  topMerchants: Array<{ merchant: string; monthly: number; cadence: string | null }>;
}

export interface RecurringStream {
  merchant: string;
  category: Category;
  cadence: string;
  monthlyAmount: number;
  confidence: number;
}

export interface RiskFlags {
  negativeBalanceDays: number;
  nsfCount: number;
}

export interface Digest {
  agentInstanceId: string;
  generatedAt: string;
  daysOfData: number;
  monthsOfData: number;
  accountsCount: number;
  isoCurrencyCode: string | null;
  incomeMonthly: number;
  expensesMonthly: number;
  leftoverMonthly: number;
  categoryTotals: Record<Category, CategoryTotal>;
  recurringStreams: RecurringStream[];
  riskFlags: RiskFlags;
  earliestTxnDate: string | null;
  latestTxnDate: string | null;
}

// Categories that count as outgoing money for the "expenses" total.
// internal_transfer is excluded (it's not net spending — it's moving your own
// money). income is obviously not an expense.
const EXPENSE_CATEGORIES: Category[] = [
  "subscription",
  "loan_emi",
  "fee_interest",
  "variable_recurring",
  "miscellaneous",
];

export async function buildDigest(agentInstanceId: string): Promise<Digest> {
  const txnRows = await db
    .select({
      id: financeTransactions.id,
      date: financeTransactions.transactionDate,
      amount: financeTransactions.amount,
      category: financeTransactions.category,
      isRecurring: financeTransactions.isRecurring,
      merchantNormalized: financeTransactions.merchantNormalized,
      pfcPrimary: financeTransactions.personalFinanceCategoryPrimary,
      description: financeTransactions.description,
    })
    .from(financeTransactions)
    .where(eq(financeTransactions.agentInstanceId, agentInstanceId));

  const clusters = await db
    .select({
      merchantNormalized: merchantClusters.merchantNormalized,
      displayName: merchantClusters.displayName,
      category: merchantClusters.category,
      isRecurring: merchantClusters.isRecurring,
      cadence: merchantClusters.cadence,
      monthlyAmount: merchantClusters.monthlyAmount,
      confidence: merchantClusters.confidence,
    })
    .from(merchantClusters)
    .where(eq(merchantClusters.agentInstanceId, agentInstanceId));
  const clusterMap = new Map(clusters.map((c) => [c.merchantNormalized, c]));

  const accounts = await db
    .select({
      id: financeAccounts.id,
      isoCurrencyCode: financeAccounts.isoCurrencyCode,
    })
    .from(financeAccounts)
    .where(eq(financeAccounts.agentInstanceId, agentInstanceId));

  // Determine the data window
  let earliest: string | null = null;
  let latest: string | null = null;
  for (const t of txnRows) {
    if (!earliest || t.date < earliest) earliest = t.date;
    if (!latest || t.date > latest) latest = t.date;
  }

  const daysOfData = earliest && latest ? daysBetween(earliest, latest) + 1 : 0;
  const monthsOfData = Math.max(daysOfData / 30, 0.0001);

  // Initialize category buckets
  const categoryTotals = {} as Record<Category, CategoryTotal>;
  for (const cat of CATEGORIES) {
    categoryTotals[cat] = { monthly: 0, total: 0, txnCount: 0, topMerchants: [] };
  }

  // Aggregate by merchant_normalized for top-merchants per category
  const perMerchantPerCategory = new Map<
    string,
    { category: Category; total: number; cadence: string | null; displayName: string }
  >();

  for (const t of txnRows) {
    if (!t.category) continue;
    const cat = t.category as Category;
    if (!(cat in categoryTotals)) continue;

    const amt = parseFloat(t.amount);
    categoryTotals[cat].total += Math.abs(amt);
    categoryTotals[cat].txnCount++;

    if (t.merchantNormalized) {
      const key = `${cat}::${t.merchantNormalized}`;
      const existing = perMerchantPerCategory.get(key);
      const cluster = clusterMap.get(t.merchantNormalized);
      const displayName = cluster?.displayName ?? t.merchantNormalized;
      const cadence = cluster?.cadence ?? null;
      if (existing) {
        existing.total += Math.abs(amt);
      } else {
        perMerchantPerCategory.set(key, {
          category: cat,
          total: Math.abs(amt),
          cadence,
          displayName,
        });
      }
    }
  }

  // For recurring categories, prefer the LLM-estimated monthly_amount from the
  // cluster (which normalizes cadence). For non-recurring categories, divide
  // the observed total by months_of_data.
  for (const cluster of clusters) {
    if (!cluster.isRecurring) continue;
    const cat = cluster.category as Category;
    if (!(cat in categoryTotals)) continue;
    categoryTotals[cat].monthly += parseFloat(cluster.monthlyAmount ?? "0");
  }

  for (const cat of CATEGORIES) {
    // For categories where we didn't sum from recurring streams, fall back to
    // (total / months_of_data). This catches one-off / variable / miscellaneous.
    if (categoryTotals[cat].monthly === 0 && categoryTotals[cat].total > 0) {
      categoryTotals[cat].monthly = categoryTotals[cat].total / monthsOfData;
    }
  }

  // Top-3 merchants per category (by total)
  const topByCat = new Map<Category, Array<{ merchant: string; monthly: number; cadence: string | null }>>();
  for (const cat of CATEGORIES) topByCat.set(cat, []);
  for (const v of perMerchantPerCategory.values()) {
    topByCat.get(v.category)!.push({
      merchant: v.displayName,
      monthly: v.total / monthsOfData,
      cadence: v.cadence,
    });
  }
  for (const cat of CATEGORIES) {
    const arr = topByCat.get(cat)!;
    arr.sort((a, b) => b.monthly - a.monthly);
    categoryTotals[cat].topMerchants = arr.slice(0, 3);
  }

  const incomeMonthly = categoryTotals.income.monthly;
  const expensesMonthly = EXPENSE_CATEGORIES.reduce(
    (s, c) => s + categoryTotals[c].monthly,
    0,
  );
  const leftoverMonthly = incomeMonthly - expensesMonthly;

  const recurringStreams: RecurringStream[] = clusters
    .filter((c) => c.isRecurring)
    .map((c) => ({
      merchant: c.displayName ?? c.merchantNormalized,
      category: c.category as Category,
      cadence: c.cadence ?? "irregular",
      monthlyAmount: parseFloat(c.monthlyAmount ?? "0"),
      confidence: parseFloat(c.confidence ?? "0"),
    }))
    .sort((a, b) => b.monthlyAmount - a.monthlyAmount);

  const riskFlags: RiskFlags = {
    negativeBalanceDays: 0, // not tracked in step 4 — needs balance history
    nsfCount: countNsf(txnRows),
  };

  return {
    agentInstanceId,
    generatedAt: new Date().toISOString(),
    daysOfData,
    monthsOfData,
    accountsCount: accounts.length,
    isoCurrencyCode: accounts[0]?.isoCurrencyCode ?? null,
    incomeMonthly,
    expensesMonthly,
    leftoverMonthly,
    categoryTotals,
    recurringStreams,
    riskFlags,
    earliestTxnDate: earliest,
    latestTxnDate: latest,
  };
}

function countNsf(
  txns: Array<{ description: string; pfcPrimary: string | null; category: string | null }>,
): number {
  let count = 0;
  for (const t of txns) {
    if (t.category === "fee_interest") {
      const d = t.description.toLowerCase();
      if (
        d.includes("overdraft") ||
        d.includes("nsf") ||
        d.includes("insufficient")
      ) {
        count++;
      }
    } else if (
      t.pfcPrimary &&
      t.pfcPrimary.toUpperCase().includes("BANK_FEES_OVERDRAFT")
    ) {
      count++;
    }
  }
  return count;
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db = new Date(b + "T00:00:00Z").getTime();
  return Math.round((db - da) / (24 * 60 * 60 * 1000));
}
