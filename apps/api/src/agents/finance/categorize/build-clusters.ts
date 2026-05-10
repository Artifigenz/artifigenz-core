import { eq } from "drizzle-orm";
import { db, financeTransactions, financeAccounts } from "@artifigenz/db";

export interface ClusterTxn {
  id: string;
  date: string;
  amount: number;
  description: string;
  merchantName: string | null;
  accountId: string | null;
  pfcPrimary: string | null;
}

export interface MerchantCluster {
  merchantNormalized: string;
  displayName: string;
  txns: ClusterTxn[];
  firstSeenDate: string;
  lastSeenDate: string;
  txnCount: number;
  totalAmount: number;
}

export interface AccountContext {
  id: string;
  institutionName: string | null;
  accountLast4: string | null;
  type: string | null;
  name: string | null;
}

/**
 * Pull all transactions for an agent_instance and group them by
 * merchant_normalized. Each cluster is one row's worth of work for the LLM
 * classifier — every transaction from the same merchant gets analyzed together
 * so the model can spot cadence.
 */
export async function buildClusters(
  agentInstanceId: string,
): Promise<MerchantCluster[]> {
  const rows = await db
    .select({
      id: financeTransactions.id,
      date: financeTransactions.transactionDate,
      amount: financeTransactions.amount,
      description: financeTransactions.description,
      merchantName: financeTransactions.merchantName,
      merchantNormalized: financeTransactions.merchantNormalized,
      accountId: financeTransactions.accountId,
      pfcPrimary: financeTransactions.personalFinanceCategoryPrimary,
    })
    .from(financeTransactions)
    .where(eq(financeTransactions.agentInstanceId, agentInstanceId));

  const map = new Map<string, MerchantCluster>();

  for (const r of rows) {
    if (!r.merchantNormalized) continue;
    const amount = parseFloat(r.amount);
    let cluster = map.get(r.merchantNormalized);
    if (!cluster) {
      cluster = {
        merchantNormalized: r.merchantNormalized,
        displayName: pickDisplayName(r.merchantName, r.description),
        txns: [],
        firstSeenDate: r.date,
        lastSeenDate: r.date,
        txnCount: 0,
        totalAmount: 0,
      };
      map.set(r.merchantNormalized, cluster);
    }
    cluster.txns.push({
      id: r.id,
      date: r.date,
      amount,
      description: r.description,
      merchantName: r.merchantName,
      accountId: r.accountId,
      pfcPrimary: r.pfcPrimary,
    });
    cluster.txnCount++;
    cluster.totalAmount += amount;
    if (r.date < cluster.firstSeenDate) cluster.firstSeenDate = r.date;
    if (r.date > cluster.lastSeenDate) cluster.lastSeenDate = r.date;
  }

  return Array.from(map.values()).sort(
    (a, b) => Math.abs(b.totalAmount) - Math.abs(a.totalAmount),
  );
}

export async function loadAccountContext(
  agentInstanceId: string,
): Promise<AccountContext[]> {
  return db
    .select({
      id: financeAccounts.id,
      institutionName: financeAccounts.institutionName,
      accountLast4: financeAccounts.accountLast4,
      type: financeAccounts.type,
      name: financeAccounts.name,
    })
    .from(financeAccounts)
    .where(eq(financeAccounts.agentInstanceId, agentInstanceId));
}

function pickDisplayName(
  merchantName: string | null,
  description: string,
): string {
  if (merchantName && merchantName.trim()) return merchantName.trim();
  return description.slice(0, 60).trim();
}
